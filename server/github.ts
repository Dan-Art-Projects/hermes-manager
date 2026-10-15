import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './vault.ts';
import type { Store } from './store.ts';
import type { Vault } from './vault.ts';
import type {
  GitHubIssue,
  GitHubProjectItem,
  GitHubProjectV2,
  GitHubRepo,
  GitHubSync,
  Runner,
  TaskStatus,
} from '../shared/types.ts';

const runner = z.enum(['hermes', 'claude', 'codex', 'opencode']);

async function ghFetch(path: string, token: string, opts?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts?.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, 'Could not reach the GitHub API. Check your network connection.');
  }
  if (!res.ok) {
    const status = res.status === 401 || res.status === 403 ? res.status : 502;
    throw new ApiError(status, `GitHub API error (HTTP ${res.status}).`);
  }
  return res.json();
}

async function ghGraphQL(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(502, 'Could not reach the GitHub API. Check your network connection.');
  }
  if (!res.ok) throw new ApiError(502, `GitHub GraphQL error (HTTP ${res.status}).`);
  const body = (await res.json()) as { data?: unknown; errors?: unknown[] };
  if (body.errors?.length) throw new ApiError(502, 'GitHub GraphQL returned errors.');
  return body.data;
}

function mapRepo(r: Record<string, unknown>): GitHubRepo {
  return {
    id: r.id as number,
    fullName: r.full_name as string,
    name: r.name as string,
    owner: (r.owner as Record<string, unknown>).login as string,
    description: (r.description as string | null) ?? null,
    url: r.html_url as string,
    private: r.private as boolean,
    openIssuesCount: r.open_issues_count as number,
    language: (r.language as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

function mapIssue(i: Record<string, unknown>, isPr = false): GitHubIssue {
  return {
    number: i.number as number,
    title: i.title as string,
    body: (i.body as string | null) ?? null,
    state: i.state as 'open' | 'closed',
    url: i.html_url as string,
    labels: ((i.labels as Array<Record<string, unknown>>) ?? []).map((l) => l.name as string),
    createdAt: i.created_at as string,
    updatedAt: i.updated_at as string,
    isPullRequest: isPr || !!(i.pull_request),
  };
}

function getToken(store: Store, vault: Vault): string {
  vault.requireUnlocked();
  const sealed = store.githubTokenSealed();
  if (!sealed) throw new ApiError(409, 'No GitHub token configured.', 'GITHUB_NOT_CONFIGURED');
  return vault.decryptGitHubToken(sealed);
}

export async function runSyncTick(store: Store, vault: Vault, changed: () => void): Promise<void> {
  if (!vault.state.unlocked) return;
  const sealed = store.githubTokenSealed();
  if (!sealed) return;
  let token: string;
  try {
    token = vault.decryptGitHubToken(sealed);
  } catch {
    return;
  }
  const syncs = store.githubSyncs();
  let dirty = false;
  for (const sync of syncs) {
    if (!sync.enabled || Date.parse(sync.nextRun) > Date.now()) continue;
    try {
      const items = await fetchSyncItems(sync, token);
      const existingRefs = new Set(store.tasks().map((t) => t.githubRef).filter(Boolean));
      const agent = store.agent(sync.agentId);
      const now = new Date().toISOString();
      let created = 0;
      for (const item of items) {
        if (!item.url || existingRefs.has(item.url)) continue;
        store.saveTask({
          id: randomUUID(),
          title: item.title.slice(0, 200),
          description: item.body ?? '',
          agentId: sync.agentId,
          runner: sync.runner ?? 'hermes',
          status: 'backlog',
          priority: 'medium',
          createdAt: now,
          updatedAt: now,
          githubRef: item.url,
          tags: [],
          chain: [],
        });
        created++;
      }
      sync.lastSyncedAt = now;
      sync.lastError = undefined;
      if (created > 0 && agent) {
        store.addActivity('task', `GitHub sync "${sync.name}" created ${created} task(s) for ${agent.name}.`);
      }
    } catch (err) {
      sync.lastError = err instanceof Error ? err.message : 'Unknown error during sync.';
    }
    const step = sync.intervalMinutes * 60000;
    sync.nextRun = new Date(Date.now() + step).toISOString();
    dirty = true;
  }
  if (dirty) {
    store.saveGithubSyncs(syncs);
    changed();
  }
}

async function fetchSyncItems(
  sync: GitHubSync,
  token: string,
): Promise<Array<{ title: string; body?: string; url: string }>> {
  if (sync.type === 'project' && sync.projectNodeId) {
    const data = (await ghGraphQL(
      `query($nodeId: ID!, $cursor: String) {
        node(id: $nodeId) {
          ... on ProjectV2 {
            items(first: 100, after: $cursor) {
              nodes {
                id
                content {
                  ... on Issue { title body url }
                  ... on PullRequest { title body url }
                  ... on DraftIssue { title body }
                }
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
                  }
                }
              }
            }
          }
        }
      }`,
      { nodeId: sync.projectNodeId },
      token,
    )) as { node?: { items?: { nodes?: Array<Record<string, unknown>> } } };
    return (data?.node?.items?.nodes ?? []).map((n) => {
      const content = n.content as Record<string, unknown> | undefined;
      return {
        title: (content?.title as string) ?? 'Untitled',
        body: content?.body as string | undefined,
        url: (content?.url as string) ?? '',
      };
    });
  }

  if (!sync.repoFullName) return [];
  const [owner, repo] = sync.repoFullName.split('/');
  const stateParam = sync.stateFilter && sync.stateFilter !== 'all' ? sync.stateFilter : 'open';

  if (sync.type === 'prs') {
    const prs = (await ghFetch(
      `/repos/${owner}/${repo}/pulls?state=${stateParam}&per_page=100`,
      token,
    )) as Array<Record<string, unknown>>;
    return prs.map((p) => ({ title: p.title as string, body: (p.body as string) || undefined, url: p.html_url as string }));
  }

  const labelParam = sync.labelFilter?.length ? `&labels=${encodeURIComponent(sync.labelFilter.join(','))}` : '';
  const issues = (await ghFetch(
    `/repos/${owner}/${repo}/issues?state=${stateParam}&per_page=100${labelParam}`,
    token,
  )) as Array<Record<string, unknown>>;
  return issues
    .filter((i) => !i.pull_request)
    .map((i) => ({ title: i.title as string, body: (i.body as string) || undefined, url: i.html_url as string }));
}

export function githubApi(
  app: Express,
  store: Store,
  vault: Vault,
  changed: () => void,
): void {
  setInterval(() => void runSyncTick(store, vault, changed), 60_000);

  app.post('/api/github/token', (req, res) => {
    vault.requireUnlocked();
    const { token } = z.object({ token: z.string().min(1).max(4096) }).strict().parse(req.body);
    const sealed = vault.encryptGitHubToken(token);
    store.saveGithubToken(sealed);
    store.addActivity('system', 'GitHub account connected.');
    changed();
    res.json({ ok: true });
  });

  app.delete('/api/github/token', (_req, res) => {
    vault.requireUnlocked();
    store.clearGithubToken();
    store.addActivity('system', 'GitHub account disconnected.');
    changed();
    res.json({ ok: true });
  });

  app.get('/api/github/repos', async (_req, res) => {
    const token = getToken(store, vault);
    const repos: GitHubRepo[] = [];
    let page = 1;
    while (page <= 10) {
      const batch = (await ghFetch(
        `/user/repos?per_page=100&page=${page}&sort=updated`,
        token,
      )) as Array<Record<string, unknown>>;
      repos.push(...batch.map(mapRepo));
      if (batch.length < 100) break;
      page++;
    }
    res.json(repos);
  });

  app.get('/api/github/repos/:owner/:repo/issues', async (req, res) => {
    const token = getToken(store, vault);
    const { owner, repo } = req.params;
    const state = (req.query.state as string) || 'open';
    const issues = (await ghFetch(
      `/repos/${owner}/${repo}/issues?state=${state}&per_page=100`,
      token,
    )) as Array<Record<string, unknown>>;
    res.json(issues.filter((i) => !i.pull_request).map((i) => mapIssue(i)));
  });

  app.get('/api/github/repos/:owner/:repo/pulls', async (req, res) => {
    const token = getToken(store, vault);
    const { owner, repo } = req.params;
    const state = (req.query.state as string) || 'open';
    const prs = (await ghFetch(
      `/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`,
      token,
    )) as Array<Record<string, unknown>>;
    res.json(prs.map((p) => mapIssue(p, true)));
  });

  app.get('/api/github/projects', async (_req, res) => {
    const token = getToken(store, vault);
    const viewer = (await ghGraphQL(
      `query {
        viewer {
          login
          projectsV2(first: 50) {
            nodes { id number title url closed }
          }
          organizations(first: 20) {
            nodes {
              login
              projectsV2(first: 50) {
                nodes { id number title url closed }
              }
            }
          }
        }
      }`,
      {},
      token,
    )) as {
      viewer: {
        login: string;
        projectsV2: { nodes: Array<Record<string, unknown>> };
        organizations: { nodes: Array<{ login: string; projectsV2: { nodes: Array<Record<string, unknown>> } }> };
      };
    };
    const projects: GitHubProjectV2[] = [];
    for (const p of viewer.viewer.projectsV2.nodes) {
      projects.push({ id: p.id as string, number: p.number as number, title: p.title as string, url: p.url as string, closed: p.closed as boolean, owner: viewer.viewer.login });
    }
    for (const org of viewer.viewer.organizations.nodes) {
      for (const p of org.projectsV2.nodes) {
        projects.push({ id: p.id as string, number: p.number as number, title: p.title as string, url: p.url as string, closed: p.closed as boolean, owner: org.login });
      }
    }
    res.json(projects);
  });

  app.get('/api/github/projects/:nodeId/items', async (req, res) => {
    const token = getToken(store, vault);
    const data = (await ghGraphQL(
      `query($nodeId: ID!, $cursor: String) {
        node(id: $nodeId) {
          ... on ProjectV2 {
            items(first: 100, after: $cursor) {
              nodes {
                id
                content {
                  ... on Issue { title body url number }
                  ... on PullRequest { title body url number }
                  ... on DraftIssue { title body }
                }
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { nodeId: req.params.nodeId },
      token,
    )) as { node?: { items?: { nodes?: Array<Record<string, unknown>> } } };
    const items: GitHubProjectItem[] = (data?.node?.items?.nodes ?? []).map((n) => {
      const content = n.content as Record<string, unknown> | undefined;
      const statusField = ((n.fieldValues as { nodes?: Array<Record<string, unknown>> })?.nodes ?? []).find(
        (fv) => (fv.field as Record<string, unknown> | undefined)?.name === 'Status',
      );
      return {
        id: n.id as string,
        title: (content?.title as string) ?? 'Untitled',
        body: content?.body as string | undefined,
        url: content?.url as string | undefined,
        number: content?.number as number | undefined,
        status: statusField?.name as string | undefined,
      };
    });
    res.json(items);
  });

  app.post('/api/github/sync', (req, res) => {
    const input = z
      .object({
        items: z.array(
          z.object({
            title: z.string().min(1).max(200),
            body: z.string().max(64000).optional(),
            url: z.string().max(2048),
          }),
        ).max(500),
        agentId: z.string().uuid(),
        runner: runner.optional(),
        status: z.enum(['backlog', 'ready', 'waiting', 'review', 'done', 'blocked']).optional(),
      })
      .strict()
      .parse(req.body);
    if (!store.agent(input.agentId)) throw new ApiError(404, 'Agent not found.');
    const existingRefs = new Set(store.tasks().map((t) => t.githubRef).filter(Boolean));
    const now = new Date().toISOString();
    let created = 0;
    let skipped = 0;
    for (const item of input.items) {
      if (item.url && existingRefs.has(item.url)) { skipped++; continue; }
      store.saveTask({
        id: randomUUID(),
        title: item.title,
        description: item.body ?? '',
        agentId: input.agentId,
        runner: (input.runner as Runner | undefined) ?? 'hermes',
        status: (input.status as TaskStatus | undefined) ?? 'backlog',
        priority: 'medium',
        createdAt: now,
        updatedAt: now,
        githubRef: item.url || undefined,
        tags: [],
        chain: [],
      });
      created++;
    }
    if (created > 0) {
      store.addActivity('task', `Imported ${created} GitHub item(s) as tasks.`);
      changed();
    }
    res.status(201).json({ created, skipped });
  });

  app.get('/api/github/syncs', (_req, res) => {
    res.json(store.githubSyncs());
  });

  app.post('/api/github/syncs', (req, res) => {
    vault.requireUnlocked();
    const input = z
      .object({
        name: z.string().trim().min(1).max(200),
        type: z.enum(['issues', 'prs', 'project']),
        repoFullName: z.string().max(200).optional(),
        projectNodeId: z.string().max(200).optional(),
        agentId: z.string().uuid(),
        runner: runner.optional(),
        enabled: z.boolean().default(true),
        intervalMinutes: z.number().int().min(1).max(10080),
        labelFilter: z.array(z.string().max(100)).max(20).optional(),
        stateFilter: z.enum(['open', 'closed', 'all']).optional(),
      })
      .strict()
      .parse(req.body);
    if (!store.agent(input.agentId)) throw new ApiError(404, 'Agent not found.');
    const syncs = store.githubSyncs();
    if (syncs.length >= 50) throw new ApiError(409, 'GitHub sync limit reached (50).');
    const item: GitHubSync = {
      ...input,
      id: randomUUID(),
      nextRun: new Date(Date.now() + input.intervalMinutes * 60000).toISOString(),
    };
    store.saveGithubSyncs([...syncs, item]);
    store.addActivity('system', `GitHub sync "${item.name}" created.`);
    changed();
    res.status(201).json(item);
  });

  app.patch('/api/github/syncs/:id', (req, res) => {
    vault.requireUnlocked();
    const input = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        type: z.enum(['issues', 'prs', 'project']).optional(),
        repoFullName: z.string().max(200).optional(),
        projectNodeId: z.string().max(200).optional(),
        agentId: z.string().uuid().optional(),
        runner: runner.optional(),
        enabled: z.boolean().optional(),
        intervalMinutes: z.number().int().min(1).max(10080).optional(),
        labelFilter: z.array(z.string().max(100)).max(20).optional(),
        stateFilter: z.enum(['open', 'closed', 'all']).optional(),
      })
      .strict()
      .parse(req.body);
    const syncs = store.githubSyncs();
    const index = syncs.findIndex((s) => s.id === req.params.id);
    if (index < 0) throw new ApiError(404, 'GitHub sync not found.');
    if (input.agentId && !store.agent(input.agentId)) throw new ApiError(404, 'Agent not found.');
    syncs[index] = { ...syncs[index], ...input, lastError: undefined };
    store.saveGithubSyncs(syncs);
    store.addActivity('system', `GitHub sync "${syncs[index].name}" updated.`);
    changed();
    res.json(syncs[index]);
  });

  app.delete('/api/github/syncs/:id', (req, res) => {
    vault.requireUnlocked();
    const syncs = store.githubSyncs();
    const item = syncs.find((s) => s.id === req.params.id);
    if (!item) throw new ApiError(404, 'GitHub sync not found.');
    store.saveGithubSyncs(syncs.filter((s) => s.id !== item.id));
    store.addActivity('system', `GitHub sync "${item.name}" deleted.`);
    changed();
    res.json({ ok: true });
  });

  app.post('/api/github/syncs/:id/run', async (req, res) => {
    const token = getToken(store, vault);
    const syncs = store.githubSyncs();
    const index = syncs.findIndex((s) => s.id === req.params.id);
    if (index < 0) throw new ApiError(404, 'GitHub sync not found.');
    const sync = syncs[index];
    try {
      const items = await fetchSyncItems(sync, token);
      const existingRefs = new Set(store.tasks().map((t) => t.githubRef).filter(Boolean));
      const agent = store.agent(sync.agentId);
      const now = new Date().toISOString();
      let created = 0;
      for (const item of items) {
        if (!item.url || existingRefs.has(item.url)) continue;
        store.saveTask({
          id: randomUUID(),
          title: item.title.slice(0, 200),
          description: item.body ?? '',
          agentId: sync.agentId,
          runner: sync.runner ?? 'hermes',
          status: 'backlog',
          priority: 'medium',
          createdAt: now,
          updatedAt: now,
          githubRef: item.url,
          tags: [],
          chain: [],
        });
        created++;
      }
      syncs[index].lastSyncedAt = now;
      syncs[index].lastError = undefined;
      syncs[index].nextRun = new Date(Date.now() + sync.intervalMinutes * 60000).toISOString();
      store.saveGithubSyncs(syncs);
      if (created > 0 && agent) {
        store.addActivity('task', `Manual GitHub sync "${sync.name}" created ${created} task(s) for ${agent.name}.`);
      }
      changed();
      res.json({ created, skipped: items.length - created });
    } catch (err) {
      syncs[index].lastError = err instanceof Error ? err.message : 'Unknown error.';
      store.saveGithubSyncs(syncs);
      changed();
      throw err;
    }
  });
}

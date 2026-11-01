import { useMemo, useState } from 'react';
import {
  BrainCircuit,
  Clock3,
  Code2,
  FileText,
  Hash,
  LayoutGrid,
  Lightbulb,
  Link,
  Network,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { Agent, BrainEntry, BrainEntryType, Task } from '../../shared/types';
import { relativeTime } from '../api';
import type { Request } from '../api';

type ViewMode = 'grid' | 'timeline' | 'explore';

interface BrainViewProps {
  entries: BrainEntry[];
  agents: Agent[];
  tasks: Task[];
  openaiConfigured: boolean;
  request: Request;
}

const typeIcons: Record<BrainEntryType, typeof FileText> = {
  note: FileText,
  link: Link,
  snippet: Code2,
  insight: Lightbulb,
  'task-summary': Sparkles,
};

const typeLabels: Record<BrainEntryType, string> = {
  note: 'Note',
  link: 'Link',
  snippet: 'Snippet',
  insight: 'Insight',
  'task-summary': 'Summary',
};

const typeColor: Record<BrainEntryType, string> = {
  note: 'blue',
  link: 'violet',
  snippet: 'green',
  insight: 'amber',
  'task-summary': 'muted',
};

// ── Enhanced card ────────────────────────────────────────────────────────────
function BrainCard({
  entry,
  agents,
  tasks,
  onEdit,
  onDelete,
}: {
  entry: BrainEntry;
  agents: Agent[];
  tasks: Task[];
  onEdit: (e: BrainEntry) => void;
  onDelete: (id: string) => void;
}) {
  const TypeIcon = typeIcons[entry.type];
  const agent = agents.find((a) => a.id === entry.agentId);
  const task = entry.taskId ? tasks.find((t) => t.id === entry.taskId) : undefined;
  const color = typeColor[entry.type];
  return (
    <div className={`brain-card bc-${color}`}>
      <div className="brain-card-type">
        <TypeIcon size={11} />
        {typeLabels[entry.type]}
        {entry.source === 'ai-extracted' && <span className="brain-card-ai-badge">AI</span>}
        {entry.source === 'auto' && <span className="brain-card-auto-badge">Auto</span>}
      </div>
      <h4>{entry.title}</h4>
      {entry.type === 'snippet' && entry.content ? (
        <pre className="brain-card-code">{entry.content.slice(0, 300)}{entry.content.length > 300 ? '\n…' : ''}</pre>
      ) : entry.content ? (
        <p>{entry.content.slice(0, 200)}{entry.content.length > 200 ? '…' : ''}</p>
      ) : null}
      {entry.url && (
        <a href={entry.url} className="brain-card-url" target="_blank" rel="noreferrer">
          {entry.url}
        </a>
      )}
      {task && (
        <div className="brain-card-task">
          <Sparkles size={10} />
          {task.title}
        </div>
      )}
      <div className="brain-card-footer">
        <div className="brain-card-tags">
          {entry.tags.map((t) => (
            <span key={t} className="brain-tag-chip small">
              <Hash size={9} />
              {t}
            </span>
          ))}
        </div>
        <span className="task-age">
          <Clock3 size={10} />
          {relativeTime(entry.createdAt)}
          {agent && ` · ${agent.name}`}
        </span>
      </div>
      <div className="brain-card-actions">
        <button onClick={() => onEdit(entry)} title="Edit"><Pencil size={12} /></button>
        <button onClick={() => onDelete(entry.id)} title="Delete"><X size={12} /></button>
      </div>
    </div>
  );
}

// ── Timeline entry row ───────────────────────────────────────────────────────
function TimelineRow({
  entry,
  agents,
  tasks,
  onEdit,
  onDelete,
}: {
  entry: BrainEntry;
  agents: Agent[];
  tasks: Task[];
  onEdit: (e: BrainEntry) => void;
  onDelete: (id: string) => void;
}) {
  const TypeIcon = typeIcons[entry.type];
  const agent = agents.find((a) => a.id === entry.agentId);
  const task = entry.taskId ? tasks.find((t) => t.id === entry.taskId) : undefined;
  const color = typeColor[entry.type];
  return (
    <div className={`brain-tl-row btl-${color}`}>
      <div className="brain-tl-marker">
        <span className={`brain-tl-dot btl-dot-${color}`}><TypeIcon size={9} /></span>
      </div>
      <div className="brain-tl-body">
        <div className="brain-tl-meta">
          <span className={`brain-tl-type btl-type-${color}`}>{typeLabels[entry.type]}</span>
          {agent && <span className="brain-tl-agent">{agent.name}</span>}
          {task && <span className="brain-tl-task"><Sparkles size={9} />{task.title}</span>}
          <span className="brain-tl-time">{relativeTime(entry.createdAt)}</span>
        </div>
        <h4 className="brain-tl-title">{entry.title}</h4>
        {entry.type === 'snippet' && entry.content ? (
          <pre className="brain-card-code tl-code">{entry.content.slice(0, 200)}{entry.content.length > 200 ? '\n…' : ''}</pre>
        ) : entry.content ? (
          <p className="brain-tl-content">{entry.content.slice(0, 160)}{entry.content.length > 160 ? '…' : ''}</p>
        ) : null}
        {entry.tags.length > 0 && (
          <div className="brain-tl-tags">
            {entry.tags.map((t) => (
              <span key={t} className="brain-tag-chip small"><Hash size={9} />{t}</span>
            ))}
          </div>
        )}
      </div>
      <div className="brain-card-actions tl-actions">
        <button onClick={() => onEdit(entry)} title="Edit"><Pencil size={12} /></button>
        <button onClick={() => onDelete(entry.id)} title="Delete"><X size={12} /></button>
      </div>
    </div>
  );
}

// ── Explore (tag bento grid) ─────────────────────────────────────────────────
function ExploreView({
  entries,
  agents,
  tasks,
  onEdit,
  onDelete,
}: {
  entries: BrainEntry[];
  agents: Agent[];
  tasks: Task[];
  onEdit: (e: BrainEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [focusTag, setFocusTag] = useState<string | null>(null);

  const tagData = useMemo(() => {
    const map = new Map<string, { entries: BrainEntry[]; types: Record<string, number> }>();
    for (const entry of entries) {
      for (const tag of entry.tags) {
        const d = map.get(tag) ?? { entries: [], types: {} };
        d.entries.push(entry);
        d.types[entry.type] = (d.types[entry.type] ?? 0) + 1;
        map.set(tag, d);
      }
    }
    return [...map.entries()]
      .map(([tag, d]) => ({
        tag,
        count: d.entries.length,
        entries: d.entries,
        dominant: Object.entries(d.types).sort((a, b) => b[1] - a[1])[0]?.[0] as BrainEntryType | undefined,
      }))
      .sort((a, b) => b.count - a.count);
  }, [entries]);

  const untagged = entries.filter((e) => e.tags.length === 0);
  const focusEntries = focusTag ? (tagData.find((t) => t.tag === focusTag)?.entries ?? []) : [];

  return (
    <div className="brain-explore">
      {tagData.length === 0 ? (
        <p className="brain-explore-hint">Add tags to your entries to see them explored here.</p>
      ) : (
        <>
          <p className="brain-explore-hint">Click a topic to explore its entries.</p>
          <div className="brain-bento">
            {tagData.map(({ tag, count, dominant }, i) => {
              const size = i === 0 ? 'xl' : i < 3 ? 'lg' : i < 8 ? 'md' : 'sm';
              const color = dominant ? typeColor[dominant] : 'muted';
              return (
                <button
                  key={tag}
                  className={`brain-bento-tile bb-${size} bb-color-${color} ${focusTag === tag ? 'active' : ''}`}
                  onClick={() => setFocusTag(focusTag === tag ? null : tag)}
                >
                  <span className="bb-count">{count}</span>
                  <span className="bb-tag"><Hash size={10} />{tag}</span>
                </button>
              );
            })}
            {untagged.length > 0 && (
              <button
                className={`brain-bento-tile bb-sm bb-color-muted ${focusTag === '__untagged' ? 'active' : ''}`}
                onClick={() => setFocusTag(focusTag === '__untagged' ? null : '__untagged')}
              >
                <span className="bb-count">{untagged.length}</span>
                <span className="bb-tag">untagged</span>
              </button>
            )}
          </div>

          {focusTag && (
            <div className="brain-explore-results">
              <div className="brain-explore-results-header">
                <Hash size={13} />
                <strong>{focusTag === '__untagged' ? 'Untagged' : focusTag}</strong>
                <span>{focusEntries.length || untagged.length} entries</span>
                <button className="icon-button" onClick={() => setFocusTag(null)}><X size={14} /></button>
              </div>
              <div className="brain-cluster-grid">
                {(focusTag === '__untagged' ? untagged : focusEntries).map((e) => (
                  <BrainCard key={e.id} entry={e} agents={agents} tasks={tasks} onEdit={onEdit} onDelete={onDelete} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Entry form modal ─────────────────────────────────────────────────────────
interface EntryFormState {
  type: BrainEntryType;
  title: string;
  content: string;
  url: string;
  tags: string;
  agentId: string;
}

function BrainEntryModal({
  initial,
  agents,
  onSave,
  onClose,
}: {
  initial?: BrainEntry;
  agents: Agent[];
  onSave: (data: EntryFormState) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<EntryFormState>({
    type: initial?.type ?? 'note',
    title: initial?.title ?? '',
    content: initial?.content ?? '',
    url: initial?.url ?? '',
    tags: initial?.tags.join(', ') ?? '',
    agentId: initial?.agentId ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key: keyof EntryFormState, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const types: BrainEntryType[] = ['note', 'link', 'snippet', 'insight', 'task-summary'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="brain-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="brain-modal">
        <div className="brain-modal-header">
          <h3><NotebookPen size={16} />{initial ? 'Edit entry' : 'Add to Second Brain'}</h3>
          <button className="icon-button" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="brain-type-tabs">
            {types.map((t) => {
              const Icon = typeIcons[t];
              return (
                <button key={t} type="button" className={`brain-type-tab ${form.type === t ? 'active' : ''}`} onClick={() => set('type', t)}>
                  <Icon size={12} />{typeLabels[t]}
                </button>
              );
            })}
          </div>
          <label>Title<input required maxLength={200} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Give this entry a clear title" /></label>
          {form.type === 'link' ? (
            <label>URL<input type="url" required value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://..." /></label>
          ) : (
            <label>
              {form.type === 'snippet' ? 'Code' : form.type === 'insight' ? 'Insight' : 'Content'}
              <textarea rows={4} maxLength={10000} value={form.content} onChange={(e) => set('content', e.target.value)}
                placeholder={form.type === 'snippet' ? 'Paste your code snippet here...' : form.type === 'insight' ? 'What did you learn?' : 'Your notes...'} />
            </label>
          )}
          <label>Tags<input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="typescript, backend, auth (comma-separated)" /></label>
          <label>Agent (optional)
            <select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}>
              <option value="">No agent</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="brain-modal-footer">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Add entry'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────
export default function BrainView({ entries, agents, tasks, request }: BrainViewProps) {
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState<BrainEntry | null>(null);

  const q = search.toLowerCase();
  const filtered = entries.filter(
    (e) =>
      (!q || e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q))) &&
      (!activeTag || e.tags.includes(activeTag)),
  );

  const allTags = [...new Set(entries.flatMap((e) => e.tags))].sort();

  // Type breakdown counts
  const typeCounts = useMemo(() => {
    const types: BrainEntryType[] = ['insight', 'note', 'snippet', 'link', 'task-summary'];
    return types.map((type) => ({ type, count: entries.filter((e) => e.type === type).length })).filter((t) => t.count > 0);
  }, [entries]);

  // Timeline groups
  const timelineGroups = useMemo(() => {
    const now = Date.now();
    const sorted = [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const groups: { label: string; rows: BrainEntry[] }[] = [];
    const push = (label: string, items: BrainEntry[]) => { if (items.length) groups.push({ label, rows: items }); };
    const today = sorted.filter((e) => now - new Date(e.createdAt).getTime() < 86_400_000);
    const yesterday = sorted.filter((e) => { const d = now - new Date(e.createdAt).getTime(); return d >= 86_400_000 && d < 172_800_000; });
    const week = sorted.filter((e) => { const d = now - new Date(e.createdAt).getTime(); return d >= 172_800_000 && d < 604_800_000; });
    const older = sorted.filter((e) => now - new Date(e.createdAt).getTime() >= 604_800_000);
    push('Today', today);
    push('Yesterday', yesterday);
    push('This week', week);
    // Group older by month
    const monthMap = new Map<string, BrainEntry[]>();
    for (const e of older) {
      const key = new Date(e.createdAt).toLocaleDateString('en', { month: 'long', year: 'numeric' });
      const list = monthMap.get(key) ?? [];
      list.push(e);
      monthMap.set(key, list);
    }
    for (const [label, items] of monthMap) push(label, items);
    return groups;
  }, [filtered]);

  // Grid clusters
  const clusters = allTags
    .map((tag) => ({ tag, items: filtered.filter((e) => e.tags.includes(tag)) }))
    .filter((c) => c.items.length > 0);
  const untagged = filtered.filter((e) => e.tags.length === 0);

  const parseTags = (raw: string) => raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

  const handleSave = async (form: EntryFormState) => {
    const body = {
      type: form.type,
      title: form.title.trim(),
      content: form.type === 'link' ? form.url : form.content,
      url: form.type === 'link' ? form.url : undefined,
      tags: parseTags(form.tags),
      agentId: form.agentId || undefined,
    };
    if (editEntry) await request(`/brain/${editEntry.id}`, 'PATCH', body);
    else await request('/brain', 'POST', body);
  };

  const handleDelete = async (id: string) => { await request(`/brain/${id}`, 'DELETE'); };

  return (
    <div className="brain-view">
      {/* Header */}
      <div className="brain-header">
        <div className="brain-header-left">
          <BrainCircuit size={22} />
          <h1>Second Brain</h1>
          <span className="count-badge">{entries.length}</span>
        </div>
        <div className="brain-header-right">
          <div className="brain-view-toggle">
            <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} title="Grid view"><LayoutGrid size={14} /></button>
            <button className={viewMode === 'timeline' ? 'active' : ''} onClick={() => setViewMode('timeline')} title="Timeline"><Clock3 size={14} /></button>
            <button className={viewMode === 'explore' ? 'active' : ''} onClick={() => setViewMode('explore')} title="Explore by topic"><Network size={14} /></button>
          </div>
          <label className="search-field">
            <Search size={15} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." aria-label="Search brain entries" />
            {search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={13} /></button>}
          </label>
          <button className="button primary" onClick={() => { setEditEntry(null); setShowAdd(true); }}>
            <Plus size={15} />Add entry
          </button>
        </div>
      </div>

      {/* Type breakdown strip */}
      {typeCounts.length > 0 && (
        <div className="brain-type-strip">
          {typeCounts.map(({ type, count }) => {
            const Icon = typeIcons[type];
            const color = typeColor[type];
            return (
              <div key={type} className={`brain-type-pill btp-${color}`}>
                <Icon size={12} />
                <span>{count}</span>
                <span className="btp-label">{typeLabels[type]}{count !== 1 ? 's' : ''}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Tag filter bar (grid + timeline only) */}
      {viewMode !== 'explore' && allTags.length > 0 && (
        <div className="brain-tag-bar">
          <button className={`brain-tag-chip ${!activeTag ? 'active' : ''}`} onClick={() => setActiveTag(null)}>All</button>
          {allTags.map((tag) => (
            <button key={tag} className={`brain-tag-chip ${activeTag === tag ? 'active' : ''}`} onClick={() => setActiveTag(activeTag === tag ? null : tag)}>
              <Hash size={10} />{tag}
            </button>
          ))}
        </div>
      )}

      {/* Views */}
      {viewMode === 'grid' && (
        <div className="brain-clusters">
          {clusters.map(({ tag, items }) => (
            <section key={tag} className="brain-cluster">
              <div className="section-heading">
                <h2><Hash size={14} />{tag}<span>{items.length}</span></h2>
              </div>
              <div className="brain-cluster-grid">
                {items.map((e) => (
                  <BrainCard key={e.id} entry={e} agents={agents} tasks={tasks}
                    onEdit={(entry) => { setEditEntry(entry); setShowAdd(true); }}
                    onDelete={(id) => void handleDelete(id)} />
                ))}
              </div>
            </section>
          ))}
          {untagged.length > 0 && (
            <section className="brain-cluster">
              <div className="section-heading"><h2>Untagged<span>{untagged.length}</span></h2></div>
              <div className="brain-cluster-grid">
                {untagged.map((e) => (
                  <BrainCard key={e.id} entry={e} agents={agents} tasks={tasks}
                    onEdit={(entry) => { setEditEntry(entry); setShowAdd(true); }}
                    onDelete={(id) => void handleDelete(id)} />
                ))}
              </div>
            </section>
          )}
          {filtered.length === 0 && <BrainEmpty hasEntries={entries.length > 0} onAdd={() => { setEditEntry(null); setShowAdd(true); }} />}
        </div>
      )}

      {viewMode === 'timeline' && (
        <div className="brain-timeline">
          {timelineGroups.length === 0 && <BrainEmpty hasEntries={entries.length > 0} onAdd={() => { setEditEntry(null); setShowAdd(true); }} />}
          {timelineGroups.map(({ label, rows }) => (
            <div key={label} className="brain-tl-group">
              <div className="brain-tl-date-label">{label}</div>
              <div className="brain-tl-track">
                {rows.map((e) => (
                  <TimelineRow key={e.id} entry={e} agents={agents} tasks={tasks}
                    onEdit={(entry) => { setEditEntry(entry); setShowAdd(true); }}
                    onDelete={(id) => void handleDelete(id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {viewMode === 'explore' && (
        <ExploreView entries={filtered} agents={agents} tasks={tasks}
          onEdit={(entry) => { setEditEntry(entry); setShowAdd(true); }}
          onDelete={(id) => void handleDelete(id)} />
      )}

      {(showAdd || editEntry) && (
        <BrainEntryModal
          initial={editEntry ?? undefined}
          agents={agents}
          onSave={handleSave}
          onClose={() => { setShowAdd(false); setEditEntry(null); }}
        />
      )}
    </div>
  );
}

function BrainEmpty({ hasEntries, onAdd }: { hasEntries: boolean; onAdd: () => void }) {
  return (
    <div className="brain-empty">
      <BrainCircuit size={36} />
      <p>{hasEntries ? 'No entries match your search.' : 'Nothing here yet. Complete tasks and insights will auto-populate, or add your own.'}</p>
      {!hasEntries && <button className="button primary" onClick={onAdd}><Plus size={15} />Add first entry</button>}
    </div>
  );
}

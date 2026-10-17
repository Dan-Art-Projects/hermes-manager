export interface CuratedSkillDef {
  slug: string;
  name: string;
  description: string;
  category: string;
  /** Attribution / project URL shown on the catalog card */
  source?: string;
  /** When set, "Add to library" fetches this URL instead of using inline body */
  url?: string;
  body: string;
}

export const curatedSkills: CuratedSkillDef[] = [
  // ── Developer ──────────────────────────────────────────────────────────────
  {
    slug: 'code-review',
    name: 'Code Review',
    description: 'Review code for security, quality, and best practices.',
    category: 'developer',
    body: `# Code Review

When reviewing code, check each dimension systematically before reporting.

## Security
- Validate all inputs at trust boundaries; never trust client-supplied data
- Check for injection risks: SQL, command injection, XSS, SSTI
- Verify secrets are never hardcoded; credentials must come from env or vault
- Look for IDOR and missing authorization checks
- Flag deprecated crypto (MD5, SHA-1); require bcrypt for passwords, AES-256 for data

## Correctness
- Trace happy path, edge cases, and error paths
- Check off-by-one errors, null/undefined dereferences, and unexpected type coercions
- Verify async code handles all promise rejections
- Check boundary conditions in loops and recursion

## Maintainability
- Flag functions > ~50 lines as refactor candidates
- Identify duplication; suggest shared helpers where sensible
- Evaluate naming: variables and functions should be self-describing
- Note missing or misleading error messages

## Performance
- Flag N+1 query patterns; recommend batching or eager loading
- Identify expensive computations in hot paths
- Check for missing indexes on filtered/sorted columns

## Output
Group findings: **Critical → High → Medium → Low → Suggestion**.
For each: location (file:line), explanation, concrete fix.
End with overall assessment and explicit approve / request-changes verdict.`,
  },
  {
    slug: 'git-workflow',
    name: 'Git Workflow',
    description: 'Git branching strategy, commit conventions, and PR workflow.',
    category: 'developer',
    body: `# Git Workflow

## Branching
- \`main\` / \`master\` is always deployable — never commit directly
- Feature branches: \`feat/<short-slug>\`; bug fixes: \`fix/<slug>\`; chores: \`chore/<slug>\`
- Keep branches short-lived (< 3 days); merge or rebase frequently

## Commits
Follow Conventional Commits: \`<type>(<scope>): <subject>\`
- Types: feat, fix, docs, style, refactor, test, chore, perf, ci
- Subject: imperative mood, ≤ 72 chars, no trailing period
- Body (optional): explain *why*, not what; reference issue numbers
- Break changes into atomic commits — one logical change per commit

## Pull Requests
- PR title = the merge commit message (follow Conventional Commits)
- Fill the template: summary, test plan, screenshots for UI changes
- Keep PRs focused; split unrelated changes into separate PRs
- All CI checks must pass; no merging with failing tests
- Squash-merge feature branches; merge-commit for release branches

## Conflict resolution
- Rebase feature onto main before opening PR
- Resolve conflicts locally; never accept "ours" blindly
- After resolving, run the full test suite

## Tagging and releases
- Semantic versioning: MAJOR.MINOR.PATCH
- Tag at HEAD of main after merging a release PR
- Update CHANGELOG before tagging`,
  },
  {
    slug: 'test-writing',
    name: 'Test Writing',
    description: 'Write unit and integration tests; TDD and coverage guidance.',
    category: 'developer',
    body: `# Test Writing

## Philosophy
- Tests are first-class code; treat them with the same care as production code
- Prefer integration tests that test behaviour over unit tests that test implementation
- One assertion per test case (where practical); clear names that describe the scenario

## Unit tests
- Follow Arrange–Act–Assert (AAA) structure
- Mock only at system boundaries (DB, network, filesystem, time)
- Test both the happy path and representative edge cases
- Name pattern: \`it('should <outcome> when <condition>')\`

## Integration tests
- Use a real (or in-memory) database — avoid mocking the data layer
- Reset state between tests using transactions or truncation
- Test the full request/response cycle for HTTP handlers
- Verify error responses return correct status codes and messages

## TDD cycle
1. Write a failing test that describes the desired behaviour
2. Write the minimum code to make it pass
3. Refactor; keep tests green

## Coverage
- Aim for 80 %+ line/branch coverage on core business logic
- Don't chase 100 % — focus on coverage that catches real regressions
- Add regression tests for every bug fix (prove the bug existed, then fix it)

## Common mistakes to avoid
- Snapshot tests for dynamic content (they break constantly)
- Testing private implementation details instead of public contracts
- Tests that depend on each other's execution order`,
  },
  {
    slug: 'api-design',
    name: 'API Design',
    description: 'Design RESTful and GraphQL APIs with OpenAPI spec and versioning.',
    category: 'developer',
    body: `# API Design

## REST conventions
- Resources are nouns (plural): \`/users\`, \`/orders/:id/items\`
- Use HTTP verbs correctly: GET (read), POST (create), PUT (replace), PATCH (partial update), DELETE
- Return appropriate status codes: 200, 201, 204, 400, 401, 403, 404, 409, 422, 500
- Envelope all responses: \`{ data, error, meta }\` — never return bare arrays at root

## Versioning
- Version via URL prefix: \`/api/v1/…\`; avoid headers for discoverability
- Never break a published contract — add fields, don't rename or remove them
- Deprecate with a \`Deprecation\` header and sunset date before removal

## Pagination
- Cursor-based pagination for large datasets (stable under concurrent writes)
- Offset pagination only for small, static datasets
- Always return total count and next-page cursor in meta

## Validation and errors
- Validate inputs at the boundary and return 422 with field-level error details
- Error body: \`{ error: { code, message, field? } }\`
- Never leak stack traces or internal paths in error responses

## OpenAPI
- Write the spec first (design-first); generate stubs from it
- Document every parameter, request body, and response schema
- Mark required vs optional fields; include examples
- Use \`$ref\` for reusable schemas; keep the spec DRY

## Security
- Authenticate with Bearer JWT or API key; never session cookies for APIs
- Rate-limit all public endpoints; return 429 with Retry-After
- Enforce HTTPS; redirect HTTP to HTTPS`,
  },
  {
    slug: 'typescript',
    name: 'TypeScript',
    description: 'TypeScript type patterns, strict mode, and idiomatic usage.',
    category: 'developer',
    body: `# TypeScript

## Configuration
- Always use \`"strict": true\` in tsconfig — enables noImplicitAny, strictNullChecks, etc.
- \`"noUncheckedIndexedAccess": true\` catches array out-of-bounds bugs
- \`"exactOptionalPropertyTypes": true\` prevents accidental undefined assignments

## Types vs interfaces
- Prefer \`interface\` for object shapes that may be extended (classes, API responses)
- Prefer \`type\` for unions, intersections, mapped types, and function signatures
- Use \`as const\` for read-only literal arrays/objects; derive types from values

## Common patterns
- Discriminated unions for state: \`type State = { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error'; error: string }\`
- Utility types: \`Partial<T>\`, \`Required<T>\`, \`Pick<T, K>\`, \`Omit<T, K>\`, \`Readonly<T>\`
- Template literal types for string validation: \`type Route = \`/\${string}\`\`
- Branded types for primitive validation: \`type UserId = string & { __brand: 'UserId' }\`

## Avoiding common mistakes
- Never use \`any\`; prefer \`unknown\` and narrow with guards
- Avoid non-null assertions (\`!\`) unless you've already verified the value is non-null
- Don't cast with \`as T\` unless you have a good reason — prefer type guards
- Enums have surprising runtime behaviour; prefer \`as const\` objects or union types

## Type narrowing
- Use \`typeof\`, \`instanceof\`, and custom type guards (\`value is T\`)
- Exhaustive checks with \`never\`: \`function assertUnreachable(x: never): never { throw … }\``,
  },
  {
    slug: 'react-development',
    name: 'React Development',
    description: 'React component patterns, hooks, state management, and performance.',
    category: 'developer',
    body: `# React Development

## Component design
- Prefer functional components with hooks; avoid class components
- Keep components small and focused — one responsibility per component
- Co-locate state as close as possible to where it's used
- Lift state only when sibling components genuinely need to share it
- Separate UI components (pure rendering) from container components (data fetching)

## Hooks
- Follow the Rules of Hooks: top-level calls only, no conditionals
- \`useState\` for local UI state; \`useReducer\` for complex state transitions
- \`useCallback\` / \`useMemo\` for referential stability when passing to children — not as a default
- Custom hooks to extract reusable stateful logic (e.g. \`useDebounce\`, \`useLocalStorage\`)
- Cleanup side effects in \`useEffect\` return functions; include all dependencies in the array

## Performance
- Avoid re-renders with \`React.memo\` for pure child components with expensive renders
- Use \`useTransition\` / \`useDeferredValue\` for deferring expensive updates
- Code-split routes with \`React.lazy\` + \`Suspense\`
- Profile with React DevTools before optimising — measure, don't guess

## Forms
- Use controlled components for forms that need validation
- Consider React Hook Form or similar for complex forms
- Always debounce search/filter inputs

## Error boundaries
- Wrap page-level sections in error boundaries to prevent full-page crashes
- Log errors to your error monitoring service in \`componentDidCatch\``,
  },
  {
    slug: 'nodejs-backend',
    name: 'Node.js Backend',
    description: 'Node.js server patterns, Express/Fastify, error handling, and production readiness.',
    category: 'developer',
    body: `# Node.js Backend

## Project structure
- Separate concerns: routes → controllers → services → data layer
- Never put business logic in route handlers; routes only parse input and call services
- Use dependency injection to keep services testable

## Error handling
- Every async route handler must catch errors and pass to error middleware
- Create typed AppError class with status code and error code
- Global error handler: log + sanitize before sending response
- Never expose stack traces in production responses

## Async
- Prefer async/await over raw Promise chains
- Wrap legacy callback APIs in util.promisify
- Limit concurrency for bulk operations (Promise.all can exhaust resources)

## Configuration
- Load config from environment variables; validate at startup with zod or similar
- Never hardcode ports, URLs, or credentials
- Separate config for test, development, and production

## Security
- Helmet for security headers
- Rate limiting on all public routes
- CORS configured explicitly — no wildcard origins in production
- Validate and sanitize all request inputs
- Parameterized queries — never string-concatenate SQL

## Logging
- Structured JSON logs (pino or winston) with request ID, user ID, duration
- Log at appropriate levels: error, warn, info, debug
- Never log PII, passwords, or tokens

## Graceful shutdown
Handle SIGTERM: stop accepting requests, drain in-flight requests, close DB connections.`,
  },
  {
    slug: 'debugging',
    name: 'Debugging',
    description: 'Systematic debugging techniques, root cause analysis, and fix validation.',
    category: 'developer',
    body: `# Debugging

## Process
1. **Reproduce first** — find the minimal case that triggers the bug reliably
2. **Understand the expected behaviour** — what *should* happen?
3. **Form a hypothesis** — what is the most likely cause?
4. **Prove or disprove** with targeted experiments (not shotgun changes)
5. **Fix the root cause**, not the symptom
6. **Verify** the fix resolves the original issue without breaking anything else
7. **Write a regression test** so the bug cannot reappear silently

## Techniques
- Binary search through code/commits: is the bug in A or B? Then narrow further
- Add structured logging or breakpoints at system boundaries to see actual values
- Compare working vs broken: same inputs, different outputs — what changed?
- Check git log/blame: when did this break? What commit introduced it?
- Read the full stack trace — the real cause is often several frames below the throw site

## Common root causes
- Off-by-one errors in iteration bounds
- Missing null/undefined checks
- Async timing issues (race conditions, missing await)
- Incorrect assumption about data format or shape
- Stale cache or state not being invalidated
- Environment differences (dev vs prod env vars, OS path separators)

## When you're stuck
- Explain the problem out loud (rubber duck debugging)
- Search the exact error message with context keywords
- Check recent dependency changelogs if something "just stopped working"
- Ask for help with a clear description: what you expected, what happened, what you tried`,
  },
  // ── DevOps ──────────────────────────────────────────────────────────────────
  {
    slug: 'ci-cd',
    name: 'CI/CD',
    description: 'CI/CD pipeline design, GitHub Actions, Docker, and deployment strategies.',
    category: 'devops',
    body: `# CI/CD

## Pipeline stages
Every push should trigger: **lint → test → build → security scan → deploy to staging → smoke test**

## GitHub Actions best practices
- Pin actions to a SHA, not a mutable tag (\`uses: actions/checkout@abc123\`)
- Use \`concurrency:\` to cancel in-progress runs on new pushes to the same branch
- Cache dependencies by hash of the lockfile
- Separate jobs for unit tests (fast) and integration tests (slow) — parallelize
- Store secrets in GitHub Secrets; never hardcode in workflow files

## Docker
- Use multi-stage builds to keep final images lean
- Pin base image versions: \`node:20.11.0-alpine\`, not \`node:latest\`
- Run as a non-root user in the final stage
- \`.dockerignore\` everything not needed: node_modules, .git, test files
- Scan images with \`docker scout\` or Trivy before pushing

## Deployment strategies
- **Blue/green**: run two identical environments; switch traffic atomically
- **Rolling**: gradually replace old instances with new ones
- **Canary**: route a small percentage of traffic to new version; monitor; ramp up
- Always have a tested rollback procedure

## Environment promotion
- Automatic deployment to staging on merge to main
- Manual gate for production; require explicit approval
- Environment parity: staging must mirror production config and data shape`,
  },
  {
    slug: 'monitoring',
    name: 'Monitoring & Observability',
    description: 'Set up metrics, logging, distributed tracing, and alerting.',
    category: 'devops',
    body: `# Monitoring & Observability

## The three pillars
- **Metrics**: numeric measurements over time (latency, error rate, saturation)
- **Logs**: structured, timestamped event records with context fields
- **Traces**: end-to-end request paths across services

## Key metrics (RED method)
- **Rate**: requests per second
- **Errors**: error rate (%)
- **Duration**: p50/p95/p99 latency

## Alerting principles
- Alert on symptoms (user-visible impact), not causes (CPU usage)
- Every alert must be actionable — if you can't fix it, it shouldn't page
- Tune thresholds to reduce alert fatigue; use multi-window burn-rate alerts
- Include runbook links in every alert

## Logging
- Structured JSON (one event per line): timestamp, level, message, requestId, userId
- Log at request start and end; include duration and status code
- Rotate and archive logs; set retention policies

## Distributed tracing
- Propagate trace context across service boundaries (W3C TraceContext / OpenTelemetry)
- Sample intelligently: 100% for errors, lower rate for success paths
- Set span names to operation names, not HTTP methods

## Health checks
- \`/health\` (liveness): returns 200 if the process is running
- \`/ready\` (readiness): returns 200 only when all dependencies are reachable`,
  },
  {
    slug: 'docker-containers',
    name: 'Docker & Containers',
    description: 'Dockerfile best practices, image optimization, and compose patterns.',
    category: 'devops',
    body: `# Docker & Containers

## Dockerfile best practices
- Multi-stage builds: use builder stage with dev deps, copy only artifacts to final stage
- Pin exact base image versions; prefer slim/alpine variants
- Order layers for cache efficiency: copy lockfiles first, install deps, then copy source
- Run as a non-root user in the final stage
- Use \`COPY --chown\` instead of separate \`RUN chown\`
- \`EXPOSE\` for documentation only; map ports at runtime

## Image hygiene
- Keep images small: remove build tools, caches, temp files in the same RUN layer
- Scan with Trivy or Docker Scout before pushing to registry
- Tag with git SHA for production; use semantic tags for releases

## docker-compose
- Use named volumes for persistent data
- Define healthchecks so dependent services wait correctly
- Use profiles for optional services (e.g. db-admin tools)
- Never put secrets in compose files; use \`env_file\` pointing to .env (gitignored)
- Set resource limits (\`deploy.resources\`) in production-like environments

## Container runtime security
- Drop all Linux capabilities; add back only what's needed (\`--cap-drop ALL --cap-add NET_BIND_SERVICE\`)
- Use read-only root filesystem where possible (\`--read-only\`)
- Avoid running Docker-in-Docker in CI unless absolutely necessary`,
  },
  {
    slug: 'infrastructure-as-code',
    name: 'Infrastructure as Code',
    description: 'Terraform patterns, state management, and IaC best practices.',
    category: 'devops',
    body: `# Infrastructure as Code (Terraform)

## Project structure
\`\`\`
infra/
  modules/       # reusable modules
  envs/
    dev/
    staging/
    prod/
\`\`\`
- Never share state files between environments
- Store state in remote backend (S3 + DynamoDB, GCS, Terraform Cloud)
- Lock state files during operations

## Writing modules
- Accept required variables; provide sensible defaults for optional ones
- Output all values that callers might need (IDs, ARNs, endpoints)
- Use \`lifecycle { prevent_destroy = true }\` for stateful resources (databases, buckets)
- Pin provider versions; use \`~>\` for minor-version flexibility

## Workflow
1. \`terraform fmt\` and \`terraform validate\` before committing
2. Run \`terraform plan\` and review all changes
3. Apply in lower environments first; promote after validation
4. Use automated plan in CI; require human approval before apply in prod

## Secrets
- Never store secrets in Terraform state or .tfvars files
- Pull secrets from Vault, AWS Secrets Manager, or similar at runtime
- Mark sensitive outputs with \`sensitive = true\`

## Drift detection
- Run \`terraform plan\` on a schedule; alert on unexpected drift
- Import manually created resources immediately; never manage them outside Terraform`,
  },
  // ── Security ─────────────────────────────────────────────────────────────────
  {
    slug: 'security-audit',
    name: 'Security Audit',
    description: 'Application security review: OWASP Top 10, auth, and pen test methodology.',
    category: 'security',
    body: `# Security Audit

## OWASP Top 10 checklist
1. **Broken access control** — verify every endpoint requires appropriate authorization
2. **Cryptographic failures** — data at rest and in transit encrypted; no weak algos
3. **Injection** — all inputs parameterized; ORM used; no eval/exec with user data
4. **Insecure design** — threat model exists; trust boundaries documented
5. **Security misconfiguration** — no default credentials; unnecessary features disabled
6. **Vulnerable components** — dependency audit; outdated packages flagged
7. **Auth failures** — brute-force protection; MFA available; sessions invalidated on logout
8. **Software/data integrity failures** — CI/CD pipeline secured; dependencies pinned
9. **Logging failures** — auth events logged; alerts on anomalies
10. **SSRF** — outbound requests validated; internal metadata endpoints blocked

## Authentication
- Passwords: bcrypt cost ≥ 12; no MD5/SHA-1
- Sessions: secure, httpOnly, sameSite cookies; rotate session ID on privilege escalation
- JWT: verify signature; check exp/nbf; reject HS256 in favor of RS256/ES256

## API security
- Rate limiting on all endpoints (especially auth)
- No sensitive data in URLs (querystring ends up in logs)
- CORS: whitelist specific origins; no wildcard with credentials

## Output
Report findings with: CVSS score, endpoint/component affected, proof-of-concept (no active exploitation), and recommended remediation.`,
  },
  {
    slug: 'dependency-security',
    name: 'Dependency Security',
    description: 'CVE scanning, supply chain security, and safe dependency management.',
    category: 'security',
    body: `# Dependency Security

## Scanning
- Run \`npm audit\` / \`pnpm audit\` / \`pip-audit\` in CI; fail on high/critical
- Use Dependabot, Renovate, or Socket.dev for automated PR updates
- Scan container images with Trivy or Grype before deploying

## Supply chain hygiene
- Pin exact versions in lockfiles; commit lockfiles to git
- Prefer dependencies with active maintainers and public CVE history
- Evaluate new dependencies: downloads/week, last publish date, maintainer count
- Avoid transitive dependencies that pull in native build tools unnecessarily
- Check package names carefully to avoid typosquatting

## License compliance
- Audit dependency licenses before shipping (GPL can be viral)
- Track licenses with \`license-checker\` or \`FOSSA\`

## Response process
1. Triage: is the vulnerability reachable in your code path?
2. If yes: update immediately; test; deploy
3. If no: document the exception with rationale and review date
4. For critical zero-days: isolate affected component; apply WAF rules as temporary mitigation

## SBOMs
- Generate a Software Bill of Materials (SPDX/CycloneDX) as part of every release
- Store alongside the release artifact for audit purposes`,
  },
  // ── Marketing ────────────────────────────────────────────────────────────────
  {
    slug: 'social-media',
    name: 'Social Media',
    description: 'Draft and schedule social content across platforms with platform-specific voice.',
    category: 'marketing',
    body: `# Social Media

## Platform-specific guidelines
- **X/Twitter**: hook in first 8 words; max 280 chars; 1–2 relevant hashtags; conversational tone
- **LinkedIn**: professional but not stiff; 3–5 short paragraphs; end with a question to drive comments; 3–5 hashtags
- **Instagram**: visual-first; caption complements the image; 10–20 relevant hashtags in first comment
- **Threads**: conversational; can be longer than Twitter; no hashtags needed
- **Facebook**: share articles/videos with commentary; ask questions; tag relevant pages

## Content principles
- Open with the strongest hook — the rest is elaboration
- One key idea per post; don't cram multiple points together
- Write for skimmers: short sentences, line breaks, emojis as visual anchors (when appropriate)
- CTAs: be specific ("Download the guide" > "Click here")

## Scheduling
- Post at times when your audience is active (check analytics)
- Space posts to avoid over-broadcasting (minimum 4 hours between posts on same platform)
- Repurpose content across platforms — adapt tone, don't copy-paste

## Engagement
- Respond to comments within the first hour (signals the algorithm)
- Ask follow-up questions to extend conversation threads
- Always credit sources and original creators`,
  },
  {
    slug: 'copywriting',
    name: 'Copywriting',
    description: 'Write persuasive copy: headlines, CTAs, landing pages, and email.',
    category: 'marketing',
    body: `# Copywriting

## Core principles
- Lead with the reader's problem or desire, not your product's features
- Benefits over features: "save 2 hours a day" > "automated scheduling"
- Specific beats vague: "reduce churn by 23%" > "improve retention"
- Use the reader's vocabulary — mirror their language back

## Headlines
- Make a specific, believable promise
- Use numbers where possible: "7 ways to…", "Cut costs by 40%"
- Trigger curiosity gap without being clickbait
- Test multiple headlines; the headline is worth more than all the body copy

## CTAs
- One primary CTA per page/email; secondary actions must be visually subordinate
- Action verbs: "Get your free guide", "Start your trial", "See it in action"
- Reduce friction: tell them what happens next ("No credit card required")

## Landing pages
- Match the ad headline exactly (message match)
- Above the fold: problem, solution, single CTA
- Social proof near the CTA (testimonials, logos, numbers)
- Remove navigation and external links — keep visitors focused

## Email
- Subject line: < 50 chars; personalize with {{first_name}} where natural
- Preview text reinforces the subject line
- One email = one idea = one CTA
- Plain text or minimal HTML outperforms design-heavy newsletters for most lists`,
  },
  {
    slug: 'seo-content',
    name: 'SEO Content',
    description: 'Optimize content for search: keyword research, on-page SEO, linking.',
    category: 'marketing',
    body: `# SEO Content

## Keyword research
- Target one primary keyword and 2–4 semantic variants per page
- Match search intent: informational (how/what/why), commercial (best/review), transactional (buy/get)
- Use keywords with measurable volume and achievable competition
- Long-tail keywords convert better; target them for new sites

## On-page optimization
- Primary keyword in: title tag (< 60 chars), H1, first 100 words, URL slug, meta description (< 160 chars)
- Use H2/H3 hierarchy logically — headers describe section content, not just keywords
- Alt text on all images: descriptive, not keyword-stuffed
- Internal links: link to deeper pages on the topic; use descriptive anchor text

## Content quality
- Satisfy search intent completely — cover every subtopic the user is likely to have
- E-E-A-T: demonstrate Experience, Expertise, Authoritativeness, Trustworthiness
- Update old content when information changes; add "last updated" dates
- Minimum viable length: as long as needed to fully answer the query

## Technical
- Core Web Vitals: LCP < 2.5s, FID < 100ms, CLS < 0.1
- Canonical tags to avoid duplicate content issues
- Schema markup for articles, FAQs, products where applicable
- Mobile-first: Google indexes mobile version

## Link building
- Earn links through original research, tools, and genuinely useful resources
- Internal linking passes authority and improves crawlability`,
  },
  // ── Writer ────────────────────────────────────────────────────────────────────
  {
    slug: 'long-form-writing',
    name: 'Long-form Writing',
    description: 'Articles, essays, and blog posts: structure, voice, and editing.',
    category: 'writer',
    body: `# Long-form Writing

## Structure
- Open with a hook: a surprising fact, vivid scene, or provocative question
- State the thesis or central argument within the first 3 paragraphs
- Body: 3–7 supporting sections, each building on the last
- Close by zooming out to broader implications; leave the reader with something to think about
- Use subheadings every 300–500 words to help skimmers navigate

## Voice and style
- Active voice as the default; passive for variety or when the subject is unknown
- Sentence variety: mix short punchy sentences with longer explanatory ones
- Show, don't tell: concrete details beat abstract claims
- Avoid filler phrases: "It is worth noting that…", "In conclusion…", "Obviously…"

## Research
- Cite primary sources where possible; link out generously
- One strong statistic beats three weak ones
- If you can't find a citation, remove the claim or hedge it

## Editing
- First draft: write fast, don't self-edit
- Second pass: cut ruthlessly — every paragraph must earn its place
- Third pass: read aloud to catch rhythm problems and awkward phrasing
- Final check: fact-check every statistic; verify all links work

## Common issues
- Burying the lede: move your most interesting point to the top
- Purple prose: if removing an adjective doesn't change the meaning, remove it
- Throat-clearing: the first draft's first paragraph is usually a warmup — delete it`,
  },
  {
    slug: 'technical-docs',
    name: 'Technical Documentation',
    description: 'Developer documentation, READMEs, API reference, and tutorials.',
    category: 'writer',
    body: `# Technical Documentation

## README
- Lead with what the project does and who it's for (2–3 sentences)
- Quick start: working example in < 5 minutes
- Installation, basic usage, configuration reference
- Contributing guide and license
- Badges for CI status, coverage, npm version

## API reference
- Document every public function/method/endpoint
- Include: purpose, parameters (name, type, required/optional, default), return value, exceptions/errors
- A concise example for every function — runnable, copy-pasteable
- Group by module/resource; alphabetize within groups

## Tutorials
- State prerequisites and expected outcome upfront
- Step-by-step: numbered steps, one action per step
- Show full commands — readers should be able to follow without filling in gaps
- Explain *why* at key decision points, not just *what*
- Include a troubleshooting section for common failure modes

## Guides (conceptual)
- Explain architecture and mental models before implementation details
- Use diagrams for data flows, state machines, and system architecture
- Link to API reference for specifics; keep guides high-level

## Maintenance
- Version-pin documentation to releases
- Add a "last reviewed" date to each page
- Treat docs like tests: broken docs are bugs`,
  },
  // ── Analyst ───────────────────────────────────────────────────────────────────
  {
    slug: 'data-analysis',
    name: 'Data Analysis',
    description: 'Analyze data, identify trends, visualize findings, and generate reports.',
    category: 'analyst',
    body: `# Data Analysis

## Process
1. **Define the question** before touching data — what decision will this analysis inform?
2. **Understand the data**: shape, types, missing values, outliers, sample size
3. **Clean and transform**: handle nulls (drop vs impute), normalize formats, join datasets correctly
4. **Explore**: descriptive statistics first (mean, median, std, percentiles)
5. **Analyse**: identify patterns, correlations, anomalies
6. **Interpret**: translate statistical findings into business language
7. **Communicate**: visualizations and written narrative for the intended audience

## Common pitfalls
- Correlation ≠ causation; consider confounders before claiming causality
- Survivorship bias: are you missing data for failures?
- Small sample sizes amplify noise; be conservative with conclusions
- p-hacking: define hypotheses before running tests, not after
- Cherry-picking date ranges or segments that support a predetermined conclusion

## SQL tips
- Use window functions for running totals, ranks, and period-over-period comparisons
- Filter early (WHERE before JOIN) to reduce intermediate result sets
- CTEs over nested subqueries for readability
- Always check row counts before and after JOINs to catch unexpected fan-outs

## Visualization
- Choose chart type to match the question: bar (comparison), line (trend over time), scatter (correlation), histogram (distribution)
- Label axes, include units, add a descriptive title
- Highlight the single most important insight on every chart`,
  },
  {
    slug: 'market-research',
    name: 'Market Research',
    description: 'Research market trends, competitive landscape, and customer opportunities.',
    category: 'analyst',
    body: `# Market Research

## Frameworks
- **TAM/SAM/SOM**: size the total, serviceable, and obtainable market
- **Porter's Five Forces**: competitive intensity, supplier/buyer power, substitutes, entry barriers
- **SWOT**: internal strengths/weaknesses, external opportunities/threats
- **Jobs to be Done**: what is the customer trying to accomplish?

## Primary research
- Customer interviews: 5–8 interviews often reveal saturation of key themes
- Surveys: keep < 10 questions; avoid leading questions; test for satisficing bias
- Analyze support tickets and reviews for unarticulated pain points
- Shadow customers using the product (usability studies)

## Secondary research
- Industry reports (Gartner, Forrester, Statista) for sizing and trends
- Competitor websites, pricing pages, job postings (reveals priorities)
- Review sites (G2, Capterra, App Store) for verbatim customer sentiment
- SEC filings and earnings calls for public company strategy signals

## Competitive analysis
- For each competitor: positioning, pricing model, key features, strengths, weaknesses, target segment
- Identify whitespace: what segments are underserved? What problems are unsolved?

## Deliverable
- Executive summary (1 page max): size, key insight, recommendation
- Data appendix with sources and methodology
- Mark estimates with confidence levels: high/medium/low`,
  },
  // ── General ───────────────────────────────────────────────────────────────────
  {
    slug: 'deep-research',
    name: 'Deep Research',
    description: 'Synthesize sources, fact-check, and produce well-cited research reports.',
    category: 'general',
    body: `# Deep Research

## Process
1. **Scope the question**: what exactly needs to be answered? Break compound questions into parts
2. **Source gathering**: primary sources > peer-reviewed papers > reputable journalism > secondary summaries
3. **Critical evaluation**: author credentials, publication date, funding conflicts, methodology
4. **Synthesis**: identify agreements, disagreements, and gaps across sources
5. **Fact-check**: verify key statistics at their original source — not just the article citing them
6. **Report**: structured narrative with inline citations; separate facts from interpretation

## Source quality hierarchy
1. Original studies and data
2. Systematic reviews and meta-analyses
3. Expert consensus documents
4. Reputable news organizations with named authors
5. Wikipedia as a starting point only (follow its citations)

## Avoiding common errors
- Don't cite aggregator sites that don't link to original data
- Check publication dates — a 5-year-old statistic may be obsolete
- Look for counter-evidence intentionally; don't just confirm the hypothesis
- Distinguish "study found X" from "researchers speculate X"

## Report structure
- **Summary**: 3–5 key findings, 1 paragraph each
- **Background**: why this question matters
- **Findings**: section per sub-question, with evidence
- **Limitations**: what you couldn't verify, what data is missing
- **Sources**: formatted bibliography`,
  },
  {
    slug: 'project-planning',
    name: 'Project Planning',
    description: 'Scope, estimate, prioritize, and track software projects.',
    category: 'general',
    body: `# Project Planning

## Discovery
- Define success criteria before writing a single line of code
- Identify all stakeholders and their needs; conflicts resolved before planning starts
- List known unknowns; spike on them early to reduce schedule risk

## Scoping
- Write requirements as user stories: "As a [role], I want [goal] so that [outcome]"
- Split stories until each is completable in < 2 days
- MoSCoW prioritization: Must-have, Should-have, Could-have, Won't-have (this release)
- Document explicit out-of-scope items to prevent scope creep

## Estimation
- Estimate with ranges, not point estimates (best case / most likely / worst case)
- Use historical velocity if available; be explicit about assumptions
- Add buffer for: integration, testing, code review, deployment, unforeseen issues (commonly 30–50%)
- Separate estimates from commitments

## Tracking
- Weekly check-in: % complete, blockers, updated ETA
- Track velocity: planned vs actual points per sprint
- Update the plan when reality diverges — don't hide slippage

## Risk management
- Identify top 3–5 risks at kickoff; define mitigation and contingency plans
- Review risks weekly; escalate early

## Communication
- Weekly status update: what shipped, what's next, what's at risk, decisions needed`,
  },
  {
    slug: 'prompt-engineering',
    name: 'Prompt Engineering',
    description: 'Design effective prompts for LLMs: few-shot, chain-of-thought, and evaluation.',
    category: 'general',
    body: `# Prompt Engineering

## Core principles
- Be explicit about the task, format, constraints, and persona
- Put the most important instructions at the beginning and end (primacy/recency effect)
- Specify output format precisely: JSON schema, markdown, bullet list, etc.
- Use positive instructions ("do X") rather than negative-only ("don't do Y")

## Techniques
- **Few-shot**: provide 2–5 high-quality input/output examples before the actual query
- **Chain-of-thought**: add "Think step by step" or show reasoning in examples for complex tasks
- **Structured output**: ask for JSON/XML with a schema; validate programmatically
- **Role prompting**: "You are a senior security engineer…" sets context and tone
- **Self-consistency**: run the same prompt multiple times, take the majority answer for high-stakes queries

## Iteration
- Change one variable at a time; document what worked and what didn't
- Use a fixed eval set to measure prompt improvements objectively
- Version control your prompts alongside code

## Common mistakes
- Overloading a single prompt with too many tasks (split into a chain)
- Ambiguous pronouns or references in multi-turn conversations
- Not constraining output length (models will pad; specify "respond in < 200 words")
- Trusting model output on arithmetic or current events without verification

## Safety
- Use system prompts for hard constraints; they're harder to override than user turns
- Test for adversarial inputs before deploying user-facing prompts`,
  },
  // ── Game Development ─────────────────────────────────────────────────────────
  {
    slug: 'game-design',
    name: 'Game Design',
    description: 'Core loops, level design, balancing, and player experience.',
    category: 'gamedev',
    body: `# Game Design

## Core loop
- The core loop is the 30-second to 5-minute cycle that players repeat endlessly — make it satisfying
- Design for intrinsic motivation: mastery, autonomy, and progression
- Identify the core fantasy: what power or experience are you selling?
- Every mechanic must support the core loop or be cut

## Level design
- Teach through play: introduce a mechanic in a safe environment, then challenge it
- Use the rule of three: introduce → vary → challenge each mechanic
- Visual language: players must read the environment intuitively (red = danger, arrows = direction)
- Pacing: alternate tension and release; don't let players stay stressed too long

## Balance
- Start by designing the extremes (strongest build, weakest build); balance toward the middle
- Use data from playtests — player behaviour reveals imbalance better than theory
- Nerf outliers before buffing underperformers; nerfs shrink the design space less
- Tune one variable at a time; document every change and its effect

## Player experience
- Minimize friction in the critical path (first 10 minutes is make-or-break)
- Reward exploration with optional content; don't punish it with dead ends
- Feedback loops: every player action must have a clear, timely response
- Difficulty: offer settings; design for moderate skill, tune up and down

## Playtesting
- Observe silently; don't explain what the player "should" do
- Track where players die, get confused, or quit`,
  },
  {
    slug: 'unity-development',
    name: 'Unity / C# Development',
    description: 'Unity engine patterns, performance, and C# best practices for games.',
    category: 'gamedev',
    body: `# Unity / C# Development

## Architecture
- Prefer composition over inheritance; use components to add behaviour
- ScriptableObjects for shared data and configuration (reduces scene coupling)
- Events for decoupled communication between systems (UnityEvent or C# events)
- Service locator or dependency injection for global systems (AudioManager, SceneLoader)

## Performance
- Profile first: use Unity Profiler and Frame Debugger before optimizing
- Avoid \`GetComponent<T>()\` in Update; cache references in Awake/Start
- Pool objects that are frequently instantiated/destroyed (bullets, particles, enemies)
- Minimize \`Find()\` calls; use direct references or events instead
- Batch draw calls: atlases for 2D, static batching for static geometry, GPU instancing for repeated meshes
- Physics: reduce FixedUpdate rate for non-physics-critical objects; use layers to limit collision checks

## C# patterns
- Use structs for small, frequently-copied value types (Vector2, Color)
- Avoid LINQ in hot paths; it allocates
- Cache \`WaitForSeconds\` instances outside coroutines to avoid per-frame allocation
- \`StringBuilder\` for string concatenation in loops

## Scene management
- Use additive scene loading for large worlds; keep a persistent "boot" scene
- Async load scenes with \`LoadSceneAsync\`; show a loading screen

## Version control
- Use \`Force Text\` serialization mode for readable diffs on assets
- \`.gitignore\` the Library, Temp, Obj, Logs folders`,
  },
  // ── AR/VR ─────────────────────────────────────────────────────────────────────
  {
    slug: 'xr-development',
    name: 'XR / AR / VR Development',
    description: 'Spatial computing, hand tracking, performance, and comfort in AR/VR.',
    category: 'gamedev',
    source: 'https://github.com/meta-quest/agentic-tools',
    body: `# XR / AR / VR Development

## Comfort and safety
- Maintain a stable 90+ fps (72 fps minimum); frame drops cause motion sickness
- Avoid screen-space UI elements that bob with head movement
- Stationary and room-scale content must stay within the Guardian boundary
- Provide a comfort/vignette option for locomotion; teleportation is the safest default

## Spatial UI
- Place UI 1.5–3 m from the user at approximately eye height
- World-locked panels beat head-locked panels for readability and comfort
- Minimum interactive target size: 6 × 6 cm at intended viewing distance
- High contrast text; minimum 72pt at 1 m for comfort

## Hand and controller input
- Design for both hand tracking and controller parity where possible
- Direct manipulation (grabbing virtual objects) requires visual and haptic feedback
- Raycasting for far interactions: show the ray, highlight valid targets
- Pinch/grip thresholds must be tunable per user

## Performance
- Budget draw calls: < 100 per eye on mobile XR (Quest), < 500 on tethered PC VR
- Use Level of Detail (LOD) aggressively
- Fixed Foveated Rendering and Variable Rate Shading where the platform supports them
- Occlusion culling for all scenes; portals for large indoor spaces

## Testing
- Test in headset early and often — simulator fidelity is insufficient for comfort and scale judgements
- QA checklist: IPD extremes, height extremes, left-handed users, fast head movement`,
  },
  // ── AI / ML ───────────────────────────────────────────────────────────────────
  {
    slug: 'ml-workflows',
    name: 'ML Workflows',
    description: 'Machine learning pipeline design, experiment tracking, and model deployment.',
    category: 'analyst',
    body: `# ML Workflows

## Pipeline stages
Data → Preprocessing → Feature Engineering → Training → Evaluation → Deployment → Monitoring

## Data
- Version your datasets alongside model versions (DVC, Delta Lake, or S3 prefixes)
- Document data provenance: where it came from, how it was collected, known biases
- Split reproducibly: seed your train/val/test split; stratify for imbalanced classes
- Never let test data touch preprocessing that is fit on training data (data leakage)

## Feature engineering
- Encode categoricals consistently (one-hot for low cardinality, target encoding for high)
- Normalize/standardize after splitting, fitted on train only
- Handle missing values explicitly; document your strategy

## Experiment tracking
- Track every experiment: hyperparameters, dataset version, metrics, model artifacts (MLflow, W&B, Neptune)
- Name experiments descriptively; add tags for major variants
- Keep a baseline result from the simplest model; every complexity must beat it

## Evaluation
- Pick the right metric for the business problem (accuracy vs precision/recall vs NDCG)
- Evaluate on held-out test set only once — not during development
- Analyze errors: where does the model fail? Are failures systematic?

## Deployment
- Serve via a REST API or batch job depending on latency requirements
- A/B test new models against the current champion
- Monitor for data drift and performance degradation in production`,
  },
  {
    slug: 'android-development',
    name: 'Android Development',
    description: 'Kotlin, Jetpack Compose, architecture patterns, and Play Store deployment.',
    category: 'developer',
    source: 'https://github.com/android/skills',
    body: `# Android Development

## Architecture
- Follow MVVM or MVI with Jetpack ViewModel
- Unidirectional data flow: UI emits events → ViewModel processes → State flows down
- Repository pattern for data access; abstract data sources behind interfaces
- Hilt for dependency injection; avoid manual DI wiring

## Jetpack Compose
- Stateless composables receive data and callbacks; hoist state to the ViewModel
- Use \`remember\` and \`derivedStateOf\` to minimize unnecessary recompositions
- \`LaunchedEffect\` / \`DisposableEffect\` for side effects in the composition
- Preview composables with \`@Preview\`; test with Compose testing library

## Coroutines
- \`viewModelScope\` for coroutines tied to ViewModel lifetime
- \`Dispatchers.IO\` for network/disk; \`Dispatchers.Default\` for CPU-intensive work
- Expose data as \`StateFlow\` or \`SharedFlow\`; collect in the UI layer
- Always handle cancellation; check \`isActive\` in long loops

## Performance
- Avoid unnecessary object allocation in tight loops
- Use \`LazyColumn\` / \`LazyRow\` for lists; never use a \`Column\` in a ScrollView for long lists
- Baseline Profiles to speed up app startup
- Profile with Android Studio Profiler before optimizing

## Play Store
- Semantic versioning: versionCode increments monotonically
- Run Lint and run the full test suite before submitting
- Target the latest stable API level; test on minimum supported API`,
  },

  // ── gamedev-skills/awesome-gamedev-agent-skills ──────────────────────────────
  {
    slug: 'gd-game-ai',
    name: 'Game AI',
    description: 'NPC and enemy decision-making with FSMs, behavior trees, steering behaviors, and A* pathfinding.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/game-ai/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-game-feel',
    name: 'Game Feel (Juice)',
    description: 'Screen shake, hit-stop, squash & stretch, tweened motion, and layered audio-visual feedback.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/game-feel/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-level-design',
    name: 'Level Design',
    description: 'Blockout-to-playable workflow, player metrics, pacing curves, gating, and encounter design.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/level-design/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-performance-optimization',
    name: 'Game Performance Optimization',
    description: 'Find and fix game performance problems — profiler-first methodology, draw calls, batching, and memory.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/performance-optimization/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-shader-programming',
    name: 'Shader Programming',
    description: 'Cross-engine shader fundamentals — vertex/fragment pipeline, UVs, lighting, and visual effects.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/shader-programming/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-audio-design',
    name: 'Game Audio Design',
    description: 'Bus/mixer architecture, gain staging, SFX variation, adaptive music, and spatial audio.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/audio-design/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-camera-systems',
    name: 'Game Camera Systems',
    description: '2D follow cameras with deadzone/look-ahead/smoothing, 3D orbit, and cinematic transitions.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/camera-systems/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-physics-tuning',
    name: 'Game Physics Tuning',
    description: 'Fixed vs variable timestep, collision layers, friction/restitution, and stable physics feel.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/physics-tuning/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-procedural-gen',
    name: 'Procedural Generation',
    description: 'Seeded RNG, noise functions, BSP/wave-function collapse, and level generation patterns.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/procedural-gen/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-save-systems',
    name: 'Save Systems',
    description: 'Serialize game state, versioning, checksums, atomic writes, and cloud save patterns.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/save-systems/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-input-systems',
    name: 'Input Systems',
    description: 'Action mapping, input buffering, rebinding, gamepad/KB+M/touch abstraction, and accessibility.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/input-systems/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-game-ui-ux',
    name: 'Game UI/UX',
    description: 'HUDs, menus, and overlays — anchor-safe layouts, focus management, and screen-size adaptation.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/game-ui-ux/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-dialogue-systems',
    name: 'Dialogue Systems',
    description: 'Branching dialogue with a node/choice graph, conditions, variables, and localization.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/dialogue-systems/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-fps-shooter',
    name: 'FPS Shooter',
    description: 'First-person shooter: move+mouse-look controller, hitscan/projectile shooting, weapons, and health.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/genres/fps-shooter/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-platformer',
    name: 'Platformer',
    description: '2D platformer: coyote time, jump buffering, variable jump height, and responsive feel.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/genres/platformer/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-puzzle',
    name: 'Puzzle Game',
    description: 'Grid/board state, move input, rule-based resolution (match-3, sokoban), undo, and hint systems.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/genres/puzzle/SKILL.md',
    body: '',
  },
  {
    slug: 'gd-card-game',
    name: 'Card Game',
    description: 'Card data, deck/hand/discard zones, draw/shuffle/reshuffle, turn structure, and targeting.',
    category: 'gamedev',
    source: 'https://github.com/gamedev-skills/awesome-gamedev-agent-skills',
    url: 'https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/genres/card-game/SKILL.md',
    body: '',
  },
  // ── android/skills ────────────────────────────────────────────────────────────
  {
    slug: 'and-jetpack-compose-adaptive',
    name: 'Jetpack Compose Adaptive UI',
    description: 'Make Android app UIs adapt to different screen sizes, form factors, and foldables.',
    category: 'developer',
    source: 'https://github.com/android/skills',
    url: 'https://raw.githubusercontent.com/android/skills/main/jetpack-compose/adaptive/SKILL.md',
    body: '',
  },
  {
    slug: 'and-compose-performance',
    name: 'Compose Performance',
    description: 'Diagnose and optimize Jetpack Compose UI — recomposition, stability, and layout passes.',
    category: 'developer',
    source: 'https://github.com/android/skills',
    url: 'https://raw.githubusercontent.com/android/skills/main/jetpack-compose/jetpack-compose-performance/SKILL.md',
    body: '',
  },
  {
    slug: 'and-camerax',
    name: 'Android CameraX',
    description: 'Android camera development with CameraX — preview, capture, analysis, and extensions.',
    category: 'developer',
    source: 'https://github.com/android/skills',
    url: 'https://raw.githubusercontent.com/android/skills/main/camera/camerax/SKILL.md',
    body: '',
  },
  {
    slug: 'and-navigation-3',
    name: 'Jetpack Navigation 3',
    description: 'Install and migrate to Jetpack Navigation 3 for Compose-first Android navigation.',
    category: 'developer',
    source: 'https://github.com/android/skills',
    url: 'https://raw.githubusercontent.com/android/skills/main/navigation/navigation-3/SKILL.md',
    body: '',
  },
  {
    slug: 'and-appfunctions',
    name: 'Android AppFunctions',
    description: 'Identify and expose key user workflows as AppFunctions for AI-driven Android integration.',
    category: 'developer',
    source: 'https://github.com/android/skills',
    url: 'https://raw.githubusercontent.com/android/skills/main/device-ai/appfunctions/SKILL.md',
    body: '',
  },
  {
    slug: 'and-litert',
    name: 'LiteRT On-Device Inference',
    description: 'Configure and run LiteRT (.tflite) on-device ML inference on Android.',
    category: 'developer',
    source: 'https://github.com/android/skills',
    url: 'https://raw.githubusercontent.com/android/skills/main/device-ai/litert/litert-runtime/SKILL.md',
    body: '',
  },
  {
    slug: 'and-play-billing',
    name: 'Play Billing Library Upgrade',
    description: 'Upgrade Android in-app purchases to the latest Play Billing Library version.',
    category: 'developer',
    source: 'https://github.com/android/skills',
    url: 'https://raw.githubusercontent.com/android/skills/main/play/play-billing-library-version-upgrade/SKILL.md',
    body: '',
  },
  {
    slug: 'and-android-cli',
    name: 'Android CLI',
    description: 'Install and use the `android` CLI tool for managing SDK packages and AVDs.',
    category: 'developer',
    source: 'https://github.com/android/skills',
    url: 'https://raw.githubusercontent.com/android/skills/main/devtools/android-cli/SKILL.md',
    body: '',
  },
  // ── meta-quest/agentic-tools ──────────────────────────────────────────────────
  {
    slug: 'mq-spatial-sdk',
    name: 'Meta Spatial SDK',
    description: 'Build spatial Android apps for Meta VR and Horizon OS with ECS architecture, 2D panels, and 3D objects.',
    category: 'gamedev',
    source: 'https://github.com/meta-quest/agentic-tools',
    url: 'https://raw.githubusercontent.com/meta-quest/agentic-tools/main/skills/hz-spatial-sdk/SKILL.md',
    body: '',
  },
  {
    slug: 'mq-unity-code-review',
    name: 'Meta VR Unity Code Review',
    description: 'Review Unity code targeting Meta VR/Horizon OS for performance, rendering, and VR-specific pitfalls.',
    category: 'gamedev',
    source: 'https://github.com/meta-quest/agentic-tools',
    url: 'https://raw.githubusercontent.com/meta-quest/agentic-tools/main/skills/hz-unity-code-review/SKILL.md',
    body: '',
  },
  {
    slug: 'mq-immersive-designer',
    name: 'Meta VR Immersive Designer',
    description: 'VR/MR UX design for Meta Horizon OS — comfort guidelines, interaction patterns, spatial layout, and accessibility.',
    category: 'gamedev',
    source: 'https://github.com/meta-quest/agentic-tools',
    url: 'https://raw.githubusercontent.com/meta-quest/agentic-tools/main/skills/hz-immersive-designer/SKILL.md',
    body: '',
  },
  {
    slug: 'mq-platform-sdk',
    name: 'Horizon Platform SDK',
    description: 'Integrate Horizon Platform SDK — achievements, IAP, leaderboards, presence, entitlements, and device integrity.',
    category: 'gamedev',
    source: 'https://github.com/meta-quest/agentic-tools',
    url: 'https://raw.githubusercontent.com/meta-quest/agentic-tools/main/skills/hz-platform-sdk/SKILL.md',
    body: '',
  },
  {
    slug: 'mq-unity-face-tracking',
    name: 'Meta Unity Face Tracking',
    description: 'Drive ARKit-blendshape-rigged face models in Unity via Meta Movement SDK on Quest Pro/3.',
    category: 'gamedev',
    source: 'https://github.com/meta-quest/agentic-tools',
    url: 'https://raw.githubusercontent.com/meta-quest/agentic-tools/main/skills/hz-unity-face-tracking/SKILL.md',
    body: '',
  },
];

export function makeCuratedSkillMd(skill: CuratedSkillDef): string {
  return `---\nname: "${skill.name}"\ndescription: "${skill.description}"\ncategory: "${skill.category}"\n---\n\n${skill.body}\n`;
}

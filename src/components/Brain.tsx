import { useState } from 'react';
import {
  BrainCircuit,
  Clock3,
  Code2,
  FileText,
  Hash,
  Lightbulb,
  Link,
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
  'task-summary': 'Task summary',
};

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
  return (
    <div className="brain-card">
      <div className="brain-card-type">
        <TypeIcon size={11} />
        {typeLabels[entry.type]}
        {entry.source === 'ai-extracted' && <span className="brain-card-ai-badge">AI</span>}
      </div>
      <h4>{entry.title}</h4>
      {entry.content && <p>{entry.content}</p>}
      {entry.url && (
        <a href={entry.url} className="brain-card-url" target="_blank" rel="noreferrer">
          {entry.url}
        </a>
      )}
      {task && (
        <div className="brain-card-task">
          <Sparkles size={10} />
          From: {task.title}
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
        <button onClick={() => onEdit(entry)} title="Edit">
          <Pencil size={12} />
        </button>
        <button onClick={() => onDelete(entry.id)} title="Delete">
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

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
          <h3>
            <NotebookPen size={16} />
            {initial ? 'Edit entry' : 'Add to Second Brain'}
          </h3>
          <button className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="brain-type-tabs">
            {types.map((t) => {
              const Icon = typeIcons[t];
              return (
                <button
                  key={t}
                  type="button"
                  className={`brain-type-tab ${form.type === t ? 'active' : ''}`}
                  onClick={() => set('type', t)}
                >
                  <Icon size={12} />
                  {typeLabels[t]}
                </button>
              );
            })}
          </div>
          <label>
            Title
            <input
              required
              maxLength={200}
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Give this entry a clear title"
            />
          </label>
          {form.type === 'link' ? (
            <label>
              URL
              <input
                type="url"
                required
                value={form.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder="https://..."
              />
            </label>
          ) : (
            <label>
              {form.type === 'snippet' ? 'Code' : form.type === 'insight' ? 'Insight' : 'Content'}
              <textarea
                rows={4}
                maxLength={10000}
                value={form.content}
                onChange={(e) => set('content', e.target.value)}
                placeholder={
                  form.type === 'snippet'
                    ? 'Paste your code snippet here...'
                    : form.type === 'insight'
                      ? 'What did you learn?'
                      : 'Your notes...'
                }
              />
            </label>
          )}
          <label>
            Tags
            <input
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="typescript, backend, auth (comma-separated)"
            />
          </label>
          <label>
            Agent (optional)
            <select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}>
              <option value="">No agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="brain-modal-footer">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? 'Saving…' : initial ? 'Save changes' : 'Add entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BrainView({ entries, agents, tasks, request }: BrainViewProps) {
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState<BrainEntry | null>(null);

  const q = search.toLowerCase();
  const filtered = entries.filter(
    (e) =>
      (!q ||
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q))) &&
      (!activeTag || e.tags.includes(activeTag)),
  );

  const allTags = [...new Set(entries.flatMap((e) => e.tags))].sort();
  const clusters = allTags
    .map((tag) => ({ tag, items: filtered.filter((e) => e.tags.includes(tag)) }))
    .filter((c) => c.items.length > 0);
  const untagged = filtered.filter((e) => e.tags.length === 0);

  const parseTags = (raw: string) =>
    raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

  const handleSave = async (form: EntryFormState) => {
    const body = {
      type: form.type,
      title: form.title.trim(),
      content: form.type === 'link' ? form.url : form.content,
      url: form.type === 'link' ? form.url : undefined,
      tags: parseTags(form.tags),
      agentId: form.agentId || undefined,
    };
    if (editEntry) {
      await request(`/brain/${editEntry.id}`, 'PATCH', body);
    } else {
      await request('/brain', 'POST', body);
    }
  };

  const handleDelete = async (id: string) => {
    await request(`/brain/${id}`, 'DELETE');
  };

  return (
    <div className="brain-view">
      <div className="brain-header">
        <div className="brain-header-left">
          <BrainCircuit size={22} />
          <h1>Second Brain</h1>
          <span className="count-badge">{entries.length}</span>
        </div>
        <div className="brain-header-right">
          <label className="search-field">
            <Search size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entries..."
              aria-label="Search brain entries"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear search">
                <X size={13} />
              </button>
            )}
          </label>
          <button className="button primary" onClick={() => { setEditEntry(null); setShowAdd(true); }}>
            <Plus size={15} />
            Add entry
          </button>
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="brain-tag-bar">
          <button
            className={`brain-tag-chip ${!activeTag ? 'active' : ''}`}
            onClick={() => setActiveTag(null)}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              className={`brain-tag-chip ${activeTag === tag ? 'active' : ''}`}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              <Hash size={10} />
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="brain-clusters">
        {clusters.map(({ tag, items }) => (
          <section key={tag} className="brain-cluster">
            <div className="section-heading">
              <h2>
                <Hash size={14} />
                {tag}
                <span>{items.length}</span>
              </h2>
            </div>
            <div className="brain-cluster-grid">
              {items.map((e) => (
                <BrainCard
                  key={e.id}
                  entry={e}
                  agents={agents}
                  tasks={tasks}
                  onEdit={(entry) => { setEditEntry(entry); setShowAdd(true); }}
                  onDelete={(id) => void handleDelete(id)}
                />
              ))}
            </div>
          </section>
        ))}

        {untagged.length > 0 && (
          <section className="brain-cluster">
            <div className="section-heading">
              <h2>
                Untagged
                <span>{untagged.length}</span>
              </h2>
            </div>
            <div className="brain-cluster-grid">
              {untagged.map((e) => (
                <BrainCard
                  key={e.id}
                  entry={e}
                  agents={agents}
                  tasks={tasks}
                  onEdit={(entry) => { setEditEntry(entry); setShowAdd(true); }}
                  onDelete={(id) => void handleDelete(id)}
                />
              ))}
            </div>
          </section>
        )}

        {filtered.length === 0 && (
          <div className="brain-empty">
            <BrainCircuit size={36} />
            <p>
              {entries.length === 0
                ? 'Nothing here yet. Add your first note, or complete a task and the brain will auto-populate with AI-extracted insights.'
                : 'No entries match your search.'}
            </p>
            {entries.length === 0 && (
              <button className="button primary" onClick={() => { setEditEntry(null); setShowAdd(true); }}>
                <Plus size={15} />
                Add first entry
              </button>
            )}
          </div>
        )}
      </div>

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

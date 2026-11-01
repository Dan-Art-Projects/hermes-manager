import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import type { Agent } from '../../shared/types';
import { agentStyle, type AttentionItem } from '../api';

const kindNames: Record<AttentionItem['kind'], string> = {
  question: 'Question',
  blocked: 'Blocked',
  setup: 'Setup',
  review: 'Review',
};

const kindColor: Record<AttentionItem['kind'], string> = {
  question: 'amber',
  blocked: 'red',
  setup: 'blue',
  review: 'violet',
};

export default function AttentionBell({
  items,
  agents,
  onOpen,
}: {
  items: AttentionItem[];
  agents: Agent[];
  onOpen: (item: AttentionItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="attention-bell-wrap" ref={ref}>
      <button
        className={`attention-bell ${items.length > 0 ? 'has-items' : ''} ${open ? 'active' : ''}`}
        aria-label={items.length > 0 ? `${items.length} items need your attention` : 'No items need attention'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={15} />
        {items.length > 0 && <span className="attention-bell-count">{items.length}</span>}
      </button>

      {open && (
        <div className="attention-popup" role="dialog" aria-label="Needs you">
          <div className="attention-popup-header">
            <span className="attention-popup-title">
              <span className="waiting-dot" />
              Needs you
            </span>
            <span className="attention-popup-count">{items.length}</span>
          </div>
          {items.length === 0 ? (
            <div className="attention-popup-empty">
              <Bell size={20} />
              <span>Nothing needs your attention right now.</span>
            </div>
          ) : (
            <ul className="attention-popup-list">
              {items.map((item) => {
                const agent = agents.find((a) => a.id === item.agentId);
                return (
                  <li key={item.key}>
                    <button
                      className="attention-popup-item"
                      style={agentStyle(agent)}
                      onClick={() => { onOpen(item); setOpen(false); }}
                    >
                      <span className={`attention-kind-dot ${kindColor[item.kind]}`} />
                      <div className="attention-popup-body">
                        <div className="attention-popup-row">
                          <span className={`attention-kind-label ${item.kind}`}>{kindNames[item.kind]}</span>
                          {agent && <span className="attention-popup-agent">{agent.name}</span>}
                        </div>
                        <strong>{item.title}</strong>
                        {item.detail && <span className="attention-popup-detail">{item.detail}</span>}
                      </div>
                      <ChevronRight size={13} className="attention-popup-arrow" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

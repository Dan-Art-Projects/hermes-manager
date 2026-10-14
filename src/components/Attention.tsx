import { useState } from 'react';
import { Bell, ChevronDown, ChevronUp } from 'lucide-react';
import type { Agent } from '../../shared/types';
import { agentStyle, type AttentionItem } from '../api';

const kindNames: Record<AttentionItem['kind'], string> = {
  question: 'Question',
  blocked: 'Blocked',
  setup: 'Setup',
  review: 'Review',
};

export default function AttentionInbox({
  items,
  agents,
  onOpen,
}: {
  items: AttentionItem[];
  agents: Agent[];
  onOpen: (item: AttentionItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  const questions = items.filter((item) => item.kind === 'question').length;
  const visible = expanded ? items : items.slice(0, 5);
  return (
    <section className="attention" aria-label="Needs you">
      <header>
        <i className="waiting-dot" aria-hidden="true" />
        <h2>
          Needs you · {items.length}
          {questions > 0 && ` (${questions} question${questions === 1 ? '' : 's'})`}
        </h2>
        {items.length > 5 && (
          <button className="text-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show fewer' : `Show all ${items.length}`}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </header>
      <ul>
        {visible.map((item) => {
          const agent = agents.find((a) => a.id === item.agentId);
          return (
            <li key={item.key}>
              <button style={agentStyle(agent)} onClick={() => onOpen(item)}>
                <span className={`attention-kind ${item.kind}`}>
                  {item.kind === 'question' && <Bell size={9} aria-hidden="true" />} {kindNames[item.kind]}
                </span>
                {agent ? <span className="agent-swatch" title={agent.name} /> : <span />}
                <span>
                  <strong>{item.title}</strong>
                  <span className="detail" title={item.detail}>
                    {item.detail}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import { useMemo } from 'react';
import {
  Activity,
  BarChart2,
  Bell,
  Bot,
  CheckCheck,
  Circle,
  Clock3,
  Radio,
  TrendingUp,
  Zap,
} from 'lucide-react';
import type { AppSnapshot, Task } from '../../shared/types';
import { agentStyle, relativeTime } from '../api';

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return `${n}`;
}

function taskDurationMs(task: Task): number | undefined {
  if (!task.startedAt || !task.finishedAt) return undefined;
  return new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
}

export default function AnalyticsView({ state }: { state: AppSnapshot }) {
  const stats = useMemo(() => {
    const all = state.tasks;
    const finished = all.filter((t) => t.finishedAt);
    const succeeded = all.filter((t) => ['done', 'review', 'archived'].includes(t.status));
    const blocked = all.filter((t) => t.status === 'blocked');
    const running = all.filter((t) => t.status === 'running');

    const totalTokensIn = all.reduce((s, t) => s + (t.tokensIn ?? 0), 0);
    const totalTokensOut = all.reduce((s, t) => s + (t.tokensOut ?? 0), 0);

    const durations = finished.map(taskDurationMs).filter((d): d is number => d !== undefined);
    const avgDuration = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0;

    const successRate = finished.length ? Math.round((succeeded.length / finished.length) * 100) : 0;

    // Per-agent stats
    const agentRows = state.agents.map((agent) => {
      const tasks = all.filter((t) => t.agentId === agent.id);
      const done = tasks.filter((t) => ['done', 'review', 'archived'].includes(t.status)).length;
      const fail = tasks.filter((t) => t.status === 'blocked').length;
      const tokIn = tasks.reduce((s, t) => s + (t.tokensIn ?? 0), 0);
      const tokOut = tasks.reduce((s, t) => s + (t.tokensOut ?? 0), 0);
      const durs = tasks.map(taskDurationMs).filter((d): d is number => d !== undefined);
      const avgMs = durs.length ? Math.round(durs.reduce((s, d) => s + d, 0) / durs.length) : 0;
      return { agent, total: tasks.length, done, fail, tokIn, tokOut, avgMs };
    }).sort((a, b) => b.total - a.total);

    // 14-day trend
    const trend = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const day = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      const count = all.filter((t) => t.finishedAt?.slice(0, 10) === day).length;
      return { day, label, count };
    });

    // Status breakdown
    const statusCounts = {
      backlog: all.filter((t) => t.status === 'backlog').length,
      running: running.length,
      waiting: all.filter((t) => t.status === 'waiting').length,
      review: all.filter((t) => t.status === 'review').length,
      done: succeeded.length,
      blocked: blocked.length,
    };

    return { all, finished, succeeded, blocked, totalTokensIn, totalTokensOut, avgDuration, successRate, agentRows, trend, statusCounts };
  }, [state.tasks, state.agents]);

  const trendMax = Math.max(...stats.trend.map((d) => d.count), 1);

  return (
    <div className="analytics-view">
      {/* Summary */}
      <div className="analytics-summary">
        <div className="analytics-stat-card">
          <span className="asc-icon blue"><BarChart2 size={16} /></span>
          <div>
            <strong>{stats.all.length}</strong>
            <span>Total tasks</span>
          </div>
        </div>
        <div className="analytics-stat-card">
          <span className="asc-icon green"><CheckCheck size={16} /></span>
          <div>
            <strong>{stats.successRate}%</strong>
            <span>Success rate</span>
          </div>
        </div>
        <div className="analytics-stat-card">
          <span className="asc-icon amber"><Zap size={16} /></span>
          <div>
            <strong>{fmtTokens(stats.totalTokensIn + stats.totalTokensOut)}</strong>
            <span>Tokens used · {fmtTokens(stats.totalTokensIn)} in / {fmtTokens(stats.totalTokensOut)} out</span>
          </div>
        </div>
        <div className="analytics-stat-card">
          <span className="asc-icon"><Clock3 size={16} /></span>
          <div>
            <strong>{stats.avgDuration ? fmtDuration(stats.avgDuration) : '—'}</strong>
            <span>Avg task duration</span>
          </div>
        </div>
        <div className="analytics-stat-card">
          <span className="asc-icon"><Radio size={16} /></span>
          <div>
            <strong>{state.agents.filter((a) => a.status === 'online' || a.status === 'busy').length} / {state.agents.length}</strong>
            <span>Agents reachable</span>
          </div>
        </div>
      </div>

      {/* Status breakdown */}
      {stats.all.length > 0 && (
        <div className="analytics-card">
          <h3 className="analytics-card-title">
            <TrendingUp size={15} />
            Task status breakdown
          </h3>
          <div className="status-breakdown">
            {([
              { key: 'backlog', label: 'Backlog', color: 'var(--text-3)' },
              { key: 'running', label: 'Running', color: 'var(--info)' },
              { key: 'waiting', label: 'Waiting', color: 'var(--needs-you)' },
              { key: 'review', label: 'Review', color: 'var(--review)' },
              { key: 'done', label: 'Done', color: 'var(--accent)' },
              { key: 'blocked', label: 'Blocked', color: 'var(--danger)' },
            ] as const).map(({ key, label, color }) => {
              const count = stats.statusCounts[key];
              const pct = stats.all.length ? Math.round((count / stats.all.length) * 100) : 0;
              return (
                <div key={key} className="status-breakdown-row">
                  <span className="sbr-label">{label}</span>
                  <div className="sbr-bar-track">
                    <div className="sbr-bar" style={{ width: `${pct}%`, background: color }} />
                  </div>
                  <span className="sbr-count">{count}</span>
                  <span className="sbr-pct">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Trend chart */}
      <div className="analytics-card">
        <h3 className="analytics-card-title">
          <Activity size={15} />
          Task completions · last 14 days
        </h3>
        <div className="trend-chart">
          {stats.trend.map((d) => (
            <div key={d.day} className="trend-col" title={`${d.label}: ${d.count} finished`}>
              <span className="trend-count">{d.count > 0 ? d.count : ''}</span>
              <div
                className="trend-bar"
                style={{ height: `${Math.max((d.count / trendMax) * 100, d.count > 0 ? 6 : 1)}%` }}
              />
              <span className="trend-label">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Agent table + activity split */}
      <div className="analytics-split">
        <div className="analytics-card analytics-card-grow">
          <h3 className="analytics-card-title">
            <Bot size={15} />
            Agent breakdown
          </h3>
          {state.agents.length === 0 ? (
            <p className="analytics-empty">No agents connected yet.</p>
          ) : (
            <table className="agent-stats-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Tasks</th>
                  <th>Done</th>
                  <th>Blocked</th>
                  <th>Tokens in</th>
                  <th>Tokens out</th>
                  <th>Avg duration</th>
                </tr>
              </thead>
              <tbody>
                {stats.agentRows.map(({ agent, total, done, fail, tokIn, tokOut, avgMs }) => (
                  <tr key={agent.id}>
                    <td>
                      <span className="ast-agent">
                        <span className="ast-dot" style={agentStyle(agent)} />
                        {agent.name}
                        {agent.role && <span className="ast-role">{agent.role}</span>}
                      </span>
                    </td>
                    <td><strong>{total}</strong></td>
                    <td className="text-green">{done}</td>
                    <td className={fail > 0 ? 'text-red' : ''}>{fail || '—'}</td>
                    <td className="mono">{tokIn > 0 ? fmtTokens(tokIn) : '—'}</td>
                    <td className="mono">{tokOut > 0 ? fmtTokens(tokOut) : '—'}</td>
                    <td className="mono">{avgMs > 0 ? fmtDuration(avgMs) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="analytics-card analytics-activity-col">
          <h3 className="analytics-card-title">
            <Bell size={15} />
            Recent activity
          </h3>
          {state.activity.length === 0 ? (
            <p className="analytics-empty">No activity yet.</p>
          ) : (
            <div className="analytics-activity-feed">
              {state.activity.slice(0, 25).map((item) => (
                <div key={item.id} className={`analytics-activity-item ${item.kind}`}>
                  <span className="aai-dot" />
                  <div>
                    <span>{item.message}</span>
                    <time>{relativeTime(item.createdAt)}</time>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Token usage per agent (only if any tokens recorded) */}
      {stats.agentRows.some((r) => r.tokIn + r.tokOut > 0) && (
        <div className="analytics-card">
          <h3 className="analytics-card-title">
            <Zap size={15} />
            Token usage by agent
          </h3>
          <div className="token-breakdown">
            {stats.agentRows
              .filter((r) => r.tokIn + r.tokOut > 0)
              .map(({ agent, tokIn, tokOut }) => {
                const total = tokIn + tokOut;
                const maxTotal = Math.max(...stats.agentRows.map((r) => r.tokIn + r.tokOut), 1);
                const pct = Math.round((total / maxTotal) * 100);
                const inPct = total > 0 ? Math.round((tokIn / total) * 100) : 0;
                return (
                  <div key={agent.id} className="token-row">
                    <span className="token-row-name">
                      <span className="ast-dot" style={agentStyle(agent)} />
                      {agent.name}
                    </span>
                    <div className="token-bar-track" title={`${fmtTokens(tokIn)} in / ${fmtTokens(tokOut)} out`}>
                      <div className="token-bar-in" style={{ width: `${pct * inPct / 100}%` }} />
                      <div className="token-bar-out" style={{ width: `${pct * (100 - inPct) / 100}%` }} />
                    </div>
                    <span className="token-row-total">{fmtTokens(total)}</span>
                  </div>
                );
              })}
            <div className="token-legend">
              <span><i className="tl-in" /> Input tokens</span>
              <span><i className="tl-out" /> Output tokens</span>
            </div>
          </div>
        </div>
      )}

      {stats.all.length === 0 && (
        <div className="analytics-empty-state">
          <BarChart2 size={32} />
          <h3>No data yet</h3>
          <p>Create tasks and run them to see analytics here.</p>
        </div>
      )}
    </div>
  );
}

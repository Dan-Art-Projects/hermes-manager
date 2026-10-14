import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Cable, LockKeyhole, Terminal, Unplug } from 'lucide-react';
import type { Agent } from '../../shared/types';
import { socketUrl } from '../api';
import '@xterm/xterm/css/xterm.css';

export default function TerminalPanel({
  agents,
  token,
  unlocked,
  demo,
  initialAgentId,
  onUnlock,
  onCheck,
}: {
  agents: Agent[];
  token: string;
  unlocked: boolean;
  demo: boolean;
  initialAgentId?: string;
  onUnlock: () => void;
  onCheck: (agent: Agent) => void;
}) {
  const [selected, setSelected] = useState(initialAgentId ?? agents[0]?.id ?? '');
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const agent = agents.find((item) => item.id === selected);
  useEffect(() => {
    if (!active || !selected || !container.current) return;
    let disposed = false;
    const term = new XTerminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      scrollback: 5000,
      theme: {
        background: '#0b0e13',
        foreground: '#e8ebf0',
        cursor: '#3ecf8e',
        selectionBackground: '#38414e',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container.current);
    fit.fit();
    const ws = new WebSocket(socketUrl(`/ws/terminal?agentId=${encodeURIComponent(selected)}`, token));
    socket.current = ws;
    setStatus('Connecting');
    setError('');
    const resize = () => {
      if (disposed) return;
      fit.fit();
      if (ws.readyState === WebSocket.OPEN)
        ws.send(
          JSON.stringify({
            type: 'resize',
            cols: Math.max(2, Math.min(500, term.cols)),
            rows: Math.max(2, Math.min(300, term.rows)),
          }),
        );
    };
    ws.onmessage = (event) => {
      if (disposed) return;
      const message = JSON.parse(event.data);
      if (message.type === 'output') term.write(message.data);
      if (message.type === 'status') {
        setStatus(message.status === 'connected' ? 'Connected' : 'Disconnected');
        if (message.status === 'connected') {
          resize();
          term.focus();
        }
      }
      if (message.type === 'error') {
        setError(message.message);
        term.writeln(`\r\n[manager] ${message.message}`);
      }
    };
    ws.onclose = () => {
      if (!disposed) {
        setStatus('Disconnected');
        setActive(false);
      }
    };
    ws.onerror = () => {
      if (!disposed)
        setError('Terminal connection failed. Check the manager connection and verify the host.');
    };
    const input = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        for (let offset = 0; offset < data.length; offset += 4096)
          ws.send(JSON.stringify({ type: 'input', data: data.slice(offset, offset + 4096) }));
      }
    });
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      ws.close();
      term.dispose();
      socket.current = null;
    };
  }, [active, selected, token]);
  return (
    <section className="terminal-panel">
      <div className="terminal-toolbar">
        <div className="terminal-title">
          <Terminal size={17} />
          <span>SSH session</span>
          <span className={`terminal-status ${active ? 'live' : ''}`}>
            <i />
            {status}
          </span>
        </div>
        <div className="terminal-controls">
          <select
            aria-label="Terminal agent"
            value={selected}
            disabled={active}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="" disabled>
              Select an agent
            </option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} / {a.host}
              </option>
            ))}
          </select>
          {active ? (
            <button
              className="button secondary small"
              onClick={() => {
                socket.current?.close();
                setActive(false);
                setStatus('Disconnected');
              }}
            >
              <Unplug size={15} />
              Disconnect
            </button>
          ) : (
            <button
              className="button primary small"
              disabled={!agent || demo}
              onClick={() => {
                if (!unlocked) onUnlock();
                else if (!agent?.fingerprint) onCheck(agent!);
                else setActive(true);
              }}
            >
              <Cable size={15} />
              {!unlocked ? 'Unlock to connect' : !agent?.fingerprint ? 'Verify host' : 'Connect'}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="terminal-error">
          {error}
        </p>
      )}
      <div className="terminal-screen" ref={container} style={{ display: active ? 'block' : 'none' }} />
      {!active && (
        <div className="terminal-empty">
          <span className="terminal-illustration">
            <Terminal size={36} />
            <span>_</span>
          </span>
          <h3>{demo ? 'A direct line to your agents' : 'Your shell, right here.'}</h3>
          <p>
            {demo
              ? 'Live terminals are disabled in the sample workspace. Add a real agent to open an SSH session.'
              : 'Select an agent and connect to its interactive shell. No commands run until you enter them.'}
          </p>
          <code>
            {agent ? `${agent.username}@${agent.host}` : 'waiting for a connection'}
            <span className="cursor-block" />
          </code>
        </div>
      )}
      <footer className="terminal-footer">
        <span>
          <LockKeyhole size={12} />
          Encrypted SSH transport
        </span>
        <span>Sessions close when you leave this page. Idle timeout: 15 min.</span>
      </footer>
    </section>
  );
}

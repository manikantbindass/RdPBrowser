import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { io, Socket } from 'socket.io-client';
import 'xterm/css/xterm.css';

interface Props {
  url: string; // expects ssh://username@host:port or similar
}

const Terminal: React.FC<Props> = ({ url }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<string>('Connecting...');

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize Xterm.js
    const term = new XTerm({
      cursorBlink: true,
      theme: {
        background: '#0a0a1a',
        foreground: '#6366f1',
        cursor: '#a855f7',
      },
      fontFamily: '"Fira Code", monospace',
      fontSize: 14,
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln(`\r\n\x1b[1;35mRemoteShield SSH Subsystem\x1b[0m\r\n`);
    const hostLine = url.replace('ssh://', '');
    term.writeln(`Initiating secure tunnel to: \x1b[1;32m${hostLine}\x1b[0m...\r\n`);

    const serverUrl = 'http://localhost:3001'; // Defaulting for now, could be dynamic
    const socket: Socket = io(serverUrl);

    socket.on('connect', () => {
      // Very basic host parsing: ssh://user@host:port
      const match = hostLine.match(/^(?:([^@]+)@)?([^:]+)(?::(\d+))?$/);
      socket.emit('ssh_connect', {
        username: match?.[1] || 'root',
        host: match?.[2] || hostLine,
        port: parseInt(match?.[3] || '22', 10),
        password: import.meta.env.VITE_DEV_SSH_PASS || 'password' // In production, this needs a UI prompt
      });
    });

    socket.on('ssh_status', (msg: string) => {
      setStatus(msg.trim() || 'Connected');
      term.writeln(`\x1b[1;33m${msg}\x1b[0m`);
    });

    socket.on('ssh_data', (d: string) => {
      term.write(d);
    });

    term.onData(data => {
      socket.emit('ssh_data', data);
    });

    const handleResize = () => {
      fitAddon.fit();
      socket.emit('ssh_resize', { rows: term.rows, cols: term.cols });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.disconnect();
      term.dispose();
    };
  }, [url]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a1a' }}>
      <div style={{ padding: '8px 16px', background: 'rgba(15, 23, 42, 0.8)', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: '#a855f7', fontSize: 13, fontFamily: 'monospace' }}>{status}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>XTerm.js / SSH2 Engine</span>
      </div>
      <div ref={terminalRef} style={{ flex: 1, padding: '16px', overflow: 'hidden' }} />
    </div>
  );
};

export default Terminal;

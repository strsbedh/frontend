import React, { useEffect, useRef } from 'react';
import { Terminal, Trash2 } from 'lucide-react';

export default function LogsPanel({ logs, onClear, title = "Event Log" }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getLogColor = (category) => {
    switch (category) {
      case 'system': return 'text-blue-400';
      case 'control': return 'text-green-400';
      case 'sent': return 'text-cyan-400';
      case 'error': return 'text-red-400';
      default: return 'text-zinc-400';
    }
  };

  return (
    <div className="logs-terminal flex flex-col h-full border border-zinc-800" data-testid="logs-panel">
      {/* Terminal header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-green-400" strokeWidth={1.5} />
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">
            {title}
          </span>
        </div>
        {onClear && (
          <button
            onClick={onClear}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            data-testid="clear-logs-btn"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-0.5 text-xs font-mono"
        data-testid="logs-content"
      >
        {logs.length === 0 ? (
          <div className="text-zinc-600 italic">Waiting for events...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="log-entry flex gap-2">
              <span className="text-zinc-600 shrink-0">{log.time}</span>
              <span className={`shrink-0 uppercase font-bold ${getLogColor(log.category)}`}>
                [{log.category}]
              </span>
              <span className="text-zinc-300 break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

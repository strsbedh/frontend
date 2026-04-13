import React from 'react';

const STATUS_MAP = {
  disconnected: { label: 'Disconnected', color: 'bg-rose-600', dotClass: 'disconnected' },
  connecting: { label: 'Connecting...', color: 'bg-yellow-500', dotClass: 'waiting' },
  waiting: { label: 'Waiting for peer', color: 'bg-yellow-500', dotClass: 'waiting' },
  streaming: { label: 'Streaming', color: 'bg-green-600', dotClass: 'streaming' },
};

export default function ConnectionStatus({ state }) {
  const status = STATUS_MAP[state] || STATUS_MAP.disconnected;

  return (
    <div className="flex items-center gap-2" data-testid="connection-status">
      <div className={`status-dot ${status.dotClass}`} />
      <span className="text-sm font-medium text-zinc-700">{status.label}</span>
    </div>
  );
}

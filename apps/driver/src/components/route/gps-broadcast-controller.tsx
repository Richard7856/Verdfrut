'use client';

// Activa GPS broadcast cuando el chofer abre la PWA con una ruta IN_PROGRESS.
// Renderiza un indicador discreto del estado (activo, error, broadcasts enviados)
// para que el chofer sepa si su posición está siendo enviada al supervisor.

import { useGpsBroadcast } from '@/lib/gps-broadcast';

interface Props {
  routeId: string;
  driverId: string;
  enabled: boolean;
}

export function GpsBroadcastController({ routeId, driverId, enabled }: Props) {
  const state = useGpsBroadcast({ routeId, driverId, enabled });

  if (!enabled) return null;

  const status: { label: string; color: string } = state.error
    ? { label: state.error, color: 'var(--color-danger-fg)' }
    : state.active
      ? { label: `GPS activo · ${state.broadcastCount} envíos`, color: 'var(--vf-green-600,#15803d)' }
      : { label: 'Conectando GPS…', color: 'var(--color-text-muted)' };

  return (
    <div
      className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--vf-surface-1)] px-4 py-2 text-xs"
      style={{ color: status.color }}
      role="status"
      aria-live="polite"
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{
          background: state.error
            ? 'var(--color-danger-fg)'
            : state.active
              ? 'var(--vf-green-500,#16a34a)'
              : 'var(--color-text-subtle)',
          animation: state.active && !state.error ? 'pulse 2s infinite' : 'none',
        }}
      />
      <span className="truncate">{status.label}</span>
    </div>
  );
}

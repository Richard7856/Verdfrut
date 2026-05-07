'use client';

// Banner discreto en /dashboard u otras páginas del admin que invita a activar
// notificaciones push del SO. Solo visible para admin/dispatcher.
// Se oculta una vez suscrito (no estorba en uso diario).

import { useEffect, useState } from 'react';
import { Button } from '@verdfrut/ui';
import { getPushState, subscribeToPush, type PushPermissionState } from '@/lib/push-subscription';

export function PushOptIn() {
  const [state, setState] = useState<PushPermissionState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPushState().then(setState);
  }, []);

  if (state === null) return null;
  if (state === 'subscribed') return null;
  if (state === 'unsupported') return null;
  if (state === 'denied') {
    return (
      <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-4 py-2 text-xs text-[var(--color-text-muted)]">
        Notificaciones del navegador bloqueadas. Para recibir alertas de
        incidencias cuando estés en otra pestaña, habilítalas en Configuración →
        Notificaciones de tu navegador.
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-info-border,#bfdbfe)] bg-[var(--color-info-bg,#eff6ff)] px-4 py-2.5 text-xs">
      <div className="min-w-0">
        <p className="font-medium text-[var(--color-text)]">
          Activa notificaciones del navegador
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          Recibe alertas cuando un chofer reporte un problema, aunque tengas
          esta pestaña en segundo plano.
        </p>
        {error && <p className="mt-1 text-[11px] text-[var(--color-danger-fg)]">{error}</p>}
      </div>
      <Button
        type="button"
        variant="primary"
        size="sm"
        isLoading={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const res = await subscribeToPush();
          if (res.ok) {
            setState('subscribed');
          } else {
            setError(res.error ?? 'No se pudo activar');
            setState(res.state);
          }
          setPending(false);
        }}
      >
        Activar
      </Button>
    </div>
  );
}

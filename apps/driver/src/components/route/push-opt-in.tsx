'use client';

// Banner que invita al chofer a activar notificaciones push.
// Aparece SOLO si:
//   - El browser soporta Push API
//   - El permiso aún no fue dado (default) o fue dado pero falta suscripción
// Se oculta si ya está suscrito o si el chofer rechazó (no insistimos —
// rechazo persistente requiere ir a settings del navegador).

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

  if (state === null) return null; // primer render antes de conocer estado
  if (state === 'subscribed') return null; // ya activo, no estorbar
  if (state === 'unsupported') return null; // browser sin Push API
  if (state === 'denied') {
    // El chofer ya dijo que no — mostramos hint discreto en lugar de pedir otra vez.
    return (
      <div className="border-b border-[var(--color-border)] bg-[var(--vf-surface-2)] px-4 py-2 text-xs text-[var(--color-text-muted)]">
        Notificaciones bloqueadas. Para recibir alertas de rutas nuevas, habilítalas en
        Configuración → Notificaciones de tu navegador.
      </div>
    );
  }

  // state === 'default' o 'granted' (sin sub activa) → mostrar CTA.
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--vf-green-50,#f0fdf4)] px-4 py-2.5 text-xs">
      <div className="min-w-0">
        <p className="font-medium text-[var(--color-text)]">
          Activar notificaciones
        </p>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Recibe aviso cuando te asignen una ruta nueva.
        </p>
        {error && (
          <p className="mt-1 text-[11px] text-[var(--color-danger-fg)]">{error}</p>
        )}
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

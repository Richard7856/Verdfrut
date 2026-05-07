'use client';

// Toggle 🔊/🔇 para sonido de notificaciones de incidencias. Persiste en localStorage.
// Hidratado: en SSR no hay localStorage, así que el primer render asume "ON" para
// no causar mismatch — el cliente lo sincroniza tras hydration.

import { useEffect, useState } from 'react';
import { isSoundEnabled, setSoundEnabled } from '@/lib/use-incident-notifications';

export function SoundToggle() {
  const [enabled, setEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setEnabled(isSoundEnabled());
    setHydrated(true);
  }, []);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSoundEnabled(next);
  }

  // Antes de hydration, mostrar como "ON" — el toggle real aplicará tras montar.
  const showEnabled = hydrated ? enabled : true;

  return (
    <button
      type="button"
      onClick={toggle}
      className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-base hover:bg-[var(--vf-surface-2)]"
      aria-label={showEnabled ? 'Silenciar notificaciones' : 'Activar notificaciones'}
      title={showEnabled ? 'Silenciar notificaciones' : 'Activar notificaciones'}
    >
      {showEnabled ? '🔊' : '🔇'}
    </button>
  );
}

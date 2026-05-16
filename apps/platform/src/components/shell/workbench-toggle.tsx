'use client';

// Toggle del modo Workbench en el topbar (ADR-112).
// Click → server action que cambia la cookie + revalida layout.
// Cuando estás en sandbox, el botón se ve amber + emoji 🧪 para refuerzo visual.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setWorkbenchModeAction } from '@/app/(app)/settings/workbench/actions';
import type { WorkbenchMode } from '@/lib/workbench-mode';

export function WorkbenchToggle({ mode }: { mode: WorkbenchMode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isSandbox = mode === 'sandbox';

  function handleClick() {
    const next: WorkbenchMode = isSandbox ? 'real' : 'sandbox';
    if (!isSandbox) {
      const ok = window.confirm(
        'Entrar al MODO PLANEACIÓN.\n\nEn este modo:\n' +
          ' • Listas y mapas muestran solo tiros/rutas hipotéticas.\n' +
          ' • Lo que crees acá NO afecta la operación real (no llega al chofer).\n' +
          ' • Es compartido con tu equipo del cliente — colaboran sobre el mismo escenario.\n\n' +
          'Para volver a operación real, vuelve a tocar el botón.',
      );
      if (!ok) return;
    }
    startTransition(async () => {
      const res = await setWorkbenchModeAction(next);
      if (res.ok) {
        router.refresh();
      } else {
        window.alert(res.error ?? 'No se pudo cambiar el modo.');
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={
        isSandbox
          ? 'Estás en MODO PLANEACIÓN — los cambios no afectan operación real. Click para volver.'
          : 'Cambiar a MODO PLANEACIÓN para probar escenarios sin afectar la operación real.'
      }
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
      style={{
        background: isSandbox
          ? 'color-mix(in oklch, var(--vf-warn, #d97706) 22%, transparent)'
          : 'transparent',
        borderColor: isSandbox ? 'var(--vf-warn, #d97706)' : 'var(--vf-line)',
        color: isSandbox ? 'var(--vf-warn, #d97706)' : 'var(--vf-text-mute)',
      }}
    >
      <span aria-hidden>{isSandbox ? '🧪' : '⚙️'}</span>
      <span>{isSandbox ? 'Modo planeación' : 'Modo real'}</span>
    </button>
  );
}

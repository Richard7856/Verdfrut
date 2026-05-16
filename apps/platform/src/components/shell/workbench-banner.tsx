// Banner persistente que aparece arriba del shell cuando el modo Workbench
// está activo (ADR-112). Refuerzo visual: aún si el admin olvida que está en
// sandbox, el banner se lo recuerda en cada navegación.
//
// Server component — lee la cookie del request directamente.

import Link from 'next/link';
import { isSandboxMode } from '@/lib/workbench-mode';

export async function WorkbenchBanner() {
  if (!(await isSandboxMode())) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 px-4 py-1.5 text-[12px]"
      style={{
        background: 'color-mix(in oklch, var(--vf-warn, #d97706) 18%, transparent)',
        borderBottom: '1px solid var(--vf-warn, #d97706)',
        color: 'var(--vf-warn, #d97706)',
      }}
    >
      <span>
        <strong>🧪 Modo planeación activo.</strong> Lo que veas y crees acá NO
        afecta la operación real. Compartido con tu equipo del cliente.
      </span>
      <Link
        href="/settings/workbench"
        className="underline-offset-2 hover:underline"
        style={{ color: 'inherit' }}
      >
        Administrar →
      </Link>
    </div>
  );
}

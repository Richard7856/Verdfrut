// Topbar del Control Plane — solo botón de logout y label de scope.

import { logoutAction } from '@/app/login/actions';

export function Topbar() {
  return (
    <header
      className="flex h-[var(--vf-top-h,56px)] items-center justify-between border-b px-6"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
          Operación VerdFrut
        </span>
      </div>
      <div className="flex items-center gap-3">
        <form action={logoutAction}>
          <button
            type="submit"
            className="text-sm text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline"
          >
            Salir
          </button>
        </form>
      </div>
    </header>
  );
}

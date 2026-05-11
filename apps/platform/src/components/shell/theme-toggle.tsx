'use client';

// Toggle dark/light. Persiste en cookie `td-theme` y muta data-theme en runtime.
// Sin server action — el SSR siguiente leerá la cookie y aplicará el tema correcto.
//
// ADR-056 / H6: la cookie cambió de `vf-theme` → `td-theme`. Al escribir la
// nueva, BORRAMOS la legacy (max-age=0) para no dejar dos cookies divergentes
// si el usuario alterna el tema. El server (theme.ts) lee ambas por compat.

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const COOKIE = 'td-theme';
const COOKIE_LEGACY = 'vf-theme';

function readCurrentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
}

function writeThemeCookie(theme: Theme) {
  // 1 año de persistencia. Path=/ para que aplique global.
  document.cookie = `${COOKIE}=${theme}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  // Limpiar la cookie legacy si existe — evita divergencia.
  document.cookie = `${COOKIE_LEGACY}=; path=/; max-age=0; SameSite=Lax`;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(readCurrentTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    writeThemeCookie(next);
    setTheme(next);
  }

  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      title={isDark ? 'Tema claro' : 'Tema oscuro'}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--vf-text-mute)] hover:bg-[var(--vf-bg-sub)] hover:text-[var(--vf-text)]"
    >
      {/* Icono inline — no dependencia de paquetes externos */}
      {isDark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

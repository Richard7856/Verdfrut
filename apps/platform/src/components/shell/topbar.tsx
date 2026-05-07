// Topbar — breadcrumb + búsqueda global + acciones + usuario.
// Densidad y altura siguen los tokens de identidad (--vf-top-h = 56px).

import type { UserProfile } from '@verdfrut/types';
import { LogoutButton } from './logout-button';
import { ThemeToggle } from './theme-toggle';
import { SoundToggle } from './sound-toggle';

const ROLE_LABELS: Record<UserProfile['role'], string> = {
  admin: 'Administrador',
  dispatcher: 'Logística',
  zone_manager: 'Encargado de zona',
  driver: 'Chofer',
};

export function Topbar({ profile }: { profile: UserProfile }) {
  return (
    <header
      className="flex h-[var(--vf-top-h)] items-center gap-3 px-[18px]"
      style={{
        background: 'var(--vf-bg-elev)',
        borderBottom: '1px solid var(--vf-line)',
      }}
    >
      {/* Breadcrumb / page title (placeholder — se completa cuando montemos páginas reales) */}
      <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--vf-text-mute)' }}>
        <span style={{ color: 'var(--vf-text-mute)' }}>Operación</span>
        <span style={{ color: 'var(--vf-text-faint)' }}>/</span>
        <span style={{ color: 'var(--vf-text)', fontWeight: 500 }}>Dashboard</span>
      </div>

      {/* Acciones a la derecha */}
      <div className="ml-auto flex items-center gap-2.5">
        {/* Toggle de sonido visible solo para admin/dispatcher (los que reciben notifs). */}
        {(profile.role === 'admin' || profile.role === 'dispatcher') && <SoundToggle />}
        <ThemeToggle />
        <UserChip profile={profile} />
        <LogoutButton />
      </div>
    </header>
  );
}

function UserChip({ profile }: { profile: UserProfile }) {
  const initials = profile.fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  return (
    <div className="flex items-center gap-2.5 pl-2">
      <div
        className="grid h-7 w-7 place-items-center rounded-full text-[10.5px] font-semibold"
        style={{
          background: 'var(--vf-green-700)',
          color: 'white',
        }}
      >
        {initials || '?'}
      </div>
      <div className="hidden text-right md:block">
        <p className="text-[12.5px] font-medium leading-tight" style={{ color: 'var(--vf-text)' }}>
          {profile.fullName}
        </p>
        <p className="text-[11px] leading-tight" style={{ color: 'var(--vf-text-mute)' }}>
          {ROLE_LABELS[profile.role]}
        </p>
      </div>
    </div>
  );
}

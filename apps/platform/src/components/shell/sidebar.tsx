// Sidebar de navegación. Sigue la identidad visual VerdFrut:
//   - Brand mark verde con leaf + wordmark "verdfrut" + badge env (PROD)
//   - Items agrupados por sección (GENERAL / OPERACIÓN / CATÁLOGO / SISTEMA)
//   - Filtra por rol del usuario.
// El sidebar es SIEMPRE oscuro (no toggle dark) — decisión de marca.

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { UserRole } from '@verdfrut/types';
import { cn } from '@verdfrut/ui';

interface NavItem {
  href: string;
  label: string;
  roles: UserRole[];
  group: 'GENERAL' | 'OPERACIÓN' | 'CATÁLOGO' | 'SISTEMA';
  badge?: string | number;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Overview', roles: ['admin', 'dispatcher', 'zone_manager'], group: 'GENERAL' },
  { href: '/map', label: 'Mapa en vivo', roles: ['admin', 'dispatcher', 'zone_manager'], group: 'GENERAL' },

  { href: '/routes', label: 'Optimizador de rutas', roles: ['admin', 'dispatcher'], group: 'OPERACIÓN' },
  { href: '/settings/vehicles', label: 'Flotilla', roles: ['admin', 'dispatcher'], group: 'OPERACIÓN' },
  { href: '/settings/depots', label: 'CEDIS / Hubs', roles: ['admin', 'dispatcher'], group: 'OPERACIÓN' },
  { href: '/incidents', label: 'Incidencias', roles: ['admin', 'dispatcher', 'zone_manager'], group: 'OPERACIÓN' },

  { href: '/settings/stores', label: 'Tiendas', roles: ['admin', 'dispatcher'], group: 'CATÁLOGO' },
  { href: '/drivers', label: 'Choferes', roles: ['admin', 'dispatcher'], group: 'CATÁLOGO' },
  { href: '/inventory', label: 'Inventario', roles: ['admin', 'dispatcher'], group: 'CATÁLOGO' },

  { href: '/reports', label: 'Reportes', roles: ['admin', 'dispatcher', 'zone_manager'], group: 'SISTEMA' },
  { href: '/settings/zones', label: 'Zonas', roles: ['admin'], group: 'SISTEMA' },
  { href: '/settings/users', label: 'Usuarios', roles: ['admin'], group: 'SISTEMA' },
];

const GROUP_ORDER: NavItem['group'][] = ['GENERAL', 'OPERACIÓN', 'CATÁLOGO', 'SISTEMA'];

const ENV_LABEL = process.env.NEXT_PUBLIC_ENV_LABEL ?? 'PROD';

export function Sidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => i.roles.includes(role));

  return (
    <aside
      className="flex h-screen w-[var(--vf-side-w)] shrink-0 flex-col"
      style={{
        background: 'var(--vf-bg-side)',
        color: 'var(--vf-text-on-dark)',
        borderRight: '1px solid color-mix(in oklch, var(--vf-bg-side) 70%, white 8%)',
      }}
    >
      {/* Brand */}
      <div
        className="flex h-[var(--vf-top-h)] items-center gap-2.5 px-4"
        style={{ borderBottom: '1px solid color-mix(in oklch, var(--vf-bg-side) 70%, white 6%)' }}
      >
        <BrandMark />
        <span className="text-[15px] font-semibold tracking-tight">
          verd
          <em className="not-italic font-semibold" style={{ color: 'var(--vf-green-500)' }}>
            frut
          </em>
        </span>
        <EnvBadge label={ENV_LABEL} />
      </div>

      {/* Nav */}
      <nav className="vf-scroll flex-1 overflow-y-auto px-2 py-4">
        {GROUP_ORDER.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} className="mb-5">
              <p
                className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-[0.08em]"
                style={{ color: 'var(--vf-text-on-dark-mute)' }}
              >
                {group}
              </p>
              <div className="flex flex-col gap-0.5">
                {groupItems.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-2.5 rounded-[var(--vf-r-sm)] border border-transparent px-2.5 py-1.5 text-[13px] transition-colors',
      )}
      style={{
        background: isActive
          ? 'color-mix(in oklch, var(--vf-bg-side) 75%, white 10%)'
          : 'transparent',
        color: isActive ? 'var(--vf-text-on-dark)' : 'var(--vf-text-on-dark-mute)',
      }}
    >
      <span className="flex-1">{item.label}</span>
      {item.badge && (
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
          style={{ background: 'var(--vf-crit)', color: 'white' }}
        >
          {item.badge}
        </span>
      )}
    </Link>
  );
}

function BrandMark() {
  return (
    <div
      className="grid h-[26px] w-[26px] place-items-center rounded-[7px]"
      style={{ background: 'var(--vf-green-700)', color: 'white' }}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c.83 5.78.42 9.16-1.2 11.84A7 7 0 0 1 11 20Z" />
        <path d="M2 21c0-3 1.85-5.36 5.08-6" />
      </svg>
    </div>
  );
}

function EnvBadge({ label }: { label: string }) {
  return (
    <span
      className="ml-auto rounded-[4px] px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.08em]"
      style={{
        color: 'var(--vf-text-on-dark-mute)',
        border: '1px solid color-mix(in oklch, var(--vf-bg-side) 60%, white 14%)',
      }}
    >
      {label}
    </span>
  );
}

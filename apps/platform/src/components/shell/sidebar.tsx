// Sidebar de navegación. Sigue la identidad visual TripDrive:
//   - Brand mark verde con leaf + wordmark "tripdrive" + badge env (PROD)
//   - Items agrupados por sección (GENERAL / OPERACIÓN / CATÁLOGO / SISTEMA)
//   - Filtra por rol del usuario.
// El sidebar es SIEMPRE oscuro (no toggle dark) — decisión de marca.

'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { UserRole } from '@tripdrive/types';
import { cn } from '@tripdrive/ui';
import { useOpenIncidentsCount } from '@/lib/use-incident-notifications';

interface NavItem {
  href: string;
  label: string;
  roles: UserRole[];
  group: 'GENERAL' | 'CLIENTES' | 'OPERACIÓN' | 'CATÁLOGO' | 'SISTEMA';
  badge?: string | number;
}

// Modelo de roles V3 (ADR-124, 2026-05-16):
// - admin/dispatcher: supervisan + OPERAN. Ven todo, ejecutan writes.
// - zone_manager: supervisor read-only + chat + incidencias. NO opera.
//   - Customer-wide si zone_id=null (encargado del cliente).
//   - Regional si zone_id=X (jefe de zona).
//   En ambos casos: ve Día, Dashboard, Mapa, Choferes, Incidencias, Reportes.
//   NO ve: Tiendas, Flotilla, CEDIS, Workbench, Asistente AI, Settings, Billing.
const NAV_ITEMS: NavItem[] = [
  // GENERAL — supervisión
  { href: '/dashboard', label: 'Overview', roles: ['admin', 'dispatcher', 'zone_manager'], group: 'GENERAL' },
  { href: '/map', label: 'Mapa en vivo', roles: ['admin', 'dispatcher', 'zone_manager'], group: 'GENERAL' },
  { href: '/orchestrator', label: 'Asistente AI', roles: ['admin', 'dispatcher'], group: 'GENERAL', badge: 'Beta' },

  // CLIENTES — shell del feature multi-cliente (en desarrollo). Mientras es
  // shell-only, todo NETO opera con el modelo actual; la sección sirve para
  // mostrar la visión del feature en la presentación.
  { href: '/customers', label: 'Clientes', roles: ['admin', 'dispatcher'], group: 'CLIENTES' },

  // OPERACIÓN — vista del día + listas
  { href: '/dia', label: '📅 Día', roles: ['admin', 'dispatcher', 'zone_manager'], group: 'OPERACIÓN' },
  { href: '/routes', label: 'Rutas', roles: ['admin', 'dispatcher'], group: 'OPERACIÓN' },
  // /dispatches removido del sidebar 2026-05-15: el concepto "tiro = contenedor
  // de rutas" confundía a customers nuevos (esperaban ver "operación del día",
  // no un contenedor abstracto). El URL /dispatches/[id] sigue accesible como
  // drill-down desde /dia (chips de tiros agrupados al pie del listado), y la
  // página /dispatches redirige a /dia.
  { href: '/settings/vehicles', label: 'Flotilla', roles: ['admin', 'dispatcher'], group: 'OPERACIÓN' },
  { href: '/settings/depots', label: 'CEDIS / Hubs', roles: ['admin', 'dispatcher'], group: 'OPERACIÓN' },
  { href: '/incidents', label: 'Incidencias', roles: ['admin', 'dispatcher', 'zone_manager'], group: 'OPERACIÓN' },
  { href: '/incidents/active-chat', label: '💬 Mi chat', roles: ['zone_manager'], group: 'OPERACIÓN' },
  { href: '/incidents/anomalies', label: '🔴 Anomalías', roles: ['admin', 'dispatcher', 'zone_manager'], group: 'OPERACIÓN' },

  // CATÁLOGO — choferes visible al supervisor; tiendas/inventario son catálogo
  // operativo (writes) → solo admin/dispatcher.
  { href: '/settings/stores', label: 'Tiendas', roles: ['admin', 'dispatcher'], group: 'CATÁLOGO' },
  { href: '/drivers', label: 'Choferes', roles: ['admin', 'dispatcher', 'zone_manager'], group: 'CATÁLOGO' },
  { href: '/inventory', label: 'Inventario', roles: ['admin', 'dispatcher'], group: 'CATÁLOGO' },

  // SISTEMA — reportes para todos, audit/configuración para admin/dispatcher.
  { href: '/reports', label: 'Reportes', roles: ['admin', 'dispatcher', 'zone_manager'], group: 'SISTEMA' },
  { href: '/audit/chat-failures', label: 'Auditoría · chat', roles: ['admin'], group: 'SISTEMA' },
  { href: '/settings/zones', label: 'Zonas', roles: ['admin'], group: 'SISTEMA' },
  { href: '/settings/users', label: 'Usuarios', roles: ['admin'], group: 'SISTEMA' },
  { href: '/settings/billing', label: '💳 Suscripción', roles: ['admin'], group: 'SISTEMA' },
  { href: '/settings/workbench', label: '🧪 Modo planeación', roles: ['admin', 'dispatcher'], group: 'SISTEMA', badge: 'Beta' },
];

const GROUP_ORDER: NavItem['group'][] = ['GENERAL', 'CLIENTES', 'OPERACIÓN', 'CATÁLOGO', 'SISTEMA'];

const ENV_LABEL = process.env.NEXT_PUBLIC_ENV_LABEL ?? 'PROD';

export function Sidebar({
  role,
  initialOpenIncidentsCount = 0,
}: {
  role: UserRole;
  /** Count inicial cargado del server. El hook lo mantiene actualizado en realtime. */
  initialOpenIncidentsCount?: number;
}) {
  const pathname = usePathname();
  // Counter realtime para el badge de "Incidencias". Solo aplica para admin/dispatcher.
  const incidentsCount = useOpenIncidentsCount(initialOpenIncidentsCount);

  // Decora dinámicamente el item "Incidencias" con badge realtime cuando hay reportes abiertos.
  const items = NAV_ITEMS.filter((i) => i.roles.includes(role)).map((item) => {
    if (item.href === '/incidents' && incidentsCount > 0) {
      return { ...item, badge: incidentsCount };
    }
    return item;
  });

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
          trip
          <em className="not-italic font-semibold" style={{ color: 'var(--vf-green-500)' }}>
            drive
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
  // Icon-only del logo (pin verde con cinta gris/blanca). Servido desde
  // /public para que Next lo optimice y cachee. Sidebar es siempre oscuro,
  // así que el ícono va sin fondo extra — la transparencia del PNG hace
  // que se vea bien sobre `--vf-bg-side`.
  return (
    <Image
      src="/tripdrive-icon.png"
      alt="TripDrive"
      width={28}
      height={28}
      priority
      className="shrink-0"
    />
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

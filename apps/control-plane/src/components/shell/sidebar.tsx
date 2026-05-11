// Sidebar del Control Plane. Identidad TripDrive — siempre oscuro, badge "CTRL"
// para distinguir visualmente del platform / driver.

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@tripdrive/ui';

interface NavItem {
  href: string;
  label: string;
  group: 'GENERAL' | 'TENANTS' | 'OPERACIÓN' | 'SISTEMA';
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Overview', group: 'GENERAL' },

  { href: '/tenants', label: 'Tenants', group: 'TENANTS' },
  { href: '/tenants/new', label: 'Onboardear cliente', group: 'TENANTS' },

  { href: '/sync', label: 'Sync logs', group: 'OPERACIÓN' },
  { href: '/audit', label: 'Audit log', group: 'OPERACIÓN' },

  { href: '/admins', label: 'Admins', group: 'SISTEMA' },
];

const GROUP_ORDER: NavItem['group'][] = ['GENERAL', 'TENANTS', 'OPERACIÓN', 'SISTEMA'];

const ENV_LABEL = process.env.NEXT_PUBLIC_ENV_LABEL ?? 'PROD';

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="flex h-screen w-[var(--vf-side-w,240px)] shrink-0 flex-col"
      style={{
        background: 'var(--vf-bg-side)',
        color: 'var(--vf-text-on-dark)',
        borderRight: '1px solid color-mix(in oklch, var(--vf-bg-side) 70%, white 8%)',
      }}
    >
      {/* Brand: tripdrive + CTRL badge */}
      <div
        className="flex h-[var(--vf-top-h,56px)] items-center gap-2.5 px-4"
        style={{ borderBottom: '1px solid color-mix(in oklch, var(--vf-bg-side) 70%, white 6%)' }}
      >
        <BrandMark />
        <span className="text-[15px] font-semibold tracking-tight">
          trip
          <em className="not-italic font-semibold" style={{ color: 'var(--vf-green-500)' }}>
            drive
          </em>
        </span>
        <CtrlBadge />
        <EnvBadge label={ENV_LABEL} />
      </div>

      <nav className="vf-scroll flex-1 overflow-y-auto px-2 py-4">
        {GROUP_ORDER.map((group) => {
          const items = NAV_ITEMS.filter((i) => i.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-5">
              <p
                className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-[0.08em]"
                style={{ color: 'var(--vf-text-on-dark-mute)' }}
              >
                {group}
              </p>
              <div className="flex flex-col gap-0.5">
                {items.map((item) => (
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
  // "/" matchea exacto. El resto matchea por prefix para que /tenants/[id] active "Tenants".
  const isActive = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/');

  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-2.5 rounded-[var(--vf-r-sm)] border border-transparent px-2.5 py-1.5 text-[13px] transition-colors',
      )}
      style={{
        background: isActive ? 'color-mix(in oklch, var(--vf-bg-side) 75%, white 10%)' : 'transparent',
        color: isActive ? 'var(--vf-text-on-dark)' : 'var(--vf-text-on-dark-mute)',
      }}
    >
      <span className="flex-1">{item.label}</span>
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
        viewBox="0 0 24 24" width="14" height="14" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      >
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c.83 5.78.42 9.16-1.2 11.84A7 7 0 0 1 11 20Z" />
        <path d="M2 21c0-3 1.85-5.36 5.08-6" />
      </svg>
    </div>
  );
}

function CtrlBadge() {
  return (
    <span
      className="rounded-[4px] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em]"
      style={{
        background: 'color-mix(in oklch, var(--vf-green-700) 70%, white 8%)',
        color: 'white',
      }}
    >
      CTRL
    </span>
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

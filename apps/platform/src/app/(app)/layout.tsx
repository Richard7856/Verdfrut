// Layout principal de la app autenticada — sidebar + topbar siguiendo identidad VerdFrut.

import { requireProfile } from '@/lib/auth';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--vf-bg)' }}>
      <Sidebar role={profile.role} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar profile={profile} />
        <main className="vf-scroll flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

// Layout principal de la app autenticada — sidebar + topbar siguiendo identidad VerdFrut.
// Incluye el listener de notificaciones para admin/dispatcher (toast + sonido al
// llegar nuevos reportes) y carga el count inicial de incidencias para el badge
// realtime del sidebar.

import { requireProfile } from '@/lib/auth';
import { createServerClient } from '@verdfrut/supabase/server';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { IncidentToastListener } from '@/components/notifications/incident-toast-listener';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  // Count inicial de incidencias abiertas para el badge del sidebar.
  // Solo lo cargamos para admin/dispatcher (zone_manager solo entra a su chat,
  // no necesita un counter global).
  let initialOpenIncidentsCount = 0;
  if (profile.role === 'admin' || profile.role === 'dispatcher') {
    const supabase = await createServerClient();
    const { count } = await supabase
      .from('delivery_reports')
      .select('id', { count: 'exact', head: true })
      .eq('chat_status', 'open');
    if (typeof count === 'number') initialOpenIncidentsCount = count;
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--vf-bg)' }}>
      <Sidebar role={profile.role} initialOpenIncidentsCount={initialOpenIncidentsCount} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar profile={profile} />
        <main className="vf-scroll vf-main flex-1 overflow-y-auto">
          <div className="vf-main-inner mx-auto max-w-7xl p-6">{children}</div>
        </main>
      </div>
      {/* Listener global de incidencias — toast + sonido cuando llega evento.
          Solo se activa para admin/dispatcher (zone_manager ya está en SU chat). */}
      <IncidentToastListener role={profile.role} zoneId={profile.zoneId} />
    </div>
  );
}

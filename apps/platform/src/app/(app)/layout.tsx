// Layout principal de la app autenticada — sidebar + topbar siguiendo identidad TripDrive.
// Incluye el listener de notificaciones para admin/dispatcher (toast + sonido al
// llegar nuevos reportes) y carga el count inicial de incidencias para el badge
// realtime del sidebar.

import { requireProfile } from '@/lib/auth';
import { createServerClient } from '@tripdrive/supabase/server';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { WorkbenchBanner } from '@/components/shell/workbench-banner';
import { IncidentToastListener } from '@/components/notifications/incident-toast-listener';
import { FloatingChat } from '@/components/floating-chat/floating-chat';
import { getCurrentCustomerBranding, brandingCss } from '@/lib/branding';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const branding = await getCurrentCustomerBranding();

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
    <>
      {/* ADR-089 / A4.1: inyecta --customer-brand-primary del customer del
          user logueado. Var disponible opt-in; cero impacto visual hasta que
          un componente la use (A4.2). Default verdfrut = #34c97c. */}
      <style dangerouslySetInnerHTML={{ __html: brandingCss(branding) }} />
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--vf-bg)' }}>
        <Sidebar role={profile.role} initialOpenIncidentsCount={initialOpenIncidentsCount} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar profile={profile} />
          {(profile.role === 'admin' || profile.role === 'dispatcher') && (
            <WorkbenchBanner />
          )}
          <main className="vf-scroll vf-main flex-1 overflow-y-auto">
            <div className="vf-main-inner mx-auto max-w-7xl p-6">{children}</div>
          </main>
        </div>
        {/* Listener global de incidencias — toast + sonido cuando llega evento.
            Solo se activa para admin/dispatcher (zone_manager ya está en SU chat). */}
        <IncidentToastListener role={profile.role} zoneId={profile.zoneId} />
        {/* Stream AI-1 / Phase 1 (2026-05-15): asistente flotante contextual.
            Solo admin/dispatcher (zone_manager no tiene tools del orchestrator).
            El componente decide internamente no renderizar en /orchestrator. */}
        {(profile.role === 'admin' || profile.role === 'dispatcher') && <FloatingChat />}
      </div>
    </>
  );
}

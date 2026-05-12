// Lista de paradas del día para el chofer.
// Server Component: hace queries con la sesión del chofer y RLS hace el resto.
// Si no hay ruta asignada, muestra estado vacío.

import Image from 'next/image';
import { requireDriverProfile } from '@/lib/auth';
import { getDriverRouteForDate, getRouteStopsWithStores } from '@/lib/queries/route';
import { createServerClient } from '@tripdrive/supabase/server';
import { todayInZone } from '@tripdrive/utils';
import { logoutAction } from '@/app/(auth)/login/actions';
import { RouteHeader } from '@/components/route/route-header';
import { ReorderableStopsList } from '@/components/route/reorderable-stops-list';
import { EmptyRoute } from '@/components/route/empty-route';
import { GpsBroadcastController } from '@/components/route/gps-broadcast-controller';
import { PushOptIn } from '@/components/route/push-opt-in';
import { OutboxBadge } from '@/components/outbox-badge';
import Link from 'next/link';
import { Button } from '@tripdrive/ui';

export const metadata = { title: 'Mi ruta' };
// Esta página no debe cachearse — los stops cambian conforme el chofer avanza.
export const dynamic = 'force-dynamic';

const DEFAULT_TZ = 'America/Mexico_City';

export default async function RoutePage() {
  const profile = await requireDriverProfile();
  const timezone = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? DEFAULT_TZ;
  const today = todayInZone(timezone);

  const route = await getDriverRouteForDate(today);
  const stops = route ? await getRouteStopsWithStores(route.id) : [];

  // Resolver driver_id (no user_id) para insertar breadcrumbs y broadcasts.
  // RLS de drivers permite al usuario leer su propio row.
  let driverId: string | null = null;
  if (route) {
    const supabase = await createServerClient();
    const { data: driverRow } = await supabase
      .from('drivers')
      .select('id')
      .eq('user_id', profile.id)
      .maybeSingle();
    driverId = driverRow?.id ?? null;
  }

  // GPS solo se activa cuando la ruta está en curso (no DRAFT/PUBLISHED solo).
  // PUBLISHED = chofer vio pero no ha llegado a primera parada → todavía no.
  // IN_PROGRESS = al menos una parada con arrived → empezó la jornada.
  const gpsEnabled = route?.status === 'IN_PROGRESS' && Boolean(driverId);

  const totalStops = stops.length;
  const completedStops = stops.filter(
    (s) => s.stop.status === 'completed' || s.stop.status === 'skipped',
  ).length;

  // La "próxima" parada pendiente — la primera por sequence con status=pending.
  // Si todas están done, no hay next.
  const nextStopId = stops.find((s) => s.stop.status === 'pending')?.stop.id ?? null;

  // Para el botón "Reportar problema" desde la lista — si hay stop pendiente, abre
  // SU chat. Si todas las paradas están done o no hay ruta, NO ofrecemos el botón
  // (caso poco común — chofer sin paradas no tiene problema operativo que reportar).
  const reportProblemStopId = nextStopId ?? stops[0]?.stop.id ?? null;

  return (
    <main className="min-h-dvh bg-[var(--vf-bg)] safe-top safe-bottom">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Image
            src="/tripdrive-icon.png"
            alt="TripDrive"
            width={28}
            height={28}
            priority
            className="shrink-0"
          />
          <div>
            <h1 className="text-base font-semibold text-[var(--color-text)]">TripDrive</h1>
            <p className="text-xs text-[var(--color-text-muted)]">{profile.fullName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Badge solo aparece si hay items pendientes — ADR-019 */}
          <OutboxBadge />
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-sm text-[var(--color-text-muted)] underline-offset-2 hover:underline"
            >
              Salir
            </button>
          </form>
        </div>
      </header>

      {/* Opt-in de push notifications — visible siempre que browser soporte y no esté ya suscrito. */}
      <PushOptIn />

      {!route ? (
        <EmptyRoute driverName={profile.fullName} todayLabel={today} />
      ) : (
        <>
          {gpsEnabled && driverId && (
            <GpsBroadcastController
              routeId={route.id}
              driverId={driverId}
              enabled={gpsEnabled}
            />
          )}
          <RouteHeader
            route={route}
            totalStops={totalStops}
            completedStops={completedStops}
            timezone={timezone}
          />
          {stops.length === 0 ? (
            <p className="m-4 text-sm text-[var(--color-text-muted)]">
              Esta ruta no tiene paradas. Contacta a tu encargado.
            </p>
          ) : (
            <>
              <div className="px-4 pt-4 space-y-2">
                <Link href="/route/navigate" className="block">
                  <Button type="button" variant="primary" size="lg" className="w-full">
                    🧭 Iniciar navegación
                  </Button>
                </Link>
                {reportProblemStopId && (
                  <Link
                    href={`/route/stop/${reportProblemStopId}/chat`}
                    className="block w-full rounded-[var(--radius-md)] border border-[var(--color-warning-border,#f59e0b)] bg-[var(--color-warning-bg,#fef3c7)] px-4 py-2.5 text-center text-sm font-medium text-[var(--color-warning-fg,#92400e)]"
                  >
                    ⚠ Reportar problema (avería, dudas, etc.)
                  </Link>
                )}
              </div>
              <ReorderableStopsList
                initialStops={stops}
                nextStopId={nextStopId}
                timezone={timezone}
              />
            </>
          )}
        </>
      )}
    </main>
  );
}

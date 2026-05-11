// ADR-046: vista pública read-only del tiro. Sin auth — accesible a cualquiera
// con la URL. El admin habilita/revoca el enlace desde /dispatches/[id].
//
// Seguridad:
//   - Token UUID 122 bits (no brute-forceable).
//   - service_role para bypass RLS (visitante anónimo no tiene sesión).
//   - Solo lectura: ningún server action accesible desde aquí.
//   - notFound() si token inválido o no asociado a un dispatch.

import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { Badge, Card } from '@tripdrive/ui';
import { getDispatchByPublicToken, listRoutesByDispatch } from '@/lib/queries/dispatches';
import { listStopsForRoutes } from '@/lib/queries/stops';
import { listVehicles } from '@/lib/queries/vehicles';
import { listStores } from '@/lib/queries/stores';
import { listZones } from '@/lib/queries/zones';
import { MultiRouteMapServer } from '@/components/map/multi-route-map-server';
import { consume as rateLimit, LIMITS } from '@/lib/rate-limit';
import { PublicRouteCard } from './public-route-card';
import type { DispatchStatus, Store } from '@tripdrive/types';

export const dynamic = 'force-dynamic';

const DISPATCH_STATUS_LABEL: Record<DispatchStatus, { text: string; tone: 'neutral' | 'info' | 'success' | 'danger' }> = {
  planning: { text: 'Planeación', tone: 'neutral' },
  dispatched: { text: 'En curso', tone: 'info' },
  completed: { text: 'Completado', tone: 'success' },
  cancelled: { text: 'Cancelado', tone: 'danger' },
};

interface Props {
  params: Promise<{ token: string }>;
}

export const metadata = {
  title: 'TripDrive — Vista del tiro',
  // No quiero que esto aparezca en buscadores. La intención es compartir
  // por WhatsApp, no que Google indexe operación interna del cliente.
  robots: { index: false, follow: false },
};

export default async function PublicDispatchViewPage({ params }: Props) {
  const { token } = await params;

  // P0-4: rate limit por IP. Sin esto un scraper puede pegar al endpoint
  // sin freno aunque conozca el token. 30 hits/min generoso para refresh
  // legítimo del equipo cliente, restrictivo contra automatización.
  // IP viene de x-forwarded-for (Vercel) o x-real-ip; fallback a 'anon' para
  // que la cota sea global cuando no podemos identificar.
  const hdrs = await headers();
  const ip =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    hdrs.get('x-real-ip') ||
    'anon';
  if (!(await rateLimit(ip, 'share-dispatch', LIMITS.shareDispatch))) {
    // 404 en vez de 429 para no filtrar que el token existe. El UX para el
    // usuario legítimo es: espera 1 min y refresca.
    notFound();
  }

  // 1. Lookup por token (service_role bypass RLS).
  const dispatch = await getDispatchByPublicToken(token);
  if (!dispatch) notFound();

  // 2. Cargar rutas + stops + vehicles + stores + zone (mismo data que /dispatches/[id]
  //    pero sin necesidad de session — todo via service_role implícito al ser
  //    queries server-side desde un page no autenticado).
  const [routes, vehicles, stores, zones] = await Promise.all([
    listRoutesByDispatch(dispatch.id),
    listVehicles({}),
    listStores({ activeOnly: false }),
    listZones(),
  ]);
  // P1-1: batch en lugar de N+1. Importante en endpoint público: si muchos
  // usuarios refrescan a la vez, multiplicaba RTT por ruta.
  const stopsByRouteId = await listStopsForRoutes(routes.map((r) => r.id));
  const stopsPerRoute = routes.map((r) => stopsByRouteId.get(r.id) ?? []);
  const storesById = new Map<string, Store>(stores.map((s) => [s.id, s]));

  const routesWithStops = routes
    .map((r, idx) => ({ route: r, stops: stopsPerRoute[idx] ?? [] }))
    .filter((x) => x.stops.length > 0);

  const status = DISPATCH_STATUS_LABEL[dispatch.status];
  const zone = zones.find((z) => z.id === dispatch.zoneId);
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  return (
    <main
      className="min-h-screen"
      style={{ background: 'var(--vf-bg)', color: 'var(--vf-text)' }}
    >
      <div className="mx-auto max-w-7xl p-4 lg:p-6">
        {/* Header simplificado: marca + status, sin acciones admin. */}
        <header className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              TripDrive · Vista pública
            </p>
            <h1 className="text-xl font-semibold">{dispatch.name}</h1>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {zone?.name ?? '—'} · {dispatch.date} · {routes.length} ruta
              {routes.length === 1 ? '' : 's'}
            </p>
          </div>
          <Badge tone={status.tone}>{status.text}</Badge>
        </header>

        {dispatch.notes && (
          <Card className="mb-4 border-[var(--color-border)] bg-[var(--vf-surface-2)]">
            <p className="text-sm text-[var(--color-text)]">{dispatch.notes}</p>
          </Card>
        )}

        {routesWithStops.length > 0 && (
          <div className="mb-4">
            <MultiRouteMapServer
              routes={routesWithStops.map((x) => x.route)}
              mapboxToken={mapboxToken}
            />
          </div>
        )}

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Rutas del tiro
          </h2>

          {routes.length === 0 ? (
            <Card className="border-[var(--color-border)] bg-[var(--vf-surface-2)]">
              <p className="text-sm text-[var(--color-text-muted)]">
                Este tiro no tiene rutas todavía.
              </p>
            </Card>
          ) : (
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {routes.map((r, idx) => {
                const stops = stopsPerRoute[idx] ?? [];
                const vehicle = vehicles.find((v) => v.id === r.vehicleId);
                return (
                  <li key={r.id}>
                    <PublicRouteCard
                      route={r}
                      stops={stops}
                      storesById={storesById}
                      vehicle={vehicle}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <footer className="mt-8 border-t border-[var(--color-border)] pt-4 text-center text-[11px] text-[var(--color-text-subtle)]">
          Vista de solo lectura · Generada por TripDrive · El enlace puede ser revocado por el administrador
        </footer>
      </div>
    </main>
  );
}

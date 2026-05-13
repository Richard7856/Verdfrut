// A3-ops.3 — Detail de una ruta del chofer desde el CP super-admin.
// Read-only: paradas con status, last breadcrumb, info de la ruta.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, Badge } from '@tripdrive/ui';
import {
  getCustomerBySlug,
  getRouteDetailForCustomer,
  type RouteStopRow,
} from '@/lib/queries/customers';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string; routeId: string }>;
}

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { dateStyle: 'medium' });
const fmtInt = new Intl.NumberFormat('es-MX');
const fmtKm = (meters: number | null) =>
  meters !== null ? `${(meters / 1000).toFixed(1)} km` : '—';
const fmtDuration = (secs: number | null) => {
  if (secs === null) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const STOP_TONE: Record<RouteStopRow['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
  pending: 'neutral',
  arrived: 'warning',
  completed: 'success',
  skipped: 'danger',
};
const STOP_LABEL: Record<RouteStopRow['status'], string> = {
  pending: 'Pendiente',
  arrived: 'En parada',
  completed: 'Completada',
  skipped: 'Saltada',
};

export async function generateMetadata({ params }: PageProps) {
  const { slug, routeId } = await params;
  const customer = await getCustomerBySlug(slug);
  if (!customer) return { title: 'Ruta' };
  const detail = await getRouteDetailForCustomer(customer.id, routeId);
  return { title: detail ? `${detail.name} — ${customer.name}` : 'Ruta' };
}

export default async function CustomerRouteDetailPage({ params }: PageProps) {
  const { slug, routeId } = await params;
  const customer = await getCustomerBySlug(slug);
  if (!customer) notFound();

  const route = await getRouteDetailForCustomer(customer.id, routeId);
  if (!route) notFound();

  const completed = route.stops.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  const arrived = route.stops.filter((s) => s.status === 'arrived').length;
  const pending = route.stops.filter((s) => s.status === 'pending').length;
  const pct = route.stops.length > 0 ? Math.round((completed / route.stops.length) * 100) : 0;

  // Indicador de último breadcrumb (¿hace cuánto reportó?).
  let lastBreadcrumbAgo: string | null = null;
  if (route.lastBreadcrumb) {
    const diffSec = Math.floor((Date.now() - new Date(route.lastBreadcrumb.recordedAt).getTime()) / 1000);
    if (diffSec < 60) lastBreadcrumbAgo = `${diffSec}s`;
    else if (diffSec < 3600) lastBreadcrumbAgo = `${Math.floor(diffSec / 60)}min`;
    else lastBreadcrumbAgo = `${Math.floor(diffSec / 3600)}h ${Math.floor((diffSec % 3600) / 60)}min`;
  }

  const isLive = route.status === 'IN_PROGRESS';

  return (
    <>
      <PageHeader
        title={route.name}
        description={`${fmtDate(route.date)} · ${route.driverName ?? 'sin chofer'} · ${route.vehiclePlate ?? '—'}`}
        breadcrumb={
          <span>
            <Link href="/customers" className="hover:underline">Customers</Link>
            {' / '}
            <Link href={`/customers/${customer.slug}`} className="hover:underline">
              {customer.name}
            </Link>
          </span>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={isLive ? 'success' : route.status === 'PUBLISHED' ? 'warning' : 'neutral'}>
          {route.status}
        </Badge>
        {route.publishedAt && (
          <span className="text-xs text-[var(--color-text-muted)]">
            Publicada: {fmtDateTime(route.publishedAt)}
          </span>
        )}
        {route.actualStartAt && (
          <span className="text-xs text-[var(--color-text-muted)]">
            · Inició: {fmtTime(route.actualStartAt)}
          </span>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Progreso</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--color-text)]">
            {completed}/{route.stops.length}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">{pct}% completado</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Pendientes</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--color-text)]">
            {fmtInt.format(pending)}
          </p>
          {arrived > 0 && (
            <p className="text-xs text-[var(--vf-warn,#d97706)]">{arrived} en parada</p>
          )}
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Distancia plan</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--color-text)]">
            {fmtKm(route.totalDistanceMeters)}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {fmtDuration(route.totalDurationSeconds)}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Último ping GPS</p>
          {lastBreadcrumbAgo ? (
            <>
              <p
                className="mt-2 text-2xl font-semibold tabular-nums"
                style={{
                  color: lastBreadcrumbAgo.includes('h') ? 'var(--vf-warn,#d97706)' : 'var(--color-text)',
                }}
              >
                hace {lastBreadcrumbAgo}
              </p>
              <p className="text-xs text-[var(--color-text-muted)] font-mono">
                {route.lastBreadcrumb!.lat.toFixed(5)}, {route.lastBreadcrumb!.lng.toFixed(5)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">Sin reportes GPS.</p>
          )}
        </Card>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Paradas ({route.stops.length})
      </h2>
      <Card className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="w-12 py-2 pr-3 text-right font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Tienda</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 pr-3 font-medium">Plan</th>
                <th className="py-2 pr-3 font-medium">Real</th>
                <th className="py-2 pr-3 font-medium">Anti-fraude</th>
              </tr>
            </thead>
            <tbody>
              {route.stops.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-[var(--color-border)] last:border-b-0"
                >
                  <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-text-muted)]">
                    {s.sequence}
                  </td>
                  <td className="py-2 pr-3">
                    <p className="font-medium text-[var(--color-text)]">{s.storeName}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      <code className="font-mono">{s.storeCode}</code> · {s.storeAddress}
                    </p>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={STOP_TONE[s.status]}>{STOP_LABEL[s.status]}</Badge>
                  </td>
                  <td className="py-2 pr-3 text-xs tabular-nums text-[var(--color-text-muted)]">
                    {fmtTime(s.plannedArrivalAt)}
                    {s.plannedDepartureAt && ` → ${fmtTime(s.plannedDepartureAt)}`}
                  </td>
                  <td className="py-2 pr-3 text-xs tabular-nums">
                    {s.actualArrivalAt ? (
                      <span className="text-[var(--color-text)]">
                        {fmtTime(s.actualArrivalAt)}
                        {s.actualDepartureAt && ` → ${fmtTime(s.actualDepartureAt)}`}
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-muted)]">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {s.arrivalWasMocked === true && (
                      <Badge tone="danger">Mock GPS</Badge>
                    )}
                    {s.arrivalAccuracyMeters !== null && s.arrivalAccuracyMeters > 50 && (
                      <span className="ml-1 text-[var(--vf-warn,#d97706)]">
                        ±{Math.round(s.arrivalAccuracyMeters)}m
                      </span>
                    )}
                    {s.arrivalDistanceMeters !== null && (
                      <span className="ml-1 text-[var(--color-text-muted)]">
                        a {s.arrivalDistanceMeters}m
                      </span>
                    )}
                    {!s.arrivalWasMocked && s.arrivalAccuracyMeters === null && (
                      <span className="text-[var(--color-text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {route.recentBreadcrumbs.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Últimos pings GPS ({route.recentBreadcrumbs.length})
          </h2>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-1.5 pr-3 font-medium">Hora</th>
                    <th className="py-1.5 pr-3 font-medium">Lat, Lng</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Vel (km/h)</th>
                  </tr>
                </thead>
                <tbody>
                  {route.recentBreadcrumbs.slice(0, 20).map((b, i) => (
                    <tr key={`${b.recordedAt}-${i}`} className="border-b border-[var(--color-border)] last:border-b-0">
                      <td className="py-1 pr-3 tabular-nums">{fmtTime(b.recordedAt)}</td>
                      <td className="py-1 pr-3 font-mono">
                        {b.lat.toFixed(5)}, {b.lng.toFixed(5)}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {b.speed !== null ? (b.speed * 3.6).toFixed(0) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {route.recentBreadcrumbs.length > 20 && (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Mostrando los 20 más recientes de {route.recentBreadcrumbs.length} cargados.
              </p>
            )}
          </Card>
        </>
      )}
    </>
  );
}

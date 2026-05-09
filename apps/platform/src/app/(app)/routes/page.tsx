// Lista de rutas con filtros (fecha, estado, zona).
// Filtros via query params para que sean bookmarkables y SSR-friendly.

import Link from 'next/link';
import { Badge, Button, DataTable, PageHeader, Select, type Column, type BadgeTone } from '@verdfrut/ui';
import type { Route, RouteStatus, Zone } from '@verdfrut/types';
import { requireRole } from '@/lib/auth';
import { listRoutes, countStopsForRoutes } from '@/lib/queries/routes';
import { listZones } from '@/lib/queries/zones';
import { listVehicles } from '@/lib/queries/vehicles';

export const metadata = { title: 'Rutas' };

const STATUS_LABELS: Record<RouteStatus, string> = {
  DRAFT: 'Borrador',
  OPTIMIZED: 'Optimizada',
  APPROVED: 'Aprobada',
  PUBLISHED: 'Publicada',
  IN_PROGRESS: 'En curso',
  INTERRUPTED: 'Interrumpida',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

const STATUS_TONES: Record<RouteStatus, BadgeTone> = {
  DRAFT: 'neutral',
  OPTIMIZED: 'info',
  APPROVED: 'primary',
  PUBLISHED: 'primary',
  IN_PROGRESS: 'warning',
  INTERRUPTED: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

interface PageProps {
  searchParams: Promise<{
    date?: string;
    status?: string;
    zone?: string;
    page?: string;
  }>;
}

const PAGE_SIZE = 50;

export default async function RoutesPage({ searchParams }: PageProps) {
  await requireRole('admin', 'dispatcher');
  const sp = await searchParams;

  const filterStatus = sp.status as RouteStatus | undefined;
  const filterZone = sp.zone || undefined;
  const filterDate = sp.date || undefined;
  const page = Math.max(0, parseInt(sp.page ?? '0', 10) || 0);

  const [{ rows: routes, total }, zones, vehicles] = await Promise.all([
    listRoutes({
      status: filterStatus,
      zoneId: filterZone,
      date: filterDate,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    }),
    listZones(),
    listVehicles(),
  ]);
  const stopCounts = await countStopsForRoutes(routes.map((r) => r.id));
  const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 0;
  const hasNext = page < totalPages - 1;
  const filterQs = new URLSearchParams();
  if (filterStatus) filterQs.set('status', filterStatus);
  if (filterZone) filterQs.set('zone', filterZone);
  if (filterDate) filterQs.set('date', filterDate);

  const columns: Column<Route>[] = [
    {
      key: 'name',
      header: 'Ruta',
      cell: (r) => (
        <Link
          href={`/routes/${r.id}`}
          className="font-medium hover:underline"
          style={{ color: 'var(--vf-text)' }}
        >
          {r.name}
        </Link>
      ),
    },
    { key: 'date', header: 'Fecha', cell: (r) => <span className="font-mono text-xs">{r.date}</span> },
    {
      key: 'vehicle',
      header: 'Camión',
      cell: (r) => {
        const v = vehiclesById.get(r.vehicleId);
        return v ? (
          <span className="font-mono text-xs">{v.alias ?? v.plate}</span>
        ) : (
          <span style={{ color: 'var(--vf-text-faint)' }}>—</span>
        );
      },
    },
    {
      key: 'zone',
      header: 'Zona',
      cell: (r) => zonesById.get(r.zoneId)?.code ?? '—',
    },
    {
      key: 'stops',
      header: 'Paradas',
      align: 'right',
      cell: (r) => {
        const c = stopCounts.get(r.id) ?? { total: 0, completed: 0 };
        return (
          <span className="font-mono tabular-nums">
            {c.completed}/{c.total}
          </span>
        );
      },
    },
    {
      key: 'distance',
      header: 'Distancia',
      align: 'right',
      cell: (r) =>
        r.totalDistanceMeters
          ? <span className="font-mono text-xs tabular-nums">{(r.totalDistanceMeters / 1000).toFixed(1)} km</span>
          : <span style={{ color: 'var(--vf-text-faint)' }}>—</span>,
    },
    {
      key: 'status',
      header: 'Estado',
      cell: (r) => <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Rutas"
        description={`Tu punto de partida para crear, optimizar y publicar rutas. ${total} ruta(s) ${filterStatus ? `en estado ${STATUS_LABELS[filterStatus].toLowerCase()}` : 'totales'}${total > PAGE_SIZE ? ` · página ${page + 1} de ${totalPages}` : ''}.`}
        action={
          <Link href="/routes/new">
            <Button variant="primary">Nueva ruta</Button>
          </Link>
        }
      />

      <RouteFilters
        zones={zones}
        currentStatus={filterStatus}
        currentZone={filterZone}
        currentDate={filterDate}
      />

      {/* ADR-039: el mapa global de rutas se removió de esta vista — duplicaba
          info de la lista y el dispatcher entra al detalle (`/routes/[id]`)
          para ver una ruta en mapa. Si en el futuro se quiere "vista del día"
          colectiva, va en `/map` (live tracking) o en `/dispatches/[id]`. */}

      <DataTable
        columns={columns}
        rows={routes}
        rowKey={(r) => r.id}
        emptyTitle="Sin rutas"
        emptyDescription="Crea tu primera ruta — selecciona tiendas y camiones, el optimizador calcula el orden óptimo."
        emptyAction={
          <Link href="/routes/new">
            <Button variant="primary">Crear ruta</Button>
          </Link>
        }
      />

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2">
          {hasPrev && (
            <Link
              href={`/routes?${new URLSearchParams({ ...Object.fromEntries(filterQs), page: String(page - 1) }).toString()}`}
            >
              <Button variant="ghost" size="sm">← Anterior</Button>
            </Link>
          )}
          <span className="text-xs" style={{ color: 'var(--vf-text-mute)' }}>
            Página {page + 1} de {totalPages}
          </span>
          {hasNext && (
            <Link
              href={`/routes?${new URLSearchParams({ ...Object.fromEntries(filterQs), page: String(page + 1) }).toString()}`}
            >
              <Button variant="ghost" size="sm">Siguiente →</Button>
            </Link>
          )}
        </div>
      )}
    </>
  );
}

// Filtros — Server Component con form GET (no requiere JS para filtrar).
function RouteFilters({
  zones,
  currentStatus,
  currentZone,
  currentDate,
}: {
  zones: Zone[];
  currentStatus?: RouteStatus;
  currentZone?: string;
  currentDate?: string;
}) {
  return (
    <form
      method="GET"
      className="mb-4 flex flex-wrap items-end gap-3 rounded-[var(--vf-r-lg)] border p-3"
      style={{
        background: 'var(--vf-bg-elev)',
        borderColor: 'var(--vf-line)',
      }}
    >
      <FilterField label="Fecha">
        <input
          type="date"
          name="date"
          defaultValue={currentDate ?? ''}
          className="h-8 w-[150px] rounded-[var(--vf-r)] border px-2 text-[12.5px]"
          style={{ borderColor: 'var(--vf-line)', background: 'var(--vf-bg-sub)' }}
        />
      </FilterField>
      <FilterField label="Estado">
        <Select
          name="status"
          defaultValue={currentStatus ?? ''}
          className="h-8 w-[160px] text-[12.5px]"
        >
          <option value="">Todos</option>
          {(Object.keys(STATUS_LABELS) as RouteStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </FilterField>
      <FilterField label="Zona">
        <Select
          name="zone"
          defaultValue={currentZone ?? ''}
          className="h-8 w-[140px] text-[12.5px]"
        >
          <option value="">Todas</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.code}
            </option>
          ))}
        </Select>
      </FilterField>
      <Button type="submit" variant="secondary" size="sm">
        Filtrar
      </Button>
      {(currentStatus || currentZone || currentDate) && (
        <Link href="/routes">
          <Button type="button" variant="ghost" size="sm">
            Limpiar
          </Button>
        </Link>
      )}
    </form>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-[10px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--vf-text-mute)' }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

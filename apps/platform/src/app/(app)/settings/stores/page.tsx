// CRUD de tiendas. Tabla + modal de creación. Filtro por zona pendiente para Fase 1.b.
// WB-2 / ADR-114: agrega columnas de frecuencia (visitas/sem, kg/visita, última visita)
// y filtro ?stale=1 para detectar tiendas sin visita reciente.

import Link from 'next/link';
import { Badge, Button, DataTable, EmptyState, PageHeader, type Column } from '@tripdrive/ui';
import type { Store } from '@tripdrive/types';
import { requireRole } from '@/lib/auth';
import { listStores } from '@/lib/queries/stores';
import { listZones } from '@/lib/queries/zones';
import { getStoreFrequencyStats, formatRelativeDate, type StoreFrequency } from '@/lib/queries/store-frequencies';
import { CreateStoreButton } from './create-store-button';
import { ToggleStoreActiveCell } from './toggle-store-active-cell';
import { TemplateDownloadButton } from '@/components/template-download-button';

export const metadata = { title: 'Tiendas' };
export const dynamic = 'force-dynamic';

// Tiendas sin visita en este umbral aparecen marcadas como "stale" — alerta
// al admin para detectar abandono. 21 días = 3 semanas, balance razonable
// para frecuencia semanal del cliente típico VerdFrut/NETO.
const STALE_THRESHOLD_DAYS = 21;
const FREQUENCY_WINDOW_DAYS = 30;

interface PageProps {
  searchParams: Promise<{ stale?: string; zone?: string }>;
}

export default async function StoresPage({ searchParams }: PageProps) {
  await requireRole('admin', 'dispatcher');
  const params = await searchParams;
  const showStaleOnly = params.stale === '1';

  const [stores, zones] = await Promise.all([listStores(), listZones()]);
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  // WB-2: stats de frecuencia para TODAS las tiendas cargadas. Una sola
  // query batch (~50-200ms para 200 tiendas), filtra a operación real.
  const frequencyStats = await getStoreFrequencyStats(
    stores.map((s) => s.id),
    FREQUENCY_WINDOW_DAYS,
  );

  // Filtro stale: tiendas activas con última visita > N días O sin visitas.
  const staleThresholdMs = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  function isStale(s: Store): boolean {
    if (!s.isActive) return false; // inactivas no aplican
    const freq = frequencyStats.get(s.id);
    if (!freq || freq.visits === 0) return true;
    if (!freq.lastVisitAt) return true;
    return now - new Date(freq.lastVisitAt).getTime() > staleThresholdMs;
  }

  const staleCount = stores.filter(isStale).length;
  const visibleStores = showStaleOnly ? stores.filter(isStale) : stores;

  if (zones.length === 0) {
    return (
      <>
        <PageHeader title="Tiendas" description="Catálogo de tiendas destino." />
        <EmptyState
          title="Primero crea al menos una zona"
          description="Cada tienda debe pertenecer a una zona. Ve a Configuración → Zonas."
        />
      </>
    );
  }

  const columns: Column<Store>[] = [
    {
      key: 'code',
      header: 'Código',
      cell: (s) => (
        <Link
          href={`/settings/stores/${s.id}`}
          className="font-mono hover:underline"
          style={{ color: 'var(--vf-text)' }}
        >
          {s.code}
        </Link>
      ),
    },
    {
      key: 'name',
      header: 'Tienda',
      cell: (s) => (
        <Link href={`/settings/stores/${s.id}`} className="hover:underline">
          {s.name}
        </Link>
      ),
    },
    {
      key: 'zone',
      header: 'Zona',
      cell: (s) => zonesById.get(s.zoneId)?.code ?? '—',
    },
    {
      key: 'address',
      header: 'Dirección',
      cell: (s) => <span className="text-[var(--color-text-muted)]">{s.address}</span>,
    },
    {
      key: 'frequency',
      header: 'Frec',
      cell: (s) => <FrequencyCell freq={frequencyStats.get(s.id)} />,
    },
    {
      key: 'kgPerVisit',
      header: 'Kg / visita',
      align: 'right',
      cell: (s) => {
        const freq = frequencyStats.get(s.id);
        if (!freq || freq.kgPerVisit === null) {
          return <span style={{ color: 'var(--vf-text-faint)' }}>—</span>;
        }
        return <span className="font-mono tabular-nums">{freq.kgPerVisit}</span>;
      },
    },
    {
      key: 'lastVisit',
      header: 'Última visita',
      cell: (s) => {
        const freq = frequencyStats.get(s.id);
        const isStaleNow = s.isActive && (!freq || !freq.lastVisitAt || (now - new Date(freq.lastVisitAt).getTime() > staleThresholdMs));
        const label = formatRelativeDate(freq?.lastVisitAt ?? null);
        return (
          <span
            className="text-xs"
            title={freq?.lastVisitAt ? `Último ISO: ${freq.lastVisitAt}` : undefined}
            style={{ color: isStaleNow ? 'var(--vf-warn, #d97706)' : 'var(--vf-text-mute)' }}
          >
            {isStaleNow && '⚠️ '}{label}
          </span>
        );
      },
    },
    {
      key: 'window',
      header: 'Ventana',
      cell: (s) =>
        s.receivingWindowStart && s.receivingWindowEnd
          ? `${s.receivingWindowStart}–${s.receivingWindowEnd}`
          : '—',
    },
    {
      key: 'coords',
      header: 'Coords',
      cell: (s) =>
        s.coordVerified ? (
          <Badge tone="success">Verificadas</Badge>
        ) : (
          <Badge tone="warning">Sin verificar</Badge>
        ),
    },
    {
      key: 'status',
      header: 'Estado',
      cell: (s) => (
        <Badge tone={s.isActive ? 'success' : 'neutral'}>
          {s.isActive ? 'Activa' : 'Inactiva'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (s) => (
        <div className="flex items-center justify-end gap-3">
          <Link
            href={`/settings/stores/${s.id}`}
            className="text-xs hover:underline"
            style={{ color: 'var(--vf-text-mute)' }}
          >
            Editar
          </Link>
          <ToggleStoreActiveCell store={s} />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Tiendas"
        description={`${stores.length} tienda(s) registradas en ${zones.length} zona(s). Frecuencias calculadas sobre los últimos ${FREQUENCY_WINDOW_DAYS} días de operación real.`}
        action={
          <div className="flex gap-2">
            <Link href="/settings/stores/map">
              <Button variant="secondary" size="sm">
                🗺️ Mapa
              </Button>
            </Link>
            <TemplateDownloadButton entity="stores" />
            <CreateStoreButton zones={zones} />
          </div>
        }
      />

      {/* WB-2 / ADR-114: alerta de tiendas sin visita reciente. Permite filtrar
          la lista a solo las stale con ?stale=1. */}
      {staleCount > 0 && (
        <div
          className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
          style={{
            background: 'color-mix(in oklch, var(--vf-warn, #d97706) 12%, transparent)',
            borderColor: 'color-mix(in oklch, var(--vf-warn, #d97706) 35%, transparent)',
            color: 'var(--vf-warn, #d97706)',
          }}
          role="status"
        >
          <span>
            <strong>⚠️ {staleCount} tienda(s) activa(s) sin visita en {STALE_THRESHOLD_DAYS}+ días.</strong>{' '}
            Pueden ser candidatas a revisar con el comercial.
          </span>
          {showStaleOnly ? (
            <Link
              href="/settings/stores"
              className="underline-offset-2 hover:underline"
              style={{ color: 'inherit' }}
            >
              Ver todas →
            </Link>
          ) : (
            <Link
              href="/settings/stores?stale=1"
              className="underline-offset-2 hover:underline"
              style={{ color: 'inherit' }}
            >
              Ver solo stale →
            </Link>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={visibleStores}
        rowKey={(s) => s.id}
        emptyTitle={showStaleOnly ? 'Sin tiendas stale' : 'Sin tiendas registradas'}
        emptyDescription={
          showStaleOnly
            ? 'Todas las tiendas activas tuvieron visita reciente. Vuelve a la lista completa.'
            : 'Agrega tu primera tienda manualmente o importa el catálogo desde CSV.'
        }
        emptyAction={
          showStaleOnly ? (
            <Link href="/settings/stores">
              <Button variant="secondary">Ver todas las tiendas</Button>
            </Link>
          ) : (
            <CreateStoreButton zones={zones} />
          )
        }
      />
    </>
  );
}

/**
 * Celda compacta de frecuencia: "3.0 v/sem" o "—" si sin visitas.
 * Color sutil para diferenciar de las columnas de texto.
 */
function FrequencyCell({ freq }: { freq: StoreFrequency | undefined }) {
  if (!freq || freq.visits === 0) {
    return <span style={{ color: 'var(--vf-text-faint)' }}>—</span>;
  }
  return (
    <span
      className="font-mono text-xs tabular-nums"
      title={`${freq.visits} visita(s) en ventana de ${FREQUENCY_WINDOW_DAYS} días`}
      style={{ color: 'var(--vf-text)' }}
    >
      {freq.visitsPerWeek} <span style={{ color: 'var(--vf-text-mute)' }}>v/sem</span>
    </span>
  );
}

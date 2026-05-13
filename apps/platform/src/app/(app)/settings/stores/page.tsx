// CRUD de tiendas. Tabla + modal de creación. Filtro por zona pendiente para Fase 1.b.

import Link from 'next/link';
import { Badge, Button, DataTable, EmptyState, PageHeader, type Column } from '@tripdrive/ui';
import type { Store } from '@tripdrive/types';
import { requireRole } from '@/lib/auth';
import { listStores } from '@/lib/queries/stores';
import { listZones } from '@/lib/queries/zones';
import { CreateStoreButton } from './create-store-button';
import { ToggleStoreActiveCell } from './toggle-store-active-cell';
import { TemplateDownloadButton } from '@/components/template-download-button';

export const metadata = { title: 'Tiendas' };

export default async function StoresPage() {
  await requireRole('admin', 'dispatcher');

  const [stores, zones] = await Promise.all([listStores(), listZones()]);
  const zonesById = new Map(zones.map((z) => [z.id, z]));

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
        description={`${stores.length} tienda(s) registradas en ${zones.length} zona(s).`}
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
      <DataTable
        columns={columns}
        rows={stores}
        rowKey={(s) => s.id}
        emptyTitle="Sin tiendas registradas"
        emptyDescription="Agrega tu primera tienda manualmente o importa el catálogo desde CSV."
        emptyAction={<CreateStoreButton zones={zones} />}
      />
    </>
  );
}

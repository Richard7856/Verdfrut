// CRUD de tiendas. Tabla + modal de creación. Filtro por zona pendiente para Fase 1.b.

import { Badge, DataTable, EmptyState, PageHeader, type Column } from '@verdfrut/ui';
import type { Store } from '@verdfrut/types';
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
    { key: 'code', header: 'Código', cell: (s) => <span className="font-mono">{s.code}</span> },
    { key: 'name', header: 'Tienda', cell: (s) => s.name },
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
      cell: (s) => <ToggleStoreActiveCell store={s} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Tiendas"
        description={`${stores.length} tienda(s) registradas en ${zones.length} zona(s).`}
        action={
          <div className="flex gap-2">
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

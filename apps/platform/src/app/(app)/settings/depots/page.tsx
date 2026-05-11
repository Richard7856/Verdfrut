// CRUD de depots (CEDIS / Hubs).

import { PageHeader, DataTable, Badge, type Column } from '@tripdrive/ui';
import type { Depot } from '@tripdrive/types';
import { requireRole } from '@/lib/auth';
import { listDepots } from '@/lib/queries/depots';
import { listZones } from '@/lib/queries/zones';
import { CreateDepotButton } from './create-depot-button';
import { ToggleDepotActiveCell } from './toggle-depot-active-cell';
import { TemplateDownloadButton } from '@/components/template-download-button';

export const metadata = { title: 'CEDIS' };

export default async function DepotsPage() {
  await requireRole('admin');
  const [depots, zones] = await Promise.all([listDepots(), listZones()]);
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  const columns: Column<Depot>[] = [
    { key: 'code', header: 'Código', cell: (d) => <span className="font-mono">{d.code}</span> },
    { key: 'name', header: 'Nombre', cell: (d) => d.name },
    {
      key: 'zone',
      header: 'Zona',
      cell: (d) => zonesById.get(d.zoneId)?.code ?? '—',
    },
    {
      key: 'address',
      header: 'Dirección',
      cell: (d) => <span className="text-[var(--color-text-muted)]">{d.address}</span>,
    },
    {
      key: 'coords',
      header: 'Coordenadas',
      cell: (d) => (
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          {d.lat.toFixed(4)}, {d.lng.toFixed(4)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      cell: (d) => (
        <Badge tone={d.isActive ? 'success' : 'neutral'}>{d.isActive ? 'Activo' : 'Inactivo'}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (d) => <ToggleDepotActiveCell depot={d} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="CEDIS / Hubs"
        description={`${depots.length} CEDIS. Punto de partida y regreso de los vehículos en cada ruta.`}
        action={
          <div className="flex gap-2">
            <TemplateDownloadButton entity="depots" />
            <CreateDepotButton zones={zones} />
          </div>
        }
      />
      <DataTable
        columns={columns}
        rows={depots}
        rowKey={(d) => d.id}
        emptyTitle="Sin CEDIS"
        emptyDescription="Crea el primer CEDIS para asignar vehículos a un punto de partida."
        emptyAction={<CreateDepotButton zones={zones} />}
      />
    </>
  );
}

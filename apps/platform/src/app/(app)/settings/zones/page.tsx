// CRUD de zonas. Solo accesible para admin.

import { PageHeader, DataTable, Badge, type Column } from '@tripdrive/ui';
import type { Zone } from '@tripdrive/types';
import { requireRole } from '@/lib/auth';
import { listZones } from '@/lib/queries/zones';
import { CreateZoneButton } from './create-zone-button';
import { ToggleActiveCell } from './toggle-active-cell';

export const metadata = { title: 'Zonas' };

export default async function ZonesPage() {
  await requireRole('admin');
  const zones = await listZones();

  const columns: Column<Zone>[] = [
    { key: 'code', header: 'Código', cell: (z) => <span className="font-mono">{z.code}</span> },
    { key: 'name', header: 'Nombre', cell: (z) => z.name },
    {
      key: 'status',
      header: 'Estado',
      cell: (z) => (
        <Badge tone={z.isActive ? 'success' : 'neutral'}>
          {z.isActive ? 'Activa' : 'Inactiva'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (z) => <ToggleActiveCell zone={z} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Zonas"
        description="Regiones operativas. Cada usuario, tienda y camión pertenece a una zona."
        action={<CreateZoneButton />}
      />
      <DataTable
        columns={columns}
        rows={zones}
        rowKey={(z) => z.id}
        emptyTitle="Aún no hay zonas"
        emptyDescription="Crea la primera zona para empezar a operar."
        emptyAction={<CreateZoneButton />}
      />
    </>
  );
}

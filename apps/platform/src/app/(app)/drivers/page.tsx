// Lista de choferes registrados (vista simplificada de drivers + user_profiles).
// La gestión completa (alta/baja/edición) vive en /settings/users con role='driver'.

import { Badge, DataTable, EmptyState, PageHeader, type Column } from '@verdfrut/ui';
import type { Driver } from '@verdfrut/types';
import { requireRole } from '@/lib/auth';
import { listDrivers } from '@/lib/queries/drivers';
import { listZones } from '@/lib/queries/zones';

export const metadata = { title: 'Choferes' };

export default async function DriversPage() {
  // V2: solo admin/dispatcher.
  await requireRole('admin', 'dispatcher');

  const [drivers, zones] = await Promise.all([listDrivers(), listZones()]);
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  if (drivers.length === 0) {
    return (
      <>
        <PageHeader
          title="Choferes"
          description="Conductores registrados en la flota."
        />
        <EmptyState
          title="Sin choferes registrados"
          description="Para agregar un chofer, ve a Configuración → Usuarios e invita con rol 'Chofer'."
        />
      </>
    );
  }

  const columns: Column<Driver>[] = [
    { key: 'name', header: 'Nombre', cell: (d) => d.fullName },
    { key: 'phone', header: 'Teléfono', cell: (d) => d.phone || '—' },
    {
      key: 'zone',
      header: 'Zona',
      cell: (d) => zonesById.get(d.zoneId)?.code ?? '—',
    },
    {
      key: 'license',
      header: 'Licencia',
      cell: (d) => d.licenseNumber || <span className="text-[var(--vf-text-faint)]">—</span>,
    },
    {
      key: 'status',
      header: 'Estado',
      cell: (d) => (
        <Badge tone={d.isActive ? 'success' : 'neutral'}>
          {d.isActive ? 'Activo' : 'Inactivo'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Choferes"
        description={`${drivers.length} chofer(es) registrado(s).`}
      />
      <DataTable columns={columns} rows={drivers} rowKey={(d) => d.id} />
    </>
  );
}

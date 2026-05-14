// Editor de vehículo individual. Form full-page (no modal) con todos los
// fields + botón "Sugerir con IA". Pedido del cliente: poder editar
// vehículos existentes con más detalle.

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge, Button, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { getVehicle } from '@/lib/queries/vehicles';
import { listZones } from '@/lib/queries/zones';
import { listDepots } from '@/lib/queries/depots';
import { updateVehicleAction } from '../actions';
import { VehicleEditClient } from './vehicle-edit-client';

export const metadata = { title: 'Editar camión' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditVehiclePage({ params }: PageProps) {
  await requireRole('admin', 'dispatcher');
  const { id } = await params;

  const [vehicle, zones, depots] = await Promise.all([
    getVehicle(id),
    listZones(),
    listDepots(),
  ]);

  if (!vehicle) notFound();

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span>{vehicle.plate}</span>
            {vehicle.alias && (
              <span
                className="text-sm font-normal"
                style={{ color: 'var(--vf-text-mute)' }}
              >
                · {vehicle.alias}
              </span>
            )}
            {!vehicle.isActive && <Badge tone="neutral">Inactivo</Badge>}
          </span>
        }
        description={
          vehicle.make && vehicle.model
            ? `${vehicle.make} ${vehicle.model}${vehicle.year ? ` ${vehicle.year}` : ''}`
            : 'Detalles del vehículo'
        }
        action={
          <Link href="/settings/vehicles">
            <Button variant="ghost" size="sm">
              ← Lista
            </Button>
          </Link>
        }
      />
      <VehicleEditClient vehicle={vehicle} zones={zones} depots={depots} />
    </>
  );
}

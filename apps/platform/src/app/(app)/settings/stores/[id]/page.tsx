// Detalle/edición de una tienda. Server component que carga la tienda + zona
// y renderiza el editor cliente con el token Mapbox del server (no expuesto
// al bundle JS público — viaja como prop).

import { notFound } from 'next/navigation';
import { Badge, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { getStore } from '@/lib/queries/stores';
import { listZones } from '@/lib/queries/zones';
import { StoreEditor } from './store-editor';

export const metadata = { title: 'Editar tienda' };

export default async function StoreEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('admin', 'dispatcher');
  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();

  const zones = await listZones();
  const zone = zones.find((z) => z.id === store.zoneId) ?? null;

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono text-sm" style={{ color: 'var(--vf-text-mute)' }}>
              {store.code}
            </span>
            <span>·</span>
            <span>{store.name}</span>
            <Badge tone={store.coordVerified ? 'success' : 'warning'}>
              {store.coordVerified ? 'Coords verificadas' : 'Coords sin verificar'}
            </Badge>
            <Badge tone={store.isActive ? 'info' : 'neutral'}>
              {store.isActive ? 'Activa' : 'Inactiva'}
            </Badge>
          </span>
        }
        description="Edita dirección y arrastra el pin para corregir la ubicación. Al guardar, las coords se marcarán como verificadas automáticamente si moviste el pin."
      />
      <StoreEditor store={store} zone={zone} mapboxToken={mapboxToken} />
    </>
  );
}

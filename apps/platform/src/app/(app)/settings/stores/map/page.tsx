// Mapa interactivo de tiendas. Pedido del cliente:
// - Ver todas las tiendas en un mapa.
// - Drag para corregir lat/lng (persiste + marca verified).
// - Filtros por código, nombre, zona, sin verificar.
// - Buscador Google Places (Neta Interlomas → click → crear).

import Link from 'next/link';
import { Button, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { listStores } from '@/lib/queries/stores';
import { listZones } from '@/lib/queries/zones';
import { StoresMap, type StoreMarker, type ZoneOption } from './stores-map';

export const metadata = { title: 'Mapa de tiendas' };
export const dynamic = 'force-dynamic';

export default async function StoresMapPage() {
  await requireRole('admin', 'dispatcher');

  const [stores, zones] = await Promise.all([listStores(), listZones()]);
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  const markers: StoreMarker[] = stores.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    address: s.address,
    zoneId: s.zoneId,
    zoneCode: zonesById.get(s.zoneId)?.code ?? '—',
    lat: s.lat,
    lng: s.lng,
    coordVerified: s.coordVerified,
    isActive: s.isActive,
  }));

  const zoneOptions: ZoneOption[] = zones.map((z) => ({
    id: z.id,
    code: z.code,
    name: z.name,
  }));

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  return (
    <>
      <PageHeader
        title="Mapa de tiendas"
        description={`${markers.filter((s) => s.isActive).length} tienda(s) activa(s). Arrastra para corregir ubicación. Busca en Google para agregar nuevas.`}
        action={
          <Link href="/settings/stores">
            <Button variant="ghost" size="sm">
              ← Lista
            </Button>
          </Link>
        }
      />
      <StoresMap stores={markers} zones={zoneOptions} mapboxToken={mapboxToken} />
    </>
  );
}

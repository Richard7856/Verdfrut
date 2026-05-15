// Página /stores/import — Stream UI-1 (2026-05-15 noche, pre-demo VerdFrut).
// Sube un XLSX con tiendas, geocodifica en lote, muestra preview en mapa,
// permite corregir filas dudosas/fallidas, y finalmente importa a BD.

import { requireRole } from '@/lib/auth';
import { ImportClient } from './import-client';

export const metadata = { title: 'Importar tiendas desde Excel' };
export const dynamic = 'force-dynamic';

export default async function StoresImportPage() {
  await requireRole('admin', 'dispatcher');

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  return <ImportClient mapboxToken={mapboxToken} />;
}

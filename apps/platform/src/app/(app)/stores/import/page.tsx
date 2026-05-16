// Página /stores/import — Stream UI-1 (2026-05-15 noche, pre-demo VerdFrut).
// Sube un XLSX con tiendas, geocodifica en lote, muestra preview en mapa,
// permite corregir filas dudosas/fallidas, y finalmente importa a BD.

import { requireRole } from '@/lib/auth';
import { getCallerFeatures } from '@/lib/plans-gate';
import { FeatureLockedCard } from '@/components/feature-lock';
import { ImportClient } from './import-client';

export const metadata = { title: 'Importar tiendas desde Excel' };
export const dynamic = 'force-dynamic';

export default async function StoresImportPage() {
  await requireRole('admin', 'dispatcher');

  // ADR-121 Fase 1: gate por plan a nivel pantalla — Starter no ve el
  // import client, ve un upgrade card. Los server actions también gatean
  // (defense-in-depth) para que un POST directo desde curl falle también.
  const { features, tier } = await getCallerFeatures();
  if (!features.xlsxImport) {
    return <FeatureLockedCard feature="xlsxImport" currentTier={tier} />;
  }

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  return <ImportClient mapboxToken={mapboxToken} />;
}

// Detalle de parada: arranque del flujo entrega o continuación si ya hay reporte en curso.

import { notFound, redirect } from 'next/navigation';
import { requireDriverProfile } from '@/lib/auth';
import { getStopContext } from '@/lib/queries/stop';
import { StopDetailClient } from '@/components/flow/stop-detail-client';

export const metadata = { title: 'Parada' };
export const dynamic = 'force-dynamic';

const DEFAULT_TZ = 'America/Mexico_City';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function StopDetailPage({ params }: Props) {
  const profile = await requireDriverProfile();
  const { id } = await params;

  const ctx = await getStopContext(id);
  if (!ctx) notFound();

  // Si la ruta no es PUBLISHED ni IN_PROGRESS, el chofer no debería estar aquí.
  // Lo regresamos a la lista (puede haberse cancelado).
  if (!['PUBLISHED', 'IN_PROGRESS', 'COMPLETED'].includes(ctx.route.status)) {
    redirect('/route');
  }

  const timezone = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? DEFAULT_TZ;

  return (
    <StopDetailClient
      stop={ctx.stop}
      store={ctx.store}
      route={ctx.route}
      report={ctx.report}
      timezone={timezone}
      userId={profile.id}
    />
  );
}

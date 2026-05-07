// Chat del chofer con su zone_manager para el report de esta parada.
// Se accede como /route/stop/[id]/chat. Si el report aún no existe (chofer
// no ha tocado "Avisar al comercial"), redirige al stop detail.

import { notFound, redirect } from 'next/navigation';
import { requireDriverProfile } from '@/lib/auth';
import { getStopContext } from '@/lib/queries/stop';
import { listChatMessages } from '@/lib/queries/chat';
import { ChatPageClient } from './chat-page-client';

export const metadata = { title: 'Chat con encargado' };
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function StopChatPage({ params }: Props) {
  const { id: stopId } = await params;
  const profile = await requireDriverProfile();
  const ctx = await getStopContext(stopId);
  if (!ctx) notFound();

  // Si todavía no hay report, no hay chat — vuelve al detail para abrir uno.
  if (!ctx.report) {
    redirect(`/route/stop/${stopId}`);
  }

  const initialMessages = await listChatMessages(ctx.report.id);

  return (
    <ChatPageClient
      report={ctx.report}
      stopId={stopId}
      routeId={ctx.route.id}
      storeName={ctx.store.name}
      userId={profile.id}
      initialMessages={initialMessages}
    />
  );
}

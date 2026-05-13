// Página del orquestador AI — Ola 2 / Sub-bloque 2.1.d.
// Solo admin/dispatcher. UI minimal: input + lista de mensajes + tool calls
// visualizados como cards expandibles. Lista de sesiones laterales en 2.6.

import { requireAdminOrDispatcher } from '@/lib/auth';
import { PageHeader } from '@tripdrive/ui';
import { OrchestratorChat } from './chat-client';

export const metadata = { title: 'Orquestador AI' };
export const dynamic = 'force-dynamic';

export default async function OrchestratorPage() {
  await requireAdminOrDispatcher();

  return (
    <>
      <PageHeader
        title="Orquestador AI"
        description="Conversa con Claude para crear, mover y publicar tiros. Las acciones destructivas (publicar, cancelar) piden confirmación explícita."
      />
      <OrchestratorChat />
    </>
  );
}

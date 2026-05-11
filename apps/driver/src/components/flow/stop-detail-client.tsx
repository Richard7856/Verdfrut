'use client';

// Componente cliente que orquesta los 3 flujos de reporte (entrega, tienda_cerrada, bascula).
// Estado:
//   - report: server source of truth (lo recargamos via router.refresh tras cada step)
//   - localCtx: contexto del flujo (hasIncidents, hasMerma, etc.) para que la máquina
//     decida el siguiente step. Algunos contextos también se persisten en la DB
//     (has_merma) pero el ctx local es la fuente para nextEntregaStep().
//
// Si el report.type es entrega → flujo largo de 14 steps (arrival_exhibit … finish).
// Si es tienda_cerrada → facade → chat_redirect → tienda_abierta_check.
// Si es bascula → scale → chat_redirect → tienda_abierta_check.
// Después de tienda_abierta_check con "sí", el server convierte el report a entrega
// y reusa la foto (facade/scale) como arrival_exhibit. La UI re-renderiza con el
// nuevo type y entra al flujo entrega normal.
//
// Si no hay report (pre-arrival), <ArrivalTypeSelector> pide al chofer escoger tipo
// + valida cercanía GPS antes de crear el report.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@tripdrive/ui';
import type {
  DeliveryReport,
  EntregaStep,
  TiendaCerradaStep,
  BasculaStep,
  Route,
  Stop,
  Store,
  ResolutionType,
} from '@tripdrive/types';
import {
  nextEntregaStep,
  nextTiendaCerradaStep,
  nextBasculaStep,
  type FlowContext,
} from '@tripdrive/flow-engine';
// patchReport sigue importándose para tipado del payload — nunca se llama directo.
import type { patchReport } from '@/app/route/stop/[id]/actions';
// Mutaciones del flow ahora pasan por el outbox (ADR-019). El cliente no espera
// confirmación del server: encola, actualiza UI optimista, sigue.
import { enqueue } from '@/lib/outbox';
import { useOutboxSnapshot } from '@/lib/outbox/use-outbox-snapshot';
import { StopHeader } from './stop-header';
import { ArrivalTypeSelector } from './arrival-type-selector';
import { OutboxBadge } from '../outbox-badge';
// Steps entrega
import { ArrivalExhibitStep } from './steps/arrival-exhibit';
import { IncidentCheckStep } from './steps/incident-check';
import { IncidentCartStep } from './steps/incident-cart';
import { ProductArrangedStep } from './steps/product-arranged';
import { WasteCheckStep } from './steps/waste-check';
import { WasteTicketStep } from './steps/waste-ticket';
import { TicketReviewStep } from './steps/ticket-review';
import { ReceiptCheckStep } from './steps/receipt-check';
import { ReceiptUploadStep } from './steps/receipt-upload';
import { NoReceiptReasonStep } from './steps/no-receipt-reason';
import { OtherIncidentCheckStep } from './steps/other-incident-check';
import { OtherIncidentStep } from './steps/other-incident';
import { FinishStep } from './steps/finish';
// Steps cerrada / bascula
import { FacadeStep } from './steps/facade';
import { ScaleStep } from './steps/scale';
import { ChatRedirectStep } from './steps/chat-redirect';
import { TiendaAbiertaCheckStep } from './steps/tienda-abierta-check';

interface Props {
  stop: Stop;
  store: Store;
  route: Route;
  report: DeliveryReport | null;
  timezone: string;
  userId: string;
}

export function StopDetailClient({ stop, store, route, report, userId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Contexto del flujo: hasIncidents, hasMerma, etc.
  const [ctx, setCtx] = useState<FlowContext>({});

  // UI optimista: el chofer avanza visualmente sin esperar al server (ADR-019).
  // Si la red está caída, el outbox sube cuando vuelva. Mientras tanto, el chofer
  // no se queda atorado.
  //
  //   optimisticStep:  step que el cliente eligió y aún no fue confirmado por el server.
  //   optimisticType:  type cambiado por convert_to_entrega antes de que server confirme.
  //
  // Cuando el outbox queda en 0 pendientes y estamos online, hacemos router.refresh()
  // para volver al server source of truth.
  const [optimisticStep, setOptimisticStep] = useState<string | null>(null);
  const [optimisticType, setOptimisticType] = useState<DeliveryReport['type'] | null>(null);
  const outbox = useOutboxSnapshot();

  // Sincronizar con server cuando se vacía la cola: ya hay confianza de que
  // los advance/patch llegaron. Limpiar optimistic state también.
  useEffect(() => {
    if (outbox.pendingTotal === 0 && (optimisticStep || optimisticType)) {
      setOptimisticStep(null);
      setOptimisticType(null);
      router.refresh();
    }
  }, [outbox.pendingTotal, optimisticStep, optimisticType, router]);

  // Pre-arrival — selector de tipo de visita con validación GPS.
  if (!report) {
    return (
      <main className="min-h-dvh bg-[var(--vf-bg)] safe-top safe-bottom">
        <StopHeader stop={stop} store={store} />
        <ArrivalTypeSelector stopId={stop.id} storeName={store.name} />
      </main>
    );
  }

  // Reporte ya enviado: vista de solo lectura.
  if (report.status !== 'draft') {
    return (
      <main className="min-h-dvh bg-[var(--vf-bg)] safe-top safe-bottom">
        <StopHeader stop={stop} store={store} />
        <section className="px-4 py-6">
          <Card className="border-[var(--color-border)]">
            <h2 className="text-base font-medium">Reporte enviado</h2>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              Resolución: <strong>{report.resolutionType ?? '—'}</strong>. Fue enviado al
              encargado de zona.
            </p>
          </Card>
        </section>
      </main>
    );
  }

  const effectiveStep = optimisticStep ?? report.currentStep;
  const effectiveType = optimisticType ?? report.type;

  // Avance: encola en outbox y mueve la UI inmediatamente.
  // Si está offline, el badge mostrará el pending; si online, el worker procesa
  // en milisegundos.
  function advance(next: string) {
    setError(null);
    setOptimisticStep(next);
    void enqueue({
      type: 'advance_step',
      payload: { reportId: report!.id, nextStep: next },
    });
  }

  function nextOf(localCtx: FlowContext): string | null {
    const merged = { ...ctx, ...localCtx };
    setCtx(merged);
    const current = effectiveStep;
    switch (effectiveType) {
      case 'entrega':
        return nextEntregaStep(current as EntregaStep, merged);
      case 'tienda_cerrada':
        return nextTiendaCerradaStep(current as TiendaCerradaStep, merged);
      case 'bascula':
        return nextBasculaStep(current as BasculaStep, merged);
    }
  }

  const stepProps = {
    report: { ...report, currentStep: effectiveStep, type: effectiveType },
    route,
    store,
    userId,
    pending,
    error,
    setError,
    onPatch: async (patch: Parameters<typeof patchReport>[1]) => {
      await enqueue({
        type: 'patch_report',
        payload: { reportId: report.id, patch },
      });
    },
    onSubmit: (resolution: ResolutionType) => {
      // Encolar el submit y navegar — si falla, el badge avisa al chofer.
      startTransition(async () => {
        await enqueue({
          type: 'submit_report',
          payload: { reportId: report.id, resolution },
        });
        router.replace('/route');
      });
    },
    onSubmitNonEntrega: (resolution: ResolutionType) => {
      startTransition(async () => {
        await enqueue({
          type: 'submit_non_entrega',
          payload: { reportId: report.id, resolution },
        });
        router.replace('/route');
      });
    },
    onConvertToEntrega: () => {
      // El server (cuando procese): cambia type=entrega + current_step=arrival_exhibit
      // y reusa la foto previa. Optimistamente, mismo cambio en cliente.
      setOptimisticType('entrega');
      setOptimisticStep('arrival_exhibit');
      void enqueue({
        type: 'convert_to_entrega',
        payload: { reportId: report.id },
      });
    },
    advanceTo: (next: string | null) => {
      if (next == null) return;
      advance(next);
    },
    nextOf,
  };

  return (
    <main className="min-h-dvh bg-[var(--vf-bg)] safe-top safe-bottom">
      <StopHeader stop={stop} store={store} />
      {/* Banda discreta cuando hay pendientes — ADR-019. */}
      <div className="flex justify-end px-4 pt-2">
        <OutboxBadge />
      </div>
      {renderStep(effectiveType, effectiveStep, stepProps)}
    </main>
  );
}

type StepProps = {
  report: DeliveryReport;
  route: Route;
  store: Store;
  userId: string;
  pending: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  onPatch: (patch: Parameters<typeof patchReport>[1]) => Promise<void>;
  onSubmit: (resolution: ResolutionType) => void;
  onSubmitNonEntrega: (resolution: ResolutionType) => void;
  onConvertToEntrega: () => void;
  advanceTo: (next: string | null) => void;
  nextOf: (ctx: FlowContext) => string | null;
};

function renderStep(
  type: DeliveryReport['type'],
  step: string,
  props: StepProps,
): React.ReactNode {
  // Steps compartidos entre cerrada y bascula.
  if (step === 'chat_redirect') return <ChatRedirectStep {...props} />;
  if (step === 'tienda_abierta_check') return <TiendaAbiertaCheckStep {...props} />;

  // Tipo-específicos.
  if (type === 'tienda_cerrada' && step === 'facade') return <FacadeStep {...props} />;
  if (type === 'bascula' && step === 'scale') return <ScaleStep {...props} />;

  // Flujo entrega completo.
  switch (step as EntregaStep) {
    case 'arrival_exhibit':
      return <ArrivalExhibitStep {...props} />;
    case 'incident_check':
      return <IncidentCheckStep {...props} />;
    case 'incident_cart':
      return <IncidentCartStep {...props} />;
    case 'product_arranged':
      return <ProductArrangedStep {...props} />;
    case 'waste_check':
      return <WasteCheckStep {...props} />;
    case 'waste_ticket':
      return <WasteTicketStep {...props} />;
    case 'waste_ticket_review':
      return <TicketReviewStep {...props} kind="waste" />;
    case 'receipt_check':
      return <ReceiptCheckStep {...props} />;
    case 'receipt_upload':
      return <ReceiptUploadStep {...props} />;
    case 'receipt_review':
      return <TicketReviewStep {...props} kind="receipt" />;
    case 'no_receipt_reason':
      return <NoReceiptReasonStep {...props} />;
    case 'other_incident_check':
      return <OtherIncidentCheckStep {...props} />;
    case 'other_incident':
      return <OtherIncidentStep {...props} />;
    case 'finish':
      return <FinishStep {...props} />;
  }
  // Fallback — step desconocido para este tipo.
  return (
    <Card className="m-4 border-[var(--color-border)]">
      <p className="text-sm text-[var(--color-danger-fg)]">
        Step inválido: {step} (type={type}). Reporta al admin.
      </p>
    </Card>
  );
}

export type { StepProps };

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

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@verdfrut/ui';
import type {
  DeliveryReport,
  EntregaStep,
  TiendaCerradaStep,
  BasculaStep,
  Route,
  Stop,
  Store,
} from '@verdfrut/types';
import {
  nextEntregaStep,
  nextTiendaCerradaStep,
  nextBasculaStep,
  type FlowContext,
} from '@verdfrut/flow-engine';
import {
  advanceStep,
  setReportEvidence,
  patchReport,
  submitReport,
} from '@/app/route/stop/[id]/actions';
import { StopHeader } from './stop-header';
import { ArrivalTypeSelector } from './arrival-type-selector';
// Steps entrega
import { ArrivalExhibitStep } from './steps/arrival-exhibit';
import { IncidentCheckStep } from './steps/incident-check';
import { IncidentCartStep } from './steps/incident-cart';
import { ProductArrangedStep } from './steps/product-arranged';
import { WasteCheckStep } from './steps/waste-check';
import { WasteTicketStep } from './steps/waste-ticket';
import { ReviewPlaceholderStep } from './steps/review-placeholder';
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

  // Helper genérico de avance.
  function advance(next: string) {
    setError(null);
    startTransition(async () => {
      const res = await advanceStep(report!.id, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function nextOf(localCtx: FlowContext): string | null {
    const merged = { ...ctx, ...localCtx };
    setCtx(merged);
    const current = report!.currentStep;
    switch (report!.type) {
      case 'entrega':
        return nextEntregaStep(current as EntregaStep, merged);
      case 'tienda_cerrada':
        return nextTiendaCerradaStep(current as TiendaCerradaStep, merged);
      case 'bascula':
        return nextBasculaStep(current as BasculaStep, merged);
    }
  }

  const stepProps = {
    report,
    route,
    store,
    userId,
    pending,
    error,
    setError,
    onSaveEvidence: async (key: string, url: string) => {
      const res = await setReportEvidence(report.id, key, url);
      if (!res.ok) setError(res.error);
    },
    onPatch: async (patch: Parameters<typeof patchReport>[1]) => {
      const res = await patchReport(report.id, patch);
      if (!res.ok) setError(res.error);
    },
    onSubmit: async (resolution: Parameters<typeof submitReport>[1]) => {
      startTransition(async () => {
        const res = await submitReport(report.id, resolution);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.replace('/route');
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
      {renderStep(report.type, report.currentStep, stepProps)}
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
  onSaveEvidence: (key: string, url: string) => Promise<void>;
  onPatch: (patch: Parameters<typeof patchReport>[1]) => Promise<void>;
  onSubmit: (resolution: Parameters<typeof submitReport>[1]) => void;
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
      return <ReviewPlaceholderStep {...props} kind="waste" />;
    case 'receipt_check':
      return <ReceiptCheckStep {...props} />;
    case 'receipt_upload':
      return <ReceiptUploadStep {...props} />;
    case 'receipt_review':
      return <ReviewPlaceholderStep {...props} kind="receipt" />;
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

'use client';

// Componente cliente que orquesta el flujo entrega para una parada.
// Estado:
//   - report: server source of truth (lo recargamos via router.refresh tras cada step)
//   - localCtx: contexto del flujo (hasIncidents, hasMerma, etc.) para que la máquina
//     decida el siguiente step. Algunos contextos también se persisten en la DB
//     (has_merma) pero el ctx local es la fuente para nextEntregaStep().
//
// Decisión: optimistic updates con rollback en error. Cada acción es un round-trip.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '@verdfrut/ui';
import type {
  DeliveryReport,
  EntregaStep,
  Route,
  Stop,
  Store,
} from '@verdfrut/types';
import { nextEntregaStep, type FlowContext } from '@verdfrut/flow-engine';
import {
  advanceStep,
  arriveAtStop,
  setReportEvidence,
  patchReport,
  submitReport,
} from '@/app/route/stop/[id]/actions';
import { StopHeader } from './stop-header';
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
  // Contexto del flujo: hasIncidents, hasMerma, etc. Se acumula en memoria y se usa
  // para calcular el next step. Los flags importantes también se persisten en DB.
  const [ctx, setCtx] = useState<FlowContext>({});

  // Si no hay report aún, mostrar pre-arrival ("Llegar a tienda").
  if (!report) {
    return (
      <main className="min-h-dvh bg-[var(--vf-bg)] safe-top safe-bottom">
        <StopHeader stop={stop} store={store} />
        <section className="flex flex-col gap-4 px-4 py-6">
          <Card className="border-[var(--color-border)]">
            <h2 className="text-base font-medium text-[var(--color-text)]">
              ¿Llegaste a la tienda?
            </h2>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              Toca el botón cuando estés en el lugar. Comenzaremos el reporte de entrega.
            </p>
          </Card>

          {error && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
              {error}
            </div>
          )}

          <Button
            type="button"
            variant="primary"
            size="lg"
            isLoading={pending}
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await arriveAtStop(stop.id, 'entrega');
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                router.refresh();
              });
            }}
            className="w-full"
          >
            Llegué a la tienda
          </Button>
        </section>
      </main>
    );
  }

  // Reporte ya en submitted o más allá: vista de solo lectura.
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

  // El report es draft → renderizar el step actual.
  const current = report.currentStep as EntregaStep;

  function advance(next: EntregaStep) {
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

  function nextOf(localCtx: FlowContext): EntregaStep | null {
    const merged = { ...ctx, ...localCtx };
    setCtx(merged);
    return nextEntregaStep(current, merged);
  }

  // Render del step actual. Cada uno recibe report, store, helpers y dispara `advance`.
  const stepProps = {
    report,
    route,
    store,
    userId,
    pending,
    error,
    setError,
    onSaveEvidence: async (key: string, url: string) => {
      const res = await setReportEvidence(report!.id, key, url);
      if (!res.ok) setError(res.error);
    },
    onPatch: async (patch: Parameters<typeof patchReport>[1]) => {
      const res = await patchReport(report!.id, patch);
      if (!res.ok) setError(res.error);
    },
    onSubmit: async (resolution: Parameters<typeof submitReport>[1]) => {
      startTransition(async () => {
        const res = await submitReport(report!.id, resolution);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.replace('/route');
      });
    },
    advanceTo: (next: EntregaStep | null) => {
      if (next == null) return;
      advance(next);
    },
    nextOf,
  };

  return (
    <main className="min-h-dvh bg-[var(--vf-bg)] safe-top safe-bottom">
      <StopHeader stop={stop} store={store} />
      {renderStep(current, stepProps)}
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
  advanceTo: (next: EntregaStep | null) => void;
  nextOf: (ctx: FlowContext) => EntregaStep | null;
};

function renderStep(step: EntregaStep, props: StepProps) {
  switch (step) {
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
}

export type { StepProps };

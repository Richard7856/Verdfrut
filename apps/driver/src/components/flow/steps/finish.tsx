'use client';

// Step final — chofer elige el resultado y submitea el reporte.

import { useState } from 'react';
import { Button } from '@verdfrut/ui';
import type { ResolutionType } from '@verdfrut/types';
import type { StepProps } from '../stop-detail-client';

const OPTIONS: { value: ResolutionType; label: string; description: string }[] = [
  {
    value: 'completa',
    label: 'Entrega completa',
    description: 'Todo el producto fue recibido por la tienda sin problemas.',
  },
  {
    value: 'parcial',
    label: 'Entrega parcial',
    description: 'Parte del producto fue rechazado o quedó pendiente.',
  },
  {
    value: 'sin_entrega',
    label: 'Sin entrega',
    description: 'No se entregó nada (tienda cerrada, rechazo total, etc).',
  },
];

export function FinishStep(props: StepProps) {
  const { pending, error, onSubmit, report } = props;
  const [selected, setSelected] = useState<ResolutionType>(report.resolutionType ?? 'completa');

  return (
    <section className="flex flex-col gap-4 px-4 py-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Resultado de la parada</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Elige cómo terminó la entrega antes de cerrar el reporte.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {OPTIONS.map((opt) => {
          const isActive = selected === opt.value;
          return (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => setSelected(opt.value)}
                className={[
                  'block w-full rounded-[var(--radius-lg)] border p-3 text-left transition-colors',
                  isActive
                    ? 'border-[var(--vf-green-500)] bg-[var(--vf-green-50)]'
                    : 'border-[var(--color-border)] bg-[var(--vf-surface-1)] hover:bg-[var(--vf-surface-2)]',
                ].join(' ')}
              >
                <p className="text-sm font-medium text-[var(--color-text)]">{opt.label}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{opt.description}</p>
              </button>
            </li>
          );
        })}
      </ul>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
          {error}
        </div>
      )}

      <div className="pt-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          isLoading={pending}
          disabled={pending}
          onClick={() => onSubmit(selected)}
          className="w-full"
        >
          Cerrar reporte
        </Button>
      </div>
    </section>
  );
}

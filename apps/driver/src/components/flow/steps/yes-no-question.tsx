'use client';

// Componente reutilizable para steps que son una pregunta sí/no.
// Cada step concreto le pasa título, descripción, y qué hacer en cada respuesta.

import { Button } from '@verdfrut/ui';

interface Props {
  title: string;
  description?: string;
  yesLabel?: string;
  noLabel?: string;
  onYes: () => void;
  onNo: () => void;
  pending?: boolean;
  error?: string | null;
}

export function YesNoQuestion({
  title,
  description,
  yesLabel = 'Sí',
  noLabel = 'No',
  onYes,
  onNo,
  pending,
  error,
}: Props) {
  return (
    <section className="flex flex-col gap-4 px-4 py-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text)]">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
        )}
      </div>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={onYes}
          isLoading={pending}
          disabled={pending}
          className="w-full"
        >
          {yesLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={onNo}
          disabled={pending}
          className="w-full"
        >
          {noLabel}
        </Button>
      </div>
    </section>
  );
}

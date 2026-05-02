// Shell común para cada step del flujo: título, descripción, contenido, botón "Continuar".
// Los steps individuales lo usan para que el aspecto sea consistente.

import type { ReactNode } from 'react';
import { Button } from '@verdfrut/ui';

interface Props {
  title: string;
  description?: string;
  children: ReactNode;
  /** Action al hacer click en el botón principal. Si null, el botón no se muestra. */
  onContinue: (() => void) | null;
  continueLabel?: string;
  continueDisabled?: boolean;
  pending?: boolean;
  error?: string | null;
}

export function StepShell({
  title,
  description,
  children,
  onContinue,
  continueLabel = 'Continuar',
  continueDisabled,
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

      <div className="flex flex-col gap-3">{children}</div>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
          {error}
        </div>
      )}

      {onContinue && (
        <div className="pt-2">
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={onContinue}
            disabled={continueDisabled || pending}
            isLoading={pending}
            className="w-full"
          >
            {continueLabel}
          </Button>
        </div>
      )}
    </section>
  );
}

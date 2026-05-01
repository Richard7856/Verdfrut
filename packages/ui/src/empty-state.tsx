// EmptyState — placeholder consistente cuando una lista/tabla está vacía.

import type { ReactNode } from 'react';
import { cn } from './cn';

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] p-12 text-center',
        className,
      )}
    >
      {icon && <div className="text-[var(--color-text-subtle)]">{icon}</div>}
      <div>
        <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
        {description && (
          <p className="mt-1 max-w-sm text-sm text-[var(--color-text-muted)]">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// PageHeader consistente — título, descripción, acciones a la derecha.

import type { ReactNode } from 'react';
import { cn } from './cn';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  breadcrumb?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, action, breadcrumb, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex flex-col gap-2', className)}>
      {breadcrumb && (
        <div className="text-xs text-[var(--color-text-muted)]">{breadcrumb}</div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}

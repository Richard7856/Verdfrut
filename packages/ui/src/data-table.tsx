// DataTable simple, tipada con generics. Sin paginación interna — la app la maneja.
// Para tablas más complejas (sortable, filtrable, virtualizadas) considerar TanStack Table.

import type { ReactNode } from 'react';
import { cn } from './cn';
import { EmptyState } from './empty-state';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  isLoading?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyTitle = 'Sin resultados',
  emptyDescription,
  emptyAction,
  isLoading,
}: DataTableProps<T>) {
  if (!isLoading && rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-surface)]"
      style={{ borderColor: 'var(--vf-line-strong)' }}
    >
      <table className="w-full text-left text-sm">
        {/* Header: peso 600 + tracking + alto generoso para separarlo visual
            del primer row. UI/UX 2026-05-12 v2 — el user reportó filas
            apretadas tras el v1; subimos altura a 52px (header) y 56px (filas). */}
        <thead
          className="text-[11px] uppercase tracking-[0.08em]"
          style={{
            background: 'var(--vf-surface-2)',
            color: 'var(--vf-text-mute)',
            borderBottom: '2px solid var(--vf-line-strong)',
          }}
        >
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'px-4 font-semibold',
                  col.align === 'right' && 'text-right',
                  col.align === 'center' && 'text-center',
                  col.className,
                )}
                style={{ height: '48px' }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        {/* Filas con altura mínima fija (56px) y padding horizontal generoso
            para que cualquier celda (texto plano, badge, link) tenga aire.
            Separadores 1px con `--vf-line` (más visible tras token update). */}
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'transition-colors',
                onRowClick && 'cursor-pointer hover:bg-[var(--vf-surface-3)]',
              )}
              style={{
                borderTop: i === 0 ? 'none' : '1px solid var(--vf-line)',
              }}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-4 text-[var(--color-text)]',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.className,
                  )}
                  style={{ height: '56px', verticalAlign: 'middle' }}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

'use client';

// Barra de filtros para la vista por día. Push a URL params para mantener
// estado bookmarkable + compatible con back/forward del browser.
//
// Decisiones:
//  - Date picker simple (input type=date) + flechas prev/next para velocidad
//    de operación común (revisar día anterior, día siguiente).
//  - Zona como dropdown (típicamente <5 opciones).
//  - Status como chips multi-select agrupado en 3 buckets ("Plan", "En curso",
//    "Cerradas") — más intuitivo que listar 8 estados RouteStatus crudos.
//  - Camioneta: queda fuera de esta fase. La leyenda lateral del mapa ya
//    tiene checkboxes por ruta para toggle individual.

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition, useCallback } from 'react';
import { Select } from '@tripdrive/ui';

interface ZoneOption {
  id: string;
  name: string;
  code: string;
}

interface Props {
  fecha: string;
  zones: ZoneOption[];
  selectedZoneId: string | null;
  selectedStatusBuckets: Set<StatusBucket>;
  /** Conteo de rutas por bucket para mostrar en el chip. */
  counts: Record<StatusBucket, number>;
}

export type StatusBucket = 'plan' | 'live' | 'done';

const BUCKET_LABELS: Record<StatusBucket, string> = {
  plan: 'Planeación',
  live: 'En curso',
  done: 'Cerradas',
};

export function DayFilters({ fecha, zones, selectedZoneId, selectedStatusBuckets, counts }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const updateQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [router, pathname, sp],
  );

  function shiftDate(deltaDays: number) {
    const d = new Date(`${fecha}T00:00:00`);
    d.setDate(d.getDate() + deltaDays);
    const next = d.toISOString().slice(0, 10);
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `/dia/${next}?${qs}` : `/dia/${next}`);
    });
  }

  function goToDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `/dia/${value}?${qs}` : `/dia/${value}`);
    });
  }

  function toggleBucket(b: StatusBucket) {
    const next = new Set(selectedStatusBuckets);
    if (next.has(b)) next.delete(b);
    else next.add(b);
    const value = next.size === 0 ? null : Array.from(next).join(',');
    updateQuery({ status: value });
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => shiftDate(-1)}
          disabled={pending}
          className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1 text-sm text-[var(--color-text)] hover:bg-[var(--vf-surface-3)] disabled:opacity-50"
          title="Día anterior"
        >
          ←
        </button>
        <input
          type="date"
          value={fecha}
          onChange={(e) => goToDate(e.target.value)}
          disabled={pending}
          className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1 text-sm text-[var(--color-text)] focus:border-[var(--vf-green-500)] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => shiftDate(1)}
          disabled={pending}
          className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1 text-sm text-[var(--color-text)] hover:bg-[var(--vf-surface-3)] disabled:opacity-50"
          title="Día siguiente"
        >
          →
        </button>
        {fecha !== today && (
          <button
            type="button"
            onClick={() => goToDate(today)}
            disabled={pending}
            className="ml-1 rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--vf-surface-3)] disabled:opacity-50"
          >
            Hoy
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <label className="text-xs text-[var(--color-text-muted)]">Zona:</label>
        <Select
          value={selectedZoneId ?? ''}
          onChange={(e) => updateQuery({ zone: e.target.value || null })}
          disabled={pending}
          className="text-sm"
        >
          <option value="">Todas</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex items-center gap-1">
        {(Object.keys(BUCKET_LABELS) as StatusBucket[]).map((b) => {
          const active = selectedStatusBuckets.has(b);
          return (
            <button
              key={b}
              type="button"
              onClick={() => toggleBucket(b)}
              disabled={pending}
              className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                active
                  ? 'border-[var(--vf-green-500)] bg-[var(--vf-green-950)] text-[var(--vf-green-300)]'
                  : 'border-[var(--color-border)] bg-[var(--vf-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              } disabled:opacity-50`}
              title={`Filtrar ${BUCKET_LABELS[b]}`}
            >
              {BUCKET_LABELS[b]} <span className="opacity-60">{counts[b]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

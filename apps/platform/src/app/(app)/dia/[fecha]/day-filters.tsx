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
import { useTransition, useCallback, useEffect, useState } from 'react';
import { Select } from '@tripdrive/ui';

interface ZoneOption {
  id: string;
  name: string;
  code: string;
}

export interface RecentDayInfo {
  date: string; // YYYY-MM-DD
  routeCount: number;
  hasLive: boolean;
}

interface Props {
  fecha: string;
  zones: ZoneOption[];
  selectedZoneId: string | null;
  selectedStatusBuckets: Set<StatusBucket>;
  /** Conteo de rutas por bucket para mostrar en el chip. */
  counts: Record<StatusBucket, number>;
  /** Últimos N días con metadata para el strip de jumps rápidos. */
  recentDays: RecentDayInfo[];
}

export type StatusBucket = 'plan' | 'live' | 'done';

const BUCKET_LABELS: Record<StatusBucket, string> = {
  plan: 'Planeación',
  live: 'En curso',
  done: 'Cerradas',
};

export function DayFilters({ fecha, zones, selectedZoneId, selectedStatusBuckets, counts, recentDays }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Local state para el input de fecha: evita que cada tecla (ej. al escribir
  // el día "25", el "2" intermedio ya forma fecha válida) dispare navegación.
  // Solo navegamos en blur o Enter cuando el valor está completo y difiere
  // de la fecha actual.
  const [localDate, setLocalDate] = useState(fecha);
  useEffect(() => {
    setLocalDate(fecha);
  }, [fecha]);

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

  function commitLocalDate() {
    if (localDate === fecha) return;
    if (/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      goToDate(localDate);
    } else {
      // Inválido — restaurar al actual sin navegar.
      setLocalDate(fecha);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Strip de últimos N días con indicador de actividad — atajo a saltar
          a días con operación sin teclear la fecha. */}
      {recentDays.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            Recientes:
          </span>
          {recentDays.map((d) => {
            const isCurrent = d.date === fecha;
            const isToday = d.date === today;
            const hasActivity = d.routeCount > 0;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => goToDate(d.date)}
                disabled={pending}
                title={`${d.date} · ${d.routeCount} ruta(s)${d.hasLive ? ' · live' : ''}`}
                className="shrink-0 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50"
                style={{
                  borderColor: isCurrent
                    ? 'var(--vf-green-500, #15803d)'
                    : 'var(--color-border)',
                  background: isCurrent
                    ? 'color-mix(in oklch, var(--vf-green-500, #15803d) 20%, transparent)'
                    : 'var(--vf-surface-2)',
                  color: isCurrent
                    ? 'var(--vf-green-300, #86efac)'
                    : hasActivity
                    ? 'var(--color-text)'
                    : 'var(--color-text-muted)',
                  fontWeight: hasActivity ? 500 : 400,
                  opacity: hasActivity || isCurrent ? 1 : 0.55,
                }}
              >
                <span className="font-mono">
                  {formatChipDate(d.date, today)}
                </span>
                {hasActivity && (
                  <span
                    className="ml-1 inline-flex items-center"
                    style={{
                      color: d.hasLive
                        ? 'var(--vf-warn, #d97706)'
                        : 'var(--color-text-muted)',
                    }}
                  >
                    · {d.routeCount}
                    {d.hasLive ? '⏵' : ''}
                  </span>
                )}
                {isToday && !isCurrent && (
                  <span className="ml-1 text-[9px] text-[var(--vf-green-500, #15803d)]">
                    HOY
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => shiftDate(-7)}
          disabled={pending}
          className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--vf-surface-3)] hover:text-[var(--color-text)] disabled:opacity-50"
          title="7 días atrás"
        >
          «
        </button>
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
          value={localDate}
          onChange={(e) => setLocalDate(e.target.value)}
          onBlur={commitLocalDate}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitLocalDate();
            } else if (e.key === 'Escape') {
              setLocalDate(fecha);
              (e.target as HTMLInputElement).blur();
            }
          }}
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
        <button
          type="button"
          onClick={() => shiftDate(7)}
          disabled={pending}
          className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--vf-surface-3)] hover:text-[var(--color-text)] disabled:opacity-50"
          title="7 días adelante"
        >
          »
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
    </div>
  );
}

/**
 * Formatea fecha YYYY-MM-DD para chip compacto: "Hoy", "Ayer", "Lun 18", etc.
 * Si la fecha es del año actual, omite el año.
 */
function formatChipDate(date: string, today: string): string {
  if (date === today) return 'Hoy';
  const t = new Date(`${today}T00:00:00`);
  const d = new Date(`${date}T00:00:00`);
  const diffDays = Math.round((d.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === -1) return 'Ayer';
  if (diffDays === 1) return 'Mañana';
  const weekdayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const weekday = weekdayNames[d.getDay()];
  return `${weekday} ${d.getDate()}`;
}

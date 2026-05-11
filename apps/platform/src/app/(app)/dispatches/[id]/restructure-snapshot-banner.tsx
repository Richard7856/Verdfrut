'use client';

// Banner que aparece tras redistribuir un tiro (ADR-053 / H3.4).
//
// Muestra:
//   - Métricas antes y después: km totales, min manejo, # rutas.
//   - Delta resaltado (verde si bajamos km, amarillo si subimos).
//   - Si quedaron tiendas sin asignar, lista con códigos para que el
//     dispatcher decida qué hacer (asignar manual a otra ruta, agregar
//     camioneta, etc.).
//
// Persistencia: sessionStorage por dispatchId. Si el dispatcher refresca la
// página el banner sigue ahí; al cerrarlo o cambiar de dispatch, desaparece.

import { useEffect, useState } from 'react';
import { Card } from '@tripdrive/ui';

export interface RestructureSnapshot {
  before: {
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    routeCount: number;
    stopCount: number;
  };
  after: {
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    routeCount: number;
    stopCount: number;
  };
  unassignedStores: Array<{ id: string; code: string; name: string }>;
  timestamp: number;
}

interface Props {
  dispatchId: string;
  /** Lookup de tienda por id para resolver códigos al renderizar. */
  storesById: Map<string, { code: string; name: string }>;
}

const STORAGE_KEY = (dispatchId: string) => `restructureSnapshot:${dispatchId}`;
const MAX_AGE_MS = 10 * 60 * 1000; // 10 min — después del refresh el banner desaparece

/**
 * Helper que los botones (AddVehicle/RemoveVehicle) llaman tras éxito para
 * guardar el snapshot. Se guarda sin los nombres de tienda — el banner los
 * resuelve en client desde el storesById de la página.
 */
export function persistRestructureSnapshot(
  dispatchId: string,
  data: {
    before: RestructureSnapshot['before'];
    after: RestructureSnapshot['after'];
    unassignedStoreIds: string[];
  },
): void {
  if (typeof window === 'undefined') return;
  const snapshot = {
    before: data.before,
    after: data.after,
    unassignedStoreIds: data.unassignedStoreIds,
    timestamp: Date.now(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY(dispatchId), JSON.stringify(snapshot));
  } catch {
    // sessionStorage puede no estar disponible (modo incognito limitado, etc).
    // En ese caso simplemente no mostramos banner — degradación silenciosa.
  }
}

export function RestructureSnapshotBanner({ dispatchId, storesById }: Props) {
  const [snapshot, setSnapshot] = useState<{
    before: RestructureSnapshot['before'];
    after: RestructureSnapshot['after'];
    unassignedStores: Array<{ id: string; code: string; name: string }>;
    timestamp: number;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY(dispatchId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        before: RestructureSnapshot['before'];
        after: RestructureSnapshot['after'];
        unassignedStoreIds: string[];
        timestamp: number;
      };
      // Auto-expira tras 10 min (ej. dispatcher refresca un rato después).
      if (Date.now() - parsed.timestamp > MAX_AGE_MS) {
        sessionStorage.removeItem(STORAGE_KEY(dispatchId));
        return;
      }
      const unassignedStores = parsed.unassignedStoreIds.map((id) => {
        const s = storesById.get(id);
        return { id, code: s?.code ?? id.slice(0, 8), name: s?.name ?? '???' };
      });
      setSnapshot({
        before: parsed.before,
        after: parsed.after,
        unassignedStores,
        timestamp: parsed.timestamp,
      });
    } catch {
      // JSON corrupt — limpiar y no mostrar.
      sessionStorage.removeItem(STORAGE_KEY(dispatchId));
    }
  }, [dispatchId, storesById]);

  if (!snapshot) return null;

  const dKm = (snapshot.after.totalDistanceMeters - snapshot.before.totalDistanceMeters) / 1000;
  const dMin = Math.round(
    (snapshot.after.totalDurationSeconds - snapshot.before.totalDurationSeconds) / 60,
  );
  const dRoutes = snapshot.after.routeCount - snapshot.before.routeCount;
  const improved = dKm <= 0; // menos km es mejor

  function dismiss() {
    sessionStorage.removeItem(STORAGE_KEY(dispatchId));
    setSnapshot(null);
  }

  return (
    <Card className="mb-4 border-[var(--color-border)] bg-[var(--vf-surface-2)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 text-sm">
          <p className="mb-2 font-semibold text-[var(--color-text)]">
            Tiro redistribuido ·{' '}
            <span
              style={{
                color: improved
                  ? 'var(--color-success-fg, #16a34a)'
                  : 'var(--color-warning-fg, #d97706)',
              }}
            >
              {improved ? '✓ optimización mejor' : '⚠ ETAs más largos'}
            </span>
          </p>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Metric
              label="Distancia"
              before={`${(snapshot.before.totalDistanceMeters / 1000).toFixed(1)} km`}
              after={`${(snapshot.after.totalDistanceMeters / 1000).toFixed(1)} km`}
              delta={`${dKm >= 0 ? '+' : ''}${dKm.toFixed(1)} km`}
              improved={dKm <= 0}
            />
            <Metric
              label="Manejo"
              before={`${Math.round(snapshot.before.totalDurationSeconds / 60)} min`}
              after={`${Math.round(snapshot.after.totalDurationSeconds / 60)} min`}
              delta={`${dMin >= 0 ? '+' : ''}${dMin} min`}
              improved={dMin <= 0}
            />
            <Metric
              label="Rutas"
              before={`${snapshot.before.routeCount}`}
              after={`${snapshot.after.routeCount}`}
              delta={dRoutes === 0 ? '·' : `${dRoutes > 0 ? '+' : ''}${dRoutes}`}
              improved={null}
            />
          </div>
          {snapshot.unassignedStores.length > 0 && (
            <div
              className="mt-3 rounded border px-2 py-1.5 text-[11px]"
              style={{
                borderColor: 'var(--color-warning-border, #fbbf24)',
                background: 'var(--color-warning-bg, #fef3c7)',
                color: 'var(--color-warning-fg, #92400e)',
              }}
            >
              <strong>{snapshot.unassignedStores.length} tienda(s) sin asignar:</strong>{' '}
              {snapshot.unassignedStores.map((s) => s.code).join(', ')}.
              Agrega manualmente a alguna ruta o suma otra camioneta para que el optimizador
              las acomode.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 text-lg leading-none text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          aria-label="Cerrar banner"
          title="Cerrar"
        >
          ×
        </button>
      </div>
    </Card>
  );
}

function Metric({
  label,
  before,
  after,
  delta,
  improved,
}: {
  label: string;
  before: string;
  after: string;
  delta: string;
  /** true = verde, false = amarillo, null = neutro. */
  improved: boolean | null;
}) {
  const deltaColor =
    improved === null
      ? 'var(--color-text-muted)'
      : improved
        ? 'var(--color-success-fg, #16a34a)'
        : 'var(--color-warning-fg, #d97706)';
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="font-mono tabular-nums text-[var(--color-text-muted)] line-through">
        {before}
      </p>
      <p className="font-mono tabular-nums font-semibold text-[var(--color-text)]">{after}</p>
      <p className="font-mono tabular-nums text-[10px]" style={{ color: deltaColor }}>
        {delta}
      </p>
    </div>
  );
}

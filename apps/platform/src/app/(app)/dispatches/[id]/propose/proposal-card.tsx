'use client';

// Card de una alternativa de plan (cheapest/balanced/fastest). Muestra:
//  - Labels emoji (una opción puede tener varios labels si coincide)
//  - Métricas clave: km, jornada máx, vehículos
//  - Costo MXN desglosado
//  - Breakdown por ruta (qué vehículo lleva cuántas paradas)
//  - Botón "Aplicar esta opción" → applyRoutePlanAction
//
// Apply hace re-rutee del tiro con los vehículos exactos de esta alternativa.
// Tarda 30-60s (VROOM corre N veces en paralelo). UI muestra loading explícito.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, toast } from '@tripdrive/ui';
import { applyRoutePlanAction } from '../../actions';
import type { RoutePlanOption } from '@tripdrive/router';

interface LabelMeta {
  emoji: string;
  text: string;
  tone: 'info' | 'success' | 'warning';
}

interface Props {
  dispatchId: string;
  alternative: RoutePlanOption;
  labelsMeta: Record<'cheapest' | 'balanced' | 'fastest', LabelMeta>;
  vehiclesById: Record<string, { alias: string | null; plate: string }>;
  driverNameById: Record<string, string>;
}

export function ProposalCard({ dispatchId, alternative, labelsMeta, vehiclesById, driverNameById }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [_, setError] = useState<string | null>(null);

  const formatMxn = (v: number) =>
    `$${v.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;

  // Compute label headline. Si coinciden varios (común con pocos vehículos),
  // mostramos el primero como hero + los demás como sub-badges.
  const primaryLabel = alternative.labels[0] ?? 'balanced';
  const primaryMeta = labelsMeta[primaryLabel];

  function handleApply() {
    const confirmation = confirm(
      `¿Aplicar esta alternativa? El tiro se reestructurará con ${alternative.vehicleCount} vehículo(s), ` +
        `${alternative.metrics.totalKm} km total, costo estimado ${formatMxn(alternative.cost.total_mxn)} MXN.\n\n` +
        `Esto tarda 30-60s porque VROOM recalcula las secuencias. Las rutas actuales del tiro se reemplazan ` +
        `atómicamente (si algo falla, el tiro queda intacto).`,
    );
    if (!confirmation) return;

    setError(null);
    startTransition(async () => {
      const res = await applyRoutePlanAction({
        dispatchId,
        vehicleAssignments: alternative.routes.map((r) => ({
          vehicleId: r.vehicleId,
          driverId: r.driverId,
        })),
        appliedLabel: alternative.labels.join('+') || 'unlabeled',
      });
      if (res.ok) {
        toast.success(
          'Plan aplicado',
          `${alternative.routes.length} rutas actualizadas. Tiro reestructurado.`,
        );
        router.push(`/dispatches/${dispatchId}`);
      } else {
        const errMsg = res.error ?? 'Error desconocido';
        setError(errMsg);
        toast.error('No se pudo aplicar', errMsg);
      }
    });
  }

  // Cap colors per primary label: bordes resaltados.
  const borderClass =
    primaryLabel === 'cheapest'
      ? 'border-emerald-500/40'
      : primaryLabel === 'fastest'
        ? 'border-amber-500/40'
        : 'border-blue-500/40';

  return (
    <Card className={`${borderClass} relative flex flex-col gap-3 border-2 p-4`}>
      {/* Header: emoji + label + badges secundarios */}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-2xl">{primaryMeta.emoji}</p>
          <div className="flex flex-wrap justify-end gap-1">
            {alternative.labels.map((lbl) => (
              <Badge key={lbl} tone={labelsMeta[lbl].tone}>
                {labelsMeta[lbl].text}
              </Badge>
            ))}
          </div>
        </div>
        <h3 className="mt-1 text-base font-semibold">
          {alternative.vehicleCount} {alternative.vehicleCount === 1 ? 'vehículo' : 'vehículos'}
        </h3>
      </div>

      {/* Métricas clave */}
      <div className="grid grid-cols-2 gap-2 rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] p-2.5 text-xs">
        <Metric label="Km totales" value={`${alternative.metrics.totalKm.toFixed(0)} km`} />
        <Metric
          label="Jornada máx"
          value={`${alternative.metrics.maxDriverHours.toFixed(1)} h`}
        />
        <Metric
          label="Horas totales"
          value={`${alternative.metrics.totalDriverHours.toFixed(1)} h`}
        />
        <Metric label="Paradas" value={`${alternative.routes.reduce((a, r) => a + r.stopCount, 0)}`} />
      </div>

      {/* Costo MXN desglosado */}
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-1)] p-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            Costo mensual estimado
          </span>
          <span className="text-xl font-bold">{formatMxn(alternative.cost.total_mxn)}</span>
        </div>
        <div className="mt-2 space-y-1 text-[11px]">
          <CostRow label="Combustible" value={alternative.cost.fuel_mxn} formatMxn={formatMxn} />
          <CostRow label="Desgaste" value={alternative.cost.wear_mxn} formatMxn={formatMxn} />
          <CostRow label="Chofer" value={alternative.cost.labor_mxn} formatMxn={formatMxn} />
          <CostRow label="Overhead" value={alternative.cost.overhead_mxn} formatMxn={formatMxn} />
        </div>
      </div>

      {/* Breakdown por ruta */}
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
          Reparto por vehículo
        </p>
        <ul className="space-y-1">
          {alternative.routes.map((r, idx) => {
            const veh = vehiclesById[r.vehicleId];
            const vehLabel = veh ? veh.alias ?? veh.plate : r.vehicleId.slice(0, 8);
            const driverLabel = r.driverId ? driverNameById[r.driverId] ?? 'chofer' : 'sin chofer';
            return (
              <li
                key={`${r.vehicleId}-${idx}`}
                className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{vehLabel}</p>
                  <p className="truncate text-[10px] text-[var(--color-text-muted)]">
                    {driverLabel} · {r.stopCount} paradas
                  </p>
                </div>
                <div className="shrink-0 text-right text-[10px] text-[var(--color-text-muted)]">
                  <p>{r.distanceKm.toFixed(0)} km</p>
                  <p>{r.durationHours.toFixed(1)} h</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Apply button */}
      <Button
        type="button"
        variant="primary"
        onClick={handleApply}
        isLoading={pending}
        disabled={pending}
        className="mt-auto w-full"
      >
        {pending ? 'Aplicando…' : 'Aplicar esta opción →'}
      </Button>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

function CostRow({
  label,
  value,
  formatMxn,
}: {
  label: string;
  value: number;
  formatMxn: (v: number) => string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span>{formatMxn(value)}</span>
    </div>
  );
}

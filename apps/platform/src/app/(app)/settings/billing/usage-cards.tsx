// ADR-126: tarjetas de consumo en /settings/billing.
//
// Muestra el admin:
//   - Cuota AI sessions vs límite mensual (con barra + reset date)
//   - Cuota AI writes vs límite mensual
//   - # de tiendas activas vs cap del plan
//
// Cada card incluye:
//   - Header con label + número absoluto (e.g. "240 / 300")
//   - Progress bar coloreada (verde < 60%, amarilla 60-85%, roja > 85%)
//   - Línea de contexto (próximo reset, o si está ilimitado)
//   - CTA "Subir a Enterprise" si tier=pro y consumo >= 80%

import Link from 'next/link';

interface UsageCardProps {
  title: string;
  used: number;
  limit: number;
  /** Si Infinity (Enterprise), renderea "Ilimitado" sin barra. */
  unitLabel: string;
  /** Texto debajo de la barra, ej. "Renueva el 1 jun". */
  footnote?: string;
  /** Si limit es finito y consumo ≥ 80%, mostramos CTA upgrade. */
  upgradeUrl?: string;
}

export function UsageCard({ title, used, limit, unitLabel, footnote, upgradeUrl }: UsageCardProps) {
  const unlimited = !Number.isFinite(limit) || limit === 0 && used === 0;
  const pct = limit > 0 && Number.isFinite(limit) ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const showUpgrade = upgradeUrl && Number.isFinite(limit) && limit > 0 && pct >= 80;

  // Color de la barra por umbral.
  let barColor = 'var(--vf-green-500, #16a34a)';
  if (pct >= 85) barColor = 'var(--vf-crit, #dc2626)';
  else if (pct >= 60) barColor = 'var(--vf-warn, #d97706)';

  return (
    <div
      className="rounded-md border p-3"
      style={{
        background: 'var(--vf-surface-1, var(--color-surface-1))',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
          {title}
        </p>
        {!unlimited && Number.isFinite(limit) && (
          <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            {pct}%
          </p>
        )}
      </div>

      {unlimited || !Number.isFinite(limit) ? (
        <>
          <p className="mt-1.5 text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>
            {used.toLocaleString('es-MX')}
            <span className="ml-1 text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>
              {unitLabel}
            </span>
          </p>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            ♾️ Ilimitado · sin tope mensual en tu plan
          </p>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>
            {used.toLocaleString('es-MX')}
            <span className="text-base font-normal" style={{ color: 'var(--color-text-muted)' }}>
              {' '}
              / {limit.toLocaleString('es-MX')}
            </span>
            <span className="ml-1 text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>
              {unitLabel}
            </span>
          </p>
          {/* Barra de progreso */}
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--vf-surface-2, color-mix(in oklch, var(--vf-bg) 85%, white 8%))' }}
          >
            <div
              className="h-full transition-all"
              style={{
                width: `${pct}%`,
                background: barColor,
              }}
            />
          </div>
        </>
      )}

      {footnote && (
        <p className="mt-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {footnote}
        </p>
      )}

      {showUpgrade && (
        <Link
          href={upgradeUrl!}
          className="mt-2 inline-block text-[11px] font-medium hover:underline"
          style={{ color: 'var(--vf-green-500)' }}
        >
          → Considera Enterprise para ilimitado
        </Link>
      )}
    </div>
  );
}

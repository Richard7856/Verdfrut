// Sugerencia de partición de zona (Workbench WB-3 / ADR-115).
//
// El admin elige una zona + un K (2-5 sub-zonas). El server clusteriza con
// bisección recursiva y devuelve la propuesta con métricas de balance + las
// frecuencias agregadas de WB-2. Read-only en WB-3 MVP: no escribe nada.
// La acción "crear N zonas hipotéticas con esta propuesta" queda diferida
// a WB-3b (necesita is_sandbox en zones + flow de migración de tiendas).

import Link from 'next/link';
import { Card, EmptyState, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { listZones } from '@/lib/queries/zones';
import { proposeZoneSplit } from '@/lib/queries/zone-suggestions';
import { ZoneSuggestionMap } from './zone-suggestion-map';

export const metadata = { title: 'Sugerir partición de zona' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ zone?: string; k?: string }>;
}

const VALID_K_VALUES = [2, 3, 4, 5] as const;

export default async function SuggestZonesPage({ searchParams }: PageProps) {
  await requireRole('admin', 'dispatcher');
  const params = await searchParams;

  const zones = await listZones();
  const activeZones = zones.filter((z) => z.isActive);
  const selectedZoneId = params.zone && activeZones.some((z) => z.id === params.zone)
    ? params.zone
    : null;
  const kRaw = parseInt(params.k ?? '2', 10);
  const k = (VALID_K_VALUES as readonly number[]).includes(kRaw) ? kRaw : 2;

  const suggestion = selectedZoneId ? await proposeZoneSplit(selectedZoneId, k) : null;
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  return (
    <>
      <PageHeader
        title="🧪 Sugerir partición de zona"
        description="El sistema propone cómo partir una zona en sub-zonas geográficamente coherentes usando el mismo algoritmo que el optimizer en producción. Útil cuando una zona creció y conviene dividirla por dispatcher o por flotilla."
      />

      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
          <Field label="Zona a analizar">
            <select
              name="zone"
              defaultValue={selectedZoneId ?? ''}
              className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1.5 min-w-[220px]"
            >
              <option value="">Selecciona…</option>
              {activeZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.code} — {z.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Partir en">
            <select
              name="k"
              defaultValue={String(k)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-2 py-1.5"
            >
              {VALID_K_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v} sub-zonas
                </option>
              ))}
            </select>
          </Field>
          <button
            type="submit"
            className="rounded-md bg-[var(--vf-green-600,#15803d)] px-4 py-1.5 text-white"
          >
            Calcular propuesta
          </button>
          {selectedZoneId && (
            <Link
              href="/settings/workbench/zones"
              className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:underline"
            >
              Limpiar
            </Link>
          )}
        </form>
      </Card>

      {!selectedZoneId && (
        <EmptyState
          title="Elige una zona para analizar"
          description="El análisis es read-only — no modifica zonas ni tiendas. Solo te muestra cómo se vería la partición."
        />
      )}

      {suggestion && suggestion.totalStores === 0 && (
        <EmptyState
          title="Esta zona no tiene tiendas activas"
          description={`${suggestion.zoneName} no tiene tiendas reales activas para clusterizar. Agrega tiendas o elige otra zona.`}
        />
      )}

      {suggestion && suggestion.totalStores > 0 && (
        <div className="flex flex-col gap-4">
          {/* Resumen de balance arriba */}
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  Propuesta para {suggestion.zoneCode} — {suggestion.zoneName}
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {suggestion.totalStores} tiendas → {suggestion.clusters.length} sub-zonas
                </p>
              </div>
              <div className="flex gap-6 text-sm">
                <BalanceBadge
                  label="Balance por tiendas"
                  score={suggestion.imbalanceScore}
                />
                <BalanceBadge
                  label="Balance por kg/sem"
                  score={suggestion.imbalanceScoreKg}
                />
              </div>
            </div>
          </Card>

          {mapboxToken && (
            <ZoneSuggestionMap suggestion={suggestion} mapboxToken={mapboxToken} />
          )}

          {/* Tabla por cluster */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {suggestion.clusters.map((c) => (
              <Card key={c.index}>
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: c.color }}
                    aria-hidden
                  />
                  <p className="text-sm font-semibold">Sub-zona {c.index}</p>
                </div>
                <dl className="space-y-1 text-xs">
                  <Metric label="Tiendas" value={String(c.storeCount)} />
                  <Metric
                    label="Visitas / semana"
                    value={c.totalVisitsPerWeek.toString()}
                  />
                  <Metric
                    label="Carga total / semana"
                    value={`${c.totalKgPerWeek.toLocaleString('es-MX')} kg`}
                  />
                  <Metric
                    label="Centro geográfico"
                    value={`${c.centroid.lat.toFixed(4)}, ${c.centroid.lng.toFixed(4)}`}
                  />
                </dl>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    Ver {c.storeCount} tienda(s) →
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1 text-[11px]">
                    {c.stores.map((s) => (
                      <li key={s.id} className="flex items-baseline justify-between gap-2">
                        <span>
                          <span className="font-mono text-[var(--color-text-muted)]">
                            {s.code}
                          </span>{' '}
                          {s.name}
                        </span>
                        <span className="font-mono tabular-nums text-[var(--color-text-muted)]">
                          {s.kgPerWeek > 0 ? `${s.kgPerWeek}kg/sem` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </Card>
            ))}
          </div>

          <Card>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Próximamente
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Aplicar la propuesta creará automáticamente las sub-zonas en modo
              planeación con las tiendas re-asignadas. Mientras tanto, úsalo como
              guía visual para tomar la decisión y aplicar manualmente desde
              Configuración → Zonas y Tiendas.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="font-mono tabular-nums text-[var(--color-text)]">{value}</dd>
    </div>
  );
}

/**
 * Convierte el score de imbalance (0-1) a un badge interpretable.
 *   0 - 0.15 → balanceado (verde)
 *   0.15 - 0.35 → aceptable (amber)
 *   > 0.35 → desbalanceado (rojo)
 */
function BalanceBadge({ label, score }: { label: string; score: number }) {
  let text: string;
  let color: string;
  if (score <= 0.15) {
    text = 'Balanceado';
    color = 'var(--vf-green-600, #15803d)';
  } else if (score <= 0.35) {
    text = 'Aceptable';
    color = 'var(--vf-warn, #d97706)';
  } else {
    text = 'Desbalanceado';
    color = 'var(--color-danger-fg, #dc2626)';
  }
  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p
        className="mt-0.5 text-sm font-semibold"
        style={{ color }}
        title={`Score de imbalance: ${score.toFixed(2)} (0 = perfectamente balanceado)`}
      >
        {text}
      </p>
    </div>
  );
}

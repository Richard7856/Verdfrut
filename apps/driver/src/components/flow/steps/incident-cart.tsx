'use client';

// Step `incident_cart` — Carrito real de incidencias (ADR-020).
//
// El chofer agrega N incidencias en una sola pantalla. Cada incidencia es un
// IncidentDetail estructurado: producto (texto libre), cantidad, unidad,
// tipo (rechazo / faltante / sobrante / devolución) y notas opcionales.
//
// Diseño:
//  - State local de la lista. Se sincroniza al server con onPatch al continuar.
//  - El form de "agregar incidencia" está colapsado por default si ya hay items
//    en la lista — para no saturar la vista cuando solo se agrega 1.
//  - "Quitar" remueve del state local sin llamar al server (la persistencia es
//    en bloque al final con Continuar).

import { useState } from 'react';
import { Button, Card } from '@tripdrive/ui';
import type { IncidentDetail, IncidentType } from '@tripdrive/types';
import { StepShell } from '../step-shell';
import type { StepProps } from '../stop-detail-client';

// Unidades cerradas (ADR-020). Si el chofer necesita otra, usa notes + pcs.
const UNITS = ['pcs', 'kg', 'caja', 'paquete', 'bolsa', 'lata'] as const;
type Unit = (typeof UNITS)[number];

// Etiquetas en español visibles al chofer.
const TYPE_LABEL: Record<IncidentType, string> = {
  rechazo: 'Rechazo',
  faltante: 'Faltante',
  sobrante: 'Sobrante',
  devolucion: 'Devolución',
};

// Helper: estado inicial de un draft vacío.
const EMPTY_DRAFT: Draft = {
  productName: '',
  type: 'rechazo',
  quantity: '',
  unit: 'pcs',
  notes: '',
};

interface Draft {
  productName: string;
  type: IncidentType;
  // Mantenemos la cantidad como string mientras el chofer escribe (para permitir
  // que vacíe el campo y reescriba sin que se "pegue" un 0). Validamos al agregar.
  quantity: string;
  unit: Unit;
  notes: string;
}

const MIN_NAME_LEN = 2;
const MAX_NAME_LEN = 200;
const MAX_NOTES_LEN = 500;
const MAX_QTY = 100_000; // sane upper bound — un pedido jamás tiene más

export function IncidentCartStep(props: StepProps) {
  const { report, pending, error, advanceTo, nextOf, onPatch, setError } = props;
  const [items, setItems] = useState<IncidentDetail[]>(
    () => report.incidentDetails.filter((d) => d.productName !== 'Pendiente de detallar via chat'),
  );
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // Si ya hay items, el form de agregar arranca colapsado.
  const [showForm, setShowForm] = useState(items.length === 0);
  const [draftError, setDraftError] = useState<string | null>(null);

  const ready = items.length > 0;

  function validateDraft(d: Draft): IncidentDetail | string {
    const name = d.productName.trim();
    if (name.length < MIN_NAME_LEN) {
      return `El nombre del producto debe tener al menos ${MIN_NAME_LEN} caracteres.`;
    }
    if (name.length > MAX_NAME_LEN) {
      return `El nombre es demasiado largo (máx ${MAX_NAME_LEN} caracteres).`;
    }
    // Acepta coma decimal mexicana (1,5 → 1.5). #39 / ADR-023.
    const qtyStr = d.quantity.replace(',', '.');
    const qty = Number(qtyStr);
    if (!Number.isFinite(qty) || qty <= 0) {
      return 'La cantidad debe ser un número mayor a 0.';
    }
    if (qty > MAX_QTY) {
      return `La cantidad es demasiado grande (máx ${MAX_QTY.toLocaleString('es-MX')}).`;
    }
    const notes = d.notes.trim();
    if (notes.length > MAX_NOTES_LEN) {
      return `Las notas son demasiado largas (máx ${MAX_NOTES_LEN} caracteres).`;
    }
    const detail: IncidentDetail = {
      productName: name,
      type: d.type,
      quantity: qty,
      unit: d.unit,
      ...(notes ? { notes } : {}),
    };
    return detail;
  }

  function handleAdd() {
    const result = validateDraft(draft);
    if (typeof result === 'string') {
      setDraftError(result);
      return;
    }
    setItems((prev) => [...prev, result]);
    setDraft(EMPTY_DRAFT);
    setDraftError(null);
    // Si el chofer agrega más de uno, mantén el form abierto para uno más.
    // Pero si llegó a 1, colapsamos para no abrumar.
    if (items.length === 0) setShowForm(false);
  }

  function handleRemove(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleContinue() {
    if (!ready) return;
    setError(null);
    await onPatch({ incidentDetails: items });
    advanceTo(nextOf({ hasIncidents: true }));
  }

  return (
    <StepShell
      title="Reportar incidencia"
      description="Agrega cada producto con problema. El detalle se enviará al encargado."
      onContinue={handleContinue}
      continueDisabled={!ready}
      pending={pending}
      error={error}
      continueLabel={ready ? `Continuar (${items.length})` : 'Agrega al menos uno'}
    >
      {/* Lista de incidencias agregadas. */}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((it, idx) => (
            <li key={idx}>
              <IncidentCard item={it} onRemove={() => handleRemove(idx)} />
            </li>
          ))}
        </ul>
      )}

      {/* Botón para abrir el form si está colapsado. */}
      {!showForm && (
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="w-full"
          onClick={() => setShowForm(true)}
        >
          + Agregar otra incidencia
        </Button>
      )}

      {showForm && (
        <Card className="border-[var(--color-border)] bg-[var(--vf-surface-2)]">
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">
                Producto
              </label>
              <input
                type="text"
                value={draft.productName}
                onChange={(e) => setDraft({ ...draft, productName: e.target.value })}
                maxLength={MAX_NAME_LEN}
                placeholder='Ej. "Manzana red delicious 1kg"'
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-1)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--vf-green-500)] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">
                  Cantidad
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={draft.quantity}
                  onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                  placeholder="0"
                  className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-1)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--vf-green-500)] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">
                  Unidad
                </label>
                <select
                  value={draft.unit}
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value as Unit })}
                  className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-1)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--vf-green-500)] focus:outline-none"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">
                Tipo de incidencia
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(TYPE_LABEL) as IncidentType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDraft({ ...draft, type: t })}
                    className={`rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-colors ${
                      draft.type === t
                        ? 'border-[var(--vf-green-500)] bg-[var(--vf-green-50)] text-[var(--color-text)]'
                        : 'border-[var(--color-border)] bg-[var(--vf-surface-1)] text-[var(--color-text-muted)]'
                    }`}
                  >
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">
                Notas (opcional)
              </label>
              <textarea
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                maxLength={MAX_NOTES_LEN}
                placeholder="Ej. cajas dañadas, fruta con golpes…"
                className="min-h-[64px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-1)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--vf-green-500)] focus:outline-none"
              />
            </div>

            {draftError && (
              <p className="text-xs text-[var(--color-danger-fg)]">{draftError}</p>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleAdd}
                className="flex-1"
              >
                Agregar al carrito
              </Button>
              {items.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    setDraft(EMPTY_DRAFT);
                    setDraftError(null);
                    setShowForm(false);
                  }}
                >
                  Cancelar
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {!ready && !showForm && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Necesitas registrar al menos una incidencia para continuar.
        </p>
      )}
    </StepShell>
  );
}

function IncidentCard({ item, onRemove }: { item: IncidentDetail; onRemove: () => void }) {
  return (
    <Card className="border-[var(--color-border)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--color-text)]">
            {item.productName}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            <strong className="text-[var(--color-text)]">{item.quantity} {item.unit}</strong>
            {' · '}
            <span className="capitalize">{TYPE_LABEL[item.type]}</span>
          </p>
          {item.notes && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{item.notes}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Quitar incidencia"
          className="rounded-full px-2 py-1 text-lg text-[var(--color-text-muted)] hover:bg-[var(--vf-surface-2)] hover:text-[var(--color-danger-fg)]"
        >
          ✕
        </button>
      </div>
    </Card>
  );
}

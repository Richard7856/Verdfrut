'use client';

// Step de revisión de ticket (recibo o merma) con OCR Claude Vision.
// ADR-022.
//
// Estados:
//   idle       → estado inicial, dispara fetch automático al montar.
//   extracting → spinner.
//   extracted  → form pre-poblado y editable.
//   error      → mensaje + reintentar / llenar manual.
//
// Si el server ya tiene `ticket_data`/`return_ticket_data` (re-entrada al step),
// arranca directamente en `extracted` sin volver a llamar Anthropic.

import { useEffect, useState } from 'react';
import { Button, Card, Spinner } from '@tripdrive/ui';
import type { TicketData, TicketItem } from '@tripdrive/types';
import { StepShell } from '../step-shell';
import type { StepProps } from '../stop-detail-client';

type Kind = 'receipt' | 'waste';

// Caps del form — ADR-023.
const MAX_NUMERO_LEN = 64;
const MAX_DESC_LEN = 200;
const MAX_ITEMS = 50;
const MAX_TOTAL = 10_000_000; // 10 millones — sane upper bound

// Clase compartida para inputs del form — evita repetir tokens en cada uno.
const INPUT_CLS =
  'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-1)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--vf-green-500)] focus:outline-none';

type ExtractState =
  | { phase: 'idle' }
  | { phase: 'extracting' }
  | { phase: 'extracted'; data: TicketData }
  | { phase: 'error'; message: string };

interface Props extends StepProps {
  kind: Kind;
}

export function TicketReviewStep(props: Props) {
  const { kind, report, pending, error, advanceTo, nextOf, onPatch } = props;

  const existing = kind === 'receipt' ? report.ticketData : report.returnTicketData;
  const alreadyConfirmed =
    kind === 'receipt' ? report.ticketExtractionConfirmed : report.returnTicketExtractionConfirmed;

  // Si ya hay extracción, no volvemos a llamar Anthropic.
  const [state, setState] = useState<ExtractState>(() =>
    existing ? { phase: 'extracted', data: existing } : { phase: 'idle' },
  );
  // Form local — copia editable del TicketData del estado.
  const [form, setForm] = useState<TicketData>(() => existing ?? blankTicket());

  useEffect(() => {
    // Si ya confirmamos, no volver a hacer nada.
    if (alreadyConfirmed) return;
    if (state.phase !== 'idle') return;
    void runExtraction();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runExtraction() {
    setState({ phase: 'extracting' });
    try {
      const res = await fetch('/api/ocr/extract-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: report.id, kind }),
      });
      const json = (await res.json()) as { ok: boolean; data?: TicketData; error?: string };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error ?? 'OCR falló');
      }
      setForm(json.data);
      setState({ phase: 'extracted', data: json.data });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ phase: 'error', message });
    }
  }

  function fillManual() {
    setForm(blankTicket());
    setState({ phase: 'extracted', data: blankTicket() });
  }

  // Validación al confirmar: numero, fecha, total > 0, caps de longitud.
  function validate(t: TicketData): string | null {
    if (!t.numero || !t.numero.trim()) return 'Falta el número del ticket.';
    if (t.numero.length > MAX_NUMERO_LEN) {
      return `El número del ticket es demasiado largo (máx ${MAX_NUMERO_LEN}).`;
    }
    if (!t.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(t.fecha)) {
      return 'La fecha debe estar en formato YYYY-MM-DD.';
    }
    if (t.total == null || t.total <= 0) return 'El total debe ser mayor a 0.';
    if (t.total > MAX_TOTAL) return `El total parece muy alto — verifica.`;
    if (t.items.length > MAX_ITEMS) {
      return `Demasiados items (${t.items.length}). Máximo ${MAX_ITEMS}.`;
    }
    for (const it of t.items) {
      if ((it.description ?? '').length > MAX_DESC_LEN) {
        return `Una descripción excede ${MAX_DESC_LEN} caracteres.`;
      }
    }
    return null;
  }

  async function handleConfirm() {
    const err = validate(form);
    if (err) {
      setState({ phase: 'error', message: err });
      return;
    }
    // Encolar el patch + advance (igual que el resto del flow).
    if (kind === 'receipt') {
      await onPatch({ ticketData: form, ticketExtractionConfirmed: true });
    } else {
      await onPatch({ returnTicketData: form, returnTicketExtractionConfirmed: true });
    }
    advanceTo(nextOf({}));
  }

  const title = kind === 'receipt' ? 'Revisión del recibo' : 'Revisión del ticket de merma';
  const description = 'Verifica los datos extraídos. Puedes corregirlos antes de continuar.';

  return (
    <StepShell
      title={title}
      description={description}
      onContinue={handleConfirm}
      continueDisabled={state.phase === 'extracting'}
      pending={pending}
      error={error}
      continueLabel="Confirmar y continuar"
    >
      {state.phase === 'extracting' && (
        <Card className="border-[var(--color-border)] bg-[var(--vf-surface-2)]">
          <div className="flex items-center gap-3">
            <Spinner />
            <div>
              <p className="text-sm font-medium text-[var(--color-text)]">Leyendo ticket…</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Esto puede tardar unos segundos.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={fillManual}
          >
            Llenar manualmente
          </Button>
        </Card>
      )}

      {state.phase === 'error' && (
        <Card className="border-[var(--color-danger-border)] bg-[var(--color-danger-bg)]">
          <p className="text-sm text-[var(--color-danger-fg)]">{state.message}</p>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="primary" size="sm" onClick={runExtraction}>
              Reintentar OCR
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={fillManual}>
              Llenar manualmente
            </Button>
          </div>
        </Card>
      )}

      {state.phase === 'extracted' && (
        <TicketForm
          value={form}
          onChange={setForm}
          confidence={state.data.confidence}
          onReExtract={existing ? undefined : runExtraction}
        />
      )}
    </StepShell>
  );
}

function blankTicket(): TicketData {
  return { numero: null, fecha: null, total: null, items: [], confidence: 0 };
}

function TicketForm({
  value,
  onChange,
  confidence,
  onReExtract,
}: {
  value: TicketData;
  onChange: (v: TicketData) => void;
  confidence: number;
  onReExtract?: () => void;
}) {
  const lowConfidence = confidence > 0 && confidence < 0.6;

  function setField<K extends keyof TicketData>(k: K, v: TicketData[K]) {
    onChange({ ...value, [k]: v });
  }

  function setItem(idx: number, patch: Partial<TicketItem>) {
    const next = [...value.items];
    next[idx] = { ...next[idx], ...patch } as TicketItem;
    onChange({ ...value, items: next });
  }

  function removeItem(idx: number) {
    onChange({ ...value, items: value.items.filter((_, i) => i !== idx) });
  }

  function addItem() {
    if (value.items.length >= MAX_ITEMS) return;
    onChange({
      ...value,
      items: [
        ...value.items,
        { description: '', quantity: null, unit: null, unitPrice: null, total: null },
      ],
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {lowConfidence && (
        <Card className="border-[var(--color-warning-border)] bg-[var(--color-warning-bg)]">
          <p className="text-xs text-[var(--color-warning-fg)]">
            ⚠️ Confianza baja en la lectura. Revisa los datos antes de confirmar.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Número de ticket">
          <input
            type="text"
            value={value.numero ?? ''}
            onChange={(e) => setField('numero', e.target.value || null)}
            maxLength={MAX_NUMERO_LEN}
            className={INPUT_CLS}
            placeholder="A-123456"
          />
        </Field>
        <Field label="Fecha (YYYY-MM-DD)">
          <input
            type="date"
            value={value.fecha ?? ''}
            onChange={(e) => setField('fecha', e.target.value || null)}
            className={INPUT_CLS}
          />
        </Field>
      </div>

      <Field label="Total">
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={value.total ?? ''}
          onChange={(e) => setField('total', e.target.value === '' ? null : Number(e.target.value))}
          className={INPUT_CLS}
          placeholder="0.00"
        />
      </Field>

      <div>
        <p className="mb-1 text-xs font-medium text-[var(--color-text)]">
          Items detectados ({value.items.length})
        </p>
        <ul className="flex flex-col gap-2">
          {value.items.map((it, idx) => (
            <li
              key={idx}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-2)] p-2"
            >
              <div className="flex items-start gap-2">
                <input
                  type="text"
                  value={it.description}
                  onChange={(e) => setItem(idx, { description: e.target.value })}
                  maxLength={MAX_DESC_LEN}
                  className={`${INPUT_CLS} flex-1`}
                  placeholder="Descripción"
                />
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  aria-label="Quitar item"
                  className="rounded-full px-2 text-[var(--color-text-muted)] hover:text-[var(--color-danger-fg)]"
                >
                  ✕
                </button>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={it.quantity ?? ''}
                  onChange={(e) =>
                    setItem(idx, { quantity: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  className={INPUT_CLS}
                  placeholder="Cant."
                />
                <input
                  type="text"
                  value={it.unit ?? ''}
                  onChange={(e) => setItem(idx, { unit: e.target.value || null })}
                  className={INPUT_CLS}
                  placeholder="Unidad"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={it.total ?? ''}
                  onChange={(e) =>
                    setItem(idx, { total: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  className={INPUT_CLS}
                  placeholder="Total"
                />
              </div>
            </li>
          ))}
        </ul>
        <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={addItem}>
          + Agregar item
        </Button>
      </div>

      {onReExtract && (
        <Button type="button" variant="ghost" size="sm" onClick={onReExtract}>
          Re-extraer con OCR
        </Button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">{label}</label>
      {children}
    </div>
  );
}

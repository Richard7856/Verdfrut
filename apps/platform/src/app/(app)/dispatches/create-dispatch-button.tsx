'use client';

// Modal sencillo para crear un tiro nuevo (nombre + fecha + zona + notas).
// Tras crear, navega a /dispatches/[id] para que el dispatcher empiece a agregar rutas.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@verdfrut/ui';
import { todayInZone } from '@verdfrut/utils';
import type { Zone } from '@verdfrut/types';
import { createDispatchAction } from './actions';

interface Props {
  zones: Zone[];
  /**
   * Fecha "hoy" en la TZ del tenant, calculada en el servidor.
   * P0-1: el componente client-side antes calculaba la fecha local con math
   * manual de offset, lo que producía la fecha equivocada cuando el navegador
   * del dispatcher estaba en otra TZ que el tenant. Ahora viene del server.
   */
  defaultDate?: string;
}

const TENANT_TZ = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

export function CreateDispatchButton({ zones, defaultDate }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  // Fallback al cliente con TZ del tenant si el server no la pasó (no rompe
  // server components nuevos vs viejos). `todayInZone` SÍ está bien hecha,
  // a diferencia del cálculo manual previo.
  const [date, setDate] = useState(defaultDate ?? todayInZone(TENANT_TZ));
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const res = await createDispatchAction({
        name,
        date,
        zoneId,
        notes: notes || null,
      });
      if (!res.ok || !res.id) {
        setError(res.error ?? 'Error');
        return;
      }
      setOpen(false);
      setName('');
      setNotes('');
      router.push(`/dispatches/${res.id}`);
    });
  }

  return (
    <>
      <Button type="button" variant="primary" size="md" onClick={() => setOpen(true)}>
        Crear tiro
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--vf-surface-1)] p-5 shadow-xl">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Nuevo tiro</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Define el lote operativo. Después agrega rutas (un camión por ruta).
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <Field label="Nombre">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder='Ej. "Tiro CDMX matutino"'
                  maxLength={80}
                  className="form-input"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Fecha">
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="form-input"
                  />
                </Field>
                <Field label="Zona">
                  <select
                    value={zoneId}
                    onChange={(e) => setZoneId(e.target.value)}
                    className="form-input"
                  >
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>{z.name}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Notas (opcional)">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contexto operativo del tiro"
                  rows={2}
                  maxLength={500}
                  className="form-input"
                />
              </Field>

              {error && (
                <p className="rounded border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-2 py-1 text-xs text-[var(--color-danger-fg)]">
                  {error}
                </p>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="md" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleSubmit}
                isLoading={pending}
                disabled={pending || name.trim().length < 2 || !zoneId}
              >
                Crear
              </Button>
            </div>
          </div>

          <style jsx>{`
            :global(.form-input) {
              width: 100%;
              padding: 0.5rem 0.75rem;
              border-radius: var(--radius-md);
              border: 1px solid var(--color-border);
              background-color: var(--vf-surface-2);
              color: var(--color-text);
              font-size: 0.875rem;
            }
            :global(.form-input:focus) {
              outline: none;
              border-color: var(--vf-green-500);
            }
          `}</style>
        </div>
      )}
    </>
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

'use client';

import { useState, useTransition } from 'react';
import { Button, Field, Input, Modal, Select, toast } from '@tripdrive/ui';
import type { Zone } from '@tripdrive/types';
import { createDepotAction } from './actions';

export function CreateDepotButton({ zones }: { zones: Zone[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const activeZones = zones.filter((z) => z.isActive);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Crear CEDIS
      </Button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title="Nuevo CEDIS"
        description="Punto físico desde donde los vehículos salen y regresan."
        size="lg"
      >
        <form
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const res = await createDepotAction(formData);
              if (res.ok) {
                toast.success('CEDIS creado');
                setOpen(false);
              } else {
                setError(res.error ?? 'Error al crear CEDIS');
              }
            });
          }}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          <Field label="Código" htmlFor="code" required>
            <Input
              id="code"
              name="code"
              required
              maxLength={16}
              placeholder="VLLJ"
              autoFocus
              disabled={pending}
            />
          </Field>
          <Field label="Nombre" htmlFor="name" required>
            <Input
              id="name"
              name="name"
              required
              maxLength={120}
              placeholder="CEDIS Vallejo"
              disabled={pending}
            />
          </Field>

          <Field label="Zona" htmlFor="zone_id" required>
            <Select id="zone_id" name="zone_id" required disabled={pending}>
              <option value="">Selecciona zona…</option>
              {activeZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.code} — {z.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Dirección" htmlFor="address" required className="md:col-span-2">
            <Input
              id="address"
              name="address"
              required
              maxLength={250}
              placeholder="Calle, colonia, ciudad"
              disabled={pending}
            />
          </Field>

          <Field label="Latitud" htmlFor="lat" required>
            <Input
              id="lat"
              name="lat"
              type="number"
              step="0.000001"
              required
              placeholder="19.488000"
              disabled={pending}
            />
          </Field>
          <Field label="Longitud" htmlFor="lng" required>
            <Input
              id="lng"
              name="lng"
              type="number"
              step="0.000001"
              required
              placeholder="-99.156000"
              disabled={pending}
            />
          </Field>

          <Field label="Encargado (opcional)" htmlFor="contact_name">
            <Input id="contact_name" name="contact_name" maxLength={120} disabled={pending} />
          </Field>
          <Field label="Teléfono (opcional)" htmlFor="contact_phone">
            <Input id="contact_phone" name="contact_phone" type="tel" maxLength={24} disabled={pending} />
          </Field>

          <Field label="Notas (opcional)" htmlFor="notes" className="md:col-span-2">
            <Input id="notes" name="notes" maxLength={500} disabled={pending} />
          </Field>

          {error && (
            <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
              {error}
            </div>
          )}

          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" isLoading={pending}>
              Crear CEDIS
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

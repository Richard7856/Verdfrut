'use client';

import { useState, useTransition } from 'react';
import { Button, Field, Input, Modal, Select, toast } from '@tripdrive/ui';
import type { Zone } from '@tripdrive/types';
import { createStoreAction } from './actions';

export function CreateStoreButton({ zones }: { zones: Zone[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const activeZones = zones.filter((z) => z.isActive);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Nueva tienda
      </Button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title="Nueva tienda"
        description="Datos requeridos para optimización: ubicación, ventana horaria, tiempo de servicio."
        size="lg"
      >
        <form
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const res = await createStoreAction(formData);
              if (res.ok) {
                toast.success('Tienda creada');
                setOpen(false);
              } else {
                setError(res.error ?? 'Error al crear');
              }
            });
          }}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          <Field label="Código" htmlFor="code" required hint="Ej: NETO-001">
            <Input id="code" name="code" required maxLength={32} autoFocus disabled={pending} />
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

          <Field label="Nombre" htmlFor="name" required className="md:col-span-2">
            <Input id="name" name="name" required maxLength={120} disabled={pending} />
          </Field>

          <Field label="Dirección" htmlFor="address" required className="md:col-span-2">
            <Input id="address" name="address" required maxLength={240} disabled={pending} />
          </Field>

          <Field label="Latitud" htmlFor="lat" required hint="Ej: 19.4326">
            <Input
              id="lat"
              name="lat"
              type="number"
              step="0.000001"
              min={-90}
              max={90}
              required
              disabled={pending}
            />
          </Field>
          <Field label="Longitud" htmlFor="lng" required hint="Ej: -99.1332">
            <Input
              id="lng"
              name="lng"
              type="number"
              step="0.000001"
              min={-180}
              max={180}
              required
              disabled={pending}
            />
          </Field>

          <Field label="Recibe desde" htmlFor="receiving_window_start" hint="Formato HH:MM">
            <Input id="receiving_window_start" name="receiving_window_start" type="time" disabled={pending} />
          </Field>
          <Field label="Recibe hasta" htmlFor="receiving_window_end">
            <Input id="receiving_window_end" name="receiving_window_end" type="time" disabled={pending} />
          </Field>

          <Field label="Tiempo de servicio (min)" htmlFor="service_minutes" hint="Default: 15">
            <Input
              id="service_minutes"
              name="service_minutes"
              type="number"
              min={1}
              max={240}
              defaultValue={15}
              disabled={pending}
            />
          </Field>

          <Field label="Contacto" htmlFor="contact_name">
            <Input id="contact_name" name="contact_name" maxLength={120} disabled={pending} />
          </Field>
          <Field label="Teléfono" htmlFor="contact_phone">
            <Input id="contact_phone" name="contact_phone" type="tel" maxLength={24} disabled={pending} />
          </Field>

          <div className="md:col-span-2 mt-2 rounded-[var(--vf-r)] p-3 text-xs" style={{ background: 'var(--vf-bg-sub)', color: 'var(--vf-text-mute)' }}>
            <strong>Demanda típica:</strong> capacidad que ocupa una entrega a esta tienda. El optimizador la compara con la capacidad del camión. Default: 100 kg, 1 m³, 5 cajas.
          </div>

          <Field label="Demanda — Peso (kg)" htmlFor="demand_weight">
            <Input
              id="demand_weight"
              name="demand_weight"
              type="number"
              min={1}
              max={100000}
              defaultValue={100}
              disabled={pending}
            />
          </Field>
          <Field label="Volumen (m³)" htmlFor="demand_volume">
            <Input
              id="demand_volume"
              name="demand_volume"
              type="number"
              min={1}
              max={1000}
              defaultValue={1}
              disabled={pending}
            />
          </Field>
          <Field label="Cajas" htmlFor="demand_boxes" className="md:col-span-2">
            <Input
              id="demand_boxes"
              name="demand_boxes"
              type="number"
              min={1}
              max={10000}
              defaultValue={5}
              disabled={pending}
            />
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
              Crear tienda
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

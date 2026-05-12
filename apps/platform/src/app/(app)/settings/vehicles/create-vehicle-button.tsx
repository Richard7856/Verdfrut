'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Button, Field, Input, Modal, Select, toast } from '@tripdrive/ui';
import type { Depot, Zone } from '@tripdrive/types';
import { createVehicleAction } from './actions';

export function CreateVehicleButton({ zones, depots }: { zones: Zone[]; depots: Depot[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [zoneId, setZoneId] = useState('');
  const [depotId, setDepotId] = useState('');

  const activeZones = zones.filter((z) => z.isActive);
  const depotsForZone = useMemo(
    () => depots.filter((d) => d.isActive && d.zoneId === zoneId),
    [depots, zoneId],
  );

  // #27 — Auto-seleccionar el CEDIS si la zona tiene exactamente UNO activo.
  // Cubre el 90% del caso real (la mayoría de zonas operativas tienen un solo
  // CEDIS) sin necesidad de la columna `zones.default_depot_id`. Si hay varios,
  // el admin elige (el caso "varios pero hay default" queda pendiente para una
  // migración separada cuando aparezca un cliente con esa topología).
  useEffect(() => {
    if (!zoneId) return;
    if (depotsForZone.length === 1) {
      setDepotId(depotsForZone[0]!.id);
    }
  }, [zoneId, depotsForZone]);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Nuevo camión
      </Button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title="Nuevo camión"
        description="Capacidad multidimensional usada por el optimizador."
        size="lg"
      >
        <form
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const res = await createVehicleAction(formData);
              if (res.ok) {
                toast.success('Camión registrado');
                setOpen(false);
              } else {
                setError(res.error ?? 'Error al crear');
              }
            });
          }}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          <Field label="Placa" htmlFor="plate" required hint="Mayúsculas, ej: ABC-123-A">
            <Input id="plate" name="plate" required maxLength={16} autoFocus disabled={pending} />
          </Field>
          <Field label="Zona" htmlFor="zone_id" required>
            <Select
              id="zone_id"
              name="zone_id"
              required
              value={zoneId}
              onChange={(e) => {
                setZoneId(e.target.value);
                setDepotId('');
              }}
              disabled={pending}
            >
              <option value="">Selecciona zona…</option>
              {activeZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.code} — {z.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Alias (opcional)" htmlFor="alias" className="md:col-span-2" hint="Ej: Tortón rojo, Camión 5">
            <Input id="alias" name="alias" maxLength={60} disabled={pending} />
          </Field>

          <Field label="Capacidad — Peso (kg)" htmlFor="capacity_weight" required>
            <Input
              id="capacity_weight"
              name="capacity_weight"
              type="number"
              min={1}
              max={100000}
              defaultValue={3500}
              required
              disabled={pending}
            />
          </Field>
          <Field label="Volumen (m³)" htmlFor="capacity_volume" required>
            <Input
              id="capacity_volume"
              name="capacity_volume"
              type="number"
              min={1}
              max={1000}
              defaultValue={20}
              required
              disabled={pending}
            />
          </Field>
          <Field label="Cajas" htmlFor="capacity_boxes" required>
            <Input
              id="capacity_boxes"
              name="capacity_boxes"
              type="number"
              min={1}
              max={10000}
              defaultValue={200}
              required
              disabled={pending}
            />
          </Field>

          <Field label="CEDIS / Hub" htmlFor="depot_id" className="md:col-span-2" hint="Punto físico desde donde sale y regresa el camión">
            <Select
              id="depot_id"
              name="depot_id"
              value={depotId}
              onChange={(e) => setDepotId(e.target.value)}
              disabled={pending || !zoneId}
            >
              <option value="">
                {!zoneId
                  ? 'Selecciona una zona primero'
                  : depotsForZone.length === 0
                    ? 'Sin CEDIS en esta zona — usar coords manuales abajo'
                    : 'Selecciona CEDIS…'}
              </option>
              {depotsForZone.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </Select>
          </Field>

          {!depotId && (
            <>
              <div className="md:col-span-2 rounded-[var(--radius-md)] bg-[var(--color-surface-subtle)] p-3 text-xs text-[var(--color-text-muted)]">
                <strong>Override manual:</strong> sólo si el camión sale de un punto distinto al CEDIS de su zona.
              </div>

              <Field label="Latitud depósito" htmlFor="depot_lat" hint="Opcional">
                <Input id="depot_lat" name="depot_lat" type="number" step="0.000001" min={-90} max={90} disabled={pending} />
              </Field>
              <Field label="Longitud depósito" htmlFor="depot_lng" hint="Opcional">
                <Input id="depot_lng" name="depot_lng" type="number" step="0.000001" min={-180} max={180} disabled={pending} />
              </Field>
            </>
          )}

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
              Registrar camión
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

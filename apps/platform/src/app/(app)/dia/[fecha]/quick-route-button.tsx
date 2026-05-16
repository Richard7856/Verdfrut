'use client';

// Botón "➕ Nueva ruta rápida" en /dia (ADR-119 / UX-Fase 3).
//
// Permite crear una ruta huérfana (sin tiro) directo desde la vista del día.
// El flow antes era: armar tiro → asignar camioneta → crear ruta. Ahora con
// dispatch_id nullable, el dispatcher puede arrancar con una sola ruta.
//
// Modal compacto: selecciona camioneta + (opcional) chofer + zona. Click
// crear → redirect a /routes/[id] para agregar paradas.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Modal, Select, toast } from '@tripdrive/ui';
import { createOrphanRouteAction } from './orphan-route-action';

interface VehicleOpt {
  id: string;
  alias: string | null;
  plate: string;
  zoneId: string;
}

interface DriverOpt {
  id: string;
  fullName: string;
  zoneId: string;
}

interface ZoneOpt {
  id: string;
  code: string;
  name: string;
}

interface Props {
  fecha: string;
  vehicles: VehicleOpt[];
  drivers: DriverOpt[];
  zones: ZoneOpt[];
  /** Zona pre-seleccionada del filtro actual (opcional). */
  defaultZoneId?: string | null;
}

export function QuickRouteButton({
  fecha,
  vehicles,
  drivers,
  zones,
  defaultZoneId,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [zoneId, setZoneId] = useState(defaultZoneId ?? '');
  const [error, setError] = useState<string | null>(null);

  // Cuando cambias vehículo, auto-selecciona su zona (si no hay zona elegida).
  function handleVehicleChange(id: string) {
    setVehicleId(id);
    if (!zoneId) {
      const v = vehicles.find((x) => x.id === id);
      if (v) setZoneId(v.zoneId);
    }
  }

  // Filtrar choferes por la zona elegida (cuando hay una).
  const filteredDrivers = zoneId
    ? drivers.filter((d) => d.zoneId === zoneId)
    : drivers;

  function reset() {
    setVehicleId('');
    setDriverId('');
    setZoneId(defaultZoneId ?? '');
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!vehicleId) {
      setError('Selecciona una camioneta.');
      return;
    }
    if (!zoneId) {
      setError('Selecciona una zona.');
      return;
    }
    startTransition(async () => {
      const res = await createOrphanRouteAction({
        date: fecha,
        vehicleId,
        zoneId,
        driverId: driverId || null,
      });
      if (!res.ok) {
        setError(res.error ?? 'No se pudo crear la ruta.');
        return;
      }
      toast.success('Ruta creada', 'Agrega paradas en la siguiente pantalla.');
      setOpen(false);
      reset();
      if (res.routeId) router.push(`/routes/${res.routeId}`);
      else router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-950/50"
        title="Crear una ruta directa para esta fecha — sin necesidad de armar un tiro previo"
      >
        ➕ Nueva ruta
      </button>

      <Modal
        open={open}
        onClose={() => {
          if (pending) return;
          setOpen(false);
          setTimeout(reset, 200);
        }}
        title="Nueva ruta rápida"
        description={`Crea una ruta DRAFT para ${fecha}. Sin necesidad de armar un tiro — puedes agruparlas después si quieres.`}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Camioneta" htmlFor="vehicle" required>
            <Select
              id="vehicle"
              required
              value={vehicleId}
              onChange={(e) => handleVehicleChange(e.target.value)}
              disabled={pending}
            >
              <option value="">Selecciona…</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.alias ? `${v.alias} · ${v.plate}` : v.plate}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Zona" htmlFor="zone" required>
            <Select
              id="zone"
              required
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              disabled={pending}
            >
              <option value="">Selecciona…</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.code} — {z.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Chofer (opcional)" htmlFor="driver">
            <Select
              id="driver"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              disabled={pending}
            >
              <option value="">Sin asignar (asignar después)</option>
              {filteredDrivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </Select>
          </Field>

          <Input type="hidden" name="date" value={fecha} readOnly />

          {error && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger-fg)]">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" isLoading={pending}>
              Crear ruta
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

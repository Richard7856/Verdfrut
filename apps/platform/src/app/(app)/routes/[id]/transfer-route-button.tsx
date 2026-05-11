'use client';

// Botón "Transferir paradas pendientes" + modal — S18.7.
// Visible cuando la ruta está en PUBLISHED o IN_PROGRESS (la transfer no
// aplica antes ni después).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal, Field } from '@tripdrive/ui';
import { transferRouteRemainderAction } from './transfer-action';

interface DriverOption {
  id: string;
  name: string;
}

interface VehicleOption {
  id: string;
  label: string;
}

interface Props {
  routeId: string;
  routeStatus: string;
  pendingStopsCount: number;
  /** Opciones para llenar los selects. Filtradas a la zona/availability del cliente. */
  availableDrivers: DriverOption[];
  availableVehicles: VehicleOption[];
  /** Si la ruta original tiene dispatch_id, ofrecemos opción de heredarlo. */
  hasDispatch: boolean;
}

const REASON_PRESETS = [
  'Avería del camión (mecánica)',
  'Llanta ponchada',
  'Accidente vial',
  'Camión sin combustible',
  'Otro',
] as const;

export function TransferRouteButton({
  routeId,
  routeStatus,
  pendingStopsCount,
  availableDrivers,
  availableVehicles,
  hasDispatch,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [reasonPreset, setReasonPreset] = useState<typeof REASON_PRESETS[number]>(REASON_PRESETS[0]);
  const [reasonDetail, setReasonDetail] = useState('');
  const [inheritDispatch, setInheritDispatch] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Solo aplica para PUBLISHED o IN_PROGRESS.
  const canTransfer =
    (routeStatus === 'PUBLISHED' || routeStatus === 'IN_PROGRESS') && pendingStopsCount > 0;
  if (!canTransfer) return null;

  function submit() {
    setError(null);
    const reason = reasonPreset === 'Otro'
      ? reasonDetail.trim() || 'Otro motivo'
      : `${reasonPreset}${reasonDetail.trim() ? ` — ${reasonDetail.trim()}` : ''}`;
    if (!vehicleId) {
      setError('Selecciona un vehículo destino.');
      return;
    }
    startTransition(async () => {
      const res = await transferRouteRemainderAction({
        sourceRouteId: routeId,
        targetVehicleId: vehicleId,
        targetDriverId: driverId || null,
        reason,
        inheritDispatch: hasDispatch && inheritDispatch,
      });
      if (!res.ok) {
        setError(res.error ?? 'Operación falló.');
        return;
      }
      setOpen(false);
      if (res.newRouteId) {
        router.push(`/routes/${res.newRouteId}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-[var(--color-warning-fg,#d97706)]"
      >
        ⚠ Transferir paradas pendientes ({pendingStopsCount})
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Transferir paradas pendientes">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Las {pendingStopsCount} paradas pendientes pasarán a una ruta nueva con
            otro chofer/vehículo. Esta ruta queda como <strong>INTERRUPTED</strong>.
            Acción no se puede deshacer automáticamente.
          </p>

          <Field label="Vehículo destino" htmlFor="target-vehicle" required>
            <select
              id="target-vehicle"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              disabled={pending}
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              <option value="">— Selecciona un vehículo —</option>
              {availableVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Chofer destino (opcional)" htmlFor="target-driver">
            <select
              id="target-driver"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              disabled={pending}
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              <option value="">— Sin chofer asignado (asignar después) —</option>
              {availableDrivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Motivo de la transferencia" htmlFor="reason-preset" required>
            <select
              id="reason-preset"
              value={reasonPreset}
              onChange={(e) => setReasonPreset(e.target.value as typeof REASON_PRESETS[number])}
              disabled={pending}
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              {REASON_PRESETS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Detalle adicional (opcional)" htmlFor="reason-detail">
            <input
              id="reason-detail"
              value={reasonDetail}
              onChange={(e) => setReasonDetail(e.target.value)}
              maxLength={400}
              disabled={pending}
              placeholder="Ej. ubicación específica, datos de contacto"
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            />
          </Field>

          {hasDispatch && (
            <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={inheritDispatch}
                onChange={(e) => setInheritDispatch(e.target.checked)}
                disabled={pending}
              />
              Mantener la nueva ruta dentro del mismo tiro
            </label>
          )}

          {error && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={submit}
              isLoading={pending}
              disabled={!vehicleId}
            >
              Transferir
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

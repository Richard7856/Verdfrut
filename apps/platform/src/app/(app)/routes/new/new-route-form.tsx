'use client';

// Formulario de creación de ruta.
// Diseño: 2 columnas — config (izq) + multi-selects (der).
// Al elegir zona, filtra las tiendas y camiones disponibles.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardHeader, Field, Input, Select, toast, cn } from '@verdfrut/ui';
import type { Driver, Store, Vehicle, Zone } from '@verdfrut/types';
import { createAndOptimizeRoute } from '../actions';

interface Props {
  zones: Zone[];
  stores: Store[];
  vehicles: Vehicle[];
  drivers: Driver[];
}

export function NewRouteForm({ zones, stores, vehicles, drivers }: Props) {
  const router = useRouter();

  // Default zona: la primera. Default fecha: mañana.
  const [zoneId, setZoneId] = useState<string>(zones[0]?.id ?? '');
  const [date, setDate] = useState<string>(() => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return t.toISOString().slice(0, 10);
  });
  const [name, setName] = useState<string>('');
  const [shiftStart, setShiftStart] = useState('06:00');
  const [shiftEnd, setShiftEnd] = useState('14:00');
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set());
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set());
  // Map vehicleId → driverId asignado. Si un vehículo no está en el map, queda sin asignar.
  const [vehicleDrivers, setVehicleDrivers] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Filtrar por zona seleccionada.
  const zoneStores = useMemo(() => stores.filter((s) => s.zoneId === zoneId), [stores, zoneId]);
  const zoneVehicles = useMemo(() => vehicles.filter((v) => v.zoneId === zoneId), [vehicles, zoneId]);
  const zoneDrivers = useMemo(() => drivers.filter((d) => d.zoneId === zoneId), [drivers, zoneId]);

  function toggleStore(id: string) {
    setSelectedStores((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVehicle(id: string) {
    setSelectedVehicles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (selectedStores.size === 0) {
      setError('Selecciona al menos una tienda');
      return;
    }
    if (selectedVehicles.size === 0) {
      setError('Selecciona al menos un camión');
      return;
    }
    if (!name.trim()) {
      setError('Ponle nombre a la ruta');
      return;
    }

    const vehicleIds = Array.from(selectedVehicles);
    const driverIds = vehicleIds.map((vid) => vehicleDrivers.get(vid) ?? null);

    startTransition(async () => {
      const res = await createAndOptimizeRoute({
        name: name.trim(),
        date,
        vehicleIds,
        driverIds,
        storeIds: Array.from(selectedStores),
        shiftStart,
        shiftEnd,
      });

      if (!res.ok) {
        setError(res.error ?? 'Error al optimizar');
        return;
      }

      const created = res.routeIds ?? [];
      const totalSelected = selectedStores.size;
      const unassignedCount = res.unassignedStoreIds?.length ?? 0;
      const unassignedRatio = totalSelected > 0 ? unassignedCount / totalSelected : 0;

      // Si más del 20% de las tiendas no se asignaron, bloquear navegación con confirm
      // explícito para que el dispatcher tome decisión consciente.
      if (unassignedRatio > 0.2) {
        const proceed = confirm(
          `⚠️ El optimizador no asignó ${unassignedCount} de ${totalSelected} tiendas (${Math.round(unassignedRatio * 100)}%).\n\n` +
            `Causas comunes:\n` +
            `• Capacidad total de camiones < demanda total de tiendas\n` +
            `• Ventanas horarias muy estrictas (no caben en el shift)\n` +
            `• Algunas tiendas muy lejos del depósito\n\n` +
            `¿Continuar con las ${created.length} ruta(s) creadas? (Las tiendas no asignadas quedan disponibles para otra ruta.)`,
        );
        if (!proceed) {
          // El usuario decide no continuar — las rutas ya están creadas, solo no navegamos
          toast.warning('Rutas creadas pero no navegadas', 'Revisa las rutas en la lista.');
          return;
        }
      } else if (unassignedCount > 0) {
        toast.warning(
          'Optimizada con paradas sin asignar',
          `${unassignedCount} tiendas no cupieron — revisa la ruta.`,
        );
      } else {
        toast.success('Ruta optimizada', `${created.length} ruta(s) generadas.`);
      }

      if (created.length === 1 && created[0]) {
        router.push(`/routes/${created[0]}`);
      } else {
        router.push('/routes');
      }
    });
  }

  if (zones.length === 0) {
    return (
      <Card>
        <p className="text-sm" style={{ color: 'var(--vf-text-mute)' }}>
          No hay zonas activas. Crea una zona en{' '}
          <a href="/settings/zones" className="underline">
            Configuración
          </a>{' '}
          antes de crear rutas.
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
      {/* COLUMNA IZQUIERDA — config */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Configuración" description="Datos de la ruta" />
          <div className="flex flex-col gap-4">
            <Field label="Nombre" htmlFor="name" required>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Ruta CDMX – Lunes"
                required
                disabled={pending}
              />
            </Field>

            <Field label="Zona" htmlFor="zone" required>
              <Select
                id="zone"
                value={zoneId}
                onChange={(e) => {
                  setZoneId(e.target.value);
                  setSelectedStores(new Set());
                  setSelectedVehicles(new Set());
                  setVehicleDrivers(new Map());
                }}
                disabled={pending}
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.code} — {z.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Fecha" htmlFor="date" required>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                disabled={pending}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Inicio turno" htmlFor="shift_start">
                <Input
                  id="shift_start"
                  type="time"
                  value={shiftStart}
                  onChange={(e) => setShiftStart(e.target.value)}
                  disabled={pending}
                />
              </Field>
              <Field label="Fin turno" htmlFor="shift_end">
                <Input
                  id="shift_end"
                  type="time"
                  value={shiftEnd}
                  onChange={(e) => setShiftEnd(e.target.value)}
                  disabled={pending}
                />
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Resumen" />
          <div className="space-y-1.5 text-sm">
            <SummaryRow label="Tiendas seleccionadas" value={selectedStores.size} />
            <SummaryRow label="Camiones seleccionados" value={selectedVehicles.size} />
            <SummaryRow
              label="Tiendas/camión (avg)"
              value={
                selectedVehicles.size > 0
                  ? Math.ceil(selectedStores.size / selectedVehicles.size)
                  : '—'
              }
            />
          </div>

          {error && (
            <div
              className="mt-3 rounded-[var(--vf-r)] border px-3 py-2 text-xs"
              style={{
                background: 'var(--color-danger-bg)',
                borderColor: 'var(--color-danger-border)',
                color: 'var(--color-danger-fg)',
              }}
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={pending}
            className="mt-4 w-full"
          >
            Optimizar y crear ruta
          </Button>
        </Card>
      </div>

      {/* COLUMNA DERECHA — selectores */}
      <div className="flex flex-col gap-4">
        <SelectorCard
          title="Camiones disponibles"
          subtitle={`${selectedVehicles.size} de ${zoneVehicles.length} seleccionados`}
          empty="No hay camiones activos en esta zona."
          isEmpty={zoneVehicles.length === 0}
          onSelectAll={() => setSelectedVehicles(new Set(zoneVehicles.map((v) => v.id)))}
          onClear={() => {
            setSelectedVehicles(new Set());
            setVehicleDrivers(new Map());
          }}
          disabled={pending}
        >
          <div className="flex flex-col gap-2">
            {zoneVehicles.map((v) => {
              const isSelected = selectedVehicles.has(v.id);
              return (
                <div key={v.id} className="flex flex-col gap-1.5">
                  <SelectChip
                    selected={isSelected}
                    onClick={() => {
                      toggleVehicle(v.id);
                      // Si lo desmarcamos, quitar el driver asignado.
                      if (isSelected) {
                        setVehicleDrivers((prev) => {
                          const next = new Map(prev);
                          next.delete(v.id);
                          return next;
                        });
                      }
                    }}
                    disabled={pending}
                    primary={v.alias ?? v.plate}
                    secondary={`${v.capacity[0] ?? 0} kg · ${v.capacity[1] ?? 0} m³`}
                  />
                  {isSelected && (
                    <div className="ml-7">
                      <Select
                        value={vehicleDrivers.get(v.id) ?? ''}
                        onChange={(e) => {
                          const did = e.target.value;
                          setVehicleDrivers((prev) => {
                            const next = new Map(prev);
                            if (did) next.set(v.id, did);
                            else next.delete(v.id);
                            return next;
                          });
                        }}
                        disabled={pending}
                        className="h-8 text-[12px]"
                      >
                        <option value="">Sin chofer asignado (asignar después)</option>
                        {zoneDrivers.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.fullName}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SelectorCard>

        <SelectorCard
          title="Tiendas a visitar"
          subtitle={`${selectedStores.size} de ${zoneStores.length} seleccionadas`}
          empty="No hay tiendas activas en esta zona."
          isEmpty={zoneStores.length === 0}
          onSelectAll={() => setSelectedStores(new Set(zoneStores.map((s) => s.id)))}
          onClear={() => setSelectedStores(new Set())}
          disabled={pending}
        >
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {zoneStores.map((s) => (
              <SelectChip
                key={s.id}
                selected={selectedStores.has(s.id)}
                onClick={() => toggleStore(s.id)}
                disabled={pending}
                primary={s.code}
                secondary={s.name}
              />
            ))}
          </div>
        </SelectorCard>
      </div>
    </form>
  );
}

function SummaryRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: 'var(--vf-text-mute)' }}>{label}</span>
      <span className="font-mono tabular-nums" style={{ color: 'var(--vf-text)' }}>
        {value}
      </span>
    </div>
  );
}

interface SelectorCardProps {
  title: string;
  subtitle: string;
  empty: string;
  isEmpty: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function SelectorCard({ title, subtitle, empty, isEmpty, onSelectAll, onClear, disabled, children }: SelectorCardProps) {
  return (
    <Card padded={false}>
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: 'var(--vf-line)' }}
      >
        <div>
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--vf-text)' }}>
            {title}
          </h3>
          <p className="text-[11.5px]" style={{ color: 'var(--vf-text-mute)' }}>
            {subtitle}
          </p>
        </div>
        {!isEmpty && (
          <div className="flex gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={onSelectAll} disabled={disabled}>
              Todos
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={disabled}>
              Ninguno
            </Button>
          </div>
        )}
      </div>
      <div className="p-4">
        {isEmpty ? (
          <p className="text-center text-sm" style={{ color: 'var(--vf-text-mute)' }}>
            {empty}
          </p>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

interface SelectChipProps {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  primary: string;
  secondary?: string;
}

function SelectChip({ selected, onClick, disabled, primary, secondary }: SelectChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-start gap-2 rounded-[var(--vf-r)] border px-2.5 py-2 text-left transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
      style={{
        background: selected ? 'color-mix(in oklch, var(--vf-green-700) 12%, transparent)' : 'var(--vf-bg-sub)',
        borderColor: selected ? 'var(--vf-green-600)' : 'var(--vf-line)',
        color: 'var(--vf-text)',
      }}
    >
      <div
        className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border"
        style={{
          background: selected ? 'var(--vf-green-700)' : 'transparent',
          borderColor: selected ? 'var(--vf-green-700)' : 'var(--vf-line-strong)',
        }}
      >
        {selected && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[12px]">{primary}</div>
        {secondary && (
          <div className="truncate text-[11px]" style={{ color: 'var(--vf-text-mute)' }}>
            {secondary}
          </div>
        )}
      </div>
    </button>
  );
}

'use client';

// Formulario de creación de ruta.
// Diseño: 2 columnas — config (izq) + multi-selects (der).
// Al elegir zona, filtra las tiendas y camiones disponibles.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardHeader, Field, Input, Select, toast, cn } from '@tripdrive/ui';
import type { Dispatch, Driver, Store, Vehicle, Zone } from '@tripdrive/types';
import { createAndOptimizeRoute, cancelRouteAction } from '../actions';

interface Props {
  zones: Zone[];
  stores: Store[];
  vehicles: Vehicle[];
  drivers: Driver[];
  /** Si vino de /dispatches/[id], pre-fillea date/zone y al crear vincula la ruta. */
  dispatch?: Dispatch | null;
}

export function NewRouteForm({ zones, stores, vehicles, drivers, dispatch }: Props) {
  const router = useRouter();

  // Si hay dispatch, las propiedades zona/fecha quedan FIJAS (no editable) para
  // garantizar consistencia con el tiro. Si no, default zona[0] y mañana.
  const [zoneId, setZoneId] = useState<string>(dispatch?.zoneId ?? zones[0]?.id ?? '');
  const [date, setDate] = useState<string>(() => {
    if (dispatch) return dispatch.date;
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

  // UX 2026-05-12: con 50+ tiendas en una zona, scroll-find era doloroso.
  // Agregamos filtros client-side: búsqueda por code/name/address + toggle
  // de verified/sin verificar + modal de "pegar lista de códigos" para
  // selección bulk desde XLSX/Sheets externos.
  const [searchQuery, setSearchQuery] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState<'all' | 'verified' | 'unverified'>('all');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState<{ matched: number; missed: string[] } | null>(null);

  // Filtrar por zona seleccionada.
  const zoneStores = useMemo(() => stores.filter((s) => s.zoneId === zoneId), [stores, zoneId]);
  const zoneVehicles = useMemo(() => vehicles.filter((v) => v.zoneId === zoneId), [vehicles, zoneId]);
  const zoneDrivers = useMemo(() => drivers.filter((d) => d.zoneId === zoneId), [drivers, zoneId]);

  // Tiendas visibles tras aplicar buscador + filter de verified. El SelectAll
  // del SelectorCard opera sobre estos visibles (no sobre todo zoneStores)
  // para que la acción sea consistente con lo que el usuario ve.
  const visibleStores = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return zoneStores.filter((s) => {
      if (verifiedFilter === 'verified' && !s.coordVerified) return false;
      if (verifiedFilter === 'unverified' && s.coordVerified) return false;
      if (q.length === 0) return true;
      return (
        s.code.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.address ?? '').toLowerCase().includes(q)
      );
    });
  }, [zoneStores, searchQuery, verifiedFilter]);

  // Paste-by-code: usuario pega una lista de códigos (separados por coma, salto
  // de línea o espacio) y los matcheamos contra zoneStores. Útil para importar
  // selección desde un XLSX/Sheets ("aquí están los 40 IDs que quiero").
  function applyPaste() {
    const tokens = pasteText
      .split(/[\s,;]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    if (tokens.length === 0) {
      setPasteResult({ matched: 0, missed: [] });
      return;
    }
    const byCode = new Map(zoneStores.map((s) => [s.code.toUpperCase(), s.id]));
    // También aceptar IDs numéricos sueltos asumiendo prefijo de zona (ej. "1550"
    // se interpreta como "CDMX-1550" si la zona actual es CDMX).
    const zoneCode = zones.find((z) => z.id === zoneId)?.code ?? '';
    const ids = new Set<string>();
    const missed: string[] = [];
    for (const tok of tokens) {
      const id =
        byCode.get(tok) ??
        byCode.get(`${zoneCode.toUpperCase()}-${tok}`) ??
        null;
      if (id) ids.add(id);
      else missed.push(tok);
    }
    setSelectedStores((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setPasteResult({ matched: ids.size, missed });
  }

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
        // ADR-040: si vino de un tiro existente, asociamos directo. Si no,
        // el server auto-crea uno (toda ruta debe vivir en un dispatch).
        dispatchId: dispatch?.id ?? null,
      });

      if (!res.ok) {
        setError(res.error ?? 'Error al optimizar');
        return;
      }

      const created = res.routeIds ?? [];
      // ADR-040: ya no necesitamos `assignRouteToDispatchAction` aquí — el
      // server action createAndOptimizeRoute ya asocia las rutas al dispatch
      // (existente o auto-creado) atómicamente.
      const totalSelected = selectedStores.size;
      const unassignedCount = res.unassignedStoreIds?.length ?? 0;
      const unassignedRatio = totalSelected > 0 ? unassignedCount / totalSelected : 0;

      // Si más del 20% de las tiendas no se asignaron, pedir confirmación explícita.
      // Bug previo (S14): el modal salía DESPUÉS de crear las rutas y "Cancelar" solo
      // bloqueaba la navegación — las rutas quedaban en BD. ADR-036: ahora si el user
      // cancela, BORRAMOS las rutas creadas para que la BD refleje su decisión.
      if (unassignedRatio > 0.2) {
        const proceed = confirm(
          `⚠️ El optimizador no asignó ${unassignedCount} de ${totalSelected} tiendas (${Math.round(unassignedRatio * 100)}%).\n\n` +
            `Causas comunes:\n` +
            `• Capacidad total de camiones < demanda total de tiendas\n` +
            `• Ventanas horarias muy estrictas (no caben en el shift)\n` +
            `• Algunas tiendas muy lejos del depósito\n\n` +
            `Aceptar = mantener las ${created.length} ruta(s) creada(s) (las tiendas no asignadas quedan disponibles).\n` +
            `Cancelar = BORRAR las ruta(s) creadas y volver al formulario para ajustar.`,
        );
        if (!proceed) {
          // BORRAR las rutas creadas — el user las rechaza explícitamente.
          // Usamos allSettled para no abortar si una falla; loggeamos errores
          // individuales y avisamos al user del resultado.
          const results = await Promise.allSettled(
            created.map((rid) => cancelRouteAction(rid)),
          );
          const failed = results.filter(
            (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok),
          ).length;
          if (failed > 0) {
            toast.error(
              'Rutas parcialmente canceladas',
              `${created.length - failed}/${created.length} canceladas. Revisa la lista — quedan ${failed} en estado DRAFT.`,
            );
          } else {
            toast.success(
              'Rutas canceladas',
              'Las tiendas vuelven a estar disponibles. Ajusta el formulario y reintenta.',
            );
          }
          // No navegamos — el user se queda en el form para corregir.
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

      // ADR-040: redirigir siempre al detalle del tiro (existente o auto-creado).
      // En `/dispatches/[id]` se ve el mapa unificado con todas las rutas del tiro,
      // que es lo que el dispatcher quiere después de crear (especialmente cuando
      // creó N>1 rutas en una corrida — antes el redirect a /routes era confuso).
      const targetDispatchId = dispatch?.id ?? res.dispatchId;
      if (targetDispatchId) {
        router.push(`/dispatches/${targetDispatchId}`);
      } else if (created.length === 1 && created[0]) {
        // Fallback (no debería pasar tras ADR-040 — toda ruta tiene tiro).
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
        {/* ADR-040: aviso del tiro al cual se asociarán las rutas. Si vino de
            /dispatches/[id], muestra el tiro existente. Si no, anuncia el auto. */}
        <div
          className="rounded-[var(--radius-md)] border px-3 py-2 text-xs"
          style={{
            background: dispatch ? 'var(--vf-info-bg)' : 'var(--vf-bg-sub)',
            borderColor: dispatch ? 'var(--vf-info-border)' : 'var(--vf-line)',
            color: 'var(--vf-text)',
          }}
        >
          {dispatch ? (
            <>
              <strong>Tiro:</strong> {dispatch.name} ({dispatch.date}) — las rutas que crees
              quedan dentro de este tiro.
            </>
          ) : (
            <>
              <strong>Tiro:</strong> se creará automáticamente uno llamado{' '}
              <span className="font-mono">Tiro {date.split('-').reverse().slice(0, 2).join('/')}</span>.
              Después puedes agregar más rutas al mismo tiro desde{' '}
              <a href="/dispatches" className="underline">/dispatches</a>.
            </>
          )}
        </div>
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
          subtitle={
            searchQuery || verifiedFilter !== 'all'
              ? `${selectedStores.size} seleccionadas · ${visibleStores.length} visibles de ${zoneStores.length}`
              : `${selectedStores.size} de ${zoneStores.length} seleccionadas`
          }
          empty="No hay tiendas activas en esta zona."
          isEmpty={zoneStores.length === 0}
          onSelectAll={() => {
            // Selecciona los VISIBLES (después de filtros), agregándolos a la
            // selección actual sin pisarla. Si quieres seleccionar solo los
            // visibles, primero "Limpiar" y después "Seleccionar visibles".
            setSelectedStores((prev) => {
              const next = new Set(prev);
              for (const s of visibleStores) next.add(s.id);
              return next;
            });
          }}
          selectAllLabel={
            searchQuery || verifiedFilter !== 'all' ? 'Seleccionar visibles' : 'Todos'
          }
          onClear={() => setSelectedStores(new Set())}
          disabled={pending}
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                placeholder="Buscar por código, nombre o dirección…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={pending}
                className="flex-1 min-w-[200px] rounded-[var(--radius-md)] border px-3 py-1.5 text-sm"
                style={{
                  background: 'var(--vf-surface-2)',
                  borderColor: 'var(--vf-line)',
                  color: 'var(--vf-text)',
                }}
              />
              <FilterChips
                value={verifiedFilter}
                onChange={setVerifiedFilter}
                disabled={pending}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPasteOpen(true);
                  setPasteResult(null);
                }}
                disabled={pending}
              >
                Pegar lista de códigos
              </Button>
            </div>
          }
        >
          {visibleStores.length === 0 ? (
            <p className="py-6 text-center text-sm" style={{ color: 'var(--vf-text-mute)' }}>
              Sin tiendas que coincidan con los filtros.
              {' '}
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setVerifiedFilter('all');
                }}
                className="underline hover:no-underline"
                style={{ color: 'var(--vf-text)' }}
              >
                Limpiar filtros
              </button>
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {visibleStores.map((s) => (
                <SelectChip
                  key={s.id}
                  selected={selectedStores.has(s.id)}
                  onClick={() => toggleStore(s.id)}
                  disabled={pending}
                  primary={s.code}
                  secondary={s.name}
                  badge={!s.coordVerified ? '⚠' : undefined}
                />
              ))}
            </div>
          )}
        </SelectorCard>

        {/* Modal paste-by-code: usuario pega lista del XLSX/Sheets y matcheamos. */}
        {pasteOpen && (
          <PasteCodesModal
            zoneCode={zones.find((z) => z.id === zoneId)?.code ?? ''}
            pasteText={pasteText}
            onChangeText={setPasteText}
            onApply={applyPaste}
            onClose={() => {
              setPasteOpen(false);
              setPasteText('');
              setPasteResult(null);
            }}
            result={pasteResult}
          />
        )}
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
  /** Override del label "Todos" — útil cuando el bulk opera sobre filtrados. */
  selectAllLabel?: string;
  /** Slot opcional debajo del header con buscadores/filters/acciones extra. */
  toolbar?: React.ReactNode;
}

function SelectorCard({
  title, subtitle, empty, isEmpty, onSelectAll, onClear, disabled, children,
  selectAllLabel = 'Todos', toolbar,
}: SelectorCardProps) {
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
              {selectAllLabel}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={disabled}>
              Ninguno
            </Button>
          </div>
        )}
      </div>
      {!isEmpty && toolbar && (
        <div
          className="border-b px-4 py-2.5"
          style={{ borderColor: 'var(--vf-line)', background: 'var(--vf-surface-2)' }}
        >
          {toolbar}
        </div>
      )}
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
  /** Indicador opcional a la derecha — para flag de coord_verified, etc. */
  badge?: string;
}

function SelectChip({ selected, onClick, disabled, primary, secondary, badge }: SelectChipProps) {
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
      {badge && (
        <span
          className="shrink-0 text-[11px]"
          style={{ color: 'var(--vf-warn-fg)' }}
          title="Coords sin verificar"
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// Filtros del SelectorCard de tiendas — toggle 3-estados (todas / verificadas
// / sin verificar) que se ajusta a coord_verified del store. Estilo segmented
// control compacto.
function FilterChips({
  value,
  onChange,
  disabled,
}: {
  value: 'all' | 'verified' | 'unverified';
  onChange: (v: 'all' | 'verified' | 'unverified') => void;
  disabled?: boolean;
}) {
  const opts: Array<{ key: 'all' | 'verified' | 'unverified'; label: string }> = [
    { key: 'all', label: 'Todas' },
    { key: 'verified', label: '✓ Verificadas' },
    { key: 'unverified', label: '⚠ Sin verificar' },
  ];
  return (
    <div
      className="inline-flex overflow-hidden rounded-[var(--radius-md)] border"
      style={{ borderColor: 'var(--vf-line)' }}
    >
      {opts.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            disabled={disabled}
            className="px-2.5 py-1.5 text-[11px] font-medium transition-colors"
            style={{
              background: active ? 'var(--vf-green-700)' : 'transparent',
              color: active ? 'white' : 'var(--vf-text-mute)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Modal para pegar lista de códigos (separados por coma, espacio, nuevas líneas).
// Útil para importar selección desde XLSX/Sheets ("aquí están los IDs que quiero").
function PasteCodesModal({
  zoneCode,
  pasteText,
  onChangeText,
  onApply,
  onClose,
  result,
}: {
  zoneCode: string;
  pasteText: string;
  onChangeText: (t: string) => void;
  onApply: () => void;
  onClose: () => void;
  result: { matched: number; missed: string[] } | null;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)]"
        style={{ background: 'var(--vf-bg-elev)', color: 'var(--vf-text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-6 py-4"
          style={{ borderBottom: '1px solid var(--vf-line)' }}
        >
          <h2 className="text-base font-semibold">Pegar lista de códigos</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--vf-text-mute)' }}>
            Pega códigos separados por coma, espacio o salto de línea. Acepta el
            código completo (<span className="font-mono">{zoneCode}-1550</span>) o
            solo el número (<span className="font-mono">1550</span>) — se le
            antepone <span className="font-mono">{zoneCode}-</span> automático.
          </p>
        </div>
        <div className="px-6 py-5">
          <textarea
            value={pasteText}
            onChange={(e) => onChangeText(e.target.value)}
            rows={8}
            placeholder={`Ej:\n1550, 582, 804\n${zoneCode}-1294 ${zoneCode}-805\n288`}
            className="w-full rounded-[var(--radius-md)] border px-3 py-2 font-mono text-sm"
            style={{
              background: 'var(--vf-surface-2)',
              borderColor: 'var(--vf-line)',
              color: 'var(--vf-text)',
            }}
            autoFocus
          />
          {result && (
            <div
              className="mt-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
              style={{
                background: result.missed.length === 0 ? 'var(--vf-ok-bg)' : 'var(--vf-warn-bg)',
                borderColor: result.missed.length === 0 ? 'var(--vf-ok-border)' : 'var(--vf-warn-border)',
                color: 'var(--vf-text)',
              }}
            >
              <p>
                <strong>{result.matched}</strong> tienda{result.matched === 1 ? '' : 's'}{' '}
                agregada{result.matched === 1 ? '' : 's'} a la selección.
              </p>
              {result.missed.length > 0 && (
                <p className="mt-1" style={{ color: 'var(--vf-warn-fg)' }}>
                  No encontradas ({result.missed.length}):{' '}
                  <span className="font-mono">{result.missed.slice(0, 10).join(', ')}</span>
                  {result.missed.length > 10 && ` (+${result.missed.length - 10} más)`}
                </p>
              )}
            </div>
          )}
        </div>
        <div
          className="flex justify-end gap-2 rounded-b-[var(--radius-lg)] px-6 py-3"
          style={{ borderTop: '1px solid var(--vf-line)', background: 'var(--vf-bg-sub)' }}
        >
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onApply}
            disabled={pasteText.trim().length === 0}
          >
            Aplicar
          </Button>
        </div>
      </div>
    </div>
  );
}

'use client';

// Form compartido para crear/editar vehículos, con botón "Sugerir con IA"
// que llama a /api/vehicles/ai-enrich y rellena los specs.

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
  Badge,
  toast,
} from '@tripdrive/ui';
import type { Depot, Zone, Vehicle } from '@tripdrive/types';

interface AiEnrichResult {
  make: string | null;
  model: string | null;
  year: number | null;
  engine_size_l: number | null;
  fuel_consumption_l_per_100km: number | null;
  capacity_weight_kg: number | null;
  capacity_volume_m3: number | null;
  capacity_boxes_estimate: number | null;
  notes: string | null;
  confidence: 'high' | 'medium' | 'low';
}

interface Props {
  mode: 'create' | 'edit';
  zones: Zone[];
  depots: Depot[];
  initial?: Vehicle;
  /** Action server: para create recibe solo formData; para edit ya viene bound al id. */
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  /** Texto del botón submit. */
  submitLabel: string;
  /** Callback al éxito (cerrar modal, redirect, etc). */
  onSuccess?: () => void;
}

export function VehicleForm({
  mode,
  zones,
  depots,
  initial,
  action,
  submitLabel,
  onSuccess,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Form state controlled — necesario para que el AI button pueda llenar.
  const [plate, setPlate] = useState(initial?.plate ?? '');
  const [alias, setAlias] = useState(initial?.alias ?? '');
  const [zoneId, setZoneId] = useState(initial?.zoneId ?? '');
  const [capacityWeight, setCapacityWeight] = useState(
    initial?.capacity[0] ?? 3500,
  );
  const [capacityVolume, setCapacityVolume] = useState(
    initial?.capacity[1] ?? 20,
  );
  const [capacityBoxes, setCapacityBoxes] = useState(
    initial?.capacity[2] ?? 200,
  );
  const [depotId, setDepotId] = useState(initial?.depotId ?? '');
  const [depotLat, setDepotLat] = useState<string>(
    initial?.depotLat != null ? String(initial.depotLat) : '',
  );
  const [depotLng, setDepotLng] = useState<string>(
    initial?.depotLng != null ? String(initial.depotLng) : '',
  );
  const [make, setMake] = useState(initial?.make ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [year, setYear] = useState<string>(
    initial?.year != null ? String(initial.year) : '',
  );
  const [engineSizeL, setEngineSizeL] = useState<string>(
    initial?.engineSizeL != null ? String(initial.engineSizeL) : '',
  );
  const [fuelConsumption, setFuelConsumption] = useState<string>(
    initial?.fuelConsumptionLPer100km != null
      ? String(initial.fuelConsumptionLPer100km)
      : '',
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');

  // AI enrichment
  const [aiDescription, setAiDescription] = useState('');
  const [aiPending, setAiPending] = useState(false);
  const [aiResult, setAiResult] = useState<AiEnrichResult | null>(null);

  const activeZones = zones.filter((z) => z.isActive);
  const depotsForZone = useMemo(
    () => depots.filter((d) => d.isActive && d.zoneId === zoneId),
    [depots, zoneId],
  );

  useEffect(() => {
    if (!zoneId) return;
    if (depotsForZone.length === 1 && !depotId) {
      setDepotId(depotsForZone[0]!.id);
    }
  }, [zoneId, depotsForZone, depotId]);

  async function runAiEnrich() {
    const d = aiDescription.trim();
    if (d.length < 3) return;
    setAiPending(true);
    setAiResult(null);
    try {
      const res = await fetch('/api/vehicles/ai-enrich', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: d }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? 'IA falló');
        return;
      }
      const body = (await res.json()) as { ok: boolean; data: AiEnrichResult };
      setAiResult(body.data);
      toast.success('Sugerencias listas — revisa antes de guardar.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setAiPending(false);
    }
  }

  function applyAi() {
    if (!aiResult) return;
    if (aiResult.make) setMake(aiResult.make);
    if (aiResult.model) setModel(aiResult.model);
    if (aiResult.year) setYear(String(aiResult.year));
    if (aiResult.engine_size_l != null) setEngineSizeL(String(aiResult.engine_size_l));
    if (aiResult.fuel_consumption_l_per_100km != null) {
      setFuelConsumption(String(aiResult.fuel_consumption_l_per_100km));
    }
    if (aiResult.capacity_weight_kg != null) setCapacityWeight(aiResult.capacity_weight_kg);
    if (aiResult.capacity_volume_m3 != null) setCapacityVolume(aiResult.capacity_volume_m3);
    if (aiResult.capacity_boxes_estimate != null) {
      setCapacityBoxes(aiResult.capacity_boxes_estimate);
    }
    if (aiResult.notes && !notes) setNotes(aiResult.notes);
    if (!alias && aiResult.make && aiResult.model) {
      setAlias(`${aiResult.make} ${aiResult.model}${aiResult.year ? ` ${aiResult.year}` : ''}`);
    }
    setAiResult(null);
    setAiDescription('');
    toast.success('Campos actualizados con la sugerencia.');
  }

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const res = await action(formData);
          if (res.ok) {
            toast.success(mode === 'create' ? 'Camión registrado' : 'Cambios guardados');
            onSuccess?.();
          } else {
            setError(res.error ?? 'Error al guardar');
          }
        });
      }}
      className="flex flex-col gap-5"
    >
      {/* AI enrichment card — destacada arriba */}
      <Card
        className="border-[var(--vf-green-600)]"
        style={{ background: 'color-mix(in oklch, var(--vf-bg-elev) 90%, var(--vf-green-500) 10%)' }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--vf-text)' }}>
              ✨ Sugerir specs con IA
            </h3>
            <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--vf-text-mute)' }}>
              Describe el camión (ej. &quot;Nissan NV200 2020&quot; o &quot;Tortón Isuzu NPR diésel
              8t&quot;). Claude sugiere capacidad, motor, consumo y notas — tú revisas
              antes de guardar.
            </p>
          </div>
        </div>

        <div className="mt-2 flex gap-2">
          <Input
            value={aiDescription}
            onChange={(e) => setAiDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void runAiEnrich();
              }
            }}
            placeholder="Nissan NV200 2020"
            disabled={aiPending || pending}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void runAiEnrich()}
            disabled={aiPending || pending || aiDescription.trim().length < 3}
          >
            {aiPending ? '⏳' : 'Sugerir'}
          </Button>
        </div>

        {aiResult && (
          <div
            className="mt-3 rounded-[var(--radius-md)] border p-3"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--vf-bg-elev)',
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <Badge
                tone={
                  aiResult.confidence === 'high'
                    ? 'success'
                    : aiResult.confidence === 'medium'
                      ? 'warning'
                      : 'neutral'
                }
              >
                Confianza: {aiResult.confidence}
              </Badge>
              <span className="text-[11px]" style={{ color: 'var(--vf-text-mute)' }}>
                {aiResult.make ?? '—'} {aiResult.model ?? '—'} {aiResult.year ?? ''}
              </span>
            </div>
            <ul
              className="ml-1 mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]"
              style={{ color: 'var(--color-text)' }}
            >
              {aiResult.engine_size_l != null && (
                <li>Motor: {aiResult.engine_size_l}L</li>
              )}
              {aiResult.fuel_consumption_l_per_100km != null && (
                <li>Consumo: {aiResult.fuel_consumption_l_per_100km}L/100km</li>
              )}
              {aiResult.capacity_weight_kg != null && (
                <li>Peso máx: {aiResult.capacity_weight_kg} kg</li>
              )}
              {aiResult.capacity_volume_m3 != null && (
                <li>Volumen: {aiResult.capacity_volume_m3} m³</li>
              )}
              {aiResult.capacity_boxes_estimate != null && (
                <li>Cajas: ~{aiResult.capacity_boxes_estimate}</li>
              )}
            </ul>
            {aiResult.notes && (
              <p
                className="mt-2 text-[11px] italic"
                style={{ color: 'var(--vf-text-mute)' }}
              >
                {aiResult.notes}
              </p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAiResult(null)}
              >
                Descartar
              </Button>
              <Button type="button" size="sm" onClick={applyAi}>
                Aplicar al formulario
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Identidad */}
      <Section title="Identidad">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Placa" htmlFor="plate" required hint="Mayúsculas, ej: ABC-123-A">
            <Input
              id="plate"
              name="plate"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              required
              maxLength={16}
              autoFocus={mode === 'create'}
              disabled={pending}
            />
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
          <Field label="Color" htmlFor="alias" hint="Ej: Roja, Azul, Verde — los choferes la identifican por color">
            <Input
              id="alias"
              name="alias"
              value={alias ?? ''}
              onChange={(e) => setAlias(e.target.value)}
              maxLength={60}
              disabled={pending}
            />
          </Field>
        </div>
      </Section>

      {/* Marca y modelo */}
      <Section title="Marca, modelo y motor">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Marca" htmlFor="make">
            <Input
              id="make"
              name="make"
              value={make ?? ''}
              onChange={(e) => setMake(e.target.value)}
              maxLength={40}
              placeholder="Nissan"
              disabled={pending}
            />
          </Field>
          <Field label="Modelo" htmlFor="model">
            <Input
              id="model"
              name="model"
              value={model ?? ''}
              onChange={(e) => setModel(e.target.value)}
              maxLength={60}
              placeholder="NV200"
              disabled={pending}
            />
          </Field>
          <Field label="Año" htmlFor="year">
            <Input
              id="year"
              name="year"
              type="number"
              min={1990}
              max={2100}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2020"
              disabled={pending}
            />
          </Field>
          <Field label="Motor (L)" htmlFor="engine_size_l">
            <Input
              id="engine_size_l"
              name="engine_size_l"
              type="number"
              step="0.1"
              min={0.5}
              max={20}
              value={engineSizeL}
              onChange={(e) => setEngineSizeL(e.target.value)}
              placeholder="1.6"
              disabled={pending}
            />
          </Field>
          <Field
            label="Consumo (L/100km)"
            htmlFor="fuel_consumption_l_per_100km"
            hint="Ciudad + carretera mixto"
            className="md:col-span-2"
          >
            <Input
              id="fuel_consumption_l_per_100km"
              name="fuel_consumption_l_per_100km"
              type="number"
              step="0.1"
              min={1}
              max={100}
              value={fuelConsumption}
              onChange={(e) => setFuelConsumption(e.target.value)}
              placeholder="9.5"
              disabled={pending}
            />
          </Field>
        </div>
      </Section>

      {/* Capacidad */}
      <Section title="Capacidad multidimensional (usada por el optimizador)">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Peso (kg)" htmlFor="capacity_weight" required>
            <Input
              id="capacity_weight"
              name="capacity_weight"
              type="number"
              min={1}
              max={100000}
              value={capacityWeight}
              onChange={(e) => setCapacityWeight(Number(e.target.value))}
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
              value={capacityVolume}
              onChange={(e) => setCapacityVolume(Number(e.target.value))}
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
              value={capacityBoxes}
              onChange={(e) => setCapacityBoxes(Number(e.target.value))}
              required
              disabled={pending}
            />
          </Field>
        </div>
      </Section>

      {/* CEDIS */}
      <Section title="Punto de salida / regreso">
        <Field label="CEDIS / Hub" htmlFor="depot_id" hint="Default: CEDIS de la zona">
          <Select
            id="depot_id"
            name="depot_id"
            value={depotId ?? ''}
            onChange={(e) => setDepotId(e.target.value)}
            disabled={pending || !zoneId}
          >
            <option value="">
              {!zoneId
                ? 'Selecciona una zona primero'
                : depotsForZone.length === 0
                  ? 'Sin CEDIS en esta zona — usar coords manuales'
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
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Latitud depósito" htmlFor="depot_lat" hint="Override manual">
              <Input
                id="depot_lat"
                name="depot_lat"
                type="number"
                step="0.000001"
                min={-90}
                max={90}
                value={depotLat}
                onChange={(e) => setDepotLat(e.target.value)}
                disabled={pending}
              />
            </Field>
            <Field label="Longitud depósito" htmlFor="depot_lng">
              <Input
                id="depot_lng"
                name="depot_lng"
                type="number"
                step="0.000001"
                min={-180}
                max={180}
                value={depotLng}
                onChange={(e) => setDepotLng(e.target.value)}
                disabled={pending}
              />
            </Field>
          </div>
        )}
      </Section>

      {/* Notas */}
      <Section title="Notas">
        <Field label="Notas" htmlFor="notes" hint="Comentarios libres (mantenimiento, condición, etc.)">
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            value={notes ?? ''}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            disabled={pending}
          />
        </Field>
      </Section>

      {error && (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border px-3 py-2 text-sm"
          style={{
            borderColor: 'var(--color-danger-border, #fecaca)',
            background: 'var(--color-danger-bg, #fef2f2)',
            color: 'var(--color-danger-fg, #991b1b)',
          }}
        >
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" variant="primary" isLoading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend
        className="mb-3 text-[10.5px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--vf-text-mute)' }}
      >
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

// Queries de vehicles. Server-only.
// Capacidad multidimensional: [peso_kg, volumen_m3, cajas].

import 'server-only';
import { createServerClient } from '@tripdrive/supabase/server';
import type { TableUpdate } from '@tripdrive/supabase';
import type { Vehicle, VehicleStatus } from '@tripdrive/types';
import { isSandboxMode } from '@/lib/workbench-mode';

interface VehicleRow {
  id: string;
  plate: string;
  alias: string | null;
  zone_id: string;
  capacity: number[];
  depot_id: string | null;
  depot_lat: number | null;
  depot_lng: number | null;
  status: VehicleStatus;
  is_active: boolean;
  created_at: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine_size_l: number | null;
  fuel_consumption_l_per_100km: number | null;
  notes: string | null;
}

const VEHICLE_COLS =
  'id, plate, alias, zone_id, capacity, depot_id, depot_lat, depot_lng, status, is_active, created_at, make, model, year, engine_size_l, fuel_consumption_l_per_100km, notes';

function toVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    plate: row.plate,
    alias: row.alias,
    zoneId: row.zone_id,
    capacity: row.capacity,
    depotId: row.depot_id,
    depotLat: row.depot_lat,
    depotLng: row.depot_lng,
    status: row.status,
    isActive: row.is_active,
    createdAt: row.created_at,
    make: row.make,
    model: row.model,
    year: row.year,
    engineSizeL: row.engine_size_l !== null ? Number(row.engine_size_l) : null,
    fuelConsumptionLPer100km:
      row.fuel_consumption_l_per_100km !== null
        ? Number(row.fuel_consumption_l_per_100km)
        : null,
    notes: row.notes,
  };
}

export async function listVehicles(opts?: {
  zoneId?: string;
  activeOnly?: boolean;
  /** ADR-112: en modo real filtra is_sandbox=false; en sandbox no filtra
   * (devuelve flotilla real + hipotéticos). */
  sandbox?: boolean;
}): Promise<Vehicle[]> {
  const supabase = await createServerClient();
  let q = supabase.from('vehicles').select(VEHICLE_COLS).order('plate');
  if (opts?.zoneId) q = q.eq('zone_id', opts.zoneId);
  if (opts?.activeOnly) q = q.eq('is_active', true);

  const sandbox = opts?.sandbox ?? (await isSandboxMode());
  if (!sandbox) q = q.eq('is_sandbox', false);

  const { data, error } = await q;
  if (error) throw new Error(`[vehicles.list] ${error.message}`);
  return (data ?? []).map(toVehicle);
}

export async function getVehiclesByIds(ids: string[]): Promise<Vehicle[]> {
  if (ids.length === 0) return [];
  const supabase = await createServerClient();
  const { data, error } = await supabase.from('vehicles').select(VEHICLE_COLS).in('id', ids);
  if (error) throw new Error(`[vehicles.getByIds] ${error.message}`);
  return (data ?? []).map(toVehicle);
}

interface CreateVehicleInput {
  plate: string;
  alias?: string | null;
  zoneId: string;
  capacity: number[];
  depotId?: string | null;
  depotLat?: number | null;
  depotLng?: number | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  engineSizeL?: number | null;
  fuelConsumptionLPer100km?: number | null;
  notes?: string | null;
}

export async function createVehicle(input: CreateVehicleInput): Promise<Vehicle> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      plate: input.plate,
      alias: input.alias ?? null,
      zone_id: input.zoneId,
      capacity: input.capacity,
      depot_id: input.depotId ?? null,
      depot_lat: input.depotLat ?? null,
      depot_lng: input.depotLng ?? null,
      status: 'available',
      make: input.make ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      engine_size_l: input.engineSizeL ?? null,
      fuel_consumption_l_per_100km: input.fuelConsumptionLPer100km ?? null,
      notes: input.notes ?? null,
    })
    .select(VEHICLE_COLS)
    .single();

  if (error) throw new Error(`[vehicles.create] ${error.message}`);
  return toVehicle(data as unknown as VehicleRow);
}

interface UpdateVehicleInput {
  plate?: string;
  alias?: string | null;
  zoneId?: string;
  capacity?: number[];
  depotId?: string | null;
  depotLat?: number | null;
  depotLng?: number | null;
  status?: VehicleStatus;
  isActive?: boolean;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  engineSizeL?: number | null;
  fuelConsumptionLPer100km?: number | null;
  notes?: string | null;
}

export async function updateVehicle(id: string, input: UpdateVehicleInput): Promise<Vehicle> {
  const supabase = await createServerClient();
  const update: TableUpdate<'vehicles'> = {};
  if (input.plate !== undefined) update.plate = input.plate;
  if (input.alias !== undefined) update.alias = input.alias;
  if (input.zoneId !== undefined) update.zone_id = input.zoneId;
  if (input.capacity !== undefined) update.capacity = input.capacity;
  if (input.depotId !== undefined) update.depot_id = input.depotId;
  if (input.depotLat !== undefined) update.depot_lat = input.depotLat;
  if (input.depotLng !== undefined) update.depot_lng = input.depotLng;
  if (input.status !== undefined) update.status = input.status;
  if (input.isActive !== undefined) update.is_active = input.isActive;
  if (input.make !== undefined) update.make = input.make;
  if (input.model !== undefined) update.model = input.model;
  if (input.year !== undefined) update.year = input.year;
  if (input.engineSizeL !== undefined) update.engine_size_l = input.engineSizeL;
  if (input.fuelConsumptionLPer100km !== undefined)
    update.fuel_consumption_l_per_100km = input.fuelConsumptionLPer100km;
  if (input.notes !== undefined) update.notes = input.notes;

  const { data, error } = await supabase
    .from('vehicles')
    .update(update)
    .eq('id', id)
    .select(VEHICLE_COLS)
    .single();

  if (error) throw new Error(`[vehicles.update] ${error.message}`);
  return toVehicle(data as unknown as VehicleRow);
}

export async function getVehicle(id: string): Promise<Vehicle | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('vehicles')
    .select(VEHICLE_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`[vehicles.get] ${error.message}`);
  return data ? toVehicle(data as unknown as VehicleRow) : null;
}

// Camión / vehículo de reparto.
// La capacidad es un array para soportar múltiples dimensiones (peso, volumen, cajas).

export type VehicleStatus = 'available' | 'in_route' | 'maintenance' | 'inactive';

export interface Vehicle {
  id: string;
  plate: string;
  alias: string | null;
  zoneId: string;
  // Capacidad multidimensional. Convención: [peso_kg, volumen_m3, cajas].
  capacity: number[];
  /**
   * FK opcional a depots(id). Si está set, el optimizer usa las coords del depot
   * y los depotLat/depotLng del vehículo se ignoran.
   */
  depotId: string | null;
  // Override per-vehículo de coords del depot. Solo se usa si depotId es null.
  depotLat: number | null;
  depotLng: number | null;
  status: VehicleStatus;
  isActive: boolean;
  createdAt: string;
}

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
  // Punto de partida y retorno (depósito). Si null, usa el del cliente.
  depotLat: number | null;
  depotLng: number | null;
  status: VehicleStatus;
  isActive: boolean;
  createdAt: string;
}

// CEDIS / Hub. Punto físico desde donde los vehículos salen y regresan en una ruta.
// Una zona puede tener uno o varios CEDIS. Cada vehículo se asigna opcionalmente a un CEDIS.

export interface Depot {
  id: string;
  zoneId: string;
  /** Código corto único en la zona (ej. VLLJ, AZCA). */
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

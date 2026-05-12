// Tienda destino de entrega. Pertenece a una zona dentro del cliente.

export interface Store {
  id: string;
  code: string;
  name: string;
  zoneId: string;
  address: string;
  lat: number;
  lng: number;
  contactName: string | null;
  contactPhone: string | null;
  // Ventana horaria preferida para recibir entregas (formato HH:MM, hora local del tenant).
  receivingWindowStart: string | null;
  receivingWindowEnd: string | null;
  // Tiempo estimado de servicio en la tienda (segundos).
  serviceTimeSeconds: number;
  // Demanda multidimensional típica de esta tienda. Se compara contra Vehicle.capacity.
  // Convención: [peso_kg, volumen_m3, cajas]. Default: [100, 1, 5].
  // En el futuro puede ser dinámica por pedido del día (Fase 5+).
  demand: number[];
  isActive: boolean;
  // Si las coords (lat/lng) son ground truth (CSV cliente, validación manual,
  // geocoding ROOFTOP) o aproximadas (geocoding APPROXIMATE, fallback). ADR-042.
  coordVerified: boolean;
  createdAt: string;
}

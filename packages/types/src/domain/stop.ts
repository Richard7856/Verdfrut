// Parada = una visita planeada a una tienda dentro de una ruta.
// Su orden viene del optimizador (sequence) y puede ser modificado por el dispatcher.

export type StopStatus =
  | 'pending'       // Aún no visitada
  | 'arrived'       // Chofer marcó llegada, no ha completado el reporte
  | 'completed'     // Reporte enviado y resuelto
  | 'skipped';      // Saltada (chofer/dispatcher decidió no visitar)

export interface Stop {
  id: string;
  routeId: string;
  storeId: string;
  // Orden de visita en la ruta (1-indexed).
  sequence: number;
  status: StopStatus;
  // ETA del optimizador.
  plannedArrivalAt: string | null;
  plannedDepartureAt: string | null;
  // Timestamps reales.
  actualArrivalAt: string | null;
  actualDepartureAt: string | null;
  // Carga asignada a esta parada (en las dimensiones de capacidad del vehículo).
  load: number[];
  notes: string | null;
  createdAt: string;
}

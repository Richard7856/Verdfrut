// Ruta = plan de entregas que un camión ejecutará en un día.
// Pasa por una máquina de estados estricta. Las modificaciones post-PUBLISHED crean nuevas versiones.

export type RouteStatus =
  | 'DRAFT'         // Dispatcher seleccionando paradas/camiones
  | 'OPTIMIZED'     // Optimizer corrió, esperando aprobación humana
  | 'APPROVED'      // Aprobada, lista para publicar
  | 'PUBLISHED'     // Enviada al chofer (recibió push)
  | 'IN_PROGRESS'   // Chofer empezó la primera parada
  | 'INTERRUPTED'   // Avería del camión / accidente. Paradas pendientes transferidas a otra ruta. (S18.7)
  | 'COMPLETED'     // Todas las paradas reportadas
  | 'CANCELLED';    // Cancelada por dispatcher

export interface Route {
  id: string;
  name: string;
  // Fecha operativa (YYYY-MM-DD en hora local del tenant).
  date: string;
  vehicleId: string;
  driverId: string | null;
  zoneId: string;
  status: RouteStatus;
  version: number;
  // Métricas del optimizador (rellenadas en OPTIMIZED).
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  estimatedStartAt: string | null;
  estimatedEndAt: string | null;
  // Timestamps reales (rellenados en ejecución).
  actualStartAt: string | null;
  actualEndAt: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Tiro al que pertenece (nullable para rutas huérfanas). ADR-024. */
  dispatchId: string | null;
  /**
   * Override del depot de salida para esta ruta (ADR-047).
   * Si NULL, se usa vehicle.depotId. Si NOT NULL, manda sobre el depot del vehículo
   * para que la misma camioneta pueda salir de un CEDIS distinto en cada ruta.
   */
  depotOverrideId: string | null;
  /**
   * TRUE si la ruta se aprobó/publicó desde DRAFT sin pasar por VROOM (ADR-108).
   * El dispatcher decidió que el orden manual era suficiente. El chofer recibió
   * las paradas con métricas haversine en vez de optimizer real. Se usa para:
   * — badge UI "✋ Manual" vs "🤖 Optimizada" (UXR-2, ADR-110).
   * — aviso en driver app para que el chofer sepa que la secuencia es manual.
   * — KPI `% rutas manuales` por mes en /reports (UXR-3, ADR-110).
   */
  optimizationSkipped: boolean;
}

export interface RouteVersion {
  id: string;
  routeId: string;
  version: number;
  reason: string;
  createdBy: string;
  createdAt: string;
}

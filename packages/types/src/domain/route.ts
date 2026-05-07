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
}

export interface RouteVersion {
  id: string;
  routeId: string;
  version: number;
  reason: string;
  createdBy: string;
  createdAt: string;
}

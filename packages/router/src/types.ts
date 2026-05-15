// Tipos compartidos del package router.
// Mantener mínimos: el clustering / asignación no debe acoplarse a Stop o
// Vehicle de la BD; cualquier entidad con lat/lng/id puede entrar.

/** Punto geográfico identificable. Subconjunto suficiente para clustering. */
export interface GeoPoint {
  id: string;
  lat: number;
  lng: number;
}

/** Vehículo con depot — suficiente para asignación. */
export interface RouterVehicle {
  id: string;
  depot: { lat: number; lng: number };
}

/** Resultado del clustering: array de clusters, cada uno con sus stops. */
export type Cluster<T extends GeoPoint> = T[];

/** Asignación cluster → vehicle. Map<vehicleId, stops>. */
export type Assignment<T extends GeoPoint> = Map<string, Cluster<T>>;

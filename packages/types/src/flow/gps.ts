// Payload del canal Realtime Broadcast `gps:{routeId}`.
// El chofer publica posición, los listeners (encargado de zona, panel logístico) reciben.

export interface GpsPosition {
  driverId: string;
  routeId: string;
  lat: number;
  lng: number;
  speed: number | null;       // m/s, null si no disponible
  heading: number | null;     // grados 0-360, null si no disponible
  accuracy: number | null;    // metros
  ts: string;                 // ISO timestamp
}

// Breadcrumb persistido en DB para análisis post-hoc (NO el stream live).
export interface RouteBreadcrumb {
  id: string;
  routeId: string;
  driverId: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  recordedAt: string;
}

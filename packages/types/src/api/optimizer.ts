// Contratos del servicio FastAPI + VROOM (services/optimizer).
// Estos tipos los usa el wrapper en apps/platform que llama al optimizador.

export interface OptimizerVehicle {
  id: number;
  capacity: number[];
  start: [number, number];          // [lng, lat] convención GeoJSON
  end: [number, number];
  time_window: [number, number];    // [unix_start, unix_end]
}

export interface OptimizerJob {
  id: number;
  location: [number, number];       // [lng, lat]
  service: number;                  // segundos en parada
  time_windows: Array<[number, number]>;
  amount: number[];
}

export interface OptimizerMatrix {
  durations: number[][];            // segundos
  distances: number[][];            // metros
}

export interface OptimizerRequest {
  vehicles: OptimizerVehicle[];
  jobs: OptimizerJob[];
  matrix?: OptimizerMatrix;
}

export interface OptimizerStep {
  job_id: number;
  arrival: number;                  // unix timestamp
  departure: number;
  load: number[];
}

export interface OptimizerRoute {
  vehicle_id: number;
  steps: OptimizerStep[];
  distance: number;
  duration: number;
  cost: number;
}

export interface OptimizerUnassigned {
  job_id: number;
  reason: string;
}

export interface OptimizerSummary {
  total_distance: number;
  total_duration: number;
  total_cost: number;
}

export interface OptimizerResponse {
  routes: OptimizerRoute[];
  unassigned: OptimizerUnassigned[];
  summary: OptimizerSummary;
}

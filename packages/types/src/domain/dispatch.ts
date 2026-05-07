// Tiro (dispatch) — agrupador operativo de N rutas. ADR-024.

export type DispatchStatus = 'planning' | 'dispatched' | 'completed' | 'cancelled';

export interface Dispatch {
  id: string;
  name: string;
  /** Fecha operativa en hora local del tenant (no UTC). */
  date: string;
  zoneId: string;
  status: DispatchStatus;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

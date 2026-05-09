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
  /**
   * ADR-046: token UUID para enlace público read-only en /share/dispatch/{token}.
   * NULL = compartir deshabilitado.
   */
  publicShareToken: string | null;
}

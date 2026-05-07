// Mensaje del chat entre chofer y encargado de zona.
// Vinculado a un reporte (cada reporte que pasa a 'submitted' abre un chat).

export type MessageSender = 'driver' | 'zone_manager' | 'system';

/**
 * Estado del chat asociado a un report.
 * 'open' al primer mensaje; transiciona a 'driver_resolved' / 'manager_resolved'
 * cuando alguno cierra; o 'timed_out' si pasaron 20 min sin cierre.
 * NULL si nadie ha abierto el chat aún.
 */
export type ChatStatus = 'open' | 'driver_resolved' | 'manager_resolved' | 'timed_out';

export interface ChatMessage {
  id: string;
  reportId: string;
  sender: MessageSender;
  senderUserId: string | null;
  text: string | null;
  imageUrl: string | null;
  createdAt: string;
}

/**
 * Snapshot del estado del chat de un report — útil para queries del chat thread.
 */
export interface ChatState {
  reportId: string;
  status: ChatStatus | null;
  openedAt: string | null;
  timeoutAt: string | null;
  resolvedAt: string | null;
}

export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  role: string;
  zoneId: string | null;
  createdAt: string;
}

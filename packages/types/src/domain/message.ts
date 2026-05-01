// Mensaje del chat entre chofer y encargado de zona.
// Vinculado a un reporte (cada reporte que pasa a 'submitted' abre un chat).

export type MessageSender = 'driver' | 'zone_manager' | 'system';

export interface ChatMessage {
  id: string;
  reportId: string;
  sender: MessageSender;
  senderUserId: string | null;
  text: string | null;
  imageUrl: string | null;
  createdAt: string;
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

// Reporte de una parada. Equivalente al "reporte" del prototipo Verdefrut Driver
// pero ahora ligado a una stop dentro de una route.

import type { ChatStatus } from './message';

export type ReportType =
  | 'entrega'           // Flujo largo de entrega exitosa
  | 'tienda_cerrada'    // Tienda cerrada al llegar
  | 'bascula';          // Problema con báscula al recibir

export type ReportStatus =
  | 'draft'                 // En proceso, chofer aún no envió
  | 'submitted'             // Enviado a encargado de zona, en chat
  | 'resolved_by_driver'    // Chofer marcó como resuelto
  | 'timed_out'             // Pasaron 20 min sin resolución
  | 'completed'             // Encargado cerró el chat
  | 'archived';

export type ResolutionType = 'completa' | 'parcial' | 'sin_entrega' | 'timed_out';

export type IncidentType =
  | 'rechazo'      // Tienda rechaza producto
  | 'faltante'     // Falta producto vs lo que el chofer trae
  | 'sobrante'     // Sobra producto vs lo que la tienda esperaba
  | 'devolucion';  // Devolución de producto previo

export interface IncidentDetail {
  productId?: string;
  productName: string;
  type: IncidentType;
  quantity: number;
  unit: string;
  notes?: string;
}

export interface TicketData {
  numero: string | null;
  fecha: string | null;
  total: number | null;
  items: TicketItem[];
  confidence: number;
}

export interface TicketItem {
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  total: number | null;
}

export interface DeliveryReport {
  id: string;
  stopId: string;
  routeId: string;
  driverId: string;
  zoneId: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  type: ReportType;
  status: ReportStatus;
  // Paso actual del flujo (para recuperar si la app se cierra).
  currentStep: string;
  // URLs de imágenes en Storage.
  evidence: Record<string, string>;
  // Datos extraídos del recibo principal.
  ticketData: TicketData | null;
  ticketImageUrl: string | null;
  ticketExtractionConfirmed: boolean;
  // Datos extraídos del ticket de merma.
  returnTicketData: TicketData | null;
  returnTicketExtractionConfirmed: boolean;
  // Incidencias declaradas durante el flujo.
  incidentDetails: IncidentDetail[];
  // Resolución final del reporte.
  resolutionType: ResolutionType | null;
  partialFailureItems: IncidentDetail[] | null;
  // Razón si no hay recibo + foto opcional.
  noTicketReason: string | null;
  noTicketReasonPhotoUrl: string | null;
  // Otra incidencia descrita libremente.
  otherIncidentDescription: string | null;
  otherIncidentPhotoUrl: string | null;
  hasMerma: boolean;
  metadata: Record<string, unknown>;
  submittedAt: string | null;
  timeoutAt: string | null;
  resolvedAt: string | null;
  // Sprint 11 / ADR-021: estado del chat asociado.
  // chatOpenedAt se setea por trigger DB al primer mensaje. Mientras es null,
  // el chat no ha sido abierto.
  chatOpenedAt: string | null;
  chatStatus: ChatStatus | null;
  createdAt: string;
}

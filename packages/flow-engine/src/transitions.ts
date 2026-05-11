// Transiciones del flujo de cada tipo de reporte.
// Cada función pura recibe el contexto y devuelve el siguiente paso.

import type { EntregaStep, TiendaCerradaStep, BasculaStep, ReportType } from '@tripdrive/types';

export interface FlowContext {
  hasIncidents?: boolean;
  hasMerma?: boolean;
  hasReceipt?: boolean;
  hasOtherIncident?: boolean;
  tiendaSeAbrio?: boolean;
}

export function nextEntregaStep(current: EntregaStep, ctx: FlowContext): EntregaStep | null {
  switch (current) {
    case 'arrival_exhibit':
      return 'incident_check';
    case 'incident_check':
      return ctx.hasIncidents ? 'incident_cart' : 'product_arranged';
    case 'incident_cart':
      // El cart redirige al chat — al volver, continúa en product_arranged.
      return 'product_arranged';
    case 'product_arranged':
      return 'waste_check';
    case 'waste_check':
      return ctx.hasMerma ? 'waste_ticket' : 'receipt_check';
    case 'waste_ticket':
      return 'waste_ticket_review';
    case 'waste_ticket_review':
      return 'receipt_check';
    case 'receipt_check':
      return ctx.hasReceipt ? 'receipt_upload' : 'no_receipt_reason';
    case 'receipt_upload':
      return 'receipt_review';
    case 'receipt_review':
      return 'other_incident_check';
    case 'no_receipt_reason':
      return 'other_incident_check';
    case 'other_incident_check':
      return ctx.hasOtherIncident ? 'other_incident' : 'finish';
    case 'other_incident':
      return 'finish';
    case 'finish':
      return null;
  }
}

export function nextTiendaCerradaStep(
  current: TiendaCerradaStep,
  ctx: FlowContext,
): TiendaCerradaStep | EntregaStep | null {
  switch (current) {
    case 'facade':
      return 'chat_redirect';
    case 'chat_redirect':
      return 'tienda_abierta_check';
    case 'tienda_abierta_check':
      // Si la tienda se abrió → conviértete en flujo entrega desde el principio.
      return ctx.tiendaSeAbrio ? 'arrival_exhibit' : 'finish';
    case 'finish':
      return null;
  }
}

export function nextBasculaStep(
  current: BasculaStep,
  ctx: FlowContext,
): BasculaStep | EntregaStep | null {
  switch (current) {
    case 'scale':
      return 'chat_redirect';
    case 'chat_redirect':
      return 'tienda_abierta_check';
    case 'tienda_abierta_check':
      return ctx.tiendaSeAbrio ? 'arrival_exhibit' : 'finish';
    case 'finish':
      return null;
  }
}

export function getInitialStep(type: ReportType): EntregaStep | TiendaCerradaStep | BasculaStep {
  switch (type) {
    case 'entrega':
      return 'arrival_exhibit';
    case 'tienda_cerrada':
      return 'facade';
    case 'bascula':
      return 'scale';
  }
}

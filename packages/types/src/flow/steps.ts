// Pasos de cada flujo de reporte. Replican la máquina del prototipo Verdefrut Driver.
// El paso actual se persiste en `delivery_reports.current_step` para resumir si la app se cierra.

// Pasos del flujo de ENTREGA.
export type EntregaStep =
  | 'arrival_exhibit'        // Foto del mueble a la llegada (DoubleEvidence)
  | 'incident_check'         // ¿Hubo incidencias? (sí → cart, no → 6)
  | 'incident_cart'          // Carrito de incidencias → chat
  | 'product_arranged'       // Foto del mueble acomodado (DoubleEvidence)
  | 'waste_check'            // ¿Hubo merma?
  | 'waste_ticket'           // Foto del ticket de merma
  | 'waste_ticket_review'    // Revisión IA del ticket de merma
  | 'receipt_check'          // ¿Hay foto del recibo?
  | 'receipt_upload'         // Subir recibo
  | 'receipt_review'         // Revisión IA del recibo
  | 'no_receipt_reason'      // Motivo de no tener recibo + foto opcional
  | 'other_incident_check'   // ¿Hubo otra incidencia?
  | 'other_incident'         // Descripción + foto opcional
  | 'finish';                // Submit del reporte

// Pasos del flujo TIENDA CERRADA.
export type TiendaCerradaStep =
  | 'facade'                 // Foto de fachada
  | 'chat_redirect'          // Inicia chat con encargado
  | 'tienda_abierta_check'   // Después del chat: ¿se abrió?
  | 'finish';                // Si no se abre, termina

// Pasos del flujo BASCULA.
export type BasculaStep =
  | 'scale'                  // Foto del problema con báscula
  | 'chat_redirect'
  | 'tienda_abierta_check'
  | 'finish';

export type FlowStep = EntregaStep | TiendaCerradaStep | BasculaStep;

// Tipo de evidencia esperada en cada paso (para validación y UI).
export type EvidenceKey =
  | 'arrival_exhibit'
  | 'arrival_exhibit_2'
  | 'product_arranged'
  | 'product_arranged_2'
  | 'ticket_recibido'
  | 'ticket_merma'
  | 'facade'
  | 'scale'
  | 'incident_photo'
  | 'no_ticket_reason_photo'
  | 'other_incident_photo';

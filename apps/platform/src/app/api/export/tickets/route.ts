// Export XLSX para ERP — Sprint 16 / ADR-029.
//
// Una sola llamada GET con ?from=&to=&zone= devuelve un archivo .xlsx con 4 hojas:
//   1. Tickets       — 1 fila por delivery_report con ticket
//   2. Items         — 1 fila por item de cualquier ticket (granular para inventario)
//   3. Devoluciones  — 1 fila por return_ticket
//   4. Incidentes    — 1 fila por incident_detail declarado por el chofer
//
// El cliente puede usar las 4 hojas o solo la que su ERP necesite (algunos solo
// quieren "Tickets", otros importan "Items" para reconciliar inventario).
//
// Auth: cookie de sesión (admin/dispatcher/zone_manager). zone_manager solo ve su zona
// (forzado en el query, RLS también filtra como red de seguridad).
//
// Por qué GET y no POST: los browsers gestionan automáticamente la descarga vía
// `Content-Disposition: attachment` cuando el usuario hace click en un <a href>.
// POST requeriría JS adicional para crear un blob y un anchor sintético.

import { NextResponse, type NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { requireRole } from '@/lib/auth';
import { getExportReports, type ExportReport } from '@/lib/queries/dashboard';

// Cap defensivo: una exportación gigantesca puede agotar memoria del server.
// 10K reportes ≈ 1 año de un cliente medio (5 zonas × ~6 reportes/día × 365).
const MAX_REPORTS = 10_000;

const TYPE_LABEL: Record<ExportReport['type'], string> = {
  entrega: 'Entrega',
  tienda_cerrada: 'Tienda cerrada',
  bascula: 'Báscula',
};

export async function GET(req: NextRequest): Promise<Response> {
  const profile = await requireRole('admin', 'dispatcher', 'zone_manager');

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
    return NextResponse.json(
      { error: 'Parámetros from/to requeridos en formato YYYY-MM-DD' },
      { status: 400 },
    );
  }

  // Defensa en profundidad: zone_manager forzado a su zona aunque mande otra
  const zoneId =
    profile.role === 'zone_manager' ? profile.zoneId ?? null : url.searchParams.get('zone') || null;

  const reports = await getExportReports({ from, to, zoneId });
  if (reports.length > MAX_REPORTS) {
    return NextResponse.json(
      {
        error: `Demasiados reportes (${reports.length}). Limita el rango — máximo ${MAX_REPORTS} por export.`,
      },
      { status: 413 },
    );
  }

  const workbook = await buildWorkbook(reports);
  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `verdfrut-tickets-${from}-${to}.xlsx`;

  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}

async function buildWorkbook(reports: ExportReport[]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TripDrive';
  wb.created = new Date();

  // -- Hoja 1: Tickets (resumen, 1 fila por reporte con ticket) ---------------
  const tickets = wb.addWorksheet('Tickets');
  tickets.columns = [
    { header: 'Fecha reporte', key: 'createdAt', width: 18 },
    { header: 'Fecha ruta', key: 'routeDate', width: 12 },
    { header: 'Tipo', key: 'type', width: 14 },
    { header: 'Estado', key: 'status', width: 16 },
    { header: 'Tienda código', key: 'storeCode', width: 14 },
    { header: 'Tienda nombre', key: 'storeName', width: 32 },
    { header: 'Ruta', key: 'routeName', width: 24 },
    { header: 'Chofer', key: 'driverName', width: 24 },
    { header: 'Ticket #', key: 'ticketNumber', width: 14 },
    { header: 'Ticket fecha', key: 'ticketDate', width: 12 },
    { header: 'Ticket total', key: 'ticketTotal', width: 14, style: { numFmt: '"$"#,##0.00' } },
    { header: '# Items', key: 'numItems', width: 8 },
    { header: 'Devolución total', key: 'returnTotal', width: 14, style: { numFmt: '"$"#,##0.00' } },
    { header: '# Incidentes', key: 'numIncidents', width: 12 },
    { header: 'Merma', key: 'hasMerma', width: 8 },
  ];

  for (const r of reports) {
    tickets.addRow({
      createdAt: r.createdAt,
      routeDate: r.routeDate,
      type: TYPE_LABEL[r.type],
      status: r.status,
      storeCode: r.storeCode,
      storeName: r.storeName,
      routeName: r.routeName,
      driverName: r.driverName ?? '',
      ticketNumber: r.ticketNumber ?? '',
      ticketDate: r.ticketDate ?? '',
      ticketTotal: r.ticketTotal ?? null,
      numItems: r.ticketItems.length,
      returnTotal: r.returnTicketTotal ?? null,
      numIncidents: r.incidents.length,
      hasMerma: r.hasMerma ? 'Sí' : '',
    });
  }
  styleHeader(tickets);

  // -- Hoja 2: Items (granular, para reconciliación de inventario) -----------
  const items = wb.addWorksheet('Items');
  items.columns = [
    { header: 'Fecha reporte', key: 'createdAt', width: 18 },
    { header: 'Tienda código', key: 'storeCode', width: 14 },
    { header: 'Tienda nombre', key: 'storeName', width: 32 },
    { header: 'Ticket #', key: 'ticketNumber', width: 14 },
    { header: 'Descripción', key: 'description', width: 40 },
    { header: 'Cantidad', key: 'quantity', width: 10 },
    { header: 'Unidad', key: 'unit', width: 10 },
    { header: 'Precio unitario', key: 'unitPrice', width: 14, style: { numFmt: '"$"#,##0.00' } },
    { header: 'Total', key: 'total', width: 14, style: { numFmt: '"$"#,##0.00' } },
  ];
  for (const r of reports) {
    for (const item of r.ticketItems) {
      items.addRow({
        createdAt: r.createdAt,
        storeCode: r.storeCode,
        storeName: r.storeName,
        ticketNumber: r.ticketNumber ?? '',
        description: item.description,
        quantity: item.quantity,
        unit: item.unit ?? '',
        unitPrice: item.unitPrice,
        total: item.total,
      });
    }
  }
  styleHeader(items);

  // -- Hoja 3: Devoluciones --------------------------------------------------
  const returns = wb.addWorksheet('Devoluciones');
  returns.columns = [
    { header: 'Fecha reporte', key: 'createdAt', width: 18 },
    { header: 'Tienda código', key: 'storeCode', width: 14 },
    { header: 'Tienda nombre', key: 'storeName', width: 32 },
    { header: 'Devolución #', key: 'returnNumber', width: 14 },
    { header: 'Devolución total', key: 'returnTotal', width: 14, style: { numFmt: '"$"#,##0.00' } },
    { header: 'Descripción', key: 'description', width: 40 },
    { header: 'Cantidad', key: 'quantity', width: 10 },
    { header: 'Unidad', key: 'unit', width: 10 },
    { header: 'Precio unitario', key: 'unitPrice', width: 14, style: { numFmt: '"$"#,##0.00' } },
    { header: 'Total línea', key: 'total', width: 14, style: { numFmt: '"$"#,##0.00' } },
  ];
  for (const r of reports) {
    if (!r.returnTicketTotal && r.returnTicketItems.length === 0) continue;
    if (r.returnTicketItems.length === 0) {
      // Devolución sin items detallados — al menos exportamos el total
      returns.addRow({
        createdAt: r.createdAt,
        storeCode: r.storeCode,
        storeName: r.storeName,
        returnNumber: r.returnTicketNumber ?? '',
        returnTotal: r.returnTicketTotal,
      });
      continue;
    }
    for (const item of r.returnTicketItems) {
      returns.addRow({
        createdAt: r.createdAt,
        storeCode: r.storeCode,
        storeName: r.storeName,
        returnNumber: r.returnTicketNumber ?? '',
        returnTotal: r.returnTicketTotal,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit ?? '',
        unitPrice: item.unitPrice,
        total: item.total,
      });
    }
  }
  styleHeader(returns);

  // -- Hoja 4: Incidentes (rechazos/faltantes/sobrantes/devoluciones manuales) -
  const incidents = wb.addWorksheet('Incidentes');
  incidents.columns = [
    { header: 'Fecha reporte', key: 'createdAt', width: 18 },
    { header: 'Tienda código', key: 'storeCode', width: 14 },
    { header: 'Tienda nombre', key: 'storeName', width: 32 },
    { header: 'Producto', key: 'productName', width: 32 },
    { header: 'Tipo', key: 'type', width: 14 },
    { header: 'Cantidad', key: 'quantity', width: 10 },
    { header: 'Unidad', key: 'unit', width: 10 },
    { header: 'Notas', key: 'notes', width: 40 },
  ];
  for (const r of reports) {
    for (const inc of r.incidents) {
      incidents.addRow({
        createdAt: r.createdAt,
        storeCode: r.storeCode,
        storeName: r.storeName,
        productName: inc.productName,
        type: inc.type,
        quantity: inc.quantity,
        unit: inc.unit,
        notes: inc.notes ?? '',
      });
    }
  }
  styleHeader(incidents);

  return wb;
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

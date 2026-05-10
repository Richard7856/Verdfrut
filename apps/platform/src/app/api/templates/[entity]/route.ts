// Endpoints que devuelven plantillas CSV para bulk import.
//
// El admin descarga el CSV con headers correctos + 1-2 filas de ejemplo,
// rellena en Excel/Sheets, y (en el futuro) lo sube de regreso para import.
//
// Por ahora solo descarga: el upload + parser + validación es trabajo de otro sprint.
// Esto desbloquea al admin para preparar datos en bulk antes de tener el importador.

import 'server-only';
import { requireRole } from '@/lib/auth';

interface Template {
  filename: string;
  headers: string[];
  rows: string[][];
  notes: string;
}

const TEMPLATES: Record<string, Template> = {
  stores: {
    filename: 'plantilla-tiendas.csv',
    headers: [
      'code',
      'name',
      'zone_code',
      'address',
      'lat',
      'lng',
      'contact_name',
      'contact_phone',
      'receiving_window_start',
      'receiving_window_end',
      'service_time_seconds',
      'demand_weight_kg',
      'demand_volume_m3',
      'demand_boxes',
    ],
    rows: [
      [
        'CDMX-001',
        'Tienda Centro',
        'CDMX',
        'Av. Insurgentes Sur 123, Roma Norte',
        '19.420000',
        '-99.165000',
        'Juan Pérez',
        '+525512345678',
        '07:00',
        '11:00',
        '900',
        '50',
        '1',
        '5',
      ],
      [
        'CDMX-002',
        'Tienda Polanco',
        'CDMX',
        'Av. Presidente Masaryk 250, Polanco',
        '19.432000',
        '-99.197000',
        '',
        '',
        '08:00',
        '12:00',
        '600',
        '30',
        '1',
        '3',
      ],
    ],
    notes:
      '# Tiendas — TripDrive\n# zone_code debe coincidir con un código de zona existente.\n# Coordenadas dentro de México (lat 14.3-32.8, lng -118.7 a -86.5).\n# Ventanas en HH:MM 24h hora local del tenant.\n# service_time_seconds: tiempo estimado por parada.\n# demand_*: demanda multidimensional para el optimizador (peso/volumen/cajas).\n',
  },

  vehicles: {
    filename: 'plantilla-camiones.csv',
    headers: [
      'plate',
      'alias',
      'zone_code',
      'depot_code',
      'capacity_weight_kg',
      'capacity_volume_m3',
      'capacity_boxes',
    ],
    rows: [
      ['ABC-123-A', 'Kangoo 1', 'CDMX', 'VLLJ', '650', '3', '40'],
      ['DEF-456-B', 'Kangoo 2', 'CDMX', 'VLLJ', '650', '3', '40'],
    ],
    notes:
      '# Camiones — TripDrive\n# zone_code y depot_code deben existir previamente.\n# Si depot_code está vacío, el camión sale del default de la zona.\n# Capacidad multidimensional [peso_kg, volumen_m3, cajas].\n',
  },

  users: {
    filename: 'plantilla-usuarios.csv',
    headers: ['email', 'full_name', 'role', 'zone_code', 'phone', 'license_number'],
    rows: [
      [
        'admin@cliente.com',
        'María Hernández',
        'admin',
        '',
        '+525511112222',
        '',
      ],
      [
        'logistica@cliente.com',
        'Carlos Ramírez',
        'dispatcher',
        '',
        '+525511113333',
        '',
      ],
      [
        'encargado.cdmx@cliente.com',
        'Ana López',
        'zone_manager',
        'CDMX',
        '+525511114444',
        '',
      ],
      [
        'chofer1@cliente.com',
        'Roberto Sánchez',
        'driver',
        'CDMX',
        '+525511115555',
        'ABC-DEF-12345',
      ],
    ],
    notes:
      '# Usuarios — TripDrive\n# Roles válidos: admin, dispatcher, zone_manager, driver.\n# zone_code obligatorio para zone_manager y driver. Vacío para admin/dispatcher.\n# license_number solo aplica a drivers.\n# Cada usuario recibirá email con link para establecer contraseña.\n',
  },

  depots: {
    filename: 'plantilla-cedis.csv',
    headers: [
      'code',
      'name',
      'zone_code',
      'address',
      'lat',
      'lng',
      'contact_name',
      'contact_phone',
      'notes',
    ],
    rows: [
      [
        'VLLJ',
        'CEDIS Vallejo',
        'CDMX',
        'Av. de las Granjas 401, Vallejo, GAM',
        '19.488000',
        '-99.156000',
        'Encargado CEDIS',
        '+525500000000',
        'Andén principal',
      ],
    ],
    notes:
      '# CEDIS — TripDrive\n# zone_code debe coincidir con un código de zona existente.\n# code es único por zona. Ej: VLLJ, AZCA, ECTA.\n# Coordenadas dentro de México.\n',
  },
};

/**
 * Convierte filas a CSV con escape correcto:
 * - Comillas dobles si el valor contiene `,`, `"`, salto de línea.
 * - `"` interno se escapa como `""`.
 */
function toCsv(headers: string[], rows: string[][]): string {
  const escape = (val: string) => {
    if (/[",\n\r]/.test(val)) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }
  return lines.join('\n') + '\n';
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  // Solo admin puede descargar plantillas — incluyen estructura interna.
  await requireRole('admin');
  const { entity } = await params;
  const tpl = TEMPLATES[entity];
  if (!tpl) {
    return new Response(`Plantilla "${entity}" no existe`, { status: 404 });
  }

  const body = tpl.notes + toCsv(tpl.headers, tpl.rows);
  // BOM UTF-8 para que Excel/Sheets lo abra con encoding correcto.
  const bom = '﻿';

  return new Response(bom + body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${tpl.filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

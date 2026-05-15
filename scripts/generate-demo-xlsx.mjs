#!/usr/bin/env node
// Genera un XLSX de prueba para el flow /stores/import.
// Mix de direcciones buenas, dudosas, y una mala — para que el demo
// muestre los 3 estados (verde/amarillo/rojo).

import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const out = path.resolve(path.dirname(__filename), 'test-data', 'demo-stores-import.xlsx');

const rows = [
  ['name', 'address'],
  ['NETO Reforma', 'Av Reforma 222, CDMX'],
  ['NETO Insurgentes Sur', 'Av Insurgentes Sur 1235, Del Valle, 03100 CDMX'],
  ['NETO Coyoacán', 'Av Universidad 1000, Coyoacán, 04510 CDMX'],
  ['NETO Tlalpan', 'Calz de Tlalpan 3000, Coyoacán, 04610 CDMX'],
  ['NETO Mixcoac', 'Av Patriotismo 580, Mixcoac, 03910 CDMX'],
  ['NETO San Ángel', 'Av Revolución 1267, San Ángel, 01000 CDMX'],
  ['NETO Iztapalapa', 'Av División del Norte 2800, Iztapalapa, 09310 CDMX'],
  ['NETO Centro Histórico', 'Calle 5 de Mayo 17, Centro, 06000 CDMX'],
  ['NETO Polanco', 'Av Ejército Nacional 980, Polanco, 11560 CDMX'],
  ['NETO Tacuba', 'Av Aquiles Serdán 900, Tacuba, 11410 CDMX'],
  // Direcciones más genéricas — probable que caigan en GEOMETRIC_CENTER/APPROXIMATE → amarillo
  ['NETO Sur General', 'colonia Doctores CDMX'],
  ['NETO Centro Sin Calle', 'Centro de la ciudad CDMX'],
  // Direcciones malas — probable ZERO_RESULTS → rojo
  ['Tienda Inexistente', 'xyzzy abc nunca jamás 999'],
  ['Sin Dirección', ''],
];

const wb = new ExcelJS.Workbook();
const sheet = wb.addWorksheet('Tiendas');
for (const r of rows) sheet.addRow(r);
sheet.columns = [{ width: 28 }, { width: 60 }];

await wb.xlsx.writeFile(out);
console.log(`✅ Escrito: ${out}`);
console.log(`   ${rows.length - 1} filas (1 header + ${rows.length - 1} datos)`);

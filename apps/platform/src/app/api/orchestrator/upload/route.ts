// Endpoint upload de adjuntos del orquestador AI.
// POST multipart con `file` y opcional `session_id`. Procesa el archivo
// server-side (xlsx → exceljs) y persiste en orchestrator_attachments.
//
// Tamaño máximo: 5MB binario. CHECK constraint en BD valida 6MB en base64.

import 'server-only';
import { requireAdminOrDispatcher } from '@/lib/auth';
import { createServerClient, createServiceRoleClient } from '@tripdrive/supabase/server';
import ExcelJS from 'exceljs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BINARY_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const profile = await requireAdminOrDispatcher();

  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: 'multipart/form-data requerido' }, { status: 400 });

  const file = form.get('file');
  const sessionIdRaw = form.get('session_id');
  const sessionId = typeof sessionIdRaw === 'string' && sessionIdRaw ? sessionIdRaw : null;

  if (!file || typeof file === 'string') {
    return Response.json({ error: 'campo `file` requerido' }, { status: 400 });
  }

  if (file.size === 0) {
    return Response.json({ error: 'archivo vacío' }, { status: 400 });
  }
  if (file.size > MAX_BINARY_BYTES) {
    return Response.json(
      { error: `archivo excede ${MAX_BINARY_BYTES / 1024 / 1024} MB` },
      { status: 413 },
    );
  }

  const mime = file.type || 'application/octet-stream';
  const filename = (file.name ?? 'sin-nombre').slice(0, 200);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Decide kind por mime + extensión.
  const lower = filename.toLowerCase();
  let kind: 'xlsx' | 'csv' | 'image' | 'other' = 'other';
  if (lower.endsWith('.xlsx') || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    kind = 'xlsx';
  } else if (lower.endsWith('.csv') || mime === 'text/csv') {
    kind = 'csv';
  } else if (mime.startsWith('image/')) {
    kind = 'image';
  }

  // Parse según kind. Si falla, guardamos parse_error y dejamos content_base64
  // para retry futuro o diagnosis manual.
  let parsedData: unknown = null;
  let parseError: string | null = null;

  if (kind === 'xlsx') {
    try {
      parsedData = await parseXlsx(buffer);
    } catch (err) {
      parseError = err instanceof Error ? err.message : 'Error parseando xlsx.';
    }
  } else if (kind === 'csv') {
    try {
      parsedData = parseCsv(buffer.toString('utf8'));
    } catch (err) {
      parseError = err instanceof Error ? err.message : 'Error parseando csv.';
    }
  }

  // Validar session si viene.
  if (sessionId) {
    const sessionClient = await createServerClient();
    const { data: existing } = await sessionClient
      .from('orchestrator_sessions')
      .select('id, user_id, state')
      .eq('id', sessionId)
      .maybeSingle();
    if (!existing) {
      return Response.json({ error: 'session_id no existe' }, { status: 404 });
    }
    if (existing.user_id !== profile.id) {
      return Response.json({ error: 'no eres dueño de esa sesión' }, { status: 403 });
    }
  }

  const admin = createServiceRoleClient();
  // Resolver customer_id del invitador (trigger lo llenaría con el rol service_role
  // que no tiene auth.uid; lo pasamos explícito).
  const sessionClient = await createServerClient();
  const { data: callerProfile } = await sessionClient
    .from('user_profiles')
    .select('customer_id')
    .eq('id', profile.id)
    .single();
  const customerId = callerProfile?.customer_id as string | undefined;
  if (!customerId) {
    return Response.json({ error: 'customer_id no resuelto' }, { status: 500 });
  }

  const { data, error } = await admin
    .from('orchestrator_attachments')
    .insert({
      customer_id: customerId,
      session_id: sessionId,
      user_id: profile.id,
      kind,
      filename,
      mime_type: mime,
      size_bytes: file.size,
      content_base64: buffer.toString('base64'),
      parsed_data: parsedData as never,
      parse_error: parseError,
    })
    .select('id, kind, filename, size_bytes')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    attachment_id: data.id,
    kind: data.kind,
    filename: data.filename,
    size_bytes: data.size_bytes,
    parsed_ok: parseError === null,
    parse_error: parseError,
  });
}

interface ParsedXlsxSheet {
  name: string;
  headers: string[];
  rows: Array<Record<string, string | number | null>>;
  row_count: number;
}

interface ParsedXlsx {
  sheets: ParsedXlsxSheet[];
}

async function parseXlsx(buffer: Buffer): Promise<ParsedXlsx> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets: ParsedXlsxSheet[] = [];
  workbook.eachSheet((worksheet) => {
    // Header: primera fila no vacía.
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      const v = String(cell.value ?? '').trim();
      headers[colNumber - 1] = v || `col_${colNumber}`;
    });

    const rows: Array<Record<string, string | number | null>> = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      const r: Record<string, string | number | null> = {};
      headers.forEach((h, i) => {
        const cell = row.getCell(i + 1);
        const v = cell.value;
        if (v === null || v === undefined || v === '') {
          r[h] = null;
        } else if (typeof v === 'object' && 'result' in v) {
          // Formula cell.
          const result = (v as { result: unknown }).result;
          r[h] = typeof result === 'number' ? result : String(result ?? '');
        } else if (typeof v === 'number') {
          r[h] = v;
        } else {
          r[h] = String(v).trim();
        }
      });
      // Saltar filas totalmente vacías.
      const hasData = Object.values(r).some((val) => val !== null && val !== '');
      if (hasData) rows.push(r);
    });

    sheets.push({
      name: worksheet.name,
      headers,
      rows: rows.slice(0, 500), // hard cap para no explotar JSONB
      row_count: rows.length,
    });
  });

  return { sheets };
}

function parseCsv(text: string): ParsedXlsx {
  // CSV parser minimal (sin escape de comas dentro de quotes complejas).
  // exceljs también soporta csv pero esto evita dependencias extras.
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { sheets: [] };
  const headers = splitCsvLine(lines[0]!);
  const rows: Array<Record<string, string | number | null>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!);
    const r: Record<string, string | number | null> = {};
    headers.forEach((h, idx) => {
      const v = cols[idx];
      r[h] = v === undefined || v === '' ? null : v;
    });
    rows.push(r);
  }
  return {
    sheets: [
      {
        name: 'sheet1',
        headers,
        rows: rows.slice(0, 500),
        row_count: rows.length,
      },
    ],
  };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        buf += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf.trim());
  return out;
}

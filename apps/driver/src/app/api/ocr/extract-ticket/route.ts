// API route para extraer datos de un ticket via Claude Vision.
// ADR-022. Server-side porque ANTHROPIC_API_KEY es secret.
//
// Flow:
//   1. Cliente: POST { reportId, kind: 'receipt' | 'waste' }
//   2. Server: lee la URL desde delivery_reports.evidence (RLS aplica)
//   3. Server: llama extractTicketFromImageUrl
//   4. Server: persiste en ticket_data | return_ticket_data
//   5. Server: responde { ok: true, data: TicketData }
//
// La persistencia inmediata simplifica la UX:
// - El chofer puede hacer back/forward sin perder la extracción.
// - Si re-entra al step, el cliente lee el report y muestra el form pre-poblado
//   sin volver a llamar Anthropic.
//
// Errores que clasifico explícitamente:
//   400 — body inválido o kind desconocido
//   404 — report no existe o sin acceso (RLS)
//   422 — no hay imagen subida para ese kind
//   502 — Anthropic devolvió garbage o timeout (cliente puede reintentar)

import { NextResponse } from 'next/server';
import { createServerClient } from '@verdfrut/supabase/server';
import { extractTicketFromImageUrl } from '@verdfrut/ai';
import type { TicketData } from '@verdfrut/types';
import { consume, LIMITS } from '@/lib/rate-limit';

interface RequestBody {
  reportId?: string;
  kind?: 'receipt' | 'waste';
}

// Map kind → (evidence slot key, target column).
const KIND_MAP: Record<'receipt' | 'waste', { slot: string; column: 'ticket_data' | 'return_ticket_data' }> = {
  receipt: { slot: 'ticket_recibido', column: 'ticket_data' },
  waste: { slot: 'ticket_merma', column: 'return_ticket_data' },
};

export async function POST(req: Request): Promise<NextResponse> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const reportId = body.reportId;
  const kind = body.kind;
  if (!reportId || !kind || !(kind in KIND_MAP)) {
    return NextResponse.json({ ok: false, error: 'reportId y kind requeridos' }, { status: 400 });
  }
  const { slot, column } = KIND_MAP[kind];

  const supabase = await createServerClient();

  // Auth + rate limit por usuario (ADR-023 / #46).
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!consume(userData.user.id, 'ocr', LIMITS.ocr)) {
    return NextResponse.json(
      { ok: false, error: 'Demasiados intentos. Espera un momento e intenta de nuevo.' },
      { status: 429 },
    );
  }

  // RLS: solo el chofer dueño (o el zone_manager de la zona) ve el report.
  const { data: report, error: readErr } = await supabase
    .from('delivery_reports')
    .select('id, evidence')
    .eq('id', reportId)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  }
  if (!report) {
    return NextResponse.json({ ok: false, error: 'Report no encontrado' }, { status: 404 });
  }

  const evidence = (report.evidence ?? {}) as Record<string, string>;
  const imageUrl = evidence[slot];
  if (!imageUrl) {
    return NextResponse.json(
      { ok: false, error: `No hay imagen subida en slot "${slot}"` },
      { status: 422 },
    );
  }

  let extracted: TicketData;
  try {
    extracted = await extractTicketFromImageUrl(imageUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `OCR falló: ${msg}` }, { status: 502 });
  }

  // Persistir en la columna correspondiente. El cliente NO necesita volver a
  // llamar `patchReport` para guardar — esta route ya lo hizo.
  const updatePayload =
    column === 'ticket_data'
      ? { ticket_data: extracted as unknown as never }
      : { return_ticket_data: extracted as unknown as never };
  const { error: upErr } = await supabase
    .from('delivery_reports')
    .update(updatePayload)
    .eq('id', reportId);
  if (upErr) {
    return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: extracted });
}

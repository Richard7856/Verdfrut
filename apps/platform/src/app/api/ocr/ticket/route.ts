// Proxy OCR — recibe { imageUrl } del driver-native app, valida JWT,
// llama a Claude Vision via @tripdrive/ai y devuelve TicketData.
//
// Razón para que este endpoint exista (ADR-079):
//   ANTHROPIC_API_KEY NO debe estar en el bundle de la app nativa (es trivial
//   extraerla). El proxy mantiene la key en server-side y autentica vía
//   Supabase JWT del chofer.
//
// Rate-limit: aplica el helper existente `tripdrive_rate_limit_check` (ADR-054)
// para que ningún chofer haga más de 30 OCRs/hora (no debería ocurrir en
// operación legítima — más que eso huele a abuso o bug).

import 'server-only';
import { createJwtClient } from '@tripdrive/supabase/server';
import { extractTicketFromImageUrl } from '@tripdrive/ai';

const OCR_RATE_LIMIT_KEY = 'ocr-ticket';
const OCR_RATE_LIMIT_MAX = 30;
const OCR_RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hora

export async function POST(req: Request) {
  // 1. Validar API key del proveedor en env.
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY no está configurada en el servidor.' },
      { status: 503 },
    );
  }

  // 2. Extraer JWT del header Authorization.
  const authHeader = req.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const jwt = match?.[1];
  if (!jwt) {
    return Response.json({ error: 'Falta header Authorization Bearer.' }, { status: 401 });
  }

  // 3. Validar JWT con Supabase via helper que inyecta Authorization header.
  let supabase;
  try {
    supabase = createJwtClient(jwt);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Servidor mal configurado.' },
      { status: 503 },
    );
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData.user) {
    return Response.json({ error: 'JWT inválido o expirado.' }, { status: 401 });
  }
  const userId = userData.user.id;

  // 4. Confirmar que el user es un chofer (anti-abuse: dispatchers/admins
  // no deberían usar este endpoint, tienen el web).
  const { data: driverRow } = await supabase
    .from('drivers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!driverRow) {
    return Response.json({ error: 'Solo choferes pueden usar OCR del ticket.' }, { status: 403 });
  }

  // 5. Rate limit por user_id.
  const { data: rateLimitOk } = await supabase.rpc('tripdrive_rate_limit_check', {
    p_bucket_key: `${OCR_RATE_LIMIT_KEY}:${userId}`,
    p_max_hits: OCR_RATE_LIMIT_MAX,
    p_window_seconds: OCR_RATE_LIMIT_WINDOW_SECONDS,
  });
  if (rateLimitOk === false) {
    return Response.json(
      { error: `Demasiados OCRs. Máx ${OCR_RATE_LIMIT_MAX}/hora.` },
      { status: 429 },
    );
  }

  // 6. Parsear body.
  let body: { imageUrl?: unknown };
  try {
    body = (await req.json()) as { imageUrl?: unknown };
  } catch {
    return Response.json({ error: 'Body inválido — esperaba JSON.' }, { status: 400 });
  }
  if (typeof body.imageUrl !== 'string' || !body.imageUrl.startsWith('http')) {
    return Response.json(
      { error: 'imageUrl debe ser una URL http(s) válida.' },
      { status: 400 },
    );
  }

  // 7. Extraer ticket. extractTicketFromImageUrl ya maneja retries internos.
  try {
    const ticket = await extractTicketFromImageUrl(body.imageUrl, { apiKey: anthropicKey });
    return Response.json(ticket);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/ocr/ticket]', message);
    return Response.json({ error: `OCR falló: ${message}` }, { status: 502 });
  }
}

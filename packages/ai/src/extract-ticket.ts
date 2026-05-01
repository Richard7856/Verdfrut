// Extracción de datos estructurados de un ticket/recibo usando Claude Vision.
// Diseñado para correr en Route Handlers (server-side).

import Anthropic from '@anthropic-ai/sdk';
import type { TicketData } from '@verdfrut/types';

const MODEL = 'claude-sonnet-4-6';
const MAX_RETRIES = 2;
const FETCH_TIMEOUT_MS = 30_000;
const SDK_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `Eres un extractor de datos de tickets/recibos de mercancía en español mexicano.
Recibes una imagen de un ticket. Devuelves SIEMPRE un JSON válido con este schema exacto:
{
  "numero": string | null,
  "fecha": "YYYY-MM-DD" | null,
  "total": number | null,
  "items": [
    { "description": string, "quantity": number | null, "unit": string | null,
      "unitPrice": number | null, "total": number | null }
  ],
  "confidence": number   // 0..1, qué tan seguro estás de la extracción
}
Reglas:
- Si no puedes leer un campo, usa null. NO inventes.
- Fechas siempre en formato ISO YYYY-MM-DD.
- Números siempre como números, no strings.
- NO incluyas explicaciones — solo el JSON.`;

interface ExtractTicketOptions {
  apiKey?: string;
}

/**
 * Extrae datos estructurados de un ticket a partir de su URL pública.
 * Falla rápido si la imagen no se puede descargar (timeout 30s).
 */
export async function extractTicketFromImageUrl(
  imageUrl: string,
  options: ExtractTicketOptions = {},
): Promise<TicketData> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('[ai] ANTHROPIC_API_KEY no está definida');

  const { base64, mediaType } = await fetchImageAsBase64(imageUrl);

  const client = new Anthropic({ apiKey, timeout: SDK_TIMEOUT_MS });

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              },
              { type: 'text', text: 'Extrae los datos del ticket.' },
            ],
          },
        ],
      });

      const text = response.content
        .filter((c): c is Anthropic.TextBlock => c.type === 'text')
        .map((c) => c.text)
        .join('');

      return parseTicketJson(text);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) continue;
    }
  }

  throw new Error(
    `[ai] Falló extracción tras ${MAX_RETRIES + 1} intentos: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function fetchImageAsBase64(
  url: string,
): Promise<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mediaType = inferMediaType(res.headers.get('content-type'), url);
    return { base64: buf.toString('base64'), mediaType };
  } finally {
    clearTimeout(timeoutId);
  }
}

function inferMediaType(
  contentType: string | null,
  url: string,
): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('png')) return 'image/png';
  if (ct.includes('webp')) return 'image/webp';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'image/jpeg';
  if (url.endsWith('.png')) return 'image/png';
  if (url.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function parseTicketJson(text: string): TicketData {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('[ai] Respuesta no contiene JSON parseable');
  const parsed = JSON.parse(jsonMatch[0]) as TicketData;
  // Validación mínima — si Claude devolvió shape distinto, fallar fuerte.
  if (!('items' in parsed) || !Array.isArray(parsed.items)) {
    throw new Error('[ai] JSON parseado no tiene campo items[]');
  }
  return {
    numero: parsed.numero ?? null,
    fecha: parsed.fecha ?? null,
    total: parsed.total ?? null,
    items: parsed.items,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
  };
}

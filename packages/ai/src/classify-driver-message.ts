// Clasificador AI de mensajes del chofer en chat — S18.8.
//
// Caso de uso: choferes mandan reportes triviales (tráfico, manifestaciones,
// "ya voy", dudas básicas) que queman la atención del admin. AI clasifica el
// mensaje en:
//   - 'trivial': info-only, AI auto-responde, no escala al admin
//   - 'real_problem': escala al admin (push + chat normal)
//   - 'unknown': por seguridad, escala (sesgo a no perder reportes reales)
//
// Diseñado para correr server-side (route handlers / server actions). NUNCA
// exponer ANTHROPIC_API_KEY al cliente.
//
// Modelo: Claude Haiku — barato (~$0.001/mensaje) y rápido. La clasificación
// no requiere razonamiento complejo, lo importante es velocidad y costo.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 200;
const FETCH_TIMEOUT_MS = 15_000;

export type DriverMessageCategory = 'trivial' | 'real_problem' | 'unknown';

export interface ClassifyResult {
  category: DriverMessageCategory;
  /** Si trivial, respuesta automática a enviar al chofer. */
  autoReply: string | null;
  /** Confianza 0..1. */
  confidence: number;
  /** Razón corta para audit (qué pistas vio Claude). */
  rationale: string;
}

const SYSTEM_PROMPT = `Eres un clasificador de mensajes de choferes de reparto en México que reportan vía chat al supervisor.

Tu trabajo: clasificar cada mensaje en UNA de tres categorías y, si es trivial, redactar una respuesta automática breve y empática.

Categorías:
- "trivial": el chofer reporta algo que NO requiere intervención del supervisor. Tráfico, manifestaciones, retraso por causa común, "ya voy", "estoy cerca", saludos, dudas operativas básicas que la app resuelve sola.
- "real_problem": el chofer reporta algo que SÍ requiere intervención humana. Avería del camión, accidente, robo/asalto, tienda hostil, mercancía dañada, pago disputado, riesgo personal, conflicto serio con la tienda receptora, o cualquier situación que el chofer no puede resolver solo.
- "unknown": no estás seguro. Por seguridad, escalamos al supervisor (sesgo a no perder reportes reales).

Devuelve SIEMPRE un JSON con este schema exacto:
{
  "category": "trivial" | "real_problem" | "unknown",
  "autoReply": string | null,   // solo si trivial; null en otros casos
  "confidence": number,          // 0..1
  "rationale": string             // 1-2 frases sobre las pistas que viste
}

Reglas:
- Si autoReply, máximo 200 caracteres, tono empático y breve, español mexicano natural.
- Nunca incluyas la palabra "AI" o "bot" en autoReply (no queremos que el chofer sepa que es automático).
- Si CUALQUIER duda → 'unknown' (sesgo a la seguridad).
- NO incluyas explicaciones — solo el JSON.`;

const FEW_SHOT_USER = 'Mensaje: "hay tráfico denso en periférico, voy retrasado como 20 min"';
const FEW_SHOT_ASSISTANT = `{"category":"trivial","autoReply":"Entendido, gracias por avisar. Mantente seguro y avísanos si la situación cambia.","confidence":0.9,"rationale":"Reporte de tráfico estándar sin acción requerida del supervisor."}`;

const FEW_SHOT_USER_2 = 'Mensaje: "se me ponchó la llanta, no traigo refacción"';
const FEW_SHOT_ASSISTANT_2 = `{"category":"real_problem","autoReply":null,"confidence":0.95,"rationale":"Avería mecánica que impide continuar la ruta — requiere coordinación humana (auxilio o transferencia de paradas)."}`;

interface ClassifyOptions {
  apiKey?: string;
}

export async function classifyDriverMessage(
  text: string,
  options: ClassifyOptions = {},
): Promise<ClassifyResult> {
  if (!text || text.trim().length === 0) {
    return {
      category: 'unknown',
      autoReply: null,
      confidence: 0,
      rationale: 'Mensaje vacío o sin texto.',
    };
  }

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Sin API key → escalar a admin por seguridad. NO bloqueamos el chat.
    return {
      category: 'unknown',
      autoReply: null,
      confidence: 0,
      rationale: 'AI no configurada (ANTHROPIC_API_KEY missing). Escalando por seguridad.',
    };
  }

  const client = new Anthropic({
    apiKey,
    timeout: FETCH_TIMEOUT_MS,
  });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: FEW_SHOT_USER },
        { role: 'assistant', content: FEW_SHOT_ASSISTANT },
        { role: 'user', content: FEW_SHOT_USER_2 },
        { role: 'assistant', content: FEW_SHOT_ASSISTANT_2 },
        { role: 'user', content: `Mensaje: "${text.replace(/"/g, '\\"')}"` },
      ],
    });

    const block = response.content[0];
    if (!block || block.type !== 'text') {
      return {
        category: 'unknown',
        autoReply: null,
        confidence: 0,
        rationale: 'Respuesta de Claude sin texto.',
      };
    }

    // Claude a veces incluye texto extra antes/después del JSON. Extraer el JSON
    // buscando primer { y último }.
    const raw = block.text;
    const startIdx = raw.indexOf('{');
    const endIdx = raw.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1) {
      return {
        category: 'unknown',
        autoReply: null,
        confidence: 0,
        rationale: 'JSON no encontrado en respuesta de Claude.',
      };
    }
    const json = raw.slice(startIdx, endIdx + 1);
    const parsed = JSON.parse(json) as Partial<ClassifyResult>;

    // Validación defensiva
    const category: DriverMessageCategory =
      parsed.category === 'trivial' || parsed.category === 'real_problem'
        ? parsed.category
        : 'unknown';
    return {
      category,
      autoReply: typeof parsed.autoReply === 'string' ? parsed.autoReply : null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    };
  } catch (err) {
    // Cualquier error → escalar (sesgo a seguridad).
    return {
      category: 'unknown',
      autoReply: null,
      confidence: 0,
      rationale: `AI falló: ${err instanceof Error ? err.message : 'error desconocido'}`,
    };
  }
}

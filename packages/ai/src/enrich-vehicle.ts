// Enrichment de specs de vehículos comerciales mexicanos via Claude Haiku 4.5.
// Server-only — consume ANTHROPIC_API_KEY.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `Eres un experto en vehículos comerciales del mercado mexicano (pick-ups, vans, camiones ligeros de reparto).

El usuario va a describir un vehículo en lenguaje natural. Tu trabajo: devolver specs estructurados típicos del modelo.

Devuelve SIEMPRE un JSON con este schema EXACTO (puedes dejar campos como null si no hay info confiable):

{
  "make": "Nissan" | "Hyundai" | "Mitsubishi" | "Isuzu" | "Hino" | "Toyota" | "Ford" | "Chevrolet" | "Renault" | ...,
  "model": "NV200" | "H100" | "L200" | "NPR" | ...,
  "year": 2020,
  "engine_size_l": 1.6,
  "fuel_consumption_l_per_100km": 9.5,
  "capacity_weight_kg": 750,
  "capacity_volume_m3": 4.2,
  "capacity_boxes_estimate": 80,
  "notes": "Comentario corto útil (1 línea max) sobre la unidad, ej: 'Van diésel popular para reparto urbano CDMX'.",
  "confidence": "high" | "medium" | "low"
}

Reglas:
- Si el usuario no menciona año, usa "year": null.
- Para capacidad: usa los valores oficiales del fabricante. Para caja seca o estaca, considera carga útil máxima legal.
- Boxes estimate: asume cajas estándar de reparto (aprox 60x40x40 cm = 0.1 m³ + 15 kg). Calcula min(volumen/0.1, peso/15) y redondea.
- Fuel consumption: promedio mixto (ciudad + carretera). En mercado MX, vans 1.5-2.0L suelen ser 8-12 L/100km.
- confidence: "high" si el modelo es claramente identificable (ej. "Nissan NV200 2020"); "medium" si hay ambigüedad; "low" si la descripción es vaga.

NO inventes datos si no tienes confianza. Mejor null + confidence "low" que números inventados.

Responde SOLO con el JSON, sin texto adicional ni markdown.`;

export interface EnrichVehicleResult {
  make: string | null;
  model: string | null;
  year: number | null;
  engine_size_l: number | null;
  fuel_consumption_l_per_100km: number | null;
  capacity_weight_kg: number | null;
  capacity_volume_m3: number | null;
  capacity_boxes_estimate: number | null;
  notes: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface EnrichVehicleResponse {
  data: EnrichVehicleResult;
  tokens_in: number;
  tokens_out: number;
}

export async function enrichVehicleSpecs(
  description: string,
): Promise<EnrichVehicleResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada');

  const d = description.trim();
  if (d.length < 3) throw new Error('description mínima 3 chars');
  if (d.length > 500) throw new Error('description máx 500 chars');

  const anthropic = new Anthropic({ apiKey });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Vehículo a identificar: "${d}"\n\nDevuelve el JSON.`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('modelo no devolvió texto');
  }
  let raw = textBlock.text.trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let parsed: EnrichVehicleResult;
  try {
    parsed = JSON.parse(raw) as EnrichVehicleResult;
  } catch (err) {
    throw new Error(
      `Modelo devolvió JSON inválido: ${err instanceof Error ? err.message : 'parse error'}`,
    );
  }

  return {
    data: parsed,
    tokens_in: response.usage.input_tokens,
    tokens_out: response.usage.output_tokens,
  };
}

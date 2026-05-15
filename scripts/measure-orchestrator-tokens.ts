// Mide el tamaño del payload que el orchestrator envía a Anthropic API
// en cada turno: system prompt + tool definitions (name + description +
// input_schema). NO incluye historial conversacional ni tool_results.
//
// Aproximación de tokens: chars / 4 (regla estándar para inglés/español).
// Para conteo exacto usar tokenizer Anthropic — esto es suficiente para
// decidir si vale la pena partir en sub-agentes.

import { SYSTEM_PROMPT } from '../packages/orchestrator/src/prompts/system';
import { TOOLS } from '../packages/orchestrator/src/tools/registry';

interface ToolPayload {
  name: string;
  description: string;
  input_schema: unknown;
}

// Lo que efectivamente va a Anthropic API por cada tool.
const toolsPayload: ToolPayload[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

const systemChars = SYSTEM_PROMPT.length;
const toolsJson = JSON.stringify(toolsPayload, null, 2);
const toolsChars = toolsJson.length;

const totalChars = systemChars + toolsChars;
const tokenEstimate = Math.round(totalChars / 4);

console.log('═══ Orchestrator API payload (por turno, sin historial) ═══');
console.log();
console.log(`System prompt:          ${systemChars.toLocaleString()} chars`);
console.log(`Tool definitions (${toolsPayload.length}):  ${toolsChars.toLocaleString()} chars`);
console.log(`─────────────────────────`);
console.log(`Total:                  ${totalChars.toLocaleString()} chars`);
console.log(`Tokens (≈ chars/4):     ${tokenEstimate.toLocaleString()}`);
console.log();
console.log('═══ Breakdown por dominio ═══');
console.log();

// Agrupar por dominio inferido del nombre o "tags" implícitos.
const groups: Record<string, ToolPayload[]> = {
  geo: [],
  routing: [],
  dispatch: [],
  catalog: [],
  data: [],
  other: [],
};

for (const t of toolsPayload) {
  const n = t.name;
  if (n.includes('geocode') || n.includes('place') || n.includes('coord') || n === 'create_store') {
    groups.geo!.push(t);
  } else if (n.includes('optimize') || n.includes('route') || n.includes('sequence')) {
    groups.routing!.push(t);
  } else if (n.includes('dispatch') || n.includes('publish') || n.includes('cancel')) {
    groups.dispatch!.push(t);
  } else if (n.includes('search') || n.includes('list') || n.includes('get')) {
    groups.catalog!.push(t);
  } else if (n.includes('xlsx') || n.includes('bulk')) {
    groups.data!.push(t);
  } else {
    groups.other!.push(t);
  }
}

for (const [domain, ts] of Object.entries(groups)) {
  if (ts.length === 0) continue;
  const json = JSON.stringify(ts);
  const chars = json.length;
  const tokens = Math.round(chars / 4);
  console.log(`  ${domain.padEnd(10)} ${ts.length.toString().padStart(2)} tools  ${chars.toLocaleString().padStart(7)} chars  ~${tokens.toLocaleString().padStart(5)} tok`);
  for (const t of ts) console.log(`    · ${t.name}`);
}

console.log();
console.log('═══ Recomendación ═══');
console.log();
if (tokenEstimate < 4000) {
  console.log('< 4k tokens → monolítico está fino. Sub-agentes son over-engineering.');
} else if (tokenEstimate < 8000) {
  console.log('4k-8k tokens → zona gris. Sub-agentes mejoran calidad pero no son urgentes.');
} else if (tokenEstimate < 15000) {
  console.log('8k-15k tokens → empieza a justificarse partir. Si hay confusiones de tool-selection, hazlo.');
} else {
  console.log('> 15k tokens → urgente partir. El modelo está perdiendo foco con tantas tools.');
}

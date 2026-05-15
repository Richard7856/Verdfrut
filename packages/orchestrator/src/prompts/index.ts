// System prompts por rol de agente (Stream R, ROADMAP 2026-05-15).
//
// Sprint R1 (current): orchestrator tiene su prompt v1 completo (sin
// cambios vs antes). geo y router tienen STUBS defensivos — si alguien
// los invoca antes de R2/R3, el modelo responde explicando que el modo
// no está disponible aún. Esto previene que un caller con bug active un
// rol antes de tiempo y produzca outputs raros en producción.

import type { AgentRole } from '../types';
import { SYSTEM_PROMPT as ORCHESTRATOR_PROMPT } from './system';
import { GEO_SYSTEM_PROMPT } from './geo';
import { ROUTER_SYSTEM_PROMPT } from './router';

export const SYSTEM_PROMPTS: Record<AgentRole, string> = {
  orchestrator: ORCHESTRATOR_PROMPT,
  geo: GEO_SYSTEM_PROMPT, // R2 activo (2026-05-15)
  router: ROUTER_SYSTEM_PROMPT, // R3 activo (2026-05-15)
};

// Re-export legacy para callers que importen `SYSTEM_PROMPT` por nombre.
export { SYSTEM_PROMPT } from './system';

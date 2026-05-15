// @tripdrive/orchestrator — agente AI conversacional para ops logísticos.
// Server-only. NUNCA exponer al cliente (consume ANTHROPIC_API_KEY).

export * from './types';
export * from './runner';
export * from './confirmation';
export * from './previews';
export * from './tools/registry';
export { TOOLS_BY_ROLE, getRoleToolNames } from './tools/role-mapping';
export { SYSTEM_PROMPT, SYSTEM_PROMPTS } from './prompts';
// Stream R / Sprint R2: geo sub-agent runner. Expuesto por si callers
// externos (tests, scripts admin) lo quieren invocar fuera del flujo via
// `delegate_to_geo`. En producción se invoca solo desde la tool.
export { runGeoAgent } from './geo-runner';
export type { GeoAgentInput, GeoAgentOutput, GeoAgentToolCall } from './geo-runner';

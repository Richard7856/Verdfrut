// Tipos del orquestador AI — ADR-090 / Ola 2.
//
// Una Tool es la unidad de capacidad del agente: nombre + JSON schema de args
// + handler server-side que ejecuta la acción.
//
// Diseño anti-fallos (lecciones de agentes previos del user):
//   - args validados con JSON schema ANTES de ejecutar.
//   - tools `requires_confirmation` interrumpen el loop para que el user
//     apruebe explícito antes de ejecutar (writes destructivas).
//   - `is_write` separa reads (no cuentan al quota mensual) de writes.
//   - cada handler retorna shape estándar { ok, data, error } — el agente
//     SIEMPRE recibe un tool_result, nunca una excepción no manejada.

import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import type { Database } from '@tripdrive/supabase';

// Re-export para consumidores externos (apps/platform) que no tienen
// @anthropic-ai/sdk como dep directa.
export type AnthropicMessageParam = Anthropic.MessageParam;

/** JSON schema simplificado para parámetros de tool (subset de Anthropic API). */
export interface ToolParamSchema {
  type: 'object';
  properties: Record<string, ToolParamProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolParamProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: readonly string[];
  items?: ToolParamProperty;
  format?: string;
}

/**
 * Resultado estándar de un handler de tool.
 * El agente SIEMPRE recibe esto serializado como tool_result; nunca una
 * excepción no manejada que rompa el loop.
 */
export type ToolResult<T = unknown> =
  | { ok: true; data: T; summary?: string }
  | { ok: false; error: string; recoverable?: boolean };

/**
 * Contexto de ejecución que el runner pasa a cada handler.
 * Identifica al caller + customer para defensa en profundidad (aunque las
 * policies RLS ya filtran via service_role).
 */
export interface ToolContext {
  customerId: string;
  userId: string;
  sessionId: string;
  /** Cliente Supabase con service_role — para bypass de RLS donde corresponda. */
  supabase: SupabaseClient<Database>;
  /** Timezone del customer (para resolver fechas relativas). */
  timezone: string;
}

export interface ToolDefinition<TArgs = Record<string, unknown>, TResult = unknown> {
  /** Identificador estable para Anthropic API + audit. snake_case. */
  name: string;
  /** Una línea — qué hace. Va al system prompt. */
  description: string;
  /** Schema de args para validación + API de Anthropic. */
  input_schema: ToolParamSchema;
  /**
   * is_write=true marca acciones que mutan estado (crear/actualizar/borrar).
   * Cuenta al quota mensual del customer. Reads (is_write=false) son gratis.
   */
  is_write: boolean;
  /**
   * requires_confirmation=true → el runner pausa antes de ejecutar y pide
   * al user que apruebe en UI. Solo aplica a writes destructivas o de alto
   * impacto (publish, cancel, reassign).
   */
  requires_confirmation: boolean;
  /**
   * Roles autorizados para invocar esta tool. El runner verifica antes de
   * llamar al handler. Default ['admin', 'dispatcher'].
   */
  allowed_roles?: readonly ('admin' | 'dispatcher')[];
  /** Handler server-side. Recibe args validados + contexto. */
  handler: (args: TArgs, ctx: ToolContext) => Promise<ToolResult<TResult>>;
}

/**
 * Roles de agente runtime (Stream R, ROADMAP 2026-05-15).
 *
 * - `orchestrator`: agente generalista que ve al usuario directo. Maneja
 *   conversación, decide cuándo delegar, llama tools de alto nivel.
 * - `geo`: agente especialista en geocoding/validación de coords/matriz
 *   de distancias. Patrón "tool batch worker": el orchestrator lo invoca
 *   via `delegate_to_geo` con input estructurado; corre un loop interno
 *   de tool calls y devuelve resultado estructurado. NO conversa con el
 *   usuario directo.
 * - `router`: agente especialista en armado/optimización/edición de
 *   rutas. Patrón "conversation handoff": cuando el orchestrator detecta
 *   intent de routing, el router toma la conversación con prompt rico
 *   (capas 1-4 del Optimization Engine, costos MXN, jornada legal). El
 *   user ve un badge "modo routing". El control vuelve al orchestrator
 *   cuando el user cambia de tema o el router cierra el flujo.
 *
 * Sprint R1 (current): el runner acepta el parámetro pero solo
 * `orchestrator` está cableado a callers reales. R2 activa geo. R3
 * activa router. Por seguridad, los roles inactivos se pueden invocar
 * pero su prompt es un stub que rehúsa actuar.
 */
export type AgentRole = 'orchestrator' | 'geo' | 'router';

/** Para el preview de confirmación: descripción humana del impacto. */
export interface ConfirmationPreview {
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  warnings?: string[];
}

/** Tipos del config per-customer en customers.flow_engine_overrides. */
export interface OrchestratorCustomerConfig {
  ai_enabled_users?: string[];
  ai_actions_quota_monthly?: number;
  ai_tools_allowlist?: string[];
}

// Rate limiter — ADR-054 / H4.2.
//
// V2 (este archivo): consume vía RPC Postgres `tripdrive_rate_limit_check`.
// Resuelve el problema multi-instancia (Vercel scaling) y persistencia tras
// restart. Si la RPC falla (BD down, network error), caemos al bucket
// in-memory como degradación elegante — es preferible degradar la precisión
// del rate limit a tumbar el endpoint que lo usa.

import 'server-only';
import { createServiceRoleClient } from '@verdfrut/supabase/server';
import { logger } from '@verdfrut/observability';

interface BucketConfig {
  /** Ventana en milisegundos. */
  windowMs: number;
  /** Máximo de hits por ventana. */
  max: number;
}

// Fallback in-memory (solo si la RPC falla). El bucket key es el mismo formato
// que se pasa a consume() — incluye user/IP + acción.
const fallbackBuckets = new Map<string, number[]>();

function fallbackConsume(bucketKey: string, cfg: BucketConfig): boolean {
  const now = Date.now();
  const cutoff = now - cfg.windowMs;
  const arr = fallbackBuckets.get(bucketKey) ?? [];
  const recent = arr.filter((t) => t > cutoff);
  if (recent.length >= cfg.max) {
    fallbackBuckets.set(bucketKey, recent);
    return false;
  }
  recent.push(now);
  fallbackBuckets.set(bucketKey, recent);
  return true;
}

/**
 * Chequea si el bucket puede aceptar otro hit. Devuelve `true` si pasó (y
 * registra el hit), `false` si excedió la cuota.
 *
 * Firma "legacy" para compatibilidad: `consume(userId, action, cfg)` combina
 * los dos primeros como `${userId}:${action}` antes de chequear. Callers nuevos
 * pueden usar `consumeByKey(bucketKey, cfg)` directo.
 */
export async function consume(
  userId: string,
  action: string,
  cfg: BucketConfig,
): Promise<boolean> {
  return consumeByKey(`${userId}:${action}`, cfg);
}

export async function consumeByKey(
  bucketKey: string,
  cfg: BucketConfig,
): Promise<boolean> {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc('tripdrive_rate_limit_check', {
      p_bucket_key: bucketKey,
      p_window_seconds: Math.ceil(cfg.windowMs / 1000),
      p_max_hits: cfg.max,
    });
    if (error) throw error;
    // RPC devuelve boolean directo.
    return data === true;
  } catch (err) {
    // BD no disponible — degradación a in-memory. Loggeamos como warn para
    // detectar si la BD está down (sería un problema operativo serio).
    await logger.warn('rate-limit: RPC falló, usando fallback in-memory', {
      bucketKey, err,
    });
    return fallbackConsume(bucketKey, cfg);
  }
}

/**
 * Versión SYNC para call sites legacy que no podían pasar a async. Solo usa
 * fallback in-memory — NO escala multi-instancia. Marcar @deprecated y migrar
 * a `consume()` async en próximos sprints.
 *
 * @deprecated usar `consume()` async para resiliencia multi-instancia.
 */
export function consumeSync(
  userId: string,
  action: string,
  cfg: BucketConfig,
): boolean {
  return fallbackConsume(`${userId}:${action}`, cfg);
}

/**
 * Configs nombrados para uso uniforme entre routes/actions.
 */
export const LIMITS = {
  chatManagerMessage: { windowMs: 60_000, max: 60 } satisfies BucketConfig,
  /**
   * P0-4: vista pública /share/dispatch/[token]. 30 hits/min por IP — generoso
   * para que el equipo del cliente refresque, restrictivo contra scrapers.
   */
  shareDispatch: { windowMs: 60_000, max: 30 } satisfies BucketConfig,
};

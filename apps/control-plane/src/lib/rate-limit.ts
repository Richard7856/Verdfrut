// Rate limiter del Control Plane — HARDENING C3.
//
// Reusa la RPC Postgres `tripdrive_rate_limit_check` (mig 033) ya usada por
// platform. La RPC es atómica + distribuida (multi-instancia Vercel).
//
// Por qué CP necesita rate limit:
// El CP tiene una sola contraseña compartida (`CP_SHARED_PASSWORD`) que
// otorga acceso a service_role cross-tenant. Sin rate limit, un atacante
// puede bruteforcear online → entrada total. Con rate limit estricto
// (5 intentos/15 min/IP), el ataque se vuelve impráctico salvo que el
// admin elija una contraseña corta — por eso también obligamos length>=16
// en la action.

import 'server-only';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';

interface BucketConfig {
  windowMs: number;
  max: number;
}

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
 * registra el hit), `false` si excedió la cuota. Si Supabase está caído,
 * cae a un bucket in-memory por instancia — peor que distribuido pero
 * mejor que abrir el endpoint.
 */
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
    return data === true;
  } catch (err) {
    await logger.warn('cp.rate-limit: RPC falló, usando fallback in-memory', {
      bucketKey,
      err,
    });
    return fallbackConsume(bucketKey, cfg);
  }
}

export const CP_LIMITS = {
  /**
   * HARDENING C3. 5 intentos de login por IP por 15 min. Después: bloqueo
   * 15 min hasta que la ventana se desplace. Para un atacante haciendo
   * bruteforce a 1 intento/seg, eso reduce la velocidad efectiva a ~20
   * intentos/hr — desde ahí, una contraseña de 16 chars random es inviable.
   */
  cpLogin: { windowMs: 15 * 60 * 1000, max: 5 } satisfies BucketConfig,
} as const;

/**
 * Extrae la IP del request desde headers HTTP. Prioridad:
 *   1. `x-real-ip` (proxy/load balancer interno).
 *   2. Primer IP de `x-forwarded-for` (Vercel edge).
 *   3. Fallback a 'unknown' — el bucket compartirá entre ataques. Aceptable.
 *
 * Nota: estos headers son spoofeables por el atacante si llega directo al
 * server. En Vercel se reescriben por la edge — confiamos en esa capa.
 * Si en el futuro alguien pone Cloudflare al frente, agregar `cf-connecting-ip`.
 */
export function getClientIp(headers: Headers): string {
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

// Rate limiter (driver) — ADR-054 / H4.2.
//
// V2 (este archivo): consume vía RPC Postgres `tripdrive_rate_limit_check`.
// Resuelve el problema multi-instancia (Vercel scaling) y persistencia tras
// restart. Si la RPC falla (BD down, network error), caemos al bucket
// in-memory como degradación elegante.
//
// Espejo del archivo de `apps/platform/src/lib/rate-limit.ts` — packages
// separados por simplicidad operativa (cada app tiene su deploy).

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
 * registra el hit), `false` si excedió la cuota. ADR-054.
 */
export async function consume(
  userId: string,
  action: string,
  cfg: BucketConfig,
): Promise<boolean> {
  const bucketKey = `${userId}:${action}`;
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
    await logger.warn('rate-limit: RPC falló, usando fallback in-memory', {
      bucketKey, err,
    });
    return fallbackConsume(bucketKey, cfg);
  }
}

export const LIMITS = {
  ocr: { windowMs: 60_000, max: 6 } satisfies BucketConfig,
  chatDriverMessage: { windowMs: 60_000, max: 30 } satisfies BucketConfig,
};

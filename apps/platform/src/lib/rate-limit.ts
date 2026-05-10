// Rate limiter en memoria — gemelo del helper de driver (ADR-023).

import 'server-only';

interface BucketConfig {
  windowMs: number;
  max: number;
}

const buckets = new Map<string, number[]>();

export function consume(userId: string, key: string, cfg: BucketConfig): boolean {
  const bucketKey = `${userId}:${key}`;
  const now = Date.now();
  const cutoff = now - cfg.windowMs;
  const arr = buckets.get(bucketKey) ?? [];
  const recent = arr.filter((t) => t > cutoff);
  if (recent.length >= cfg.max) {
    buckets.set(bucketKey, recent);
    return false;
  }
  recent.push(now);
  buckets.set(bucketKey, recent);
  return true;
}

export const LIMITS = {
  chatManagerMessage: { windowMs: 60_000, max: 60 } satisfies BucketConfig,
  /**
   * P0-4: vista pública /share/dispatch/[token]. 30 hits/min por IP — generoso
   * para que el equipo del cliente refresque, restrictivo contra scrapers.
   */
  shareDispatch: { windowMs: 60_000, max: 30 } satisfies BucketConfig,
};

// Rate limiter en memoria — sliding window simple por usuario.
// ADR-023 / #41 / #46.
//
// Aceptable para V1 con un solo proceso por app. En multi-proceso/multi-instance
// migrar a Redis o tabla `rate_limits` en Postgres.
//
// Comportamiento: cada llamada apunta `consume(userId, key)`. Si el bucket
// excede el límite, devuelve `false` — el caller responde 429 al cliente.

import 'server-only';

interface BucketConfig {
  /** Ventana en milisegundos. */
  windowMs: number;
  /** Máximo de hits por ventana. */
  max: number;
}

// Map de `${userId}:${key}` → array de timestamps dentro de la ventana.
const buckets = new Map<string, number[]>();

export function consume(userId: string, key: string, cfg: BucketConfig): boolean {
  const bucketKey = `${userId}:${key}`;
  const now = Date.now();
  const cutoff = now - cfg.windowMs;
  const arr = buckets.get(bucketKey) ?? [];
  // Drop stamps fuera de la ventana.
  const recent = arr.filter((t) => t > cutoff);
  if (recent.length >= cfg.max) {
    buckets.set(bucketKey, recent);
    return false;
  }
  recent.push(now);
  buckets.set(bucketKey, recent);
  return true;
}

/** Configs nombrados para uso uniforme entre routes/actions. */
export const LIMITS = {
  ocr: { windowMs: 60_000, max: 6 } satisfies BucketConfig,
  chatDriverMessage: { windowMs: 60_000, max: 30 } satisfies BucketConfig,
};

// Helpers de fechas. Convención: TODO en UTC en DB, conversión a local solo en UI.
// Nunca usar Date.toLocaleString() en server — usa el TZ del proceso.

/**
 * Formatea un ISO timestamp a "HH:MM" en una zona horaria específica.
 * Ej: formatTimeInZone('2026-04-30T14:23:00Z', 'America/Mexico_City') → "08:23"
 */
export function formatTimeInZone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/**
 * ADR-054 / H4.3 / issue #120: helper centralizado para `new Date().toISOString()`.
 * Antes de este sprint el patrón estaba duplicado en 8+ archivos, lo cual
 * dificulta:
 *   - Mockear el tiempo en tests (no podemos stub `new Date()` global).
 *   - Cambiar el formato si algún día agregamos timezone-aware serialization.
 * Uso: `update({ updated_at: nowUtcIso() })`.
 */
export function nowUtcIso(): string {
  return new Date().toISOString();
}

/**
 * Devuelve la fecha YYYY-MM-DD en la zona horaria del tenant.
 * Útil para query "¿qué rutas hay HOY?" sin sufrir DST/timezone bugs.
 */
export function todayInZone(timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

/**
 * Convierte unix seconds (lo que devuelve VROOM) a ISO string.
 */
export function unixSecondsToIso(unix: number): string {
  return new Date(unix * 1000).toISOString();
}

/**
 * Formatea un ISO timestamp como "DD MMM HH:MM" en una zona horaria específica.
 * Ej: formatDateTimeInZone('2026-04-30T14:23:00Z', 'America/Mexico_City') → "30 abr 08:23"
 *
 * Reemplaza el patrón inseguro `new Date(iso).toLocaleString('es-MX')` que
 * usa la TZ del proceso server (UTC en Vercel, depende del SO en VPS).
 */
export function formatDateTimeInZone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Formatea duración en segundos como "Xh Ym" o "X min".
 * Helper estándar para mostrar duraciones de ruta.
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}m`;
}

// Cache del formatter — Intl.NumberFormat es caro de instanciar; reusar.
const KM_FORMATTER = new Intl.NumberFormat('es-MX', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * #9 — Formatea metros como kilómetros con separador de miles + 1 decimal.
 *
 * Ej: 1234567 → "1,234.6 km"
 *     850     → "0.9 km"
 *     0       → "0.0 km"
 *
 * Por qué un helper en vez de `(m/1000).toFixed(1)` inline: ese patrón perdía
 * el separador de miles, y a 1,000+ km la cifra "1234.5 km" se lee mal en
 * reportes y dashboards.
 */
export function formatKilometers(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '—';
  return `${KM_FORMATTER.format(meters / 1000)} km`;
}

/**
 * Convierte una fecha (YYYY-MM-DD) + hora (HH:MM) interpretada como hora LOCAL
 * de la zona horaria dada, a unix seconds en UTC.
 *
 * Ejemplo: localTimeToUnix('2026-05-15', '06:00', 'America/Mexico_City')
 *   → unix correspondiente a 2026-05-15 06:00:00 UTC-6 = 12:00:00 UTC
 *
 * NOTA: en zonas con DST esta función puede tener bugs sutiles cerca de la
 * transición de horario. México (excepto frontera norte) abolió DST en 2022,
 * así que para nuestro caso es seguro. Frontera norte (Tijuana etc) sigue
 * con DST — habría que migrar a date-fns-tz si esos clientes son objetivo.
 */
export function localTimeToUnix(date: string, time: string, timezone: string): number {
  // Estrategia: construir la fecha como si fuera UTC, calcular el offset de la TZ
  // para ese instante, y restar/sumar el offset para obtener el unix real.
  const naiveUtc = new Date(`${date}T${time}:00Z`).getTime();

  // Obtener qué hora "ve" la TZ cuando el reloj UTC marca naiveUtc.
  // Si TZ es CDMX (UTC-6) y naiveUtc=06:00, la TZ ve "00:00".
  // El offset es (UTC view) - (TZ view) = 6h en milisegundos.
  const tzView = new Date(naiveUtc).toLocaleString('en-US', { timeZone: timezone });
  const utcView = new Date(naiveUtc).toLocaleString('en-US', { timeZone: 'UTC' });
  const offsetMs = new Date(utcView).getTime() - new Date(tzView).getTime();

  // Aplicar offset: si TZ está atrás de UTC (offset > 0), sumamos para obtener
  // el momento real en UTC en que el reloj local marcará 'time'.
  return Math.floor((naiveUtc + offsetMs) / 1000);
}

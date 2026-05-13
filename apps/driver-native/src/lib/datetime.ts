// Helpers de fecha/hora locales al tenant.
//
// El web usa @tripdrive/utils que depende de Intl + Temporal polyfill. En native
// Intl está disponible pero algunos features (Hermes) están limitados. Por eso
// duplicamos las funciones mínimas que N2 necesita en lugar de importar el
// package web — evita rabbit-hole de polyfills.

const DEFAULT_TIMEZONE = 'America/Mexico_City';

/** Fecha YYYY-MM-DD en la zona del tenant. Es la "fecha operativa" del chofer. */
export function todayInZone(timeZone: string = DEFAULT_TIMEZONE): string {
  // Intl.DateTimeFormat con 'en-CA' devuelve YYYY-MM-DD por convención canadiense.
  // Workaround standard en React Native (donde Temporal no está disponible aún).
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/**
 * Formatea ISO timestamp → "HH:MM" en zona del tenant.
 * Retorna '—' si el ISO es null/inválido para que la UI no muestre "Invalid Date".
 */
export function formatTimeInZone(
  iso: string | null,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Formatea fecha YYYY-MM-DD → "vie 12 may" (día corto + día + mes abreviado).
 * Útil en el header de la ruta.
 */
export function formatRouteDate(
  ymd: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  // YYYY-MM-DD se interpreta como UTC midnight en JS — para evitar drift de TZ
  // construimos la fecha al mediodía del día indicado.
  const date = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(date.getTime())) return ymd;
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

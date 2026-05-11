// Helpers de validación. Sin Zod por ahora — añadirlo si los esquemas crecen.
// Lanza ValidationError; los Server Actions lo capturan y devuelven el mensaje.

export class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function requireString(field: string, value: unknown, opts?: {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  patternMsg?: string;
}): string {
  if (typeof value !== 'string') {
    throw new ValidationError(field, `${field} es obligatorio`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(field, `${field} es obligatorio`);
  }
  if (opts?.minLength && trimmed.length < opts.minLength) {
    throw new ValidationError(field, `${field} debe tener al menos ${opts.minLength} caracteres`);
  }
  if (opts?.maxLength && trimmed.length > opts.maxLength) {
    throw new ValidationError(field, `${field} debe tener máximo ${opts.maxLength} caracteres`);
  }
  if (opts?.pattern && !opts.pattern.test(trimmed)) {
    throw new ValidationError(field, opts.patternMsg ?? `${field} tiene formato inválido`);
  }
  return trimmed;
}

export function optionalString(value: unknown, opts?: { maxLength?: number }): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (opts?.maxLength && trimmed.length > opts.maxLength) {
    throw new ValidationError('campo', `Debe tener máximo ${opts.maxLength} caracteres`);
  }
  return trimmed;
}

export function requireNumber(field: string, value: unknown, opts?: {
  min?: number;
  max?: number;
  integer?: boolean;
}): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new ValidationError(field, `${field} debe ser un número válido`);
  }
  if (opts?.integer && !Number.isInteger(num)) {
    throw new ValidationError(field, `${field} debe ser un número entero`);
  }
  if (opts?.min !== undefined && num < opts.min) {
    throw new ValidationError(field, `${field} debe ser ≥ ${opts.min}`);
  }
  if (opts?.max !== undefined && num > opts.max) {
    throw new ValidationError(field, `${field} debe ser ≤ ${opts.max}`);
  }
  return num;
}

export function requireUuid(field: string, value: unknown): string {
  const str = requireString(field, value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    throw new ValidationError(field, `${field} debe ser un UUID válido`);
  }
  return str;
}

/**
 * Bounding box del tenant — ADR-054 / H4.4 / issue #121.
 *
 * Antes hardcoded a México. Ahora se lee de env vars del tenant
 * (`TENANT_BBOX_LAT_MIN`, etc.) con default a México para no romper
 * tenants existentes. Cuando llegue el primer cliente fuera de México,
 * el tenant.json va a setear estas vars en el deploy correspondiente.
 *
 * El bbox sirve para validar coordenadas al onboardear tiendas (catch
 * errores típicos: copiar lat/lng invertidos, escribir 99 en vez de -99,
 * etc.). NO es validación de seguridad — un atacante puede burlar el bbox.
 */
function getTenantBBox() {
  return {
    latMin: parseFloat(process.env.TENANT_BBOX_LAT_MIN ?? '14.3'),
    latMax: parseFloat(process.env.TENANT_BBOX_LAT_MAX ?? '32.8'),
    lngMin: parseFloat(process.env.TENANT_BBOX_LNG_MIN ?? '-118.7'),
    lngMax: parseFloat(process.env.TENANT_BBOX_LNG_MAX ?? '-86.5'),
  };
}

const TENANT_REGION_NAME = process.env.TENANT_REGION_NAME ?? 'México';

export function requireLat(value: unknown): number {
  const num = requireNumber('latitud', value, { min: -90, max: 90 });
  const bbox = getTenantBBox();
  if (num < bbox.latMin || num > bbox.latMax) {
    throw new ValidationError(
      'latitud',
      `Latitud ${num.toFixed(4)} está fuera del rango de ${TENANT_REGION_NAME} (${bbox.latMin}–${bbox.latMax}). Verifica las coordenadas.`,
    );
  }
  return num;
}

export function requireLng(value: unknown): number {
  const num = requireNumber('longitud', value, { min: -180, max: 180 });
  const bbox = getTenantBBox();
  if (num < bbox.lngMin || num > bbox.lngMax) {
    throw new ValidationError(
      'longitud',
      `Longitud ${num.toFixed(4)} está fuera del rango de ${TENANT_REGION_NAME} (${bbox.lngMin}–${bbox.lngMax}). Verifica las coordenadas.`,
    );
  }
  return num;
}

/**
 * Valida formato HH:MM (24h). Devuelve null si está vacío.
 */
export function optionalTime(value: unknown): string | null {
  const str = optionalString(value);
  if (!str) return null;
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(str)) {
    throw new ValidationError('hora', 'Formato debe ser HH:MM (24h)');
  }
  return str;
}

/**
 * Wrap a Server Action body to convert ValidationError into { ok: false, error }.
 */
export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
}

export async function runAction(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { ok: false, error: err.message, field: err.field };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

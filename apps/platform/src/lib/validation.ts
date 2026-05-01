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
 * Bounding box de México (territorio continental + Baja California + frontera sur).
 * Conservador: incluye un poco de margen oceánico para evitar falsos positivos
 * en tiendas costeras (Mazatlán, Cancún, Ensenada).
 *
 * Para tenants fuera de México, parametrizar via tenant.bbox en Fase 6.
 */
const MX_BBOX = {
  latMin: 14.3,
  latMax: 32.8,
  lngMin: -118.7,
  lngMax: -86.5,
};

export function requireLat(value: unknown): number {
  const num = requireNumber('latitud', value, { min: -90, max: 90 });
  if (num < MX_BBOX.latMin || num > MX_BBOX.latMax) {
    throw new ValidationError(
      'latitud',
      `Latitud ${num.toFixed(4)} está fuera del rango de México (${MX_BBOX.latMin}–${MX_BBOX.latMax}). Verifica las coordenadas.`,
    );
  }
  return num;
}

export function requireLng(value: unknown): number {
  const num = requireNumber('longitud', value, { min: -180, max: 180 });
  if (num < MX_BBOX.lngMin || num > MX_BBOX.lngMax) {
    throw new ValidationError(
      'longitud',
      `Longitud ${num.toFixed(4)} está fuera del rango de México (${MX_BBOX.lngMin}–${MX_BBOX.lngMax}). Verifica las coordenadas.`,
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

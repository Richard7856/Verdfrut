// Registro de tenants. Mapea slug (subdominio) a credenciales Supabase.
//
// V1: lee un archivo JSON en disco. Path configurable vía TENANT_REGISTRY_PATH.
// Futuro: leer de tabla en el control plane Supabase.
//
// El archivo NUNCA se committea — vive en el VPS en /etc/verdfrut/tenants.json
// con permisos restrictivos (chmod 600, root:root).

import type { TenantRegistryEntry } from '@tripdrive/types';

interface TenantRegistry {
  tenants: TenantRegistryEntry[];
}

let cachedRegistry: TenantRegistry | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

/**
 * Resuelve el tenant a partir de un host header (ej: "neto.verdfrut.com").
 * Devuelve null si el subdomain no corresponde a un tenant activo.
 */
export async function resolveTenantFromHost(
  host: string,
): Promise<TenantRegistryEntry | null> {
  const slug = extractSlugFromHost(host);
  if (!slug) return null;
  return resolveTenantBySlug(slug);
}

/**
 * Resuelve un tenant por su slug.
 */
export async function resolveTenantBySlug(
  slug: string,
): Promise<TenantRegistryEntry | null> {
  const registry = await loadRegistry();
  const tenant = registry.tenants.find((t) => t.slug === slug);
  if (!tenant || tenant.status !== 'active') return null;
  return tenant;
}

/**
 * Lista todos los tenants activos (uso del control plane).
 */
export async function listActiveTenants(): Promise<TenantRegistryEntry[]> {
  const registry = await loadRegistry();
  return registry.tenants.filter((t) => t.status === 'active');
}

/**
 * Extrae el slug del primer label del host.
 * "neto.verdfrut.com" → "neto"
 * "driver-neto.verdfrut.com" → "driver-neto"
 * "localhost:3000" → null
 */
function extractSlugFromHost(host: string): string | null {
  const cleanHost = host.split(':')[0] ?? '';
  const parts = cleanHost.split('.');
  if (parts.length < 3) return null;
  return parts[0] ?? null;
}

async function loadRegistry(): Promise<TenantRegistry> {
  const now = Date.now();
  if (cachedRegistry && now - cachedAt < CACHE_TTL_MS) {
    return cachedRegistry;
  }

  const path = process.env.TENANT_REGISTRY_PATH ?? '/etc/verdfrut/tenants.json';
  try {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as TenantRegistry;
    cachedRegistry = parsed;
    cachedAt = now;
    return parsed;
  } catch (err) {
    throw new Error(
      `[tenant-registry] No se pudo leer ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Solo para testing: limpia el cache.
 */
export function clearTenantRegistryCache(): void {
  cachedRegistry = null;
  cachedAt = 0;
}

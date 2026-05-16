// Card y badge reusables para mostrar "esta feature requiere un plan
// superior" — ADR-121 Fase 1 de gating real por tier. La idea es que
// cualquier server component que detecte vía `getCallerFeatures()` que
// el customer no tiene la feature pueda renderizar este card en lugar
// del contenido normal, en vez de dejar al user dar click y comerse un
// 403 del server action.

import Link from 'next/link';
import { PLAN_LABELS, type CustomerTier, type FeatureKey } from '@tripdrive/plans';

/**
 * Tier mínimo que tiene cada feature. Solo cubre las features con gate
 * activo hoy (Fase 1). Si agregas una feature nueva al registry, súmala
 * aquí para que el copy del lock sea correcto.
 */
const FEATURE_MIN_TIER: Partial<Record<FeatureKey, CustomerTier>> = {
  xlsxImport: 'pro',
  dragEditMap: 'pro',
  pushNotifications: 'starter',
  liveReOpt: 'starter',
  ai: 'pro',
  customDomain: 'enterprise',
  customBranding: 'enterprise',
};

/**
 * Copy human-friendly por feature — qué entrega y por qué el user la
 * quiere. Reemplaza el mensaje técnico del FeatureNotAvailableError
 * cuando lo mostramos in-app.
 */
const FEATURE_COPY: Partial<Record<FeatureKey, { title: string; pitch: string }>> = {
  xlsxImport: {
    title: 'Importar Excel masivo',
    pitch: 'Sube un XLSX con cientos de tiendas y el sistema geocodifica, valida y crea todo en un solo paso. Ideal para onboarding o migración desde un sistema previo.',
  },
  dragEditMap: {
    title: 'Edición visual del día',
    pitch: 'Selecciona paradas con Shift+arrastre en el mapa, muévelas entre camionetas cross-plan, y arma tu día visualmente sin tocar formularios.',
  },
  pushNotifications: {
    title: 'Notificaciones push',
    pitch: 'Avisa a tus choferes en tiempo real cuando publicas o cambias una ruta — sin depender de que abran la app.',
  },
  liveReOpt: {
    title: 'Re-optimización en vivo',
    pitch: 'Re-calcula ETAs y reordena paradas en flight cuando algo cambia (retraso, parada urgente, chofer atrasado).',
  },
  ai: {
    title: 'Asistente AI',
    pitch: 'Crea, modifica y consulta operación conversando con el agente. Importa Excel, optimiza día, reasigna choferes — todo desde el chat.',
  },
  customDomain: {
    title: 'Dominio propio',
    pitch: 'Tu equipo accede en `app.tuempresa.com` con tu marca, no la nuestra.',
  },
  customBranding: {
    title: 'Branding personalizado',
    pitch: 'Logo, paleta de colores y nombre del producto adaptados a tu marca.',
  },
};

interface FeatureLockedCardProps {
  feature: FeatureKey;
  currentTier: CustomerTier;
  /** Opcional: override del título por defecto del registry de copy. */
  titleOverride?: string;
}

/**
 * Card grande para reemplazar el contenido de una página completa cuando
 * la feature está bloqueada. Usar en server components que ya leyeron
 * `getCallerFeatures()`.
 */
export function FeatureLockedCard({ feature, currentTier, titleOverride }: FeatureLockedCardProps) {
  const minTier = FEATURE_MIN_TIER[feature] ?? 'pro';
  const copy = FEATURE_COPY[feature];
  const title = titleOverride ?? copy?.title ?? 'Feature no disponible en tu plan';
  const pitch = copy?.pitch ?? 'Esta funcionalidad se incluye en planes superiores.';

  return (
    <div
      className="mx-auto max-w-2xl rounded-[var(--radius-md)] border p-8 text-center"
      style={{
        background: 'var(--color-surface-1)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
        style={{
          background: 'color-mix(in oklch, var(--vf-green-500) 20%, transparent)',
        }}
        aria-hidden
      >
        <span className="text-2xl">🔒</span>
      </div>
      <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
        {title}
      </h2>
      <p className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {pitch}
      </p>
      <div
        className="mt-6 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
        style={{
          background: 'color-mix(in oklch, var(--vf-amber-500, #f59e0b) 15%, transparent)',
          color: 'var(--vf-amber-200, #fde68a)',
        }}
      >
        Tu plan actual: <span className="font-semibold">{PLAN_LABELS[currentTier]}</span>
        <span aria-hidden>→</span>
        Requiere: <span className="font-semibold">{PLAN_LABELS[minTier]}</span>
      </div>
      <div className="mt-6 flex justify-center gap-3">
        <Link
          href="/settings/billing"
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-white"
          style={{ background: 'var(--vf-green-700)' }}
        >
          Ver plan actual y mejorar
        </Link>
      </div>
    </div>
  );
}

interface FeatureLockedBadgeProps {
  feature: FeatureKey;
  /** Texto inline, ej. "Pro" o "Enterprise". */
  short?: boolean;
}

/**
 * Badge pequeño "🔒 Pro" para poner junto a botones/menú items que están
 * bloqueados. El componente padre decide si oculta el control o lo deja
 * visible con el badge.
 */
export function FeatureLockedBadge({ feature, short = true }: FeatureLockedBadgeProps) {
  const minTier = FEATURE_MIN_TIER[feature] ?? 'pro';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{
        background: 'color-mix(in oklch, var(--vf-amber-500, #f59e0b) 15%, transparent)',
        color: 'var(--vf-amber-200, #fde68a)',
      }}
      title={`Requiere plan ${PLAN_LABELS[minTier]}`}
    >
      <span aria-hidden>🔒</span>
      {short ? PLAN_LABELS[minTier] : `Requiere ${PLAN_LABELS[minTier]}`}
    </span>
  );
}

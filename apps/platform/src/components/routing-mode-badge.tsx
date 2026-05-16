// Badge "✋ Manual" vs "🤖 Optimizada" para una ruta (UXR-2 / ADR-110).
//
// Lee `route.optimizationSkipped` (set por approveRoute con skippedOptimization
// cuando el dispatcher publica desde DRAFT sin pasar por VROOM). El badge le da
// al admin un golpe de vista para distinguir rutas que SÍ pasaron por el
// optimizer de las que se publicaron a mano (puede ser intencional, pero el
// dispatcher debe saberlo al auditar).
//
// Reglas:
//   DRAFT → null (todavía no se decide). No mostrar nada.
//   Cualquier otro estado:
//     optimizationSkipped=true  → ✋ Manual (warning tone, llama la atención).
//     optimizationSkipped=false → 🤖 Optimizada (info tone, neutro). Opt-in
//       vía showOptimized=true: en listas con MUCHAS rutas optimizadas el badge
//       se vuelve ruido; solo mostramos el "manual". En el detalle sí lo
//       mostramos para confirmar al dispatcher que el optimizer corrió.

import { Badge, type BadgeTone } from '@tripdrive/ui';
import type { Route } from '@tripdrive/types';

interface Props {
  route: Pick<Route, 'status' | 'optimizationSkipped'>;
  /** Si true, también renderiza el badge "🤖 Optimizada". Default false (solo Manual). */
  showOptimized?: boolean;
  /** Tamaño visual — compacto en listas, normal en detalles. */
  compact?: boolean;
}

export function RoutingModeBadge({ route, showOptimized = false, compact = false }: Props) {
  if (route.status === 'DRAFT') return null;

  const isManual = route.optimizationSkipped === true;
  if (!isManual && !showOptimized) return null;

  const label = isManual ? 'Manual' : 'Optimizada';
  const emoji = isManual ? '✋' : '🤖';
  const tone: BadgeTone = isManual ? 'warning' : 'info';
  const title = isManual
    ? 'Esta ruta se publicó desde DRAFT sin pasar por el optimizer. El orden es manual.'
    : 'El optimizer calculó el orden de las paradas con VROOM + tráfico.';

  if (compact) {
    return (
      <span
        title={title}
        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
        style={{
          background: isManual
            ? 'color-mix(in oklch, var(--vf-warn, #d97706) 18%, transparent)'
            : 'color-mix(in oklch, var(--vf-info, #0284c7) 15%, transparent)',
          color: isManual ? 'var(--vf-warn, #d97706)' : 'var(--vf-info, #0284c7)',
        }}
      >
        <span aria-hidden>{emoji}</span>
        <span>{label}</span>
      </span>
    );
  }

  return (
    <Badge tone={tone} title={title}>
      <span aria-hidden className="mr-0.5">{emoji}</span>
      {label}
    </Badge>
  );
}

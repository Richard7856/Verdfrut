// /dispatches → redirect a /dia (vista unificada por día).
//
// Histórico: esta página listaba "tiros" (contenedores de rutas) agrupados
// por fecha. Era la puerta de entrada original al planning. 2026-05-15 la
// vista por día (/dia/[fecha]) se volvió la entrada principal y este URL
// quedó como duplicado confuso, especialmente para customers nuevos que
// veían dos entradas en sidebar sin entender la diferencia.
//
// Decisión: redirect transparente. Los URLs profundos /dispatches/[id]
// siguen funcionando como drill-down de edición avanzada — accesibles
// desde /dia vía los chips "Abrir plan xxxxx" del listado lateral.
//
// Fase 2 (próxima sesión): /dia/[fecha] gana edición directa (bulk select
// cross-dispatch, mover paradas entre camionetas sin entrar al plan
// específico) — ahí el concepto "tiro como contenedor" desaparece de UI.
// Fase 3: relax de routes.dispatch_id NOT NULL en BD, agrupación automática
// por (fecha, zona) — el concepto desaparece también del modelo.

import { redirect } from 'next/navigation';
import { todayInZone } from '@tripdrive/utils';

export const dynamic = 'force-dynamic';

const TENANT_TZ = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

export default function DispatchesIndexPage() {
  redirect(`/dia/${todayInZone(TENANT_TZ)}`);
}

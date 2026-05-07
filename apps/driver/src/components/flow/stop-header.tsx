// Header del detalle de parada: regresar, código + nombre tienda + acciones.
//
// Acciones (en orden de uso típico):
//   - Maps / Waze: deeplinks para que el chofer use SU app de navegación favorita.
//     Patrón intencional V1 — su infra de navegación está mucho más pulida que la
//     que podríamos construir nosotros. Mantenemos turn-by-turn in-app como respaldo
//     para flujos donde queremos visibilidad/auditoría (botón "🧭 Iniciar navegación"
//     desde /route).
//   - Reportar problema: abre el chat realtime con el zone_manager. Útil para
//     averías, incidencias, dudas durante el flujo (a diferencia del chat dentro
//     del flow, este es accesible en cualquier momento del stop).
//
// DECISIÓN INTENCIONAL (no hay botón de llamar tienda):
// Anteriormente hubo un botón "Llamar tienda" pero genera fricción operativa real
// — choferes llaman a gerentes de tienda por cosas no relevantes (preguntas de la
// app, dudas, etc.) y eso quema la relación con el cliente final. Toda comunicación
// del chofer pasa por chat (con AI mediator a futuro — Sprint 18+) o por el zone
// manager. La tienda nunca recibe llamada del chofer.

import Link from 'next/link';
import type { Stop, Store } from '@verdfrut/types';

interface Props {
  stop: Stop;
  store: Store;
}

export function StopHeader({ stop, store }: Props) {
  // Google Maps directions con travel mode driving (mejor que /search/ porque
  // arranca turn-by-turn directo sin que el chofer tenga que tocar "Iniciar").
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${store.lat},${store.lng}&travelmode=driving`;
  // Waze deep link — abre Waze app si está instalada, sino su web.
  const wazeUrl = `https://waze.com/ul?ll=${store.lat},${store.lng}&navigate=yes`;

  return (
    <header className="border-b border-[var(--color-border)] bg-[var(--vf-surface-1)]">
      <div className="flex items-center gap-3 px-4 py-3">
        <Link
          href="/route"
          aria-label="Volver a la lista de paradas"
          className="text-2xl text-[var(--color-text-muted)]"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--color-text)]">
            <span className="text-[var(--color-text-muted)]">#{stop.sequence}</span> · {store.name}
          </p>
          <p className="truncate text-xs text-[var(--color-text-muted)]">
            {store.code} · {store.address}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-3 text-xs">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-[var(--radius-md)] bg-[var(--vf-surface-2)] px-3 py-1.5 text-[var(--color-text)]"
        >
          🗺 Maps
        </a>
        <a
          href={wazeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-[var(--radius-md)] bg-[var(--vf-surface-2)] px-3 py-1.5 text-[var(--color-text)]"
        >
          🚗 Waze
        </a>
        <Link
          href={`/route/stop/${stop.id}/chat`}
          className="rounded-[var(--radius-md)] bg-[var(--color-warning-bg)] px-3 py-1.5 text-[var(--color-warning-fg)] font-medium"
        >
          ⚠ Reportar problema
        </Link>
      </div>
    </header>
  );
}

// Header del detalle de parada: regresar, código + nombre tienda, link maps, llamar tienda.

import Link from 'next/link';
import type { Stop, Store } from '@verdfrut/types';

interface Props {
  stop: Stop;
  store: Store;
}

export function StopHeader({ stop, store }: Props) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${store.lat},${store.lng}`;
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
      <div className="flex gap-2 px-4 pb-3 text-xs">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-[var(--radius-md)] bg-[var(--vf-surface-2)] px-3 py-1.5 text-[var(--color-text)]"
        >
          Cómo llegar
        </a>
        {store.contactPhone && (
          <a
            href={`tel:${store.contactPhone}`}
            className="rounded-[var(--radius-md)] bg-[var(--vf-surface-2)] px-3 py-1.5 text-[var(--color-text)]"
          >
            Llamar
          </a>
        )}
      </div>
    </header>
  );
}

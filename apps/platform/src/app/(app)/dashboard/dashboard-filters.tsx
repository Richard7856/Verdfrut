'use client';

// Filtros del dashboard sincronizados con la URL (?from=&to=&zone=).
// Server component padre re-renderea con nuevos searchParams cuando cambian.

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Field, Input, Spinner } from '@verdfrut/ui';

interface ZoneOption {
  id: string;
  name: string;
}

interface Props {
  zones: ZoneOption[];
  /** Si false, el selector de zona no se muestra (zone_manager con zona única) */
  showZoneSelector: boolean;
}

export function DashboardFilters({ zones, showZoneSelector }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const zone = params.get('zone') ?? '';

  function update(key: 'from' | 'to' | 'zone', value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  return (
    <div className="mb-6 flex flex-wrap items-end gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <Field label="Desde" htmlFor="from">
        <Input
          id="from"
          type="date"
          value={from}
          onChange={(e) => update('from', e.target.value)}
          disabled={pending}
        />
      </Field>
      <Field label="Hasta" htmlFor="to">
        <Input
          id="to"
          type="date"
          value={to}
          onChange={(e) => update('to', e.target.value)}
          disabled={pending}
        />
      </Field>
      {showZoneSelector && (
        <Field label="Zona" htmlFor="zone">
          <select
            id="zone"
            value={zone}
            onChange={(e) => update('zone', e.target.value)}
            disabled={pending}
            className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
          >
            <option value="">Todas las zonas</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {pending && (
        <div className="flex h-10 items-center text-xs text-[var(--color-text-muted)]">
          <Spinner /> <span className="ml-2">Actualizando…</span>
        </div>
      )}
    </div>
  );
}

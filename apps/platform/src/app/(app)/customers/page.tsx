// Listado de clientes — UI shell del feature multi-cliente.
// Mientras está en shell, los datos vienen de `customers-preview.ts` (mockup)
// y NETO tiene `storeCount` real desde BD para mostrar coherencia con la operación.

import Link from 'next/link';
import { Badge, Card, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { listStores } from '@/lib/queries/stores';
import { CUSTOMERS_PREVIEW } from '@/lib/customers-preview';
import { PreviewBanner } from './preview-banner';

export const metadata = { title: 'Clientes' };

export default async function CustomersPage() {
  await requireRole('admin', 'dispatcher');

  // Único valor real: count de stores. Por convención todos los stores
  // actuales se asocian al cliente NETO (en Phase 1 real, esto vendrá del
  // FK customer_id).
  const allStores = await listStores();
  const netoStoreCount = allStores.length;

  // Mezclamos el real (NETO) con los preview (OXXO, Bimbo).
  const customers = CUSTOMERS_PREVIEW.map((c) => {
    if (c.id === 'neto-real') {
      return {
        ...c,
        mockMetrics: {
          ...(c.mockMetrics ?? {
            storeCount: 0,
            dispatchesThisMonth: 0,
            deliveriesThisMonth: 0,
            onTimeRate: 0,
            avgKmPerRoute: 0,
          }),
          storeCount: netoStoreCount,
        },
      };
    }
    return c;
  });

  return (
    <>
      <PageHeader
        title="Clientes"
        description={`${customers.length} cliente(s) — NETO en operación, otros en preview / onboarding.`}
      />
      <div className="flex flex-col gap-4">
        <PreviewBanner />
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {customers.map((c) => (
            <li key={c.id}>
              <Link href={`/customers/${c.id}`} className="block">
                <Card className="h-full border-[var(--color-border)] transition-colors hover:bg-[var(--vf-surface-3)]">
                  <header className="flex items-start gap-3">
                    {/* Avatar con iniciales */}
                    <div
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] text-[14px] font-bold"
                      style={{ background: c.accentHex, color: 'white' }}
                    >
                      {c.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3
                          className="truncate text-[14px] font-semibold"
                          style={{ color: 'var(--vf-text)' }}
                        >
                          {c.name}
                        </h3>
                        {c.isPreview && <Badge tone="warning">Preview</Badge>}
                      </div>
                      <p
                        className="mt-0.5 truncate font-mono text-[11px]"
                        style={{ color: 'var(--vf-text-mute)' }}
                      >
                        {c.code}
                      </p>
                    </div>
                    <StatusBadge status={c.status} />
                  </header>

                  <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
                    <Metric
                      label="Tiendas"
                      value={c.mockMetrics?.storeCount?.toLocaleString('es-MX') ?? '—'}
                    />
                    <Metric
                      label="Tiros este mes"
                      value={c.mockMetrics?.dispatchesThisMonth?.toLocaleString('es-MX') ?? '—'}
                    />
                    <Metric
                      label="Entregas mes"
                      value={c.mockMetrics?.deliveriesThisMonth?.toLocaleString('es-MX') ?? '—'}
                    />
                    <Metric
                      label="On-time"
                      value={
                        c.mockMetrics?.onTimeRate
                          ? `${c.mockMetrics.onTimeRate.toFixed(1)}%`
                          : '—'
                      }
                    />
                  </dl>

                  {c.contactName && (
                    <p
                      className="mt-3 truncate text-[11px]"
                      style={{ color: 'var(--vf-text-mute)' }}
                    >
                      Contacto: <span style={{ color: 'var(--vf-text)' }}>{c.contactName}</span>
                    </p>
                  )}
                </Card>
              </Link>
            </li>
          ))}

          {/* "Agregar cliente" deshabilitado mientras shell */}
          <li>
            <div
              className="flex h-full items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed p-6 text-center"
              style={{ borderColor: 'var(--vf-line-strong)' }}
              title="Disponible al cerrar la integración multi-cliente"
            >
              <div>
                <p className="text-[14px] font-medium" style={{ color: 'var(--vf-text-mute)' }}>
                  + Agregar cliente
                </p>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--vf-text-faint)' }}>
                  Disponible próximamente
                </p>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: 'active' | 'onboarding' | 'inactive' }) {
  if (status === 'active') return <Badge tone="success">Activo</Badge>;
  if (status === 'onboarding') return <Badge tone="info">Onboarding</Badge>;
  return <Badge tone="neutral">Inactivo</Badge>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ color: 'var(--vf-text-mute)' }}>{label}</dt>
      <dd
        className="text-right font-mono tabular-nums"
        style={{ color: 'var(--vf-text)' }}
      >
        {value}
      </dd>
    </>
  );
}

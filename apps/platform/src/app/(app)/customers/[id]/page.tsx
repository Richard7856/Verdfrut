// Detalle de un cliente — UI shell.
// Para NETO: métricas reales desde BD. Para preview: mockup.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button, Card, CardHeader, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { listStores } from '@/lib/queries/stores';
import { listRoutes } from '@/lib/queries/routes';
import { getCustomerPreview } from '@/lib/customers-preview';
import { PreviewBanner } from '../preview-banner';

export const metadata = { title: 'Cliente' };

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('admin', 'dispatcher');
  const { id } = await params;
  const customer = getCustomerPreview(id);
  if (!customer) notFound();

  // Para NETO usamos datos reales. Para preview, el mockMetrics que ya viene.
  let metrics = customer.mockMetrics ?? {
    storeCount: 0,
    dispatchesThisMonth: 0,
    deliveriesThisMonth: 0,
    onTimeRate: 0,
    avgKmPerRoute: 0,
  };

  if (!customer.isPreview && customer.id === 'neto-real') {
    const stores = await listStores();
    // Tiros del mes actual (todos los stores son de NETO mientras shell)
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const routesData = await listRoutes({ limit: 200 });
    const routesThisMonth = routesData.rows.filter((r) => r.date >= firstOfMonth);
    const dispatchesThisMonth = new Set(routesThisMonth.map((r) => r.dispatchId)).size;
    const avgKm =
      routesThisMonth.filter((r) => r.totalDistanceMeters && r.totalDistanceMeters > 0).length > 0
        ? routesThisMonth.reduce((acc, r) => acc + (r.totalDistanceMeters ?? 0), 0) /
          routesThisMonth.filter((r) => r.totalDistanceMeters && r.totalDistanceMeters > 0).length /
          1000
        : 0;
    metrics = {
      storeCount: stores.length,
      dispatchesThisMonth,
      deliveriesThisMonth: 0, // requiere query de delivery_reports — placeholder
      onTimeRate: 0, // requiere computación — placeholder
      avgKmPerRoute: avgKm,
    };
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-[13px] font-bold"
              style={{ background: customer.accentHex, color: 'white' }}
            >
              {customer.initials}
            </span>
            <span>{customer.name}</span>
            {customer.isPreview && <Badge tone="warning">Preview</Badge>}
            <Badge tone={customer.status === 'active' ? 'success' : customer.status === 'onboarding' ? 'info' : 'neutral'}>
              {customer.status === 'active' ? 'Activo' : customer.status === 'onboarding' ? 'Onboarding' : 'Inactivo'}
            </Badge>
          </span>
        }
        description={
          customer.isPreview
            ? 'Vista preview del feature multi-cliente — datos de muestra.'
            : `Operación real · contrato desde ${customer.contractStart ?? 'por confirmar'}.`
        }
        action={
          <Link href="/customers">
            <Button variant="ghost" size="sm">
              ← Todos los clientes
            </Button>
          </Link>
        }
      />

      <div className="flex flex-col gap-4">
        <PreviewBanner>
          {customer.isPreview
            ? 'Cliente en demo — al cerrar la integración multi-cliente, este cliente entra a operación real con su propio flow, KPIs y catálogo.'
            : `Métricas reales de operación. La sección multi-cliente está en desarrollo — pronto este cliente tendrá su flow del chofer personalizable, catálogo aislado y branding propio.`}
        </PreviewBanner>

        {/* KPIs grid */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            label="Tiendas activas"
            value={metrics.storeCount.toLocaleString('es-MX')}
            sub={customer.isPreview ? 'demo' : `verificadas + sin verificar`}
          />
          <KpiCard
            label="Tiros este mes"
            value={metrics.dispatchesThisMonth.toLocaleString('es-MX')}
            sub={customer.isPreview ? 'demo' : 'operación real'}
          />
          <KpiCard
            label="Entregas mes"
            value={metrics.deliveriesThisMonth.toLocaleString('es-MX')}
            sub={customer.isPreview ? 'demo' : 'pendiente cálculo'}
          />
          <KpiCard
            label="On-time rate"
            value={
              metrics.onTimeRate > 0 ? `${metrics.onTimeRate.toFixed(1)}%` : '—'
            }
            sub={customer.isPreview ? 'demo' : 'pendiente cálculo'}
          />
        </div>

        {/* Secciones futuras — cards deshabilitadas tipo "coming soon" */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <FutureSection
            title="Flow del chofer"
            description={
              customer.isPreview
                ? `Configuración personalizada para ${customer.name} — qué pantallas activar, parámetros por entrega, validaciones específicas.`
                : `Hoy ${customer.name} usa el flow default. Cuando entre el feature multi-cliente, vas a poder personalizar qué pantallas ve el chofer en cada entrega.`
            }
            cta="Configurar flow"
            disabled
          />
          <FutureSection
            title="Flotilla asignada"
            description="Camionetas y choferes que atienden a este cliente. Puede ser pool global (default) o exclusivo (premium)."
            cta="Asignar flotilla"
            disabled
          />
          <FutureSection
            title="Catálogo de tiendas"
            description={
              customer.id === 'neto-real'
                ? `${metrics.storeCount} tiendas activas hoy. Cuando entre el feature, vas a poder filtrar por sub-región, importar masivo y separar por contrato.`
                : 'Catálogo aislado por cliente. Importación masiva desde XLS/CSV.'
            }
            cta={customer.id === 'neto-real' ? 'Ver tiendas actuales' : 'Importar catálogo'}
            href={customer.id === 'neto-real' ? '/settings/stores' : undefined}
            disabled={customer.id !== 'neto-real'}
          />
          <FutureSection
            title="Reportes y facturación"
            description="KPIs filtrables por cliente, exportación mensual de entregas para facturación interna y SLA tracking por contrato."
            cta="Ver reportes"
            disabled
          />
        </div>

        {/* Sección de contacto */}
        <Card className="border-[var(--color-border)]">
          <CardHeader title="Información de contacto" />
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <Field label="Contacto" value={customer.contactName ?? '—'} />
            <Field label="Email" value={customer.contactEmail ?? '—'} />
            <Field label="Código" value={customer.code} mono />
            <Field label="Contrato desde" value={customer.contractStart ?? '—'} />
          </dl>
        </Card>
      </div>
    </>
  );
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="border-[var(--color-border)]">
      <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--vf-text-mute)' }}>
        {label}
      </p>
      <p className="mt-1 font-mono text-2xl tabular-nums" style={{ color: 'var(--vf-text)' }}>
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-[10.5px]" style={{ color: 'var(--vf-text-faint)' }}>
          {sub}
        </p>
      )}
    </Card>
  );
}

function FutureSection({
  title,
  description,
  cta,
  href,
  disabled,
}: {
  title: string;
  description: string;
  cta: string;
  href?: string;
  disabled?: boolean;
}) {
  const inner = (
    <Card className="h-full border-[var(--color-border)] bg-[var(--vf-surface-2)]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--vf-text)' }}>
          {title}
        </h3>
        {disabled && <Badge tone="neutral">Próximamente</Badge>}
      </div>
      <p
        className="mt-2 text-[12.5px] leading-relaxed"
        style={{ color: 'var(--vf-text-mute)' }}
      >
        {description}
      </p>
      <div className="mt-3">
        <Button variant={disabled ? 'ghost' : 'secondary'} size="sm" disabled={disabled}>
          {cta}
        </Button>
      </div>
    </Card>
  );
  return href && !disabled ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[12px]" style={{ color: 'var(--vf-text-mute)' }}>
        {label}
      </dt>
      <dd
        className={mono ? 'font-mono text-[12.5px]' : 'text-[12.5px]'}
        style={{ color: 'var(--vf-text)' }}
      >
        {value}
      </dd>
    </div>
  );
}

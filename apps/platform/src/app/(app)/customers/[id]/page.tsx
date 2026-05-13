// Detalle de un cliente — UI shell.
// Para NETO: métricas reales desde BD. Para preview: mockup.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button, Card, CardHeader, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { createServerClient } from '@tripdrive/supabase/server';
import { listStores } from '@/lib/queries/stores';
import { listRoutes } from '@/lib/queries/routes';
import { listDrivers } from '@/lib/queries/drivers';
import { listVehicles } from '@/lib/queries/vehicles';
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

  // Datos operativos extra para cards funcionales (no solo para NETO real —
  // si llega un preview, quedan en cero pero el render no rompe).
  let driversCount = 0;
  let vehiclesCount = 0;
  let activeRoutesToday = 0;

  if (!customer.isPreview && customer.id === 'neto-real') {
    const stores = await listStores();
    // Tiros del mes actual (todos los stores son de NETO mientras shell)
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const [routesData, drivers, vehicles] = await Promise.all([
      listRoutes({ limit: 200 }),
      listDrivers({ activeOnly: true }),
      listVehicles({ activeOnly: true }),
    ]);

    const routesThisMonth = routesData.rows.filter((r) => r.date >= firstOfMonth);
    const routeIdsThisMonth = routesThisMonth.map((r) => r.id);
    const dispatchesThisMonth = new Set(routesThisMonth.map((r) => r.dispatchId)).size;
    activeRoutesToday = routesData.rows.filter(
      (r) => r.date === today && (r.status === 'PUBLISHED' || r.status === 'IN_PROGRESS'),
    ).length;
    driversCount = drivers.length;
    vehiclesCount = vehicles.length;

    const avgKm =
      routesThisMonth.filter((r) => r.totalDistanceMeters && r.totalDistanceMeters > 0).length > 0
        ? routesThisMonth.reduce((acc, r) => acc + (r.totalDistanceMeters ?? 0), 0) /
          routesThisMonth.filter((r) => r.totalDistanceMeters && r.totalDistanceMeters > 0).length /
          1000
        : 0;

    // Entregas mes + on-time rate desde stops/delivery_reports.
    const supabase = await createServerClient();
    let deliveriesThisMonth = 0;
    let onTimeRate = 0;
    if (routeIdsThisMonth.length > 0) {
      const { data: doneStops } = await supabase
        .from('stops')
        .select('id, actual_arrival_at, planned_arrival_at, status')
        .in('route_id', routeIdsThisMonth)
        .in('status', ['completed', 'arrived']);
      const completed = (doneStops ?? []) as Array<{
        actual_arrival_at: string | null;
        planned_arrival_at: string | null;
      }>;
      deliveriesThisMonth = completed.length;

      // On-time = actual_arrival <= planned_arrival + 15 min tolerance.
      const TOLERANCE_MS = 15 * 60 * 1000;
      const withBoth = completed.filter(
        (s) => s.actual_arrival_at !== null && s.planned_arrival_at !== null,
      );
      if (withBoth.length > 0) {
        const onTime = withBoth.filter((s) => {
          const a = new Date(s.actual_arrival_at!).getTime();
          const p = new Date(s.planned_arrival_at!).getTime();
          return a - p <= TOLERANCE_MS;
        }).length;
        onTimeRate = (onTime / withBoth.length) * 100;
      }
    }

    metrics = {
      storeCount: stores.length,
      dispatchesThisMonth,
      deliveriesThisMonth,
      onTimeRate,
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

        {/* Operación activa hoy */}
        {!customer.isPreview && customer.id === 'neto-real' && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <FlowSection
              customerName={customer.name}
              customerId={customer.id}
              isPreview={false}
            />
            <FleetSection
              driversCount={driversCount}
              vehiclesCount={vehiclesCount}
              activeRoutesToday={activeRoutesToday}
              isPreview={false}
            />
            <FutureSection
              title="Catálogo de tiendas"
              description={`${metrics.storeCount} tiendas activas. Importa masivo (XLS/CSV) o gestiona individualmente. Geocoding via Google Maps + verificación manual.`}
              cta="Ver / agregar tiendas"
              href="/settings/stores"
            />
            <ReportsSection
              deliveriesThisMonth={metrics.deliveriesThisMonth}
              onTimeRate={metrics.onTimeRate}
              isPreview={false}
            />
          </div>
        )}

        {/* Cliente preview: sigue mostrando shell con "Próximamente" porque no hay datos reales. */}
        {customer.isPreview && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <FutureSection
              title="Flow del chofer"
              description={`Configuración personalizada para ${customer.name} — qué pantallas activar, parámetros por entrega, validaciones específicas.`}
              cta="Configurar flow"
              disabled
            />
            <FutureSection
              title="Flotilla asignada"
              description="Camionetas y choferes que atienden a este cliente. Pool global (default) o exclusivo (premium)."
              cta="Asignar flotilla"
              disabled
            />
            <FutureSection
              title="Catálogo de tiendas"
              description="Catálogo aislado por cliente. Importación masiva desde XLS/CSV."
              cta="Importar catálogo"
              disabled
            />
            <FutureSection
              title="Reportes y facturación"
              description="KPIs filtrables por cliente, exportación mensual de entregas y SLA tracking por contrato."
              cta="Ver reportes"
              disabled
            />
          </div>
        )}

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

function FlowSection({
  customerName,
  customerId,
  isPreview,
}: {
  customerName: string;
  customerId: string;
  isPreview: boolean;
}) {
  // El flow real está hardcoded en @tripdrive/flow-engine — mostramos los pasos
  // canónicos del flow "Entrega" que es el 99% del volumen operativo.
  const entregaSteps = [
    { id: 'arrival_exhibit', label: 'Llegada + foto del exhibidor' },
    { id: 'incident_check', label: 'Detección de incidencia' },
    { id: 'product_arranged', label: 'Confirmación de mercancía' },
    { id: 'waste_check', label: 'Validación de merma' },
    { id: 'receipt_check', label: 'Subida del ticket / OCR' },
    { id: 'other_incident_check', label: 'Otra incidencia (si aplica)' },
    { id: 'finish', label: 'Cierre + push al supervisor' },
  ];

  return (
    <Card className="h-full border-[var(--color-border)] bg-[var(--vf-surface-2)]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--vf-text)' }}>
          Flow del chofer
        </h3>
        <Badge tone="success">Activo</Badge>
      </div>
      <p
        className="mt-2 text-[12.5px] leading-relaxed"
        style={{ color: 'var(--vf-text-mute)' }}
      >
        {customerName} usa el flow estándar TripDrive. {entregaSteps.length} pasos
        para entregas regulares; ramas adicionales para tiendas cerradas y báscula.
      </p>
      <ol className="mt-3 space-y-1 text-[12px]" style={{ color: 'var(--vf-text)' }}>
        {entregaSteps.map((s, i) => (
          <li key={s.id} className="flex items-baseline gap-2">
            <span
              className="font-mono tabular-nums"
              style={{ color: 'var(--vf-text-faint)' }}
            >
              {String(i + 1).padStart(2, '0')}.
            </span>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-center gap-2">
        <Link href={`/customers/${customerId}/flow`}>
          <Button variant="secondary" size="sm">
            Ver pantallas + configurar
          </Button>
        </Link>
        <Badge tone="info">Custom per cliente · Stream A3</Badge>
      </div>
    </Card>
  );
}

function FleetSection({
  driversCount,
  vehiclesCount,
  activeRoutesToday,
  isPreview,
}: {
  driversCount: number;
  vehiclesCount: number;
  activeRoutesToday: number;
  isPreview: boolean;
}) {
  return (
    <Card className="h-full border-[var(--color-border)] bg-[var(--vf-surface-2)]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--vf-text)' }}>
          Flotilla asignada
        </h3>
        <Badge tone="neutral">Pool global</Badge>
      </div>
      <p
        className="mt-2 text-[12.5px] leading-relaxed"
        style={{ color: 'var(--vf-text-mute)' }}
      >
        {vehiclesCount} camioneta(s) y {driversCount} chofer(es) activo(s). Hoy hay{' '}
        <strong>{activeRoutesToday}</strong> ruta(s) operando en piso.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/drivers">
          <Button variant="secondary" size="sm">
            Choferes ({driversCount})
          </Button>
        </Link>
        <Link href="/settings/vehicles">
          <Button variant="secondary" size="sm">
            Camionetas ({vehiclesCount})
          </Button>
        </Link>
      </div>
      <p className="mt-3 text-[11px]" style={{ color: 'var(--vf-text-faint)' }}>
        Segmentación exclusiva por cliente · Stream A3 (premium tier).
      </p>
    </Card>
  );
}

function ReportsSection({
  deliveriesThisMonth,
  onTimeRate,
  isPreview,
}: {
  deliveriesThisMonth: number;
  onTimeRate: number;
  isPreview: boolean;
}) {
  return (
    <Card className="h-full border-[var(--color-border)] bg-[var(--vf-surface-2)]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--vf-text)' }}>
          Reportes y facturación
        </h3>
        <Badge tone="success">Disponible</Badge>
      </div>
      <p
        className="mt-2 text-[12.5px] leading-relaxed"
        style={{ color: 'var(--vf-text-mute)' }}
      >
        Dashboard con KPIs operativos completos: entregas, anomalías, choferes,
        tiendas, mapa en vivo. Exportación XLSX para facturación interna.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link href="/reports">
          <Button variant="secondary" size="sm" className="w-full">
            Ver reportes
          </Button>
        </Link>
        <Link href="/dashboard">
          <Button variant="secondary" size="sm" className="w-full">
            Dashboard
          </Button>
        </Link>
      </div>
      <p className="mt-3 text-[11px]" style={{ color: 'var(--vf-text-faint)' }}>
        {deliveriesThisMonth} entrega(s) este mes · {onTimeRate.toFixed(1)}% on-time
        · Facturación Stripe automática · Stream A6.
      </p>
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

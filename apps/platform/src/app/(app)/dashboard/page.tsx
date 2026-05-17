// Dashboard cliente — Sprint 14 / ADR-028.
//
// Server Component: lee searchParams (?from=&to=&zone=) y dispara queries en
// paralelo. Re-renderea cuando los filtros cambian via URL. Sin client-state.
//
// Defaults:
//   - Rango: últimos 30 días en zona horaria del tenant
//   - Zona: ninguna (RLS decide — admin ve todo, zone_manager ve su zona)
//
// Roles permitidos: admin, dispatcher, zone_manager.

import { PageHeader } from '@tripdrive/ui';
import { todayInZone } from '@tripdrive/utils';
import { requireRole } from '@/lib/auth';
import { getCallerFeatures } from '@/lib/plans-gate';
import { listZones } from '@/lib/queries/zones';
import {
  getDashboardOverview,
  getDashboardDailySeries,
  getDashboardTopStores,
  getDashboardTopDrivers,
} from '@/lib/queries/dashboard';
import { DashboardFilters } from './dashboard-filters';
import { ExportButton } from './export-button';
import { KpiGrid } from './kpi-grid';
import { DailyChart } from './daily-chart';
import { TopTables } from './top-tables';
import { PushOptIn } from '@/components/notifications/push-opt-in';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const DEFAULT_TZ = 'America/Mexico_City';
const DEFAULT_RANGE_DAYS = 30;

interface SearchParams {
  from?: string;
  to?: string;
  zone?: string;
}

function defaultRange(timezone: string): { from: string; to: string } {
  const today = todayInZone(timezone);
  // Sumar/restar días en formato YYYY-MM-DD
  const toDate = new Date(today + 'T00:00:00Z');
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - (DEFAULT_RANGE_DAYS - 1));
  return {
    from: fromDate.toISOString().slice(0, 10),
    to: today,
  };
}

interface Props {
  searchParams: Promise<SearchParams>;
}

export default async function DashboardPage({ searchParams }: Props) {
  // ADR-124 (V3): zone_manager también ve dashboard read-only. Si tiene
  // zoneId asignado, las queries ya filtran por su zona (lógica existente
  // `profile.role === 'zone_manager' ? profile.zoneId : params.zone`). Si
  // es customer-wide (zoneId null), pasa params.zone como cualquier otro.
  const profile = await requireRole('admin', 'dispatcher', 'zone_manager');
  const params = await searchParams;
  const timezone = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? DEFAULT_TZ;
  // ADR-121 Fase 1: el banner de push solo aparece si el plan lo incluye.
  // El API /api/push/subscribe también gatea (defense-in-depth).
  const { features: planFeatures } = await getCallerFeatures();

  const range = defaultRange(timezone);
  const from = params.from || range.from;
  const to = params.to || range.to;

  // ADR-124: zone_manager SCOPED (con zoneId) forzamos su zona. zone_manager
  // CUSTOMER-WIDE (zoneId null) y admin/dispatcher respetan el filtro opcional.
  const isScopedSupervisor =
    profile.role === 'zone_manager' && profile.zoneId !== null;
  const zoneId = isScopedSupervisor ? profile.zoneId : params.zone || null;

  const filters = { from, to, zoneId };

  // Cargar todo en paralelo: 4 queries independientes. Solo el supervisor
  // scoped salta el fetch de zones porque no necesita el selector.
  const [overview, dailySeries, topStores, topDrivers, zones] = await Promise.all([
    getDashboardOverview(filters),
    getDashboardDailySeries(filters),
    getDashboardTopStores({ ...filters, limit: 10 }),
    getDashboardTopDrivers({ ...filters, limit: 10 }),
    isScopedSupervisor ? Promise.resolve([]) : listZones(),
  ]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Métricas operativas del ${formatDateLabel(from)} al ${formatDateLabel(to)}`}
        action={<ExportButton defaultFrom={from} defaultTo={to} defaultZone={zoneId} />}
      />

      {/* Banner discreto para activar push notifications del SO. Se auto-oculta
          tras suscribir o si el browser rechazó. ADR-121: solo si el plan lo
          incluye — escondido completo para Starter/sin push. */}
      {planFeatures.pushNotifications && <PushOptIn />}

      <DashboardFilters
        zones={zones.map((z) => ({ id: z.id, name: z.name }))}
        showZoneSelector={!isScopedSupervisor}
      />

      <KpiGrid overview={overview} />

      <DailyChart data={dailySeries} />

      <TopTables topStores={topStores} topDrivers={topDrivers} />
    </>
  );
}

function formatDateLabel(iso: string): string {
  // YYYY-MM-DD → "DD/MM/YYYY"
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

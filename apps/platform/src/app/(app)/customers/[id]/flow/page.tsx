// Sub-página /customers/[id]/flow — preview visual del flow del chofer +
// settings editables. Pensado para que los socios entiendan qué hace la app
// del chofer sin necesidad de instalar el APK.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button, Card, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { createServerClient } from '@tripdrive/supabase/server';
import { getCustomerPreview } from '@/lib/customers-preview';
import { FlowMockup } from './flow-mockup';
import { FlowSettingsForm } from './settings-form';

export const metadata = { title: 'Flow del chofer' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const DEFAULTS = {
  entrega: 300,
  tiendaCerrada: 1000,
  bascula: 300,
};

export default async function CustomerFlowPage({ params }: PageProps) {
  await requireRole('admin', 'dispatcher');
  const { id } = await params;
  const customer = getCustomerPreview(id);
  if (!customer) notFound();

  // Leer overrides actuales del customer activo (verdfrut hoy).
  let initial = DEFAULTS;
  if (!customer.isPreview) {
    const supabase = await createServerClient();
    const { data } = await supabase
      .from('customers')
      .select('flow_engine_overrides')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    const overrides = (data?.flow_engine_overrides ?? {}) as {
      arrival_radius_meters?: {
        entrega?: number;
        tienda_cerrada?: number;
        bascula?: number;
      };
    };
    const radii = overrides.arrival_radius_meters;
    if (radii) {
      initial = {
        entrega: radii.entrega ?? DEFAULTS.entrega,
        tiendaCerrada: radii.tienda_cerrada ?? DEFAULTS.tiendaCerrada,
        bascula: radii.bascula ?? DEFAULTS.bascula,
      };
    }
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span>Flow del chofer</span>
            <Badge tone="success">Activo</Badge>
          </span>
        }
        description={`Cómo opera la app del chofer en cada parada para ${customer.name}.`}
        action={
          <Link href={`/customers/${customer.id}`}>
            <Button variant="ghost" size="sm">
              ← Volver a {customer.name}
            </Button>
          </Link>
        }
      />

      <div className="flex flex-col gap-5">
        {/* Mockup visual del flow */}
        <Card className="border-[var(--color-border)]">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <h2
                className="text-[15px] font-semibold"
                style={{ color: 'var(--vf-text)' }}
              >
                Vista previa: flow Entrega
              </h2>
              <p
                className="text-[12px]"
                style={{ color: 'var(--vf-text-mute)' }}
              >
                7 pasos · ~3 minutos por parada · cubre el 95% del volumen
              </p>
            </div>
            <Badge tone="info">Misma para todos los clientes hoy</Badge>
          </div>
          <FlowMockup />
          <p
            className="mt-3 text-[11px]"
            style={{ color: 'var(--vf-text-faint)' }}
          >
            ↔ Desliza horizontalmente para ver todos los pasos. Los flows
            &quot;tienda cerrada&quot; y &quot;báscula&quot; son variantes
            similares con pantallas distintas en los pasos 2-5.
          </p>
        </Card>

        {/* Settings editables */}
        <FlowSettingsForm customerSlug={customer.id} initial={initial} />

        {/* Próximo: pantallas custom per-cliente */}
        <Card className="border-[var(--color-border)] bg-[var(--vf-surface-2)]">
          <h3
            className="text-[14px] font-semibold"
            style={{ color: 'var(--vf-text)' }}
          >
            Personalización avanzada
          </h3>
          <p
            className="mt-1 text-[12px]"
            style={{ color: 'var(--vf-text-mute)' }}
          >
            Stream A3 introduce flow data-driven — vas a poder agregar,
            quitar o reordenar pasos per-customer (ej. NETO requiere foto
            del precio del producto, OXXO requiere captura del medidor de
            refrigerador). Lo que hoy es hardcoded en código pasará a tabla{' '}
            <code className="font-mono">customer_flow_steps</code> editable
            desde aquí.
          </p>
          <p className="mt-2 text-[11px]" style={{ color: 'var(--vf-text-faint)' }}>
            Issue #269 — flow editor visual con drag-and-drop de pasos.
          </p>
        </Card>
      </div>
    </>
  );
}

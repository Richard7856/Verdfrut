// Stub del onboarding wizard — Sprint 19 lo implementa.

import { PageHeader, Card } from '@tripdrive/ui';

export const metadata = { title: 'Onboardear cliente' };

export default function NewTenantPage() {
  return (
    <>
      <PageHeader
        title="Onboardear cliente"
        description="Crear proyecto Supabase + aplicar migrations + registrar"
        breadcrumb={
          <a href="/tenants" className="hover:underline">
            Tenants
          </a>
        }
      />

      <Card>
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Pendiente — Sprint 19</h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          El wizard automatiza lo que hoy hace <code>scripts/provision-tenant.sh</code>:
        </p>
        <ol className="mt-3 ml-4 list-decimal text-sm text-[var(--color-text-muted)]">
          <li>Pedir slug / nombre / plan / TZ / contacto</li>
          <li>Crear proyecto Supabase via Management API</li>
          <li>Esperar status ACTIVE_HEALTHY (1-3 min)</li>
          <li>Aplicar migraciones de <code>supabase/migrations/</code></li>
          <li>Configurar Auth redirect URLs (issue #14, ya automatizado)</li>
          <li>Insertar fila en <code>control_plane.tenants</code> con status=&apos;active&apos;</li>
          <li>Loguear en <code>control_plane.audit_log</code></li>
        </ol>
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          Mientras tanto, usa el script bash existente y registra el tenant manualmente
          en <code>control_plane.tenants</code> via Supabase Studio.
        </p>
      </Card>
    </>
  );
}

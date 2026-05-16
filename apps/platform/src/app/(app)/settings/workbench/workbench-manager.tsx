'use client';

// Cliente component del panel de administración del Workbench.
// Render del estado actual + botones de toggle y reset.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, toast } from '@tripdrive/ui';
import type { WorkbenchMode } from '@/lib/workbench-mode';
import { setWorkbenchModeAction, resetSandboxAction } from './actions';

interface Stats {
  dispatches: number;
  routes: number;
  stops: number;
  stores: number;
  vehicles: number;
  drivers: number;
}

export function WorkbenchManager({
  mode,
  stats,
  totalSandbox,
}: {
  mode: WorkbenchMode;
  stats: Stats;
  totalSandbox: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isSandbox = mode === 'sandbox';

  function handleToggle() {
    const next: WorkbenchMode = isSandbox ? 'real' : 'sandbox';
    startTransition(async () => {
      const res = await setWorkbenchModeAction(next);
      if (res.ok) {
        toast.success(
          isSandbox ? 'Volviste a operación real' : 'Activaste modo planeación',
        );
        router.refresh();
      } else {
        toast.error('No se pudo cambiar', res.error);
      }
    });
  }

  function handleReset() {
    if (totalSandbox === 0) {
      toast.info('No hay nada que limpiar — el sandbox ya está vacío.');
      return;
    }
    const ok = window.confirm(
      `¿Borrar TODO el contenido del modo planeación?\n\n` +
        `Se eliminarán:\n` +
        `  ${stats.dispatches} tiro(s) · ${stats.routes} ruta(s) · ${stats.stops} parada(s)\n` +
        `  ${stats.stores} tienda(s) hipotética(s) · ${stats.vehicles} camioneta(s) hipotética(s) · ${stats.drivers} chofer(es) hipotético(s)\n\n` +
        `La operación real NO se toca. Esta acción NO se puede deshacer.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const res = await resetSandboxAction();
      if (res.ok) {
        toast.success(
          'Sandbox limpio',
          `Eliminadas ${
            (res.deleted?.dispatches ?? 0) +
            (res.deleted?.routes ?? 0) +
            (res.deleted?.stops ?? 0) +
            (res.deleted?.stores ?? 0) +
            (res.deleted?.vehicles ?? 0) +
            (res.deleted?.drivers ?? 0)
          } entidades.`,
        );
        router.refresh();
      } else {
        toast.error('Error al limpiar sandbox', res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              Estado actual
            </p>
            <p className="mt-1 text-lg font-semibold">
              {isSandbox ? '🧪 Modo planeación activo' : '⚙️ Modo operación real'}
            </p>
          </div>
          <Button
            variant={isSandbox ? 'secondary' : 'primary'}
            onClick={handleToggle}
            isLoading={pending}
          >
            {isSandbox ? 'Volver a operación real' : 'Activar modo planeación'}
          </Button>
        </div>
      </Card>

      <Card>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Contenido en sandbox
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <StatLine label="Tiros" value={stats.dispatches} />
          <StatLine label="Rutas" value={stats.routes} />
          <StatLine label="Paradas" value={stats.stops} />
          <StatLine label="Tiendas hipotéticas" value={stats.stores} />
          <StatLine label="Camionetas hipotéticas" value={stats.vehicles} />
          <StatLine label="Choferes hipotéticos" value={stats.drivers} />
        </div>
      </Card>

      <Card>
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">
          Limpiar sandbox
        </p>
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">
          Borra todo lo que crearon tú y tu equipo en modo planeación. La operación
          real (lo que SÍ ven los choferes y se factura en Stripe) no se toca. Útil
          cuando un escenario quedó obsoleto o quieres empezar limpio.
        </p>
        <Button
          variant="danger"
          onClick={handleReset}
          isLoading={pending}
          disabled={pending}
        >
          🗑 Limpiar todo el sandbox ({totalSandbox})
        </Button>
      </Card>

      <Card>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Herramientas de análisis
        </p>
        <ul className="space-y-2 text-sm">
          <li>
            <a
              href="/settings/workbench/zones"
              className="font-medium underline-offset-2 hover:underline"
              style={{ color: 'var(--vf-green-600, #15803d)' }}
            >
              🗺 Sugerir partición de zona
            </a>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              Analiza una zona y propone cómo partirla en N sub-zonas geográficamente
              coherentes con el algoritmo del optimizer.
            </p>
          </li>
        </ul>
      </Card>

      <Card>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Próximamente
        </p>
        <ul className="space-y-1 text-xs text-[var(--color-text-muted)]">
          <li>• Aplicar sugerencia de partición de zona como sandbox (WB-3b).</li>
          <li>• Recomendación de flotilla por volumen (WB-4).</li>
          <li>• Heatmaps en mapa por frecuencia/kg (WB-5).</li>
          <li>• Vista jerárquica Día→Zona→Frecuencia→Camioneta→Ruta→Parada (WB-6).</li>
        </ul>
      </Card>
    </div>
  );
}

function StatLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-3 py-2">
      <span className="text-[11px] text-[var(--color-text-muted)]">{label}</span>
      <span className="font-mono text-base tabular-nums text-[var(--color-text)]">{value}</span>
    </div>
  );
}

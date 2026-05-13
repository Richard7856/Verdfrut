'use client';

// Form de settings del flow per-customer.
// Hoy solo persiste arrival_radius_meters por tipo de reporte.

import { useState, useTransition } from 'react';
import { Field, Input, Button, Card } from '@tripdrive/ui';
import { updateFlowSettingsAction } from './actions';

interface Props {
  customerSlug: string;
  initial: {
    entrega: number;
    tiendaCerrada: number;
    bascula: number;
  };
}

export function FlowSettingsForm({ customerSlug, initial }: Props) {
  const [entrega, setEntrega] = useState(initial.entrega);
  const [tiendaCerrada, setTiendaCerrada] = useState(initial.tiendaCerrada);
  const [bascula, setBascula] = useState(initial.bascula);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    { type: 'ok'; msg: string } | { type: 'err'; msg: string } | null
  >(null);

  function handleSubmit() {
    setStatus(null);
    startTransition(async () => {
      const res = await updateFlowSettingsAction({
        customerSlug,
        arrivalRadiusEntregaMeters: entrega,
        arrivalRadiusTiendaCerradaMeters: tiendaCerrada,
        arrivalRadiusBasculaMeters: bascula,
      });
      if (res.ok) {
        setStatus({ type: 'ok', msg: 'Configuración guardada. Aplica al próximo rebuild del APK.' });
      } else {
        setStatus({ type: 'err', msg: res.error ?? 'Error desconocido' });
      }
    });
  }

  return (
    <Card className="border-[var(--color-border)]">
      <h3
        className="mb-1 text-[14px] font-semibold"
        style={{ color: 'var(--vf-text)' }}
      >
        Radio de validación de llegada
      </h3>
      <p className="mb-3 text-[12px]" style={{ color: 'var(--vf-text-mute)' }}>
        Distancia máxima entre el chofer y la tienda para marcar &quot;Llegué&quot;. Si
        está más lejos, la app le bloquea y le pide acercarse — previene fraude
        de marcado remoto. Configurable por tipo de reporte.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field
          label="Entrega normal"
          htmlFor="radius-entrega"
          hint="Default 300 m"
        >
          <div className="flex items-center gap-2">
            <Input
              id="radius-entrega"
              type="number"
              min={10}
              max={5000}
              step={10}
              value={entrega}
              onChange={(e) => setEntrega(Number(e.target.value))}
            />
            <span className="text-[11px]" style={{ color: 'var(--vf-text-mute)' }}>
              metros
            </span>
          </div>
        </Field>

        <Field
          label="Tienda cerrada"
          htmlFor="radius-cerrada"
          hint="Default 1000 m"
        >
          <div className="flex items-center gap-2">
            <Input
              id="radius-cerrada"
              type="number"
              min={10}
              max={5000}
              step={10}
              value={tiendaCerrada}
              onChange={(e) => setTiendaCerrada(Number(e.target.value))}
            />
            <span className="text-[11px]" style={{ color: 'var(--vf-text-mute)' }}>
              metros
            </span>
          </div>
        </Field>

        <Field label="Báscula" htmlFor="radius-bascula" hint="Default 300 m">
          <div className="flex items-center gap-2">
            <Input
              id="radius-bascula"
              type="number"
              min={10}
              max={5000}
              step={10}
              value={bascula}
              onChange={(e) => setBascula(Number(e.target.value))}
            />
            <span className="text-[11px]" style={{ color: 'var(--vf-text-mute)' }}>
              metros
            </span>
          </div>
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          {status && (
            <p
              className="text-[12px]"
              style={{
                color:
                  status.type === 'ok'
                    ? 'var(--vf-green-600)'
                    : 'var(--vf-crit, #dc2626)',
              }}
            >
              {status.msg}
            </p>
          )}
        </div>
        <Button onClick={handleSubmit} disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>

      <p className="mt-3 text-[11px]" style={{ color: 'var(--vf-text-faint)' }}>
        ℹ️ Los valores se persisten en BD. El código nativo del chofer leerá esta
        configuración dinámica en el próximo rebuild (issue #268). Por ahora los
        radios efectivos siguen siendo los defaults hardcoded del APK actual.
      </p>
    </Card>
  );
}

'use client';

// Selector de tipo de arrival cuando el chofer llega a una parada.
// 3 opciones: entrega normal, tienda cerrada, báscula no funciona.
//
// Cada botón:
//   1. Pide GPS al chofer (getCurrentDriverCoords)
//   2. Muestra "Calculando ubicación…" mientras llega
//   3. Llama arriveAtStop con (stopId, type, coords)
//   4. Si rejection.reason='too_far' → muestra distancia y deja reintentar
//   5. Si OK → page se refresca y aparece el flujo correspondiente

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '@verdfrut/ui';
import type { ReportType } from '@verdfrut/types';
import { getCurrentDriverCoords, isCoordsError } from '@/lib/geo';
import { arriveAtStop } from '@/app/route/stop/[id]/actions';

interface Props {
  stopId: string;
  storeName: string;
}

interface OptionDef {
  type: ReportType;
  title: string;
  description: string;
  variant: 'primary' | 'secondary' | 'ghost';
}

const OPTIONS: OptionDef[] = [
  {
    type: 'entrega',
    title: 'Iniciar entrega',
    description: 'La tienda está abierta y va a recibir el pedido.',
    variant: 'primary',
  },
  {
    type: 'tienda_cerrada',
    title: 'Tienda cerrada',
    description: 'No hay nadie que reciba — abrir chat con el comercial.',
    variant: 'secondary',
  },
  {
    type: 'bascula',
    title: 'Báscula no funciona',
    description: 'La báscula del receptor no opera — reportar al comercial.',
    variant: 'secondary',
  },
];

export function ArrivalTypeSelector({ stopId, storeName }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<ReportType | null>(null);

  function handleSelect(type: ReportType) {
    setError(null);
    setActiveType(type);
    startTransition(async () => {
      // 1. Pedir GPS.
      const coords = await getCurrentDriverCoords();
      if (isCoordsError(coords)) {
        setError(`No pude leer tu ubicación: ${coords.message}`);
        setActiveType(null);
        return;
      }

      // 2. Server valida + crea report.
      const res = await arriveAtStop(stopId, type, {
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy,
      });
      if (!res.ok) {
        if ('rejection' in res) {
          setError(res.rejection.message);
        } else {
          setError(res.error);
        }
        setActiveType(null);
        return;
      }

      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4 px-4 py-6">
      <Card className="border-[var(--color-border)]">
        <h2 className="text-base font-medium text-[var(--color-text)]">
          Llegaste a {storeName}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Confirma qué tipo de visita es. Vamos a verificar tu ubicación con GPS para
          empezar el reporte.
        </p>
      </Card>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {OPTIONS.map((opt) => {
          const isThisLoading = pending && activeType === opt.type;
          return (
            <Button
              key={opt.type}
              type="button"
              variant={opt.variant}
              size="lg"
              onClick={() => handleSelect(opt.type)}
              disabled={pending}
              isLoading={isThisLoading}
              className="w-full justify-start text-left"
            >
              <div className="flex flex-col items-start">
                <span className="text-base font-semibold">{opt.title}</span>
                <span className="text-xs opacity-80">
                  {isThisLoading ? 'Verificando ubicación…' : opt.description}
                </span>
              </div>
            </Button>
          );
        })}
      </div>

      <p className="text-xs text-[var(--color-text-subtle)]">
        Tu ubicación GPS se compara con la dirección registrada de la tienda. Si estás
        muy lejos, no podrás iniciar el reporte.
      </p>
    </section>
  );
}

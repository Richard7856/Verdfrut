'use client';

// Botón de promover/clonar (Workbench WB-1b, ADR-113).
// Render condicional según el is_sandbox del dispatch:
//   • sandbox=true → "📤 Promover a operación real"
//   • sandbox=false → "🧪 Clonar al sandbox para experimentar"
// El admin click → confirm → server action → redirect al nuevo dispatch.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@tripdrive/ui';
import { cloneDispatchAction } from './clone-action';

export function WorkbenchCloneButton({
  dispatchId,
  sourceIsSandbox,
}: {
  dispatchId: string;
  sourceIsSandbox: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // El target es siempre el opuesto del source.
  const targetSandbox = !sourceIsSandbox;
  const isPromote = !targetSandbox; // sandbox → real
  const label = isPromote
    ? '📤 Promover a operación real'
    : '🧪 Clonar al sandbox';
  const confirmText = isPromote
    ? '¿Promover este tiro a OPERACIÓN REAL?\n\n' +
      'Se creará una copia de todas sus rutas y paradas como tiro real.\n' +
      'El chofer SÍ podrá recibirlo cuando lo publiques.\n\n' +
      'El sandbox original queda intacto (no se borra).'
    : '¿Clonar este tiro al MODO PLANEACIÓN?\n\n' +
      'Se creará una copia idéntica como escenario hipotético para experimentar.\n' +
      'Tus cambios al clon NO afectan la operación real.\n\n' +
      'El tiro real original queda intacto.';

  function handleClick() {
    if (!window.confirm(confirmText)) return;
    startTransition(async () => {
      const res = await cloneDispatchAction(dispatchId, targetSandbox);
      if (!res.ok) {
        toast.error(isPromote ? 'No se pudo promover' : 'No se pudo clonar', res.error);
        return;
      }
      toast.success(
        isPromote ? 'Tiro promovido a operación real' : 'Tiro clonado al sandbox',
        `${res.summary?.routes ?? 0} ruta(s) y ${res.summary?.stops ?? 0} parada(s) copiada(s).`,
      );
      if (res.newDispatchId) {
        router.push(`/dispatches/${res.newDispatchId}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <Button
      type="button"
      variant={isPromote ? 'primary' : 'secondary'}
      size="sm"
      onClick={handleClick}
      isLoading={pending}
      disabled={pending}
      title={
        isPromote
          ? 'Copia este escenario sandbox a operación real (los choferes podrán recibirlo).'
          : 'Copia este tiro real al sandbox para probar variaciones sin tocar la operación.'
      }
    >
      {label}
    </Button>
  );
}

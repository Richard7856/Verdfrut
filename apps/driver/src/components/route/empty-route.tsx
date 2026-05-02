// Estado vacío cuando el chofer no tiene ruta asignada hoy.

import { Card } from '@verdfrut/ui';

interface Props {
  driverName: string;
  todayLabel: string;
}

export function EmptyRoute({ driverName, todayLabel }: Props) {
  return (
    <Card className="border-[var(--color-border)] m-4">
      <h2 className="text-base font-medium">Hola, {driverName.split(' ')[0]}</h2>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        No tienes una ruta asignada para hoy ({todayLabel}). Si esperas trabajar, contacta a tu encargado.
      </p>
      <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
        Cuando tu ruta esté lista la verás aquí automáticamente.
      </p>
    </Card>
  );
}

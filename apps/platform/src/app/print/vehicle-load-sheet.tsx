// Hoja imprimible de UNA camioneta — pensada para el almacenista que arma el
// layout de carga. El orden de la tabla es por sequence (orden de entrega).
// Una nota recordatoria pide cargar en orden INVERSO al recorrido (última
// parada cerca de la puerta, primera al fondo) — es la regla operativa estándar
// de reparto.

import type { Route, Stop, Store, Vehicle, Depot } from '@tripdrive/types';

interface Props {
  route: Route;
  stops: Stop[];
  storesById: Map<string, Store>;
  vehicle: Vehicle | undefined;
  /** Nombre del chofer ya resuelto (o null si la ruta no tiene asignación). */
  driverName: string | null;
  /** Depot efectivo (override o el del vehículo). */
  depot: Depot | null;
  /** Zona resuelta (code + name) para el header. */
  zone: { code: string; name: string } | null;
  /** Hora de generación del PDF — para auditoría en el header. */
  generatedAt: Date;
  /** Timezone del tenant. */
  timezone: string;
}

export function VehicleLoadSheet({
  route,
  stops,
  storesById,
  vehicle,
  driverName,
  depot,
  zone,
  generatedAt,
  timezone,
}: Props) {
  const totalKg = stops.reduce((sum, s) => {
    // Convención del proyecto: load[0] = kg/cajas (dimensión primaria de capacidad).
    return sum + (Number(s.load?.[0] ?? 0) || 0);
  }, 0);

  const fmtTime = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat('es-MX', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(iso))
      : '—';

  const fmtDateLong = (yyyymmdd: string): string => {
    const [y, m, d] = yyyymmdd.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return new Intl.DateTimeFormat('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  };

  const fmtGenerated = new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(generatedAt);

  const vehicleLabel =
    vehicle?.alias && vehicle.plate
      ? `${vehicle.alias} · ${vehicle.plate}`
      : vehicle?.alias ?? vehicle?.plate ?? '—';

  return (
    <article className="print-sheet">
      <header className="print-sheet-header">
        <div className="print-sheet-title">
          <h1>Layout de camioneta</h1>
          <p className="print-sheet-meta">
            Generado {fmtGenerated} · ruta v{route.version}
          </p>
        </div>
        <div className="print-sheet-vehicle">
          <p className="print-sheet-vehicle-name">{vehicleLabel}</p>
          <p className="print-sheet-vehicle-route">{route.name}</p>
        </div>
      </header>

      <section className="print-sheet-summary">
        <Field label="Fecha">{fmtDateLong(route.date)}</Field>
        <Field label="Zona">{zone ? `${zone.code} · ${zone.name}` : '—'}</Field>
        <Field label="Chofer">{driverName ?? 'Sin asignar'}</Field>
        <Field label="Sale de">{depot ? `${depot.code} · ${depot.name}` : '—'}</Field>
        <Field label="Salida estimada">{fmtTime(route.estimatedStartAt)}</Field>
        <Field label="Regreso estimado">{fmtTime(route.estimatedEndAt)}</Field>
        <Field label="Paradas">{stops.length}</Field>
        <Field label="Carga total">{totalKg > 0 ? `${totalKg} kg / cajas` : '—'}</Field>
      </section>

      {route.optimizationSkipped && (
        <p className="print-sheet-warning">
          ⚠️ Esta ruta NO pasó por el optimizador. El orden de paradas fue
          definido manualmente por el dispatcher.
        </p>
      )}

      <p className="print-sheet-rule">
        Cargar en orden <strong>inverso</strong> al de entrega: la última parada
        (#{stops.length || '—'}) va más cerca de la puerta, la primera (#1) al
        fondo. La tabla está ordenada por orden de visita.
      </p>

      <table className="print-sheet-table">
        <thead>
          <tr>
            <th className="print-col-seq">#</th>
            <th className="print-col-code">Código</th>
            <th className="print-col-store">Tienda</th>
            <th className="print-col-addr">Dirección</th>
            <th className="print-col-kg">Kg / Cajas</th>
            <th className="print-col-eta">ETA</th>
            <th className="print-col-check">✓</th>
          </tr>
        </thead>
        <tbody>
          {stops.length === 0 && (
            <tr>
              <td colSpan={7} className="print-empty">
                Sin paradas asignadas.
              </td>
            </tr>
          )}
          {stops.map((s) => {
            const store = storesById.get(s.storeId);
            const kg = Number(s.load?.[0] ?? 0) || 0;
            return (
              <tr key={s.id}>
                <td className="print-col-seq">{s.sequence}</td>
                <td className="print-col-code">{store?.code ?? '—'}</td>
                <td className="print-col-store">{store?.name ?? '(tienda no encontrada)'}</td>
                <td className="print-col-addr">{store?.address ?? '—'}</td>
                <td className="print-col-kg">{kg > 0 ? kg : '—'}</td>
                <td className="print-col-eta">{fmtTime(s.plannedArrivalAt)}</td>
                <td className="print-col-check"></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <footer className="print-sheet-footer">
        <div className="print-sheet-signature">
          <div className="print-sheet-signline" />
          <p>Firma almacenista</p>
        </div>
        <div className="print-sheet-signature">
          <div className="print-sheet-signline" />
          <p>Firma chofer</p>
        </div>
        <div className="print-sheet-signature">
          <div className="print-sheet-signline" />
          <p>Hora de salida real</p>
        </div>
      </footer>
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="print-field">
      <span className="print-field-label">{label}</span>
      <span className="print-field-value">{children}</span>
    </div>
  );
}

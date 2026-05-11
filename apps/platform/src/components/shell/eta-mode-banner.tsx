// Banner de transparencia operativa — ADR-052.
//
// Cuando MAPBOX_DIRECTIONS_TOKEN NO está configurado en el server, el
// optimizer cae a haversine + factor 1.4 / 25 km/h para calcular ETAs.
// Los números son "directionales" pero pueden errar 20-40% en zonas con
// tráfico real o desvíos por carretera. Antes de este banner el dispatcher
// no tenía forma de saber si lo que veía era Mapbox real o haversine.
//
// Server component — verifica env var en el server (NUNCA exponer
// MAPBOX_DIRECTIONS_TOKEN al cliente).

interface Props {
  /** Si true, el banner se renderiza. Server component decide. */
  show: boolean;
}

/** Render del banner — el padre decide cuándo mostrarlo. */
export function EtaModeBanner({ show }: Props) {
  if (!show) return null;
  return (
    <div
      className="mb-3 rounded-[var(--radius-md)] border px-3 py-2 text-xs"
      style={{
        borderColor: 'var(--color-warning-border, #fbbf24)',
        background: 'var(--color-warning-bg, #fef3c7)',
        color: 'var(--color-warning-fg, #92400e)',
      }}
      role="status"
    >
      <strong>ETAs aproximados:</strong> el optimizador está usando estimación
      por línea recta (haversine ×1.4 / 25 km/h). Para tiempos reales por
      carretera y tráfico, configura{' '}
      <code className="rounded px-1" style={{ background: 'rgba(0,0,0,0.05)' }}>
        MAPBOX_DIRECTIONS_TOKEN
      </code>{' '}
      en Vercel. Los km y minutos pueden errar 20-40% sin esto.
    </div>
  );
}

/**
 * Helper para que los pages decidan si mostrar el banner. Lee env del server.
 * El llamado debe estar en un Server Component.
 */
export function isEtaModeDemo(): boolean {
  return !process.env.MAPBOX_DIRECTIONS_TOKEN;
}

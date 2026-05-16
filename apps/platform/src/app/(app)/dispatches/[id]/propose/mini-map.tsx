'use client';

// Mini-mapa SVG ligero — visualiza la distribución espacial de los stops
// de una alternativa de plan. No usa Mapbox (cero JS pesado, cero API calls)
// — solo SVG con dots coloreados por ruta + líneas conectando en orden de
// visita.
//
// Trade-off intencional: NO muestra calles ni geometría real de rutas; solo
// la "forma" de cada cluster (qué área cubre cada vehículo). Para el dispatcher
// es lo que importa al comparar 3 alternativas lado-a-lado: identificar visual
// rápido cuál opción tiene clusters más compactos vs cruzados.

interface Props {
  /** Cada ruta = array de [lng, lat] en orden de visita. */
  routeCoords: Array<Array<[number, number]>>;
  /** Colores hex por ruta — paralelo a routeCoords. */
  routeColors: string[];
  width?: number;
  height?: number;
}

export function MiniMap({ routeCoords, routeColors, width = 280, height = 140 }: Props) {
  // 1. Calcular bounding box de TODOS los stops para que el zoom encaje.
  const allPoints = routeCoords.flat();
  if (allPoints.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-[var(--color-border)] bg-[var(--vf-surface-2)] text-[10px] text-[var(--color-text-muted)]"
        style={{ width, height }}
      >
        Sin paradas para previsualizar
      </div>
    );
  }

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of allPoints) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  // Padding del bbox para que los dots no toquen el borde.
  const pad = 0.005;
  minLng -= pad;
  maxLng += pad;
  minLat -= pad;
  maxLat += pad;
  // Evitar divisiones por 0 si todos los stops son el mismo punto.
  const lngRange = Math.max(maxLng - minLng, 0.001);
  const latRange = Math.max(maxLat - minLat, 0.001);

  // 2. Proyección equirectangular simple (suficiente para escalas urbanas).
  //    Y invertido porque SVG crece hacia abajo.
  const project = (lng: number, lat: number): [number, number] => {
    const x = ((lng - minLng) / lngRange) * width;
    const y = height - ((lat - minLat) / latRange) * height;
    return [x, y];
  };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-1)]"
      role="img"
      aria-label="Mini mapa de la alternativa"
    >
      {/* Background tenue para diferenciar del fondo */}
      <rect width={width} height={height} fill="var(--vf-surface-2, #1a1a1a)" />

      {/* Por cada ruta: líneas conectando los stops en orden + dots */}
      {routeCoords.map((coords, routeIdx) => {
        if (coords.length === 0) return null;
        const color = routeColors[routeIdx] ?? '#6b7280';
        const projected = coords.map(([lng, lat]) => project(lng, lat));
        const pathD = projected
          .map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`))
          .join(' ');
        return (
          <g key={routeIdx}>
            {/* Polyline visitando los stops en orden */}
            <path
              d={pathD}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeOpacity={0.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Dots */}
            {projected.map(([x, y], stopIdx) => (
              <circle
                key={stopIdx}
                cx={x}
                cy={y}
                r={2.5}
                fill={color}
                stroke="#fff"
                strokeWidth={0.5}
                strokeOpacity={0.3}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

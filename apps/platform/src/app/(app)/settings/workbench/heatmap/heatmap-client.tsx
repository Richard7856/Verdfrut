'use client';

// Cliente Mapbox del heatmap (WB-5 / ADR-117).
//
// Estrategia visual:
//   • frequency/volume → mapboxgl heatmap layer + circle layer encima para
//     puntos individuales identificables al hacer zoom.
//   • utilization → circle layer SIN heatmap (no es densidad, es categoría);
//     color del círculo determinado por el utilizationPct de la zona.
//
// El weight del heatmap se normaliza al max del dataset para que el calor
// se distribuya en el rango completo sin importar la escala absoluta.

import { useEffect, useRef } from 'react';
import { mapboxgl, setMapboxToken } from '@tripdrive/maps';
import type { HeatmapData } from '@/lib/queries/heatmap-data';

type Mode = 'frequency' | 'volume' | 'utilization';

interface Props {
  data: HeatmapData;
  mode: Mode;
  mapboxToken: string;
}

const SOURCE_ID = 'wb5-stores';
const HEATMAP_LAYER_ID = 'wb5-heatmap';
const CIRCLE_LAYER_ID = 'wb5-circles';

export function HeatmapClient({ data, mode, mapboxToken }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    setMapboxToken(mapboxToken);

    const bounds = new mapboxgl.LngLatBounds();
    for (const s of data.stores) bounds.extend([s.lng, s.lat]);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      bounds: bounds.isEmpty() ? undefined : bounds,
      fitBoundsOptions: { padding: 50, maxZoom: 12 },
      attributionControl: false,
    });
    mapRef.current = map;

    map.on('load', () => {
      const features = data.stores.map((s) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
        properties: {
          id: s.id,
          code: s.code,
          name: s.name,
          zoneCode: s.zoneCode,
          visitsPerWeek: s.visitsPerWeek,
          kgPerWeek: s.kgPerWeek,
          zoneUtilizationPct: s.zoneUtilizationPct,
        },
      }));

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      const isHeatmapMode = mode !== 'utilization';

      if (isHeatmapMode) {
        const weightProp = mode === 'frequency' ? 'visitsPerWeek' : 'kgPerWeek';
        const maxVal = mode === 'frequency' ? data.max.visitsPerWeek : data.max.kgPerWeek;
        map.addLayer({
          id: HEATMAP_LAYER_ID,
          type: 'heatmap',
          source: SOURCE_ID,
          paint: {
            // Peso normalizado [0..1] al max del dataset. Si max=0 fallback 1.
            'heatmap-weight': [
              'interpolate',
              ['linear'],
              ['get', weightProp],
              0,
              0,
              Math.max(1, maxVal),
              1,
            ],
            // Intensidad sube con zoom para preservar detalle al acercar.
            'heatmap-intensity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              0,
              1,
              13,
              3,
            ],
            // Paleta amber→rojo (mode=volume "carga") o azul→morado (frequency "movimiento").
            'heatmap-color':
              mode === 'frequency'
                ? [
                    'interpolate',
                    ['linear'],
                    ['heatmap-density'],
                    0, 'rgba(0,0,255,0)',
                    0.2, 'rgba(64,128,255,0.5)',
                    0.5, 'rgba(48,80,200,0.7)',
                    0.8, 'rgba(120,40,200,0.85)',
                    1, 'rgba(180,20,180,0.9)',
                  ]
                : [
                    'interpolate',
                    ['linear'],
                    ['heatmap-density'],
                    0, 'rgba(0,0,0,0)',
                    0.2, 'rgba(255,200,80,0.55)',
                    0.5, 'rgba(245,158,11,0.75)',
                    0.8, 'rgba(220,80,40,0.85)',
                    1, 'rgba(180,30,30,0.92)',
                  ],
            'heatmap-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              0,
              4,
              13,
              30,
            ],
            // Opacidad baja al zoom alto para que los círculos individuales destaquen.
            'heatmap-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              7,
              0.9,
              13,
              0.5,
            ],
          },
        });
      }

      // Circle layer: siempre presente. En modos heatmap son pequeños y oscuros;
      // en modo utilization son grandes y coloreados según pct de zona.
      map.addLayer({
        id: CIRCLE_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint:
          mode === 'utilization'
            ? {
                'circle-radius': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  6, 4,
                  13, 8,
                ],
                'circle-color': [
                  'case',
                  ['>', ['get', 'zoneUtilizationPct'], 100], '#dc2626',
                  ['>', ['get', 'zoneUtilizationPct'], 85], '#d97706',
                  '#15803d',
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1.5,
                'circle-opacity': 0.9,
              }
            : {
                'circle-radius': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  6, 2,
                  13, 5,
                ],
                'circle-color': '#1f2937',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1,
                'circle-opacity': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  6, 0.3,
                  13, 0.95,
                ],
              },
      });

      // Popup al hacer hover/click sobre un círculo.
      map.on('click', CIRCLE_LAYER_ID, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as {
          code: string;
          name: string;
          zoneCode: string;
          visitsPerWeek: number;
          kgPerWeek: number;
          zoneUtilizationPct: number;
        };
        new mapboxgl.Popup({ offset: 10 })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(
            `<div style="font-family: system-ui; font-size: 12px;">
              <strong>${escapeHtml(props.code)}</strong> ${escapeHtml(props.name)}<br/>
              <span style="color:#6b7280">Zona ${escapeHtml(props.zoneCode)}</span><br/>
              ${props.visitsPerWeek} visitas/sem · ${Number(props.kgPerWeek).toLocaleString('es-MX')} kg/sem<br/>
              <span style="color:#6b7280">Uso zona: ${props.zoneUtilizationPct}%</span>
            </div>`,
          )
          .addTo(map);
      });

      map.on('mouseenter', CIRCLE_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', CIRCLE_LAYER_ID, () => {
        map.getCanvas().style.cursor = '';
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [data, mode, mapboxToken]);

  return (
    <div
      ref={containerRef}
      className="h-[560px] w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
      role="img"
      aria-label={`Heatmap de operación con ${data.stores.length} tiendas, lente: ${mode}`}
    />
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

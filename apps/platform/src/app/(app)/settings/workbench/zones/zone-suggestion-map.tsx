'use client';

// Mapa de la propuesta de partición de zona (WB-3 / ADR-115).
// Renderiza cada cluster con un color distintivo + un marker grande en el
// centroide. El admin entiende de un vistazo cómo se ve la sub-división
// geográfica antes de aplicarla.

import { useEffect, useRef } from 'react';
import { mapboxgl, setMapboxToken } from '@tripdrive/maps';
import type { ZoneSuggestion } from '@/lib/queries/zone-suggestions';

interface Props {
  suggestion: ZoneSuggestion;
  mapboxToken: string;
}

export function ZoneSuggestionMap({ suggestion, mapboxToken }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    setMapboxToken(mapboxToken);

    const bounds = new mapboxgl.LngLatBounds();
    for (const cluster of suggestion.clusters) {
      for (const store of cluster.stores) {
        bounds.extend([store.lng, store.lat]);
      }
    }

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      bounds: bounds.isEmpty() ? undefined : bounds,
      fitBoundsOptions: { padding: 50, maxZoom: 13 },
      attributionControl: false,
    });
    mapRef.current = map;

    map.on('load', () => {
      // Pin pequeño por tienda con el color del cluster.
      for (const cluster of suggestion.clusters) {
        for (const store of cluster.stores) {
          const el = document.createElement('div');
          el.style.cssText = `
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: ${cluster.color};
            border: 2px solid white;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            cursor: pointer;
          `;
          const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
            .setLngLat([store.lng, store.lat])
            .setPopup(
              new mapboxgl.Popup({ offset: 12 }).setHTML(
                `<div style="font-family: system-ui; font-size: 12px;">
                  <strong>${escapeHtml(store.code)}</strong> ${escapeHtml(store.name)}<br/>
                  <span style="color:#6b7280">Sub-zona ${cluster.index} · ${store.kgPerWeek > 0 ? `${store.kgPerWeek}kg/sem` : 'sin historia'}</span>
                </div>`,
              ),
            )
            .addTo(map);
          markersRef.current.push(marker);
        }

        // Marker grande en el centroide con el número del cluster.
        const centroidEl = document.createElement('div');
        centroidEl.style.cssText = `
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: ${cluster.color};
          border: 3px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
          color: white;
          font-family: system-ui;
          font-size: 16px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: default;
        `;
        centroidEl.textContent = String(cluster.index);
        const centroidMarker = new mapboxgl.Marker({
          element: centroidEl,
          anchor: 'center',
        })
          .setLngLat([cluster.centroid.lng, cluster.centroid.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 24 }).setHTML(
              `<div style="font-family: system-ui; font-size: 12px;">
                <strong>Sub-zona ${cluster.index}</strong><br/>
                ${cluster.storeCount} tiendas · ${cluster.totalKgPerWeek.toLocaleString('es-MX')} kg/sem<br/>
                <span style="color:#6b7280">${cluster.totalVisitsPerWeek} visitas/sem totales</span>
              </div>`,
            ),
          )
          .addTo(map);
        markersRef.current.push(centroidMarker);
      }
    });

    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [suggestion, mapboxToken]);

  return (
    <div
      ref={containerRef}
      className="h-[460px] w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
      role="img"
      aria-label={`Mapa con ${suggestion.totalStores} tiendas agrupadas en ${suggestion.clusters.length} sub-zonas`}
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

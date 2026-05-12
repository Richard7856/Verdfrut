'use client';

// LocationPicker — mapa Mapbox con marker draggable + click-to-set para que el
// admin afine las coords de una tienda sin salir del form. Sincroniza los
// inputs hidden `lat` y `lng` cuando el pin se mueve, y notifica al parent
// via `onChange` para que renderice los valores visibles.
//
// Sin Mapbox token disponible: degrada a inputs numéricos manuales.

import { useEffect, useRef, useState } from 'react';
import { mapboxgl, setMapboxToken } from '@tripdrive/maps';
import { logger } from '@tripdrive/observability';

interface Props {
  initialLat: number;
  initialLng: number;
  mapboxToken: string | null;
  onChange: (lat: number, lng: number) => void;
}

export function LocationPicker({ initialLat, initialLng, mapboxToken, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [coords, setCoords] = useState({ lat: initialLat, lng: initialLng });

  // Cuando el caller actualiza desde fuera (ej: tras "Re-geocodificar"),
  // movemos el pin para reflejar el nuevo estado.
  useEffect(() => {
    if (!markerRef.current || !mapRef.current) return;
    if (
      Math.abs(initialLat - coords.lat) > 0.00001 ||
      Math.abs(initialLng - coords.lng) > 0.00001
    ) {
      markerRef.current.setLngLat([initialLng, initialLat]);
      mapRef.current.flyTo({ center: [initialLng, initialLat], zoom: 16 });
      setCoords({ lat: initialLat, lng: initialLng });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLat, initialLng]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!mapboxToken) {
      void logger.warn('[LocationPicker] sin Mapbox token, degradado a inputs manuales');
      return;
    }
    setMapboxToken(mapboxToken);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [initialLng, initialLat],
      zoom: 16,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    const marker = new mapboxgl.Marker({ color: '#16a34a', draggable: true })
      .setLngLat([initialLng, initialLat])
      .addTo(map);
    markerRef.current = marker;

    const handleDragEnd = () => {
      const lngLat = marker.getLngLat();
      setCoords({ lat: lngLat.lat, lng: lngLat.lng });
      onChange(lngLat.lat, lngLat.lng);
    };
    marker.on('dragend', handleDragEnd);

    // Click en mapa → mover el pin a ese punto.
    const handleMapClick = (e: mapboxgl.MapMouseEvent) => {
      marker.setLngLat(e.lngLat);
      setCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      onChange(e.lngLat.lat, e.lngLat.lng);
    };
    map.on('click', handleMapClick);

    return () => {
      // Cleanup explícito de los listeners ANTES del map.remove() — aunque
      // `map.remove()` cleanup todo internamente, ser explícito es defensivo
      // contra futuros refactors y silencia false positive de `effect-needs-cleanup`.
      marker.off('dragend', handleDragEnd);
      map.off('click', handleMapClick);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // initialLat/Lng solo se usan al montar — cambios post-mount los maneja
    // el otro useEffect arriba. eslint disable a propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken]);

  if (!mapboxToken) {
    return (
      <div
        className="rounded-[var(--radius-md)] border border-dashed p-4 text-sm"
        style={{
          borderColor: 'var(--vf-line)',
          color: 'var(--vf-text-mute)',
          backgroundColor: 'var(--vf-surface-2)',
        }}
      >
        Mapa no disponible (falta <code>NEXT_PUBLIC_MAPBOX_TOKEN</code>). Edita las coordenadas
        manualmente en los campos de abajo.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="h-[360px] w-full rounded-[var(--radius-md)] border"
        style={{ borderColor: 'var(--vf-line)' }}
      />
      <p className="text-[11px]" style={{ color: 'var(--vf-text-mute)' }}>
        Arrastra el pin verde o haz click en el mapa para ajustar la ubicación. Los campos lat/lng
        se actualizan automáticamente.
        <br />
        <span className="font-mono">
          {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
        </span>
      </p>
    </div>
  );
}

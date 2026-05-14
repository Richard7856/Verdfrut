// Mini-mapa con pines de paradas + depot.
//
// Decisiones:
//   - PROVIDER_GOOGLE: usa Google Maps nativo embebido en el dispositivo.
//     Para que renderice tiles necesita Google Maps API key con "Maps SDK for
//     Android" habilitado. Key inyectada vía app.config.js + GOOGLE_MAPS_ANDROID_API_KEY.
//     Sin key, el mapa sale gris.
//   - Bounds auto-ajustadas via fitToCoordinates en onLayout/onMapReady. Padding
//     generoso para que pines no queden pegados al borde.
//   - Pin color = status del stop (ver theme/colors.ts).
//   - onPressPin sube el id para que la pantalla scrollee a esa StopCard.
//
// HARDENING APK-2026-05-13: si el módulo nativo de Google Maps falla en init
// (API key vacía, módulo no linkeado, OOM) la app entera crasheaba al renderear
// el componente. Ahora envuelto en ErrorBoundary → si el map falla, el resto
// de la pantalla (header + cards de paradas) sigue funcional con un placeholder.

import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Depot } from '@tripdrive/types';
import { colors } from '@/theme/colors';
import type { StopWithStore } from '@/lib/queries/route';

interface RouteMapProps {
  stops: StopWithStore[];
  depot: Depot | null;
  onPressStop?: (stopId: string) => void;
}

/**
 * Error Boundary alrededor del MapView nativo.
 *
 * react-native-maps con PROVIDER_GOOGLE puede crashear el render si el SDK
 * de Android Maps no está disponible (API key faltante, módulo native no
 * linkeado en el APK). El crash sin boundary tumba el árbol entero — incluso
 * cards de paradas que NO usan el mapa.
 *
 * Con este wrapper, capturamos el error a nivel React y mostramos un
 * placeholder. El chofer puede seguir trabajando con la lista; el mapa se
 * recupera en el próximo build que tenga la key.
 */
class MapErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[RouteMap] MapView falló al renderear:', error.message, info.componentStack);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function MapFallback({ stopCount }: { stopCount: number }) {
  return (
    <View style={[styles.container, styles.fallback]}>
      <Text style={styles.fallbackTitle}>Mapa no disponible</Text>
      <Text style={styles.fallbackSubtitle}>
        Continúa con la lista de paradas abajo · {stopCount} stops en ruta
      </Text>
    </View>
  );
}

function pinColorForStatus(status: StopWithStore['stop']['status']): string {
  switch (status) {
    case 'arrived':
      return colors.pinArrived;
    case 'completed':
      return colors.pinCompleted;
    case 'skipped':
      return colors.pinSkipped;
    case 'pending':
    default:
      return colors.pinPending;
  }
}

export function RouteMap({ stops, depot, onPressStop }: RouteMapProps) {
  return (
    <MapErrorBoundary fallback={<MapFallback stopCount={stops.length} />}>
      <RouteMapInner stops={stops} depot={depot} onPressStop={onPressStop} />
    </MapErrorBoundary>
  );
}

function RouteMapInner({ stops, depot, onPressStop }: RouteMapProps) {
  const mapRef = useRef<MapView | null>(null);

  // Construimos la lista de coords una sola vez por cambio en stops/depot.
  // Si está vacía no fitteamos (el mapa se queda en region default).
  const coords = [
    ...(depot ? [{ latitude: depot.lat, longitude: depot.lng }] : []),
    ...stops.map((s) => ({ latitude: s.store.lat, longitude: s.store.lng })),
  ];

  useEffect(() => {
    if (coords.length === 0 || !mapRef.current) return;
    // Pequeño delay para que el mapa esté ready antes de fittear.
    // Sin esto, el primer fit puede ignorarse en algunos devices.
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
        animated: false,
      });
    }, 100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops.length, depot?.id]);

  // Región inicial: CDMX center mientras carga (será sobreescrito por fitToCoordinates).
  const initialRegion = {
    latitude: 19.4326,
    longitude: -99.1332,
    latitudeDelta: 0.5,
    longitudeDelta: 0.5,
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        loadingEnabled
        loadingBackgroundColor={colors.surface1}
        loadingIndicatorColor={colors.brand}
      >
        {depot ? (
          <Marker
            coordinate={{ latitude: depot.lat, longitude: depot.lng }}
            title={depot.name}
            description={`CEDIS · ${depot.code}`}
            pinColor={colors.pinDepot}
            tracksViewChanges={false}
          />
        ) : null}
        {stops.map((s) => (
          <Marker
            key={s.stop.id}
            coordinate={{ latitude: s.store.lat, longitude: s.store.lng }}
            title={`${s.stop.sequence}. ${s.store.name}`}
            description={s.store.code}
            pinColor={pinColorForStatus(s.stop.status)}
            tracksViewChanges={false}
            onPress={() => onPressStop?.(s.stop.id)}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 240,
    backgroundColor: colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  map: {
    flex: 1,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  fallbackTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  fallbackSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
});

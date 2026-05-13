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
// Limitación N2: con >30 pines en mismo bounds el rendering puede arrastrar FPS
// en gama baja. Mitigación deferida — clustering entra si el cliente reporta
// (issue para abrir en review).

import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Depot } from '@tripdrive/types';
import { colors } from '@/theme/colors';
import type { StopWithStore } from '@/lib/queries/route';

interface RouteMapProps {
  stops: StopWithStore[];
  depot: Depot | null;
  onPressStop?: (stopId: string) => void;
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
});

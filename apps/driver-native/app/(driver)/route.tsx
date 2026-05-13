// Pantalla "Mi ruta del día" — Fase N2 (ADR-076).
//
// Estructura:
//   FlatList con ListHeaderComponent = RouteHeader + RouteMap.
//   Body = StopCards por sequence.
//
// ¿Por qué FlatList y no ScrollView + .map()?
//   Una ruta puede tener 30+ paradas. FlatList recicla views, ScrollView
//   monta todas. Diferencia perceptible en gama baja.
//
// Estados que renderiza la pantalla:
//   1. isLoading & !data → SkeletonRoute (primera carga sin cache).
//   2. !data & !isLoading → EmptyRoute (sin ruta hoy, con retry).
//   3. data → Header + Mapa + Cards. Banners arriba si aplica:
//        - OfflineBanner si isStale=true
//        - ErrorBanner si error y data existe (refetch falló pero cache sirve)

import { useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useRoute } from '@/hooks/useRoute';
import { useGpsBroadcast } from '@/hooks/useGpsBroadcast';
import { useOutboxSnapshot } from '@/hooks/useOutboxSnapshot';
import { RouteHeader } from '@/components/route/RouteHeader';
import { RouteMap } from '@/components/route/RouteMap';
import { StopCard } from '@/components/route/StopCard';
import {
  EmptyRoute,
  ErrorBanner,
  OfflineBanner,
  SkeletonRoute,
} from '@/components/route/RouteStates';
import { colors } from '@/theme/colors';
import type { StopWithStore } from '@/lib/queries/route';

export default function RouteScreen() {
  const { data, isLoading, isRefreshing, error, isStale, refresh } = useRoute();
  const router = useRouter();
  const listRef = useRef<FlatList<StopWithStore>>(null);
  const [highlightedStopId, setHighlightedStopId] = useState<string | null>(null);

  // GPS broadcast: arranca cuando la ruta está IN_PROGRESS Y tenemos driverId.
  // PUBLISHED = chofer aún no llegó a la primera parada → no consumimos batería.
  // En cuanto marca primera llegada (route → IN_PROGRESS), arranca el task.
  const gpsEnabled =
    data?.route.status === 'IN_PROGRESS' && Boolean(data.driverId);
  const gps = useGpsBroadcast({
    routeId: data?.route.id ?? null,
    driverId: data?.driverId ?? null,
    enabled: gpsEnabled,
  });
  const outboxSnapshot = useOutboxSnapshot();

  if (isLoading && !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <SkeletonRoute />
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <RouteHeader route={null} totalStops={0} completedStops={0} />
        <EmptyRoute onRetry={refresh} />
      </SafeAreaView>
    );
  }

  const stops = data.stops;
  const completed = stops.filter(
    (s) => s.stop.status === 'completed' || s.stop.status === 'skipped',
  ).length;

  // Próxima parada pendiente (primer pending por sequence) — la resaltamos.
  // El cálculo está dentro del render porque depende del data ya filtrado.
  const nextStopId = stops.find((s) => s.stop.status === 'pending')?.stop.id ?? null;

  // Tap en pin del mapa → scrollea a la card + resalta.
  const handlePressPin = (stopId: string) => {
    setHighlightedStopId(stopId);
    const index = stops.findIndex((s) => s.stop.id === stopId);
    if (index >= 0) {
      listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.3,
      });
    }
  };

  // Tap en la card → navega al detalle.
  const handlePressCard = (stopId: string) => {
    router.push(`/(driver)/stop/${stopId}` as never);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {isStale ? <OfflineBanner /> : null}
      {error && data ? <ErrorBanner message={`No se pudo refrescar: ${error}`} /> : null}

      <FlatList
        ref={listRef}
        data={stops}
        keyExtractor={(s) => s.stop.id}
        ListHeaderComponent={
          <View>
            <RouteHeader
              route={data.route}
              totalStops={stops.length}
              completedStops={completed}
              gps={gpsEnabled ? { running: gps.running, denial: gps.denial } : null}
              outbox={{
                pending: outboxSnapshot.counts.pending + outboxSnapshot.counts.in_flight,
                failed: outboxSnapshot.counts.failed,
              }}
            />
            <RouteMap stops={stops} depot={data.depot} onPressStop={handlePressPin} />
          </View>
        }
        renderItem={({ item }) => (
          <StopCard
            item={item}
            highlighted={item.stop.id === (highlightedStopId ?? nextStopId)}
            onPress={() => handlePressCard(item.stop.id)}
          />
        )}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
        // Si la ruta no tiene stops todavía (DRAFT publicado vacío — caso raro)
        // mostramos un mensaje, no un espacio en blanco.
        ListEmptyComponent={
          <View style={styles.listEmpty}>
            <View style={styles.emptyDot} />
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  sep: {
    height: 10,
  },
  listEmpty: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
});

// Pantalla detalle de una parada — Fase N3.
//
// Lo que muestra:
//   - Código + nombre + dirección + ventana horaria
//   - Demanda (peso/volumen/cajas)
//   - ETA + hora real de llegada (si arrived/completed)
//   - Contacto (si la tienda lo tiene)
//   - 3 botones:
//       1. "Navegar" (Waze → geo: → fallback Google Maps web)
//       2. "Marcar llegada" (con validación geo client-side)
//       3. "Reportar entrega" (placeholder — Fase N4)

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { colors } from '@/theme/colors';
import { formatTimeInZone } from '@/lib/datetime';
import { openNavigationTo } from '@/lib/deeplinks';
import { getStopContext, type StopContext } from '@/lib/queries/stop';
import { markArrived } from '@/lib/actions/arrive';

export default function StopDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [ctx, setCtx] = useState<StopContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isArriving, setIsArriving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const data = await getStopContext(id);
      setCtx(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleNavigate = useCallback(async () => {
    if (!ctx) return;
    const opened = await openNavigationTo({
      lat: ctx.store.lat,
      lng: ctx.store.lng,
      label: `${ctx.store.code} ${ctx.store.name}`,
    });
    if (!opened) {
      Alert.alert(
        'No se pudo abrir el navegador',
        'Verifica que tengas Waze o Google Maps instalado.',
      );
    }
  }, [ctx]);

  const handleCall = useCallback(() => {
    if (!ctx?.store.contactPhone) return;
    // tel: URI universal en Android.
    Linking.openURL(`tel:${ctx.store.contactPhone}`).catch(() => {
      Alert.alert('No se pudo abrir el marcador');
    });
  }, [ctx]);

  const handleMarkArrived = useCallback(async () => {
    if (!ctx) return;
    setIsArriving(true);
    try {
      const res = await markArrived(ctx);
      if (res.ok) {
        await load(); // refresca status
        Alert.alert('Llegada registrada', 'Continúa con el reporte de entrega.');
      } else if ('rejection' in res) {
        Alert.alert('No se pudo marcar llegada', res.rejection.message);
      } else {
        Alert.alert('Error', res.error);
      }
    } finally {
      setIsArriving(false);
    }
  }, [ctx, load]);

  const handleReport = useCallback(() => {
    if (!ctx) return;
    router.push(`/(driver)/stop/${ctx.stop.id}/evidence` as never);
  }, [ctx, router]);

  const handleOpenChat = useCallback(() => {
    if (!ctx) return;
    router.push(`/(driver)/stop/${ctx.stop.id}/chat` as never);
  }, [ctx, router]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !ctx) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error ?? 'Parada no encontrada'}</Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Volver</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { stop, store } = ctx;
  const eta = formatTimeInZone(stop.plannedArrivalAt);
  const arrived = formatTimeInZone(stop.actualArrivalAt);
  const isCompleted = stop.status === 'completed' || stop.status === 'skipped';
  const hasArrived = stop.status === 'arrived' || isCompleted;
  const receivingWindow =
    store.receivingWindowStart && store.receivingWindowEnd
      ? `${store.receivingWindowStart} – ${store.receivingWindowEnd}`
      : null;
  const demand =
    Array.isArray(store.demand) && store.demand.length > 0
      ? `${store.demand[0]} kg${store.demand.length > 2 ? ` · ${store.demand[2]} cajas` : ''}`
      : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backArrow}>← Mi ruta</Text>
        </Pressable>
        <View style={styles.sequenceBadge}>
          <Text style={styles.sequenceText}>{stop.sequence}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.storeCode}>{store.code}</Text>
          <Text style={styles.storeName}>{store.name}</Text>
          <Text style={styles.storeAddress}>{store.address}</Text>
          {store.contactName ? (
            <View style={styles.contactRow}>
              <Text style={styles.contactName}>{store.contactName}</Text>
              {store.contactPhone ? (
                <Pressable onPress={handleCall}>
                  <Text style={styles.contactPhone}>{store.contactPhone}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.gridCard}>
          <InfoCell label="ETA planeada" value={eta} />
          <InfoCell
            label="Llegada real"
            value={hasArrived ? arrived : '—'}
            highlight={hasArrived}
          />
          {receivingWindow ? <InfoCell label="Ventana horaria" value={receivingWindow} /> : null}
          {demand ? <InfoCell label="Demanda estimada" value={demand} /> : null}
        </View>

        {!store.coordVerified ? (
          <View style={styles.warnBanner}>
            <Text style={styles.warnBannerText}>
              ⚠️ Las coordenadas de esta tienda no están verificadas. Si el GPS
              te lleva mal, reporta al supervisor.
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            onPress={handleNavigate}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
          >
            <Text style={styles.primaryBtnText}>🧭 Navegar</Text>
          </Pressable>

          {!hasArrived ? (
            <Pressable
              onPress={handleMarkArrived}
              disabled={isArriving}
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && styles.secondaryBtnPressed,
                isArriving && styles.btnDisabled,
              ]}
            >
              {isArriving ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={styles.secondaryBtnText}>📍 Marcar llegada</Text>
              )}
            </Pressable>
          ) : null}

          {hasArrived && !isCompleted ? (
            <Pressable
              onPress={handleReport}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            >
              <Text style={styles.primaryBtnText}>📦 Reportar entrega</Text>
            </Pressable>
          ) : null}

          {isCompleted ? (
            <>
              <View style={styles.completedBadge}>
                <Text style={styles.completedText}>
                  ✓ {stop.status === 'completed' ? 'Entrega completada' : 'Parada saltada'}
                </Text>
              </View>
              <Pressable
                onPress={handleOpenChat}
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
              >
                <Text style={styles.secondaryBtnText}>💬 Chat con supervisor</Text>
              </Pressable>
            </>
          ) : null}
        </View>

        {stop.notes ? (
          <View style={styles.notesCard}>
            <Text style={styles.notesLabel}>Notas del dispatcher</Text>
            <Text style={styles.notesText}>{stop.notes}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={[styles.cellValue, highlight && { color: colors.brand }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backArrow: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  sequenceBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sequenceText: { color: colors.text, fontWeight: '700', fontSize: 14 },

  content: { padding: 16, gap: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  errorText: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  backBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backBtnText: { color: colors.textMuted, fontSize: 14 },

  card: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  storeCode: {
    color: colors.textMuted,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  storeName: { color: colors.text, fontSize: 18, fontWeight: '600', marginTop: 4 },
  storeAddress: { color: colors.textFaint, fontSize: 13, marginTop: 4, lineHeight: 18 },
  contactRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contactName: { color: colors.textMuted, fontSize: 13 },
  contactPhone: { color: colors.brand, fontSize: 13, fontWeight: '600' },

  gridCard: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    minWidth: '50%',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  cellLabel: { color: colors.textFaint, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  cellValue: { color: colors.text, fontSize: 15, fontFamily: 'monospace', marginTop: 2 },

  warnBanner: {
    backgroundColor: colors.warnSurface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.warn,
    padding: 12,
  },
  warnBannerText: { color: colors.warn, fontSize: 12, fontWeight: '500', lineHeight: 18 },

  actions: { gap: 10 },
  primaryBtn: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnPressed: { backgroundColor: colors.brandDark },
  primaryBtnText: { color: '#0c1410', fontWeight: '700', fontSize: 16 },
  secondaryBtn: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnPressed: { backgroundColor: colors.surface3 },
  secondaryBtnText: { color: colors.text, fontWeight: '600', fontSize: 15 },
  btnDisabled: { opacity: 0.6 },

  completedBadge: {
    backgroundColor: '#13321f',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.brand,
  },
  completedText: { color: colors.brand, fontWeight: '700', fontSize: 14 },

  notesCard: {
    backgroundColor: colors.surface1,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notesLabel: { color: colors.textFaint, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  notesText: { color: colors.textMuted, fontSize: 13, marginTop: 6, lineHeight: 18 },
});

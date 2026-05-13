// Card de una parada en la lista de la ruta del día.
//
// N2 sólo muestra la info — el tap NO navega todavía (Fase N3 implementa
// `/stop/[id]`). Por ahora `onPress` está ahí para no romper API después.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StopWithStore } from '@/lib/queries/route';
import { colors } from '@/theme/colors';
import { formatTimeInZone } from '@/lib/datetime';

interface StopCardProps {
  item: StopWithStore;
  onPress?: () => void;
  /** Resaltar visualmente — el id de "next stop" o el que tocó el mapa. */
  highlighted?: boolean;
}

interface StatusVisual {
  label: string;
  bg: string;
  fg: string;
}

function statusVisual(status: StopWithStore['stop']['status']): StatusVisual {
  switch (status) {
    case 'arrived':
      return { label: 'En tienda', bg: colors.warnSurface, fg: colors.warn };
    case 'completed':
      return { label: 'Entregada', bg: '#13321f', fg: colors.brand };
    case 'skipped':
      return { label: 'Saltada', bg: colors.surface3, fg: colors.textMuted };
    case 'pending':
    default:
      return { label: 'Pendiente', bg: colors.infoSurface, fg: colors.info };
  }
}

export function StopCard({ item, onPress, highlighted }: StopCardProps) {
  const { stop, store } = item;
  const visual = statusVisual(stop.status);
  const eta = formatTimeInZone(stop.plannedArrivalAt);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        highlighted ? styles.highlighted : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.sequenceBox}>
        <Text style={styles.sequenceText}>{stop.sequence}</Text>
      </View>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.code} numberOfLines={1}>
            {store.code}
          </Text>
          <View style={[styles.statusPill, { backgroundColor: visual.bg }]}>
            <Text style={[styles.statusText, { color: visual.fg }]}>{visual.label}</Text>
          </View>
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {store.name}
        </Text>
        <Text style={styles.address} numberOfLines={1}>
          {store.address}
        </Text>
        <View style={styles.etaRow}>
          <Text style={styles.etaLabel}>ETA</Text>
          <Text style={styles.etaValue}>{eta}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  highlighted: {
    borderColor: colors.brand,
  },
  pressed: {
    backgroundColor: colors.surface2,
  },
  sequenceBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sequenceText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    gap: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  code: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    marginTop: 2,
  },
  address: {
    color: colors.textFaint,
    fontSize: 12,
    marginTop: 2,
  },
  etaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  etaLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  etaValue: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: 'monospace',
  },
});

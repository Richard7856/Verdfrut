// Header de la pantalla /route — fecha + nombre de la ruta + progreso + logout.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Route } from '@tripdrive/types';
import { colors } from '@/theme/colors';
import { formatRouteDate } from '@/lib/datetime';
import { signOut } from '@/lib/auth';

interface RouteHeaderProps {
  route: Route | null;
  totalStops: number;
  completedStops: number;
  /** Estado del GPS broadcast (N3+). null = no aplica. */
  gps?: {
    running: boolean;
    denial: 'foreground_denied' | 'background_denied' | 'start_failed' | null;
  } | null;
  /** Estado del outbox (N4+). null = nada pendiente, no se renderiza. */
  outbox?: {
    pending: number;
    failed: number;
  } | null;
}

export function RouteHeader({
  route,
  totalStops,
  completedStops,
  gps,
  outbox,
}: RouteHeaderProps) {
  const dateLabel = route ? formatRouteDate(route.date) : 'Hoy';

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={styles.brand}>TripDrive</Text>
          <Text style={styles.date}>{dateLabel}</Text>
        </View>
        <Pressable
          onPress={signOut}
          style={({ pressed }) => [styles.logout, pressed && styles.logoutPressed]}
        >
          <Text style={styles.logoutText}>Salir</Text>
        </Pressable>
      </View>
      {route ? (
        <View style={styles.progressRow}>
          <Text style={styles.routeName} numberOfLines={1}>
            {route.name}
          </Text>
          <Text style={styles.progress}>
            {completedStops}/{totalStops}
          </Text>
        </View>
      ) : null}
      {gps ? <GpsStatusBar gps={gps} /> : null}
      {outbox && outbox.pending + outbox.failed > 0 ? <OutboxBar outbox={outbox} /> : null}
    </View>
  );
}

function OutboxBar({ outbox }: { outbox: NonNullable<RouteHeaderProps['outbox']> }) {
  const { pending, failed } = outbox;
  let label: string;
  let bg: string;
  let fg: string;
  if (failed > 0) {
    label = `⚠ ${failed} envío${failed > 1 ? 's' : ''} con error · ${pending} en cola`;
    bg = colors.warnSurface;
    fg = colors.warn;
  } else {
    label = `📤 ${pending} envío${pending > 1 ? 's' : ''} pendiente${pending > 1 ? 's' : ''} de subir`;
    bg = colors.infoSurface;
    fg = colors.info;
  }
  return (
    <View style={[outboxStyles.bar, { backgroundColor: bg }]}>
      <Text style={[outboxStyles.text, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function GpsStatusBar({ gps }: { gps: NonNullable<RouteHeaderProps['gps']> }) {
  let label: string;
  let bg: string;
  let fg: string;
  let dotColor: string;
  if (gps.denial === 'foreground_denied' || gps.denial === 'background_denied') {
    label = '⚠ Permiso de ubicación denegado — tu supervisor no te ve';
    bg = colors.dangerSurface;
    fg = colors.danger;
    dotColor = colors.danger;
  } else if (gps.denial === 'start_failed') {
    label = '⚠ No se pudo iniciar GPS background';
    bg = colors.warnSurface;
    fg = colors.warn;
    dotColor = colors.warn;
  } else if (gps.running) {
    label = 'GPS activo — supervisor te ve en vivo';
    bg = '#13321f';
    fg = colors.brand;
    dotColor = colors.brand;
  } else {
    label = 'GPS inactivo';
    bg = colors.surface3;
    fg = colors.textMuted;
    dotColor = colors.textFaint;
  }

  return (
    <View style={[gpsStyles.bar, { backgroundColor: bg }]}>
      <View style={[gpsStyles.dot, { backgroundColor: dotColor }]} />
      <Text style={[gpsStyles.text, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    flex: 1,
  },
  brand: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  date: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  logout: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logoutPressed: {
    backgroundColor: colors.surface2,
  },
  logoutText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 12,
  },
  routeName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  progress: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});

const gpsStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
    borderRadius: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
});

const outboxStyles = StyleSheet.create({
  bar: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 6,
    borderRadius: 6,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});

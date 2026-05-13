// Estados sin-datos de la pantalla /route: skeleton, vacío, error, banner offline.

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/colors';

export function SkeletonRoute() {
  return (
    <View style={styles.skeleton}>
      <View style={styles.skeletonMap}>
        <ActivityIndicator color={colors.brand} />
      </View>
      <View style={styles.skeletonList}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.skeletonCard} />
        ))}
      </View>
    </View>
  );
}

interface EmptyRouteProps {
  onRetry?: () => void;
}

export function EmptyRoute({ onRetry }: EmptyRouteProps) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>📭</Text>
      <Text style={styles.emptyTitle}>Sin ruta asignada</Text>
      <Text style={styles.emptyText}>
        Tu supervisor todavía no ha publicado una ruta para hoy. Vuelve a
        intentar más tarde o desliza hacia abajo para refrescar.
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.retryBtn, pressed && styles.retryBtnPressed]}
        >
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface ErrorBannerProps {
  message: string;
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText} numberOfLines={2}>
        ⚠️ {message}
      </Text>
    </View>
  );
}

export function OfflineBanner() {
  return (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineBannerText}>
        📡 Datos en cache — sin conexión al servidor
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { flex: 1 },
  skeletonMap: {
    height: 240,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  skeletonList: {
    padding: 16,
    gap: 12,
  },
  skeletonCard: {
    height: 96,
    backgroundColor: colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.5,
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.brand,
  },
  retryBtnPressed: {
    backgroundColor: colors.brandDark,
  },
  retryText: {
    color: '#0c1410',
    fontWeight: '600',
    fontSize: 14,
  },

  errorBanner: {
    backgroundColor: colors.dangerSurface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.danger,
  },
  errorBannerText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '500',
  },

  offlineBanner: {
    backgroundColor: colors.warnSurface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.warn,
  },
  offlineBannerText: {
    color: colors.warn,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
});

// Pantalla "Mi ruta del día" — placeholder de N1.
// Fase N2 la reemplaza con lista de paradas + mini-mapa nativo.

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOut } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useEffect, useState } from 'react';

export default function RouteScreen() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeTitle}>👋 Bienvenido</Text>
          <Text style={styles.welcomeEmail}>{email ?? 'Cargando...'}</Text>
        </View>

        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderEmoji}>🚧</Text>
          <Text style={styles.placeholderTitle}>App en construcción</Text>
          <Text style={styles.placeholderText}>
            Esta es la versión nativa de TripDrive Conductor. Por ahora solo
            puedes hacer login. En las próximas semanas se agregan:
          </Text>
          <View style={styles.list}>
            <Text style={styles.listItem}>• Lista de paradas con mapa nativo (Fase N2)</Text>
            <Text style={styles.listItem}>• Navegación con Google Maps / Waze (Fase N3)</Text>
            <Text style={styles.listItem}>• Cámara + OCR de tickets (Fase N4)</Text>
            <Text style={styles.listItem}>• Chat con supervisor + push (Fase N5)</Text>
          </View>
          <Text style={styles.placeholderHint}>
            Mientras tanto, sigue usando la versión web en{'\n'}
            <Text style={styles.mono}>driver.tripdrive.xyz</Text>
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.logoutButton, pressed && styles.logoutPressed]}
          onPress={signOut}
        >
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1d2521' },
  container: { padding: 16, gap: 16 },
  welcomeCard: {
    backgroundColor: '#262e2a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#323a35',
  },
  welcomeTitle: { color: '#f1f3f0', fontSize: 20, fontWeight: '600' },
  welcomeEmail: { color: '#a8b0aa', fontSize: 13, marginTop: 4 },
  placeholderCard: {
    backgroundColor: '#222a26',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#323a35',
    alignItems: 'center',
  },
  placeholderEmoji: { fontSize: 48 },
  placeholderTitle: {
    color: '#f1f3f0',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  placeholderText: {
    color: '#a8b0aa',
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 20,
  },
  list: { alignSelf: 'stretch', marginTop: 16, paddingHorizontal: 8 },
  listItem: { color: '#a8b0aa', fontSize: 13, marginTop: 4 },
  placeholderHint: {
    color: '#7d847f',
    fontSize: 12,
    marginTop: 16,
    textAlign: 'center',
    lineHeight: 18,
  },
  mono: { fontFamily: 'monospace', color: '#34c97c' },
  logoutButton: {
    borderColor: '#323a35',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  logoutPressed: { backgroundColor: '#262e2a' },
  logoutText: { color: '#a8b0aa', fontSize: 14, fontWeight: '500' },
});

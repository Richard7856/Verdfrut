// Pantalla de login del chofer.
// Form simple email/password contra Supabase Auth.

import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signInWithPassword } from '@/lib/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!email || !password) {
      setError('Ingresa email y contraseña');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: authError } = await signInWithPassword(email, password);
    setSubmitting(false);
    if (authError) {
      setError(authError);
    }
    // Si OK, el AuthGate de _layout.tsx redirige automáticamente a /(driver)/route.
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.container}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>TripDrive</Text>
          <Text style={styles.subtitle}>App del chofer</Text>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="tucorreo@empresa.com"
              placeholderTextColor="#7d847f"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              editable={!submitting}
            />

            <Text style={[styles.label, { marginTop: 12 }]}>Contraseña</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#7d847f"
              secureTextEntry
              autoComplete="current-password"
              editable={!submitting}
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                submitting && styles.buttonDisabled,
                pressed && !submitting && styles.buttonPressed,
              ]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.buttonText}>Iniciar sesión</Text>
              )}
            </Pressable>

            <Text style={styles.help}>
              ¿Problemas para entrar? Contacta a tu supervisor.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1d2521' },
  flex: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    alignItems: 'center',
  },
  logo: { width: 80, height: 80, marginBottom: 12 },
  title: { color: '#f1f3f0', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#a8b0aa', fontSize: 14, marginTop: 4 },
  form: { width: '100%', marginTop: 40 },
  label: { color: '#a8b0aa', fontSize: 13, fontWeight: '500', marginBottom: 6 },
  input: {
    backgroundColor: '#262e2a',
    borderColor: '#323a35',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#f1f3f0',
    fontSize: 16,
  },
  error: {
    color: '#dc2626',
    marginTop: 12,
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#1f7a4a',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonPressed: { backgroundColor: '#34c97c' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  help: {
    color: '#7d847f',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
  },
});

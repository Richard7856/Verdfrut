// Helpers de auth nativos. Wrapper sobre supabase.auth con manejo de UX
// específico de mobile (sin redirects de navegador, todo via Router de Expo).

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface AuthState {
  session: Session | null;
  isLoading: boolean;
}

/**
 * Hook que mantiene la sesión actual del usuario suscrito a cambios.
 * Al montar, carga la sesión persistida en AsyncStorage; después escucha
 * eventos de Supabase (login, logout, refresh token).
 */
export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // 1. Cargar sesión inicial (cache de AsyncStorage).
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setIsLoading(false);
    });

    // 2. Suscribirse a cambios (login, logout, token refresh).
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return { session, isLoading };
}

/**
 * Login con email/password. Devuelve error como string (UI lo muestra).
 * En N2+ esto puede crecer a manejar invite tokens, password reset, etc.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) return { error: error.message };
  return { error: null };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

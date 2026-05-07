'use client';

// Hook que escucha eventos de incidencia en la zona del admin/dispatcher y
// dispara notificaciones múltiples (toast + sonido + count update).
//
// Eventos detectados:
//   - INSERT en messages con sender='driver' → "Nuevo mensaje de chofer"
//   - INSERT en delivery_reports con chat_status='open' → "Nuevo reporte abierto"
//
// Las notificaciones del browser (push real cuando tab está cerrado) se manejan
// por separado en `usePushOptInPlatform` — VAPID push fanout es server-driven.
// Este hook es para feedback INMEDIATO cuando el admin tiene la app abierta.
//
// El sonido se genera con Web Audio API (sin asset binario) para evitar
// dependencias adicionales y problemas de cache.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@verdfrut/supabase/browser';
import { toast } from '@verdfrut/ui';

const SOUND_TOGGLE_KEY = 'vf-incident-sound-enabled';

interface MessageRow {
  id: string;
  report_id: string;
  sender: 'driver' | 'zone_manager' | 'system';
  text: string | null;
  created_at: string;
}

interface ReportRow {
  id: string;
  store_name: string | null;
  zone_id: string;
  type: string;
  chat_status: string | null;
  chat_opened_at: string | null;
}

/**
 * Genera un beep corto de 2 tonos (estilo notification de mensajería) usando
 * Web Audio API. Sin asset binario. Tono pleasant: 880Hz → 1320Hz, 200ms total.
 */
function playBeep(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1320, now + 0.1);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + 0.2);

    osc.start(now);
    osc.stop(now + 0.22);
  } catch (err) {
    // Audio puede fallar si user no interactuó con la página todavía (autoplay policy).
    // Silencioso — la notificación toast sigue siendo visible.
    console.warn('[notification.beep] failed:', err);
  }
}

/**
 * Lee la preferencia del toggle 🔊/🔇 del localStorage. Default: ON.
 */
export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = localStorage.getItem(SOUND_TOGGLE_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_TOGGLE_KEY, enabled ? '1' : '0');
  } catch {
    // no-op
  }
}

/**
 * Hook que se monta una sola vez en (app)/layout.tsx — vivirá durante toda la
 * sesión del admin/dispatcher.
 *
 * @param viewerZoneId zone_id del viewer (admin global puede pasar null y verá todo).
 *                     zone_manager se filtra por su zona vía RLS automáticamente,
 *                     pero este hook es para admin/dispatcher así que casi siempre null.
 */
export function useIncidentNotifications(viewerZoneId: string | null) {
  const router = useRouter();
  const initializedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    const supabase = createBrowserClient();

    // Suscribir a INSERTs en `messages` con sender='driver'. Filtro por sender
    // (no por zone) porque RLS ya limita los rows que el viewer puede recibir.
    const messagesChannel = supabase
      .channel('admin:driver-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: 'sender=eq.driver',
        },
        (payload) => {
          const row = payload.new as MessageRow;
          // Ignorar mensajes anteriores al mount del hook (puede pasar si
          // Realtime entrega backlog en reconexión).
          const createdAt = new Date(row.created_at).getTime();
          if (createdAt < initializedAtRef.current - 1000) return;

          if (isSoundEnabled()) playBeep();
          toast.info('Nuevo mensaje de chofer', {
            description: row.text ? row.text.slice(0, 80) : 'Foto o adjunto',
            action: {
              label: 'Ver',
              onClick: () => router.push(`/incidents/${row.report_id}`),
            },
          });
        },
      )
      .subscribe();

    // Suscribir a INSERTs en delivery_reports con chat abierto (primer reporte
    // con chat). Es el caso de un reporte recién abierto.
    const reportsChannel = supabase
      .channel('admin:new-reports')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'delivery_reports',
          filter: 'chat_status=eq.open',
        },
        (payload) => {
          const row = payload.new as ReportRow;
          const oldRow = payload.old as Partial<ReportRow>;
          // Solo notificar cuando chat_status TRANSITIONA a 'open' (no si ya estaba)
          if (oldRow.chat_status === 'open') return;

          if (isSoundEnabled()) playBeep();
          toast.info('Nuevo reporte abierto', {
            description: row.store_name ? `Tienda: ${row.store_name}` : 'Sin tienda asociada',
            action: {
              label: 'Ver',
              onClick: () => router.push(`/incidents/${row.id}`),
            },
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(reportsChannel);
    };
  }, [viewerZoneId, router]);
}

/**
 * Hook con contador realtime de incidentes abiertos (para badge en sidebar).
 * Mantiene un count inicial via fetch + se actualiza con eventos realtime.
 */
export function useOpenIncidentsCount(initial: number) {
  const [count, setCount] = useState(initial);

  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel('admin:incidents-count')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'delivery_reports',
        },
        async () => {
          // Re-fetch del count cada vez que algo cambia. Cheap query, sin overhead.
          const { count: c } = await supabase
            .from('delivery_reports')
            .select('id', { count: 'exact', head: true })
            .eq('chat_status', 'open');
          if (typeof c === 'number') setCount(c);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}

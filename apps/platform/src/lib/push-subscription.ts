'use client';

// Helpers cliente para suscripción a Web Push del platform.
// Patrón idéntico al driver — duplicado deliberado (los apps no comparten src/).
// Cuando aparezca un 3er consumidor, mover a `@tripdrive/notifications`.

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

const SW_URL = '/sw-push.js';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushPermissionState = 'unsupported' | 'denied' | 'granted' | 'default' | 'subscribed';

export async function getPushState(): Promise<PushPermissionState> {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';

  try {
    const reg = await ensureSwRegistered();
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'granted';
  } catch {
    return 'granted';
  }
}

/**
 * Registra el SW de push si no está registrado todavía. Idempotente.
 * El SW vive en /sw-push.js (scope "/" — toda la app).
 */
async function ensureSwRegistered(): Promise<ServiceWorkerRegistration> {
  // ¿Ya hay registro?
  const existing = await navigator.serviceWorker.getRegistration(SW_URL);
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_URL, { scope: '/' });
}

export async function subscribeToPush(): Promise<{
  ok: boolean;
  state: PushPermissionState;
  error?: string;
}> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return { ok: false, state: 'unsupported', error: 'Browser sin Push API' };
  }
  if (!PUBLIC_KEY) {
    return { ok: false, state: 'unsupported', error: 'VAPID public key no configurado' };
  }
  if (Notification.permission === 'denied') {
    return {
      ok: false,
      state: 'denied',
      error: 'Habilita las notificaciones en Configuración del navegador',
    };
  }
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') {
      return { ok: false, state: 'denied', error: 'Permiso rechazado' };
    }
  }

  try {
    const reg = await ensureSwRegistered();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY) as BufferSource,
      });
    }

    const subJson = sub.toJSON();
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, state: 'granted', error: data.error ?? 'No se pudo registrar' };
    }
    return { ok: true, state: 'subscribed' };
  } catch (err) {
    return {
      ok: false,
      state: 'granted',
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
}

'use client';

// Helpers cliente para el flujo de suscripción a Web Push.
// Convierte la VAPID public key (base64url) al formato Uint8Array que requiere
// PushManager.subscribe(), llama al endpoint server para persistir la sub.

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

/**
 * Convierte un string base64url (formato VAPID) al Uint8Array que pide PushManager.
 * El padding `=` puede faltar en VAPID; lo agregamos.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushPermissionState = 'unsupported' | 'denied' | 'granted' | 'default' | 'subscribed';

/**
 * Estado actual de push para este browser:
 *   - unsupported: no hay PushManager o ServiceWorker
 *   - denied: usuario rechazó permiso anteriormente (irreversible sin ir a settings)
 *   - default: aún no se ha pedido
 *   - granted: permiso dado pero sin suscripción activa (caso raro)
 *   - subscribed: hay suscripción activa
 */
export async function getPushState(): Promise<PushPermissionState> {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';

  // permission === 'granted': verificar si hay sub activa.
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'granted';
  } catch {
    return 'granted';
  }
}

/**
 * Pide permiso al chofer y registra la subscription en el backend.
 * Devuelve el nuevo estado tras el flujo.
 */
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

  // Si está denegado, no hay forma de re-pedir desde código.
  if (Notification.permission === 'denied') {
    return {
      ok: false,
      state: 'denied',
      error: 'Habilita las notificaciones en Configuración del navegador',
    };
  }

  // Pedir permiso (si está default).
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') {
      return { ok: false, state: 'denied', error: 'Permiso rechazado' };
    }
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      // TS strict no acepta Uint8Array directo en applicationServerKey por la
      // ambigüedad de SharedArrayBuffer vs ArrayBuffer en el lib.dom moderno.
      // Cast seguro — en runtime es exactamente lo que la API espera.
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY) as BufferSource,
      });
    }

    // Persistir en backend.
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

/** Desuscribe en el browser y borra del backend. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
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

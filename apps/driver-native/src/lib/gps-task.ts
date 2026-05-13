// Background GPS task — corre con expo-location + expo-task-manager.
//
// Decisiones (ADR-077):
//
// 1. **Foreground service Android obligatorio** (Android 12+ requirement).
//    `Location.startLocationUpdatesAsync` con `foregroundService` enciende una
//    notif persistente "TripDrive — siguiendo tu ruta", que es la condición
//    para que el OS NO mate el proceso al ir a background.
//
// 2. **Sólo breadcrumbs (DB), no broadcast Realtime en bg.**
//    Mantener una conexión WebSocket Supabase Realtime estable en background
//    es frágil (el OS puede dormir la red, el WS muere, re-subscribe es lento).
//    En su lugar persistimos a `route_breadcrumbs` cada 30s — el supervisor
//    ve al chofer "moverse" con ~30s de lag vs los 8s del broadcast del web.
//    Aceptable mientras nadie reporte. Si reportan, agregamos Realtime sobre
//    esto en un sprint chico (issue #180).
//
// 3. **Estado vive en AsyncStorage**, no en memoria del task.
//    El JS engine se puede recargar entre eventos de location (sobre todo si
//    el foreground service rebota). El task lee `routeId` + `driverId` + el
//    timestamp del último breadcrumb cada callback. Si no hay state válido,
//    el task se auto-detiene.
//
// 4. **defineTask se ejecuta top-level** (importado desde `app/_layout.tsx`).
//    Si lo defines dentro de useEffect, TaskManager no lo encuentra cuando el
//    OS wakea el bundle en bg.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '@/lib/supabase';

export const GPS_TASK_NAME = 'tripdrive-gps-broadcast';
const STATE_KEY = 'tripdrive-gps:state';
const LAST_WRITE_KEY = 'tripdrive-gps:last-write-ts';

const BREADCRUMB_INTERVAL_MS = 30_000; // 30s

interface GpsTaskState {
  routeId: string;
  driverId: string;
  startedAt: number;
}

interface LocationTaskBody {
  data?: { locations?: Location.LocationObject[] };
  error?: TaskManager.TaskManagerError | null;
}

// El callback del task: el OS lo llama (1) en foreground cuando hay nuevo fix,
// (2) en background cuando el foreground service está activo y entra un fix
// nuevo según distanceInterval / timeInterval.
TaskManager.defineTask(GPS_TASK_NAME, async (body: unknown) => {
  const { data, error } = (body ?? {}) as LocationTaskBody;
  if (error) {
    console.warn('[gps-task] error desde TaskManager:', error.message);
    return;
  }
  const locations = data?.locations ?? [];
  if (locations.length === 0) return;

  // Tomamos sólo el último fix — si el OS bufferó varios, los anteriores son
  // historia que no vale la pena escribir.
  const fix = locations[locations.length - 1];

  // Leer state. Si no hay, el task quedó huérfano (ej. user logout, app
  // crash mientras el task estaba registrado). Lo detenemos.
  const stateRaw = await AsyncStorage.getItem(STATE_KEY);
  if (!stateRaw) {
    await stopGpsTaskSilent();
    return;
  }
  let state: GpsTaskState;
  try {
    state = JSON.parse(stateRaw) as GpsTaskState;
  } catch {
    await stopGpsTaskSilent();
    return;
  }

  // Throttle: ¿pasaron 30s desde el último write?
  const lastWriteRaw = await AsyncStorage.getItem(LAST_WRITE_KEY);
  const lastWrite = lastWriteRaw ? Number(lastWriteRaw) : 0;
  const now = Date.now();
  if (now - lastWrite < BREADCRUMB_INTERVAL_MS) return;

  // Persistir breadcrumb. RLS permite al driver insertar suyos.
  try {
    const { error: insertErr } = await supabase.from('route_breadcrumbs').insert({
      route_id: state.routeId,
      driver_id: state.driverId,
      lat: fix.coords.latitude,
      lng: fix.coords.longitude,
      speed: fix.coords.speed ?? null,
      heading: fix.coords.heading ?? null,
      recorded_at: new Date(fix.timestamp).toISOString(),
    });
    if (insertErr) {
      console.warn('[gps-task] breadcrumb insert falló:', insertErr.message);
      return;
    }
    await AsyncStorage.setItem(LAST_WRITE_KEY, String(now));
  } catch (err) {
    console.warn('[gps-task] excepción al insertar breadcrumb:', err);
  }
});

interface StartArgs {
  routeId: string;
  driverId: string;
}

/**
 * Arranca el tracking. Antes verifica permisos foreground + background.
 * Devuelve `{ ok: false, reason }` si algún permiso falta — la UI muestra
 * el motivo y un botón para abrir Configuración del dispositivo.
 */
export async function startGpsTask(args: StartArgs): Promise<
  | { ok: true }
  | { ok: false; reason: 'foreground_denied' | 'background_denied' | 'start_failed'; detail?: string }
> {
  const fg = await Location.getForegroundPermissionsAsync();
  let fgGranted = fg.granted;
  if (!fgGranted) {
    const ask = await Location.requestForegroundPermissionsAsync();
    fgGranted = ask.granted;
  }
  if (!fgGranted) return { ok: false, reason: 'foreground_denied' };

  const bg = await Location.getBackgroundPermissionsAsync();
  let bgGranted = bg.granted;
  if (!bgGranted) {
    const ask = await Location.requestBackgroundPermissionsAsync();
    bgGranted = ask.granted;
  }
  if (!bgGranted) return { ok: false, reason: 'background_denied' };

  // Guardar state antes de arrancar — el primer fix puede llegar inmediatamente.
  const state: GpsTaskState = {
    routeId: args.routeId,
    driverId: args.driverId,
    startedAt: Date.now(),
  };
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  await AsyncStorage.removeItem(LAST_WRITE_KEY); // reset throttle

  try {
    await Location.startLocationUpdatesAsync(GPS_TASK_NAME, {
      accuracy: Location.Accuracy.High,
      // Disparamos cuando se mueve >20m O pasaron >10s — lo que primero ocurra.
      distanceInterval: 20,
      timeInterval: 10_000,
      // Foreground service Android — obligatorio para bg location en API 31+.
      foregroundService: {
        notificationTitle: 'TripDrive — siguiendo tu ruta',
        notificationBody: 'Tu ubicación se comparte con tu supervisor mientras la ruta está activa.',
        notificationColor: '#34c97c',
      },
      // En Android, sin pausa cuando el usuario está estático.
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: false,
    });
    return { ok: true };
  } catch (err) {
    await AsyncStorage.removeItem(STATE_KEY);
    return {
      ok: false,
      reason: 'start_failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function stopGpsTask(): Promise<void> {
  await stopGpsTaskSilent();
}

async function stopGpsTaskSilent(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(GPS_TASK_NAME);
    if (running) {
      await Location.stopLocationUpdatesAsync(GPS_TASK_NAME);
    }
  } catch (err) {
    console.warn('[gps-task] stop falló:', err);
  }
  await AsyncStorage.removeItem(STATE_KEY);
  await AsyncStorage.removeItem(LAST_WRITE_KEY);
}

export async function isGpsTaskRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(GPS_TASK_NAME);
  } catch {
    return false;
  }
}

/** Lee la timestamp del último breadcrumb persistido. Para indicador UI. */
export async function getLastBreadcrumbAt(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_WRITE_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

// Deeplinks para lanzar apps de navegación externa desde el botón "Navegar".
//
// Estrategia (ADR-078):
//   1. Intentar Waze primero (es el preferido del chofer mexicano por tráfico
//      real-time + reportes comunitarios).
//   2. Si Waze no está instalado, caer a `geo:` URI estándar de Android. Eso
//      abre un picker con todas las apps que entienden geo (Google Maps, Maps.me,
//      etc.) — el chofer elige su preferida.
//   3. Si TODO falla (edge case raro), fallback a `https://google.com/maps/dir`
//      en el browser.
//
// Por qué no abrir Google Maps direct: el chofer puede ya tener Google Maps
// como default del picker `geo:`, y si lo hace, va directo. Si no, escoge una
// vez y la próxima ya recuerda. Más adaptativo que hardcodear Google.

import { Linking, Platform } from 'react-native';

interface Destination {
  lat: number;
  lng: number;
  /** Opcional: nombre/dirección para que la app de nav la muestre. */
  label?: string;
}

function buildWazeUrl(d: Destination): string {
  // Waze acepta navigate=yes para iniciar el guiado inmediatamente.
  return `waze://?ll=${d.lat},${d.lng}&navigate=yes`;
}

function buildGeoUri(d: Destination): string {
  // El estándar es `geo:lat,lng?q=lat,lng(label)`.
  // El label entre paréntesis lo muestra como pin en algunos picker.
  const labelPart = d.label ? `(${encodeURIComponent(d.label)})` : '';
  return `geo:${d.lat},${d.lng}?q=${d.lat},${d.lng}${labelPart}`;
}

function buildGoogleMapsHttp(d: Destination): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}&travelmode=driving`;
}

/**
 * Lanza el flujo de navegación. Devuelve la URL que efectivamente se abrió
 * (para logging) o `null` si falló todo.
 *
 * iOS NOTE: iOS tiene canOpenURL whitelist en Info.plist. En V1 Android-only
 * no nos afecta. Si entra iOS, agregar LSApplicationQueriesSchemes con `waze`
 * y `comgooglemaps`.
 */
export async function openNavigationTo(d: Destination): Promise<string | null> {
  const waze = buildWazeUrl(d);
  const geo = buildGeoUri(d);
  const http = buildGoogleMapsHttp(d);

  // 1. Waze
  try {
    const wazeOk = await Linking.canOpenURL(waze);
    if (wazeOk) {
      await Linking.openURL(waze);
      return waze;
    }
  } catch (err) {
    console.warn('[deeplinks] Waze canOpenURL falló:', err);
  }

  // 2. geo: URI (Android picker)
  if (Platform.OS === 'android') {
    try {
      // canOpenURL para `geo:` siempre devuelve true en Android moderno
      // si hay AL MENOS UNA app que lo maneja. No es un test exhaustivo
      // pero suficiente para distinguir del fallback HTTP.
      const geoOk = await Linking.canOpenURL(geo);
      if (geoOk) {
        await Linking.openURL(geo);
        return geo;
      }
    } catch (err) {
      console.warn('[deeplinks] geo: canOpenURL falló:', err);
    }
  }

  // 3. Fallback HTTP — abre browser y luego deeplinkea a Google Maps si está
  // instalado (Android tiene intent handler para google.com/maps).
  try {
    await Linking.openURL(http);
    return http;
  } catch (err) {
    console.warn('[deeplinks] HTTP fallback falló:', err);
    return null;
  }
}

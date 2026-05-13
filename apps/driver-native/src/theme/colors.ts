// Paleta compartida entre pantallas del driver native.
//
// Mirror manual de los tokens `--vf-*` del CSS web (no podemos importar CSS
// en RN). Cuando entremos a Stream A Fase 5 (Flow Viewer data-driven) podemos
// considerar moverlo a un package.

export const colors = {
  bg: '#1d2521',
  surface1: '#222a26',
  surface2: '#262e2a',
  surface3: '#2b342f',
  border: '#323a35',
  borderStrong: '#3d4640',

  text: '#f1f3f0',
  textMuted: '#a8b0aa',
  textFaint: '#7d847f',

  brand: '#34c97c', // verde TripDrive
  brandDark: '#2aa566',

  warn: '#f0b429',
  warnSurface: '#3a2f12',

  danger: '#e44d4d',
  dangerSurface: '#3a1a1a',

  info: '#4d9bff',
  infoSurface: '#152340',

  // Pin colors para el mapa
  pinPending: '#4d9bff',   // azul = pendiente
  pinArrived: '#f0b429',   // amarillo = ya llegó
  pinCompleted: '#34c97c', // verde = entregada
  pinSkipped: '#7d847f',   // gris = saltada
  pinDepot: '#9b59b6',     // morado = CEDIS
};

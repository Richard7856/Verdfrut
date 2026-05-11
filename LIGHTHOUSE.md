# Lighthouse Audit — TripDrive Driver PWA

> Sprint H5 (issue #145). El driver app vive en celulares de los choferes — su performance en redes 3G/4G mexicanas es crítica. Esta guía documenta cómo correr el audit y qué métricas monitorear.

---

## Por qué importa

Los choferes:
- Cargan la PWA en su Android al iniciar el día (rara vez tienen wifi).
- Reciben push notifications con stops nuevas y deben abrir la app rápido.
- Suben fotos de evidencia desde redes celulares con cobertura variable.

Un TTI > 5s con 3G simulado significa que el chofer espera mientras la fila avanza en la tienda.

---

## Cómo correr el audit

### 1. Audit local con Chrome DevTools

```bash
# Levantar la driver app en modo prod local (importante: NO dev)
cd /Users/richardfigueroa/Downloads/VerdFrut
pnpm --filter @verdfrut/driver build
pnpm --filter @verdfrut/driver start  # corre en :3001
```

Abrir Chrome → http://localhost:3001 → DevTools → tab **Lighthouse**.

**Configuración recomendada:**
- Device: **Mobile**
- Categories: **Performance**, **PWA**, **Best Practices**
- Throttling: **Slow 4G** (representa red mexicana realista)
- Mode: **Navigation (Default)**

Click **Analyze page load**. El reporte se guarda en `lighthouse-report-<timestamp>.html`.

### 2. Audit en producción

Una vez `driver.tripdrive.xyz` esté live, repetir contra prod (los bundles son más optimizados que local):

```
https://verdfrut-driver.vercel.app  (URL actual)
https://driver.tripdrive.xyz        (cuando esté el dominio)
```

### 3. CLI (para CI/CD futuro)

```bash
npx --yes lighthouse https://verdfrut-driver.vercel.app \
  --preset=desktop \
  --output=json --output-path=./reports/lighthouse-driver.json \
  --quiet
```

---

## Métricas a vigilar

| Métrica | Target | Razón |
|---|---:|---|
| **Performance score** | ≥ 80 | Indicador agregado |
| **First Contentful Paint (FCP)** | ≤ 1.8s en 4G | El chofer ve algo rápido |
| **Largest Contentful Paint (LCP)** | ≤ 2.5s en 4G | Contenido principal listo |
| **Time to Interactive (TTI)** | ≤ 3.8s en 4G | Puede interactuar |
| **Speed Index** | ≤ 3.4s | Velocidad percibida |
| **Total Blocking Time (TBT)** | ≤ 200ms | No "atascos" al interactuar |
| **Cumulative Layout Shift (CLS)** | ≤ 0.1 | Layout no salta — crítico al taparse pantalla con dedo |
| **Bundle size first load** | ≤ 200 KB JS gzip | Datos celulares no quemados |
| **PWA installability** | ✓ | Manifest + service worker + HTTPS |

---

## Qué optimizar si el audit reprueba

### Bundle JS > 200 KB

Sospechosos típicos:
- `mapbox-gl` — pesa ~600 KB. Solo se necesita en `/route/[id]/map` y `/supervisor`. Verificar dynamic import (`next/dynamic`) en componentes que lo usan.
- `exceljs` — solo se usa en platform exports. Si aparece en driver bundle, hay un import errante.
- `@dnd-kit/*` — solo platform; verificar no esté en driver.

```bash
# Analizar bundle del driver
cd apps/driver
ANALYZE=true pnpm build
# Abre apps/driver/.next/analyze/client.html
```

### LCP > 2.5s

- ¿El hero/header tiene una imagen sin `priority`?
- ¿La fuente Geist se carga sync? Verificar `display: 'swap'` (ya en layout).
- ¿Hay un fetch a Supabase bloqueando el render? Mover a Suspense.

### TBT > 200ms

- Service Worker grande — Serwist puede precachear demasiado. Revisar `swSrc` config.
- Hidratación React lenta — chunks muy grandes. Code-splitting con `next/dynamic`.

### CLS > 0.1

- Imágenes sin `width/height` saltan al cargar. `<Image>` de Next ya las maneja si tienen dimensiones.
- Fuentes que cambian (FOIT/FOUT) — Geist `display: 'swap'` puede causar shift. Considerar `optional` si el chofer prefiere fuente del sistema antes que el shift.

---

## Checklist PWA específico

- [x] **manifest.json** con icons 192/512/maskable (ya).
- [x] **Service worker** registrado (Serwist).
- [x] **HTTPS** en prod (Vercel auto).
- [ ] **assetlinks.json** servido con `Content-Type: application/json` (ADR-052 — config aplicada, pendiente verificar tras deploy).
- [x] **Theme color** consistente con la marca (#16a34a).
- [ ] **App splash screen** — pendiente para Play Store.
- [ ] **Offline page** — pendiente, hoy el SW devuelve falla pelada.

---

## Cómo y cuándo correr el audit

| Cuándo | Quién | Acción |
|---|---|---|
| Pre-deploy mayor | Yo o tú | Audit local + comparar vs último resultado |
| Después de cambios de bundle (npm install pesado) | Tú | Audit local para detectar regresión |
| Mensual en prod | Tú | Audit contra prod, archivar HTML |
| Cuando el chofer reporta lentitud | Tú | Audit + comparar contra baseline |

Guardar reportes en `apps/driver/lighthouse-reports/` con fecha. Diff contra el anterior te dice qué empeoró.

---

## Estado actual

El audit completo no se ha corrido todavía (issue #145). Cuando lo hagas la primera vez:

1. Comparte el reporte HTML para revisarlo juntos.
2. Identificamos los 3 problemas más grandes.
3. Atacamos en un sub-sprint dedicado si el score < 70.

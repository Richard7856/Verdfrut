# DECISIONS — VerdFrut

Registro de decisiones técnicas no triviales. Cada entrada documenta el contexto, la decisión, alternativas consideradas, riesgos y oportunidades de mejora.

> Formato ADR (Architectural Decision Record). Las decisiones se agregan al final, nunca se editan retroactivamente — si una decisión cambia, se crea una nueva entrada que la supersede y se enlaza.

---

## [2026-04-30] ADR-001: Multi-tenant — Un proyecto Supabase por cliente

**Contexto:** VerdFrut sirve a empresas distribuidoras competidoras (OXXO, Neto). Una fuga de datos entre tenants por mala configuración de RLS sería catastrófica (legal, comercial, reputacional). Además, cada cliente espera aislamiento operativo: que un problema con un cliente no afecte a otro.

**Decisión:** Cada cliente tiene su propio proyecto Supabase. VerdFrut tiene un proyecto separado (control plane) con datos agregados (sin PII). Las zonas dentro de un cliente se separan con RLS por columna `zone_id`.

**Alternativas consideradas:**
- *Un solo proyecto con `tenant_id` + RLS:* descartado por riesgo de leak entre competidores. Una sola política mal escrita expone datos de todos.
- *Un proyecto por zona:* descartado por carga operativa. Un cliente con 30 zonas = 30 proyectos a mantener, migrar y monitorear.
- *DB compartida con schemas separados (PostgreSQL `SCHEMA`):* descartado porque Supabase no expone bien esta abstracción y complica el uso de Auth/Realtime.

**Riesgos / Limitaciones:**
- Migraciones cross-tenant: cada cambio de schema debe correrse en N proyectos. Mitigación: script central que itera sobre todos los proyectos en `scripts/migrate-all-tenants.sh`.
- Carga operativa de provisioning: crear un cliente requiere crear proyecto, correr migraciones, configurar storage, crear admin. Mitigación: script desde día 1 (`scripts/provision-tenant.sh`), automatización con n8n a 5+ clientes.
- Costo: Supabase Pro cuesta ~$25/mes/proyecto. A 10 clientes = $250/mes. Aceptable porque el cliente paga el costo.

**Oportunidades de mejora:**
- Si Supabase libera "organizations" con billing por org pero proyectos hijos compartiendo recursos, evaluar consolidación.
- Considerar Supabase Branching para staging compartido entre tenants.

---

## [2026-04-30] ADR-002: Optimizador self-hosted (FastAPI + VROOM)

**Contexto:** El motor de optimización de rutas es el corazón del producto. Las opciones managed (Google Routes Optimization API) cobran por shipment, generando costos lineales con el uso. A 10 clientes × 200 paradas/día × 30 días = 60,000 shipments/mes × $0.01 = $600/mes solo en optimización, escalando sin control.

**Decisión:** FastAPI service en Python que envuelve VROOM (binario C++ libre y rápido). Corre como Docker container sibling de las apps Next.js en el mismo VPS. Costo fijo ($0 por request).

**Alternativas consideradas:**
- *Google Routes Optimization API:* alta calidad pero costo lineal incontrolable. Descartado.
- *OpenRouteService (hosted):* free tier con límites ambiguos, dependencia externa. Descartado.
- *OR-Tools puro:* más flexible para restricciones complejas pero más lento (200ms-2s vs ~50ms de VROOM). Considerado como fallback futuro.
- *Algoritmo propio (Greedy/Hill Climbing):* descartado, reinventar la rueda con peor calidad que VROOM.

**Riesgos / Limitaciones:**
- VROOM no soporta restricciones complejas tipo "este camión debe visitar A antes que B por refrigeración". Mitigación: cuando aparezca el caso, agregar OR-Tools como fallback detrás del mismo API de FastAPI.
- Operativa de mantener un servicio adicional. Mitigación: Docker container, monitoreo básico vía Traefik.
- Calidad de matriz de distancias afecta calidad de ruta. Empezamos con Mapbox Directions API; si crece costo, OSRM self-hosted.

**Oportunidades de mejora:**
- Cache de matriz de distancias entre paradas frecuentes (mismas tiendas día tras día).
- Precomputar matriz nocturna para todas las tiendas activas del cliente.

---

## [2026-04-30] ADR-003: GPS via Supabase Realtime Broadcast (no DB writes)

**Contexto:** GPS tracking continuo de choferes activos. 50 choferes × 1 update/5s × 8h jornada = 288K mensajes/día/cliente. Si cada update es un INSERT a Postgres, en un mes son 8.6M filas/cliente, colapsando el plan Pro de Supabase (8GB) y degradando performance.

**Decisión:** Usar Supabase Realtime Broadcast channels para datos transitorios. El chofer publica posición a `gps:{route_id}` y los listeners (encargado de zona, panel logístico) reciben en tiempo real. SIN escritura a DB. Solo se escribe a DB en eventos discretos: inicio/fin de ruta, llegada/salida de parada, alerta de desviación.

**Alternativas consideradas:**
- *Postgres Changes (DB triggers):* descartado, escribe cada update a DB.
- *Custom WebSocket server (Node + ws):* 2-3 semanas de trabajo, cero beneficio sobre lo que Supabase ofrece gratis.
- *HTTP polling:* añade carga al server Next.js, lag de 5s en supervisión, no es realmente "realtime".
- *MQTT broker:* infra adicional, sin justificación para nuestra escala.

**Riesgos / Limitaciones:**
- Broadcast no persiste mensajes — si un listener se desconecta, pierde los GPS de ese intervalo. Mitigación: aceptable, el listener volverá a recibir desde el momento de reconexión, y el dato histórico no es crítico (el chofer ya pasó por ahí).
- Para análisis post-hoc de ruta (ej. "¿el chofer se desvió?"), necesitamos algunos breadcrumbs guardados. Mitigación: chofer escribe en lote cada N minutos a tabla `route_breadcrumbs` (~10-20 puntos por ruta).
- Límite de mensajes Broadcast en Supabase (varía por plan). Monitorear y subir plan si necesario.

**Oportunidades de mejora:**
- Si en el futuro se requiere replay completo de ruta, agregar batching más agresivo a `route_breadcrumbs`.

---

## [2026-04-30] ADR-004: PWA primero, nativa si hace falta

**Contexto:** El chofer usa la app en su teléfono móvil. iOS mata service workers de PWAs agresivamente y limita GPS background. Una app nativa resolvería esto pero añade 2-3 meses al timeline (React Native/Expo, App Store/Play Store, dos código bases o framework cross-platform).

**Decisión:** Empezar con PWA Next.js 16 + Serwist. Diseñar UX para minimizar dependencia de background (Wake Lock API para mantener pantalla encendida, navegación fullscreen para que el chofer no salga de la app). Migrar a Expo en Fase 7 SOLO si iOS deteriora la operación a punto de afectar negocio.

**Alternativas consideradas:**
- *Nativa desde día 1 con Expo:* retraso de 2-3 meses sin certeza de necesidad. Descartado para V1.
- *Solo PWA sin plan B:* riesgo si iOS bloquea la operación. Mitigación: el plan incluye Fase 7 con criterios claros.
- *Wrapper nativo simple (Capacitor):* considerado, pero añade complejidad de stores sin resolver fundamentalmente el problema de background si Apple endurece políticas.

**Riesgos / Limitaciones:**
- Si todos los choferes están en iOS y el supervisor pierde tracking continuo, la operación puede degradarse. Mitigación: el modelo asume que llegada/salida de parada son los datos confiables (reportados manualmente), no el GPS continuo.
- PWAs son menos descubribles que apps nativas. Mitigación: el cliente onboardea a sus choferes, no es un canal de adquisición.

**Oportunidades de mejora:**
- Fase 7 con Expo reutilizando `packages/types`, `packages/supabase`, `packages/flow-engine`.
- Considerar TWA (Trusted Web Activity) para Android como paso intermedio si solo Android necesita publicación en store.

---

## [2026-04-30] ADR-005: Platform = una sola app Next.js con route groups

**Contexto:** El panel logístico, el dashboard de ventas y el panel de configuración del cliente comparten la misma autenticación, el mismo tenant, los mismos datos de DB. Separarlos en apps independientes duplica config, deploy, y client setup.

**Decisión:** Una sola app Next.js (`apps/platform`) con route groups del App Router:
- `(auth)/` — login, registro
- `(logistics)/` — crear/optimizar/aprobar/publicar rutas
- `(dashboard)/` — KPIs, métricas, reportes
- `(settings)/` — tiendas, camiones, usuarios, zonas

El acceso por rol se valida en middleware.

**Alternativas consideradas:**
- *Apps separadas (logistics, dashboard, settings):* triplica deploys, environment config, build pipelines. Sin beneficio claro.
- *Microfrontends:* over-engineering brutal para este tamaño.

**Riesgos / Limitaciones:**
- Si el bundle crece mucho, todos los usuarios bajan código que no usan. Mitigación: Next.js code-splitting por ruta es automático.
- Si en el futuro un equipo distinto opera el dashboard, podría justificarse separar. Por ahora, somos uno.

---

## [2026-04-30] ADR-006: Mapas con Mapbox GL JS

**Contexto:** Necesitamos renderizado de mapa con tracking de flota en tiempo real para el supervisor de zona, vista de rutas para el chofer, y visualización de rutas optimizadas en el panel logístico. Las dos opciones serias son Mapbox y Google Maps.

**Decisión:** Mapbox GL JS. 50K free map loads/mes (suficiente hasta ~30 tenants), tiles vectoriales (mejor experiencia de pan/zoom para fleet tracking que raster), $5/1K overage (40-50% más barato que Google), opción futura de self-host con OpenMapTiles.

**Alternativas consideradas:**
- *Google Maps Platform:* mejor geocoding en México, Street View útil para verificación visual de tienda. Más caro a escala (~$7/1K vs $5/1K).
- *Leaflet + OSM:* gratis pero raster tiles sin la suavidad necesaria para tracking continuo.

**Riesgos / Limitaciones:**
- Geocoding de direcciones mexicanas es ligeramente peor en Mapbox que en Google. Mitigación: en Fase 1 usar Mapbox para todo; si geocoding es problema, usar Google solo para esa función específica detrás del wrapper de `packages/maps`.

**Oportunidades de mejora:**
- Si crece el costo, self-host de OpenMapTiles + OSRM elimina dependencia y costo de Mapbox.

---

## Plantilla para nuevas decisiones

```markdown
## [YYYY-MM-DD] ADR-NNN: Título corto

**Contexto:** Qué problema o necesidad triggereó esta decisión.

**Decisión:** Qué se eligió.

**Alternativas consideradas:**
- *Opción A:* por qué no.
- *Opción B:* por qué no.

**Riesgos / Limitaciones:** Qué puede fallar, qué hay que vigilar, mitigaciones.

**Oportunidades de mejora:** Qué podría ser mejor más adelante.
```

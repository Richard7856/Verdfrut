# Stream C — Optimizer mejorado con Google Routes

> Plan para llevar el optimizador (el core del negocio) de "decente" a
> "clase mundial". Integra Google Routes API con tráfico real-time +
> re-optimización en vivo.
>
> **Estado**: 🟡 Próximo (post Stream B Fase N3).
> **Owner**: Richard + Claude.
> **No tiene timeline** — DoD por fase.

---

## 0. Estado actual del optimizer

```
services/optimizer/
├── main.py            ← FastAPI app
├── vroom_solver.py    ← VROOM 1.14 binding
├── matrix.py          ← Cliente Mapbox Distance Matrix
├── geocode.py         ← Cache de geocoding
└── Dockerfile

Endpoint:
POST /optimize
  body: { vehicles[], jobs[], shift_start, shift_end, depot, ... }
  returns: { routes: [{ vehicle_id, steps[], distance, duration }] }
```

**Lo que hace hoy**:
1. Recibe N camionetas + M paradas + ventana del turno.
2. Pide a Mapbox Distance Matrix una matriz N×M con distancias y tiempos.
3. Pasa todo a VROOM que resuelve el VRP (Vehicle Routing Problem).
4. Devuelve rutas óptimas con secuencia + ETAs.

**Limitaciones actuales**:
- **Mapbox Matrix sin tráfico** — calcula tiempo de viaje en condiciones
  ideales. En CDMX hora pico, el chofer llega 30-50% más tarde.
- **Sin re-optimización en vivo** — si chofer atrasa o llega una parada
  urgente, hay que cancelar la ruta y crear una nueva.
- **Matrix limitada a 25 coords/request** (#29 KNOWN_ISSUES). Tiros >23
  paradas caen a fallback haversine.
- **Sin predicción de ETAs por hora** — no podemos sugerir "mejor sale a
  las 5am que a las 7am" basado en tráfico esperado.

---

## 1. Por qué Google Routes API

Google Routes API (la versión 2 de Directions, lanzada 2023) ofrece:

| Feature | Mapbox Matrix | Google Routes API |
|---|---|---|
| Tráfico real-time MX | Pobre (TomTom) | **Excelente (Waze)** |
| Tráfico predicho por hora futura | NO | **SÍ** (`departureTime`) |
| Límite de waypoints | 25/matrix | 25/route, no hay matrix mode (compute route individual) |
| Costo por compute | $0.50/1000 elements | $5/1000 routes (compute) |
| Avoid (peajes, autopistas) | Limitado | Granular |
| Routing modes | driving | driving, two-wheeler, transit, walking |

**Estrategia recomendada**:
- **Planning del día siguiente (nocturno)**: usar Mapbox Matrix (barato, batch).
- **Re-optimización en vivo** (chofer atrasado): usar Google Routes (preciso).
- **Predicción de ETAs por hora**: usar Google Routes con `departureTime` future.

Esto da lo mejor de ambos mundos: costo bajo en batch + precisión alta
cuando se necesita.

---

## 2. Fases (Definition of Done)

### Fase O1 — Integrar Google Routes API ⚪

**Meta**: el optimizer tiene un cliente Google Routes API funcional.
Dispatcher tiene botón "Re-optimizar con tráfico actual" en `/dispatches/[id]`
que dispara el flujo.

**DoD**:
- [ ] Variable env `GOOGLE_ROUTES_API_KEY` en Railway (proyecto Google Cloud
      con Routes API enabled).
- [ ] Módulo `services/optimizer/google_routes.py` con cliente Routes API.
- [ ] Endpoint nuevo `POST /reoptimize-live` que:
  - Recibe `route_id` + lista de stops pendientes.
  - Llama Google Routes API con tráfico actual para cada par origen→destino.
  - Recalcula matriz con tiempos actualizados.
  - Pasa a VROOM para re-secuenciar (con first stop fija = posición actual del chofer).
  - Devuelve nueva ruta optimizada.
- [ ] Server action `reoptimizeLiveAction(routeId)` en platform que llama
      el endpoint.
- [ ] Botón "Re-optimizar con tráfico actual" en `RouteStopsCard`
      cuando ruta está IN_PROGRESS.
- [ ] Audit log en `route_versions` con `reason = "Live re-opt with traffic"`.
- [ ] Push notification al chofer "Tu ruta se actualizó por tráfico".

**Documentación entregable**:
- ADR-074: Google Routes integration + estrategia híbrida.
- `OPTIMIZER.md` actualizado con flujo y costos.

**Riesgos**:
- Costo de Google Routes si se abusa. Mitigación: rate limit por dispatcher
  (max 3 re-opts en vivo por ruta/día).
- Latencia: cada par origen→destino = 1 request HTTP. Para 20 stops = 19
  requests × 200ms = 3.8s. Mitigación: paralelización con `asyncio.gather`.

---

### Fase O2 — Re-optimización automática trigger >15min ⚪

**Meta**: cuando el chofer atrasa >15min en una parada vs ETA original, el
sistema dispara automáticamente la re-optimización en vivo y notifica al
dispatcher.

**DoD**:
- [ ] Cron job (Supabase Edge Function) cada 5 min que:
  - Lee rutas IN_PROGRESS.
  - Para cada una, calcula delta entre ETA original de próxima parada vs
    "tiempo ahora + travel time desde posición actual con tráfico".
  - Si delta > 15min, dispara `reoptimizeLiveAction` automático.
- [ ] Notification al dispatcher: "Ruta XYZ — chofer atrasado 22min,
      re-optimicé automáticamente. Ver nuevos ETAs."
- [ ] Feature flag `auto_reopt_enabled` per customer (default ON).
- [ ] Setting en `/customers/[id]/config` para ajustar threshold (default 15min).

**Documentación entregable**:
- ADR-075: Auto re-optimization triggers + thresholds.

**Riesgos**:
- Falsos positivos: chofer paró por comida 20min, no es atraso real.
  Mitigación: detectar GPS estacionario antes de re-opt — si está parado
  en una tienda válida, asumir parada legítima.
- Loop infinito de re-opts. Mitigación: cooldown de 30min entre re-opts.

---

### Fase O3 — Predicción de ETAs por hora del día ⚪

**Meta**: cuando el dispatcher arma un tiro, ve gráfica "si sales a las
5am, ruta tarda 4h; a las 6am, 4.5h; a las 7am, 6h". Permite elegir el
shift óptimo basado en tráfico predicho.

**DoD**:
- [ ] Endpoint `POST /predict-shift-cost` que:
  - Recibe la ruta planeada (vehicles, jobs).
  - Calcula matrix con Google Routes para 5 horas distintas (5am, 6am, 7am, 8am, 9am) usando `departureTime`.
  - Devuelve total duration estimado para cada hora.
- [ ] UI en `/routes/new` muestra gráfica de barras "duración total por hora de salida".
- [ ] Sugerencia: "Sugerencia: sal a las 5am — ahorra 1h 47min vs 7am".

**Documentación entregable**:
- ADR-076: Shift cost prediction.

**Riesgos**:
- Costo: 5 hours × N stops = 5x el costo de matrix actual. Mitigación:
  cache de 24h por (route_template, day_of_week).
- Modelo de tráfico predicho varía día a día. Mitigación: mostrar
  "±15min margen" en la sugerencia.

---

### Fase O4 — ML-learned service time por tienda ⚪

**Meta**: el `service_time_seconds` por tienda deja de ser fijo (1800s = 30min)
y se calcula del histórico real de entregas. Tiendas grandes tardan 45min,
chicas 15min — el optimizer lo refleja.

**DoD**:
- [ ] Job Postgres mensual que actualiza `stores.service_time_seconds_learned`:
  - Para cada tienda, calcula mediana de `actual_departure_at - actual_arrival_at`
    de últimos 60 días.
  - Si <10 muestras, usa default 1800s.
  - Si >10, usa mediana clamped a [600, 3600].
- [ ] Optimizer usa `service_time_seconds_learned` cuando exista.
- [ ] UI en `/settings/stores/[id]` muestra "Tiempo de servicio: 28min
      (aprendido de 47 entregas en últimos 60 días)".

**Documentación entregable**:
- ADR-077: ML-learned service times.

**Riesgos**:
- Outliers: una entrega con problema duró 2h, sube la mediana. Mitigación:
  uso de mediana (resistente a outliers) en vez de mean. Y clamp a [600, 3600].
- Tiendas nuevas (sin histórico) usan default — OK.

---

## 3. Costos estimados

Asumiendo escala normal (VerdFrut + 2 clientes futuros, 5 tiros/día, 50 stops promedio):

| Fase | Google Routes calls/mes | Costo USD/mes |
|---|---|---|
| O1 (re-opt manual) | ~50 × 20 pairs × 30 días = 30K | $150 |
| O2 (re-opt auto) | ~200 × 20 pairs × 30 días = 120K | $600 |
| O3 (shift prediction) | ~150 × 5h × 30 días = 22.5K | $115 |
| O4 (no usa Google) | 0 | $0 |
| **Total** | **~172K calls/mes** | **~$865 USD/mes** |

**Esto es high — vale la pena solo si el cliente paga premium**. Modelo
de pricing actual incluye "Routes con tráfico" solo en Tier Pro+ ($1,490
MXN/perfil/mes × 7 = $10K MXN = ~$590 USD/mes). Margen ajustado pero
viable porque el tráfico es feature high-value.

**Optimización de costos**:
- Cache agresivo de matrix por (origin, destination, hour_of_day, day_of_week)
  con TTL de 7 días. Reduce calls ~70% en operación recurrente.
- Solo activar O2 (auto re-opt) en Tier Pro+.
- O3 solo cuando dispatcher lo solicita explícito.

Con cache + tier-gating: costo real ~$200-300/mes.

---

## 4. Decisiones pendientes antes de O1

| # | Decisión | Default |
|---|---|---|
| 1 | Cobrar Google Routes solo en Tier Pro+ o todos | Solo Pro+ |
| 2 | Threshold de re-opt auto (min) | 15 min |
| 3 | Cooldown entre re-opts (min) | 30 min |
| 4 | Cache TTL de matrix (días) | 7 días |
| 5 | Notificar chofer en cada re-opt o solo si delta significativo | Solo si próxima parada cambió ETA >10min |

---

## 5. Cómo medimos éxito de Stream C

| KPI | Objetivo | Cómo medimos |
|---|---|---|
| Precisión de ETAs (post re-opt) | Error promedio <10min | Comparar `planned_arrival_at` vs `actual_arrival_at` |
| Reducción de quejas "chofer llegó tarde" | -50% | Tickets soporte mensual |
| Adopción de "Sugerencia de shift" | >40% dispatchers la usan | Analytics de click en gráfica |
| Costo Google Routes vs revenue | <10% del MRR per customer | Cost tracking GCP + billing |

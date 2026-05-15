# Optimization Engine — feature central de TripDrive

> ADR-096 (2026-05-14). Spec técnica detallada para implementar la capa de
> clustering + asignación + secuencia + decisión de # vehículos como
> **el** diferenciador del producto.

## TL;DR

Reemplazar el flujo actual de "el dispatcher arma rutas a mano y luego
optimiza la secuencia" por **"el agente AI propone 2-3 alternativas óptimas
en 30 segundos, el dispatcher elige una"**. Esto va para todo: tiros nuevos,
re-ruteo en vivo, planeación multi-día.

---

## Problema actual (evidencia VerdFrut 2026-05-14)

55 stops CDMX repartidos alfabéticamente entre 2 camionetas → ambas cruzan
toda la zona, una hace 269 km en 10h, la otra 152 km en 6h.

Fix manual aplicado:
- SUR: split por lng en lng=-99.142 → 11 oeste + 10 este
- ORIENTE: split por lat en lat=19.38 → 13 norte + 12 sur

Resultado: cada camioneta toma un cluster geográficamente coherente,
reduciendo ~40% km totales.

**Conclusión**: el optimizador VROOM resuelve secuencia, no asignación
inter-vehículo. Necesitamos una **capa previa de clustering**.

---

## Arquitectura — 5 capas

```
┌─────────────────────────────────────────────────────────────┐
│  Capa 4 — Decisión "cuántos vehículos"                       │
│  Presenta 2-3 alternativas con costo + jornada               │
├─────────────────────────────────────────────────────────────┤
│  Capa 5 — Multi-día / frequency (post-V1)                    │
│  Reparte stops en N días respetando frecuencia               │
├─────────────────────────────────────────────────────────────┤
│  Capa 1 — Clustering geográfico                              │
│  N stops + K → K clusters coherentes                         │
├─────────────────────────────────────────────────────────────┤
│  Capa 2 — Asignación cluster → vehículo                      │
│  K clusters + V vehículos + depots → mapping                 │
├─────────────────────────────────────────────────────────────┤
│  Capa 3 — Secuencia intra-ruta (VROOM existente)             │
│  Stops asignados + depot → orden óptimo de visita            │
└─────────────────────────────────────────────────────────────┘
```

El agente AI orquesta capas 4 → 1 → 2 → 3 → 5 (en ese orden) y devuelve
plan completo listo para aplicar.

---

## Capa 1 — Clustering geográfico

### Algoritmo V1: Bisección recursiva por eje de mayor spread

```ts
function clusterStops(stops: Stop[], k: number): Stop[][] {
  if (k === 1 || stops.length <= MAX_PER_CLUSTER) return [stops];

  // Decidir eje de split (mayor spread = más capacidad de separación clean)
  const lngSpread = max(stops.map(s => s.lng)) - min(stops.map(s => s.lng));
  const latSpread = max(stops.map(s => s.lat)) - min(stops.map(s => s.lat));
  const axis = lngSpread > latSpread ? 'lng' : 'lat';

  // Mediana del eje para split balanceado
  const sorted = [...stops].sort((a, b) => a[axis] - b[axis]);
  const median = sorted[Math.floor(sorted.length / 2)][axis];

  const left = stops.filter(s => s[axis] <= median);
  const right = stops.filter(s => s[axis] > median);

  // Recursión: split izquierda en k/2, derecha en k - k/2
  return [
    ...clusterStops(left, Math.floor(k / 2)),
    ...clusterStops(right, Math.ceil(k / 2)),
  ];
}
```

### Por qué bisección recursiva (no k-means clásico)

- **Determinístico** — mismo input siempre da mismo output. Esto importa
  para que el user vea "los mismos clusters" si re-corre.
- **Sin random seeds**: k-means clásico empieza con centroides random;
  resultados varían entre runs.
- **Balance por construcción**: cada split corta en mediana → clusters
  con ≈ mismo tamaño.
- **Ejes alineados con grilla urbana**: CDMX (y mayoría de ciudades MX)
  tiene calles cuadriculadas; splits por lat/lng coinciden con vialidades
  naturales (Periférico, Calzada, etc.).
- **Implementable en 50 líneas TS**: no requiere dependencia externa.

### Limitaciones conocidas

- **Asume zona convexa**: si los stops forman herradura o L, la bisección
  puede separar mal. V2: detectar shape y caer a k-means+capacity.
- **No respeta capacidad de vehículo**: la capa actual divide por count,
  no por demand[]. Si tienda A requiere 80% de capacidad de la
  camioneta y tienda B requiere otro 80%, no caben juntas aunque sean
  vecinas. V1.1 agrega bin-packing como segunda pasada (post-cluster
  swap stops entre clusters vecinos para respetar capacidad).

### Edge cases

- **k=1**: return [stops] sin split.
- **stops.length <= max_per_cluster**: return [stops] aunque k > 1.
- **stops todos en el mismo punto**: bisección imposible → forzar k=1
  o split aleatorio con warning al user.

---

## Capa 2 — Asignación cluster → vehículo

### Algoritmo V1: greedy por centroide-depot distance

```ts
function assignClustersToVehicles(
  clusters: Stop[][],
  vehicles: Vehicle[],
): Map<string, Stop[]> {
  const assignments = new Map<string, Stop[]>();
  const remainingVehicles = [...vehicles];

  // Calcular centroide de cada cluster
  const clustersByDistance = clusters.map((cluster, i) => ({
    cluster,
    centroid: centroid(cluster),
    originalIndex: i,
  }));

  // Para cada cluster, asignar el vehículo cuyo depot está más cerca
  for (const { cluster, centroid: c } of clustersByDistance) {
    const closest = remainingVehicles
      .map(v => ({ v, dist: haversine(c, v.depot) }))
      .sort((a, b) => a.dist - b.dist)[0];

    assignments.set(closest.v.id, cluster);
    remainingVehicles.splice(remainingVehicles.indexOf(closest.v), 1);
  }

  return assignments;
}
```

### Caso especial: depots compartidos

En VerdFrut hoy todos los vehículos salen del mismo depot (CEDA). En ese
caso, la asignación greedy degenera: cualquier cluster a cualquier
vehículo da el mismo costo de "depot → primer stop del cluster".

V1 mitigation: asignar por orden de aparición del cluster (arbitrario
pero consistente).

V2: cuando haya múltiples CEDIS (Toluca, Tetelco, etc.), la asignación
greedy ya tiene sentido.

---

## Capa 3 — Secuencia intra-ruta (VROOM, existente)

Reuso del `apps/platform/src/lib/optimizer-pipeline.ts` actual sin cambios.
Lo único: se llama **una vez por cluster** en lugar de **una vez con todos
los vehículos**.

```ts
for (const [vehicleId, clusterStops] of assignments) {
  const sequence = await callVroomOptimizer({
    vehicles: [vehicles.find(v => v.id === vehicleId)!],
    jobs: clusterStops,
    matrix: trafficMatrix,
  });
  routes.push({ vehicleId, sequence });
}
```

Esto puede paralelizarse: cada cluster es independiente del otro, así que
las llamadas a VROOM pueden ir en `Promise.all([...])` para reducir
latencia ~50%.

---

## Capa 4 — Decisión "cuántos vehículos"

### Función objetivo: costo total por opción

```ts
interface RoutePlanOption {
  vehicleCount: number;
  totalKm: number;
  maxDriverHours: number;     // jornada del chofer más cargado
  estimatedCostMxn: number;   // combustible + peajes + salario
  feasible: boolean;          // ¿todos los choferes <= jornada legal?
  clusters: ClusterPreview[]; // para map render
}
```

### Cálculo de costo

```
costoTotalMxn =
  sumOf(km_recorridos) * COSTO_POR_KM_COMBUSTIBLE  +
  sumOf(km_recorridos) * COSTO_POR_KM_DESGASTE     +
  sumOf(hours_chofer) * SALARIO_HORA_CHOFER        +
  vehicleCount * COSTO_FIJO_DESPACHO_POR_DIA
```

Constantes configurables por customer (en `customers.optimizer_costs` jsonb).
Defaults razonables MX:
- `COSTO_POR_KM_COMBUSTIBLE`: $2.5 MXN (Kangoo a 14 km/l, $24/litro)
- `COSTO_POR_KM_DESGASTE`: $0.5 MXN (mantenimiento + amortización)
- `SALARIO_HORA_CHOFER`: $80 MXN (~$15k/mes a 200 h)
- `COSTO_FIJO_DESPACHO_POR_DIA`: $50 MXN (overhead admin)

### Algoritmo de propuesta

```ts
async function proposePlans(
  stops: Stop[],
  vehiclesAvailable: Vehicle[],
  constraints: { maxHoursPerDriver: number; maxStopsPerVehicle: number },
): Promise<RoutePlanOption[]> {
  const options: RoutePlanOption[] = [];
  const minVehicles = Math.ceil(stops.length / constraints.maxStopsPerVehicle);
  const maxVehicles = Math.min(vehiclesAvailable.length, stops.length / 4);

  for (let k = minVehicles; k <= maxVehicles; k++) {
    const clusters = clusterStops(stops, k);
    const assignments = assignClustersToVehicles(clusters, vehiclesAvailable.slice(0, k));
    const routes = await Promise.all(
      [...assignments.entries()].map(([vId, stops]) => optimizeSequence(vId, stops))
    );
    options.push(buildPlanOption(k, routes));
  }

  // Marcar feasible y ordenar por costo
  return options
    .map(o => ({ ...o, feasible: o.maxDriverHours <= constraints.maxHoursPerDriver }))
    .filter(o => o.feasible)  // descartar infeasible
    .sort((a, b) => a.estimatedCostMxn - b.estimatedCostMxn);
}
```

### UX de presentación

Devolver máximo **3 alternativas** al user (no espamearlo con 10):
1. **Más económica**: menor `estimatedCostMxn`.
2. **Balanced**: mediana de hours_chofer ≤ 7h (jornada cómoda).
3. **Más rápida**: menor `maxDriverHours` (entrega completa más temprano).

Si dos coinciden (ej. balanced y rápida son la misma), mostrar solo 2.

---

## Capa 5 — Multi-día / frequency (post-V1)

Diferido. Cuando el catálogo crece más allá de "1 día puede con todo",
necesitamos:

1. Frequency tag por store: `delivery_frequency` (daily/3x_week/weekly/biweekly)
2. Asignación de días disponibles: `available_days[]` por store
3. Optimizer multi-día: aplica capas 1-4 por día respetando que la suma
   semanal cumple frequency.

V1: hardcodeable, todas las stores "daily" por defecto. V2 expone UI.

---

## Integración con el agente AI

### 2 tools nuevos en `@tripdrive/orchestrator`

#### `propose_route_plan`
```ts
{
  name: 'propose_route_plan',
  is_write: false,
  description: 'Calcula 2-3 planes alternativos de rutas para un conjunto de stops.',
  input_schema: {
    stop_ids: string[],
    vehicle_count_max?: number,    // default: todos los disponibles del customer
    max_hours_per_driver?: number, // default: 9 (jornada legal MX)
    max_stops_per_vehicle?: number,// default: 14 (config del customer)
    date?: string,                 // default: hoy
  },
  // Output:
  // { plans: RoutePlanOption[], recommendation_index: number, reasoning: string }
}
```

#### `apply_route_plan`
```ts
{
  name: 'apply_route_plan',
  is_write: true,
  needs_confirmation: true,
  description: 'Materializa un plan propuesto en dispatch + routes + stops.',
  input_schema: {
    plan_id: string,         // referencia al plan propuesto en la sesión
    dispatch_name: string,   // ej. "CDMX Lun 18/05 — Sur"
    date: string,
  },
}
```

### Endpoint interno

`POST /api/orchestrator/_internal/propose-routes` — recibe stop_ids +
constraints, ejecuta capas 1-4, devuelve `RoutePlanOption[]`.

Misma estructura del `optimize/` endpoint existente (token interno
+ derivación de customer_id del user — HARDENING C1 aplica).

### UX del agente

Diálogo ejemplo:
```
User:    "Arma el tiro del lunes con las tiendas del sur de CDMX."

Agente:  Buscando tiendas en zona sur... encontré 21.

         Te propongo 3 alternativas:

         🚚 Más económica  · 2 camionetas
            • Sur-Oeste 11 stops, 145 km, 6h chofer
            • Sur-Este 10 stops, 130 km, 5.5h chofer
            • Total: $1,820 MXN

         ⚖️ Balanced  · 2 camionetas (recomendada)
            • Sur-Oeste 11 stops, 145 km, 6h chofer
            • Sur-Este 10 stops, 130 km, 5.5h chofer
            • Total: $1,820 MXN
            (misma que la económica en este caso)

         ⚡ Más rápida  · 3 camionetas
            • Sur-W 8 stops, 95 km, 4h
            • Sur-C 7 stops, 90 km, 4h
            • Sur-E 6 stops, 80 km, 3.5h
            • Total: $2,180 MXN
            (entrega completa 2h antes pero +$360)

         ¿Cuál aplicamos?

User:    "Vamos con la balanced."

Agente:  [llama apply_route_plan] Listo. Tiro "CDMX Lun 18/05 — Sur"
         creado con 2 rutas. Las dos camionetas ya tienen secuencia
         óptima. ¿Quieres publicar ya o esperar?
```

---

## Plan de implementación

### Sprint 1 — Capas 1+2 (Clustering + Asignación)

- **Día 1-2**: Implementar `clusterStops` en nuevo package `@tripdrive/router`.
  Tests unitarios con casos VerdFrut conocidos (21 sur, 25 oriente).
- **Día 3**: Implementar `assignClustersToVehicles`.
- **Día 4**: Integrar en `optimizer-pipeline.ts` como pre-paso opcional
  (flag `use_clustering=true`). Backward compatible.
- **Día 5**: Test E2E: tomar tiros existentes, comparar km/tiempo
  pre-clustering vs post-clustering. Documentar % de mejora.

### Sprint 2 — Capa 4 (Propuesta de N alternativas)

- **Día 1-2**: Implementar `proposePlans` que ejecuta clustering + VROOM
  para K = minVehicles..maxVehicles en paralelo.
- **Día 3**: Cálculo de costo MXN. Agregar columna
  `customers.optimizer_costs jsonb` (migración 045).
- **Día 4**: Endpoint `/api/orchestrator/_internal/propose-routes`.
  Hardening C1 aplicado (caller_user_id → derive customer).
- **Día 5**: Tool `propose_route_plan` en orchestrator package.

### Sprint 3 — Capa AI + UI

- **Día 1-2**: Tool `apply_route_plan` en orchestrator. State management
  en la sesión para mantener plans propuestos entre turnos.
- **Día 3-4**: Componente `RouteProposalCard` con mini-map por cluster
  (Mapbox GL JS). 3 cards apiladas con costo + jornada + botón "elegir".
- **Día 5**: Integrar en la UI de chat del orchestrator. Test end-to-end
  con VerdFrut data real.

### Sprint 4 — Refinamientos

- Constraints adicionales: ventanas horarias, capacity multi-dimensional
  (peso/volumen/cajas), preferencias del chofer.
- Cache de matrices de tráfico (Google Routes es caro — reusar cuando
  los stops son los mismos).
- A/B testing: mostrar opción "balanced" como default vs "más económica"
  como default, medir cuál elige el dispatcher.

---

## Métricas de éxito

| Métrica | Pre-V1 (manual) | Post-V1 (target) |
|---|---|---|
| Km totales por tiro CDMX 21 stops | 421 | < 280 (-33%) |
| Tiempo armar tiro (UX) | 15-30 min | < 1 min |
| % desbalance entre rutas | hasta 70% | < 20% |
| Adopción del feature | N/A | >80% de tiros usan AI propose |
| Costo logístico per delivery | baseline | -20% |

---

## Riesgos

1. **Latencia**: 3 VROOM calls + clustering + UI render = ~30s p99. Si se
   siente lento, agregar progress bar + cancelable.
2. **Sub-optimalidad para forma no convexa**: documentar y construir tests
   para detectar (compare clustering vs k-means en datasets de varias
   ciudades MX antes de generalizar).
3. **Costo Google Routes**: 3 alternativas × 2-3 vehículos × 50 stops =
   ~9 llamadas por propuesta. Cap por customer (límite mensual) + cache
   agresivo en matriz de pares (lat,lng).
4. **Sobre-confianza del user en la IA**: la herramienta propone, el user
   decide. UI nunca esconde el detalle (km / horas / costo); siempre
   mostrar para que el dispatcher pueda overridear con razonamiento.

---

## Anti-features (no incluir en V1)

- ❌ Optimización en tiempo real durante operación (ya hay re-opt manual,
  no toquemos hasta tener feedback)
- ❌ Predicción ML de service time (eso es Stream C/O4, separado)
- ❌ Optimización con stops dinámicos (cliente agrega pedido a las 11am):
  flujo aparte, no parte de "armar tiro inicial"
- ❌ Multi-customer optimization (un dispatcher armando para varios
  clientes operativos a la vez): separado, complejidad adicional
- ❌ Frequency multi-día (Capa 5): post-V1

---

## Refs

- ADR-096 — esta decisión arquitectónica
- ADR-094 — tool optimize_dispatch existente (capa 3)
- ADR-074 — Google Routes integration (matriz de tráfico)
- ADR-090..094 — orquestador package y tools previos

Implementación: a iniciar en sesión 2026-05-15 (próxima).

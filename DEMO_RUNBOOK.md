# Demo Runbook — VerdFrut/NETO · 2026-05-15 (noche)

Guion paso a paso para presentar el feature **propuesta de N alternativas con costo MXN** al cliente.

**Pitch del feature**: "el dispatcher arma rutas a mano y elige una. Ahora el sistema propone 2-3 alternativas óptimas con costo MXN y km, en 30 segundos. Si tu renta te limita por km, ves el impacto antes de despachar."

---

## ⏰ Timeline recomendado

| Cuándo | Qué |
|---|---|
| **T-3h** | Pre-flight check (`preflight-demo.mjs`). Si falla, escalar inmediatamente. |
| **T-2h** | Dry-run el demo TÚ MISMO. Captura output a un .txt como respaldo. |
| **T-30min** | `pnpm dev` corriendo. Terminal listo con el comando del CLI pre-tipeado. |
| **T-0** | Demo con cliente. |

---

## 1. Pre-flight (T-3h) — CRÍTICO

```bash
cd /Users/richardfigueroa/Downloads/VerdFrut

# Asegúrate que el dev server está corriendo
pnpm --filter @tripdrive/platform dev

# En otra terminal, corre el preflight:
node scripts/preflight-demo.mjs \
  --user=<TU_UUID_ADMIN> \
  --dispatch=<UUID_TIRO_DEMO>
```

Output esperado:
```
✅ env: NEXT_PUBLIC_SUPABASE_URL
✅ env: SUPABASE_SERVICE_ROLE_KEY
✅ env: INTERNAL_AGENT_TOKEN
✅ migración 045 (customers.optimizer_costs)
✅ migración 046 (orchestrator_sessions.active_agent_role)
✅ user existe: role=admin, customer_id=...
✅ user es admin/dispatcher activo
✅ dispatch existe: <nombre> (<fecha>, <status>)
✅ dispatch tiene rutas: N rutas
✅ dispatch tiene tiendas: M tiendas en X paradas
✅ demo-worthy (≥5 stops)
✅ endpoint reachable (http://localhost:3000)

✅ Pre-flight OK. Listo para demo.
```

**Si CUALQUIER check falla → resolver antes de continuar. No improvisar con el cliente enfrente.**

### Resolución de fails comunes

- ❌ `env: INTERNAL_AGENT_TOKEN`: agregar a `apps/platform/.env.local`. Cualquier string suficientemente largo.
- ❌ `migración 045/046`: aplicar via MCP o `psql`. La aplicación ya se hizo en el tenant VerdFrut, así que si falla acá, revisa el `NEXT_PUBLIC_SUPABASE_URL` — ¿estás apuntando al tenant correcto?
- ❌ `user es admin/dispatcher activo`: tu user tal vez es `driver` o `is_active=false`. Usar otro UUID.
- ❌ `dispatch tiene tiendas`: el tiro está vacío. Agregar rutas con paradas via UI antes del demo. O usar otro dispatch.
- ❌ `endpoint reachable`: `pnpm dev` no está corriendo, o está en otro puerto. Setear `PLATFORM_BASE_URL=http://localhost:XXXX`.

---

## 2. Dry-run (T-2h) — Captura de respaldo

```bash
node scripts/demo-propose-routes.mjs \
  --dispatch=<UUID_TIRO_DEMO> \
  --user=<TU_UUID_ADMIN> \
  | tee /tmp/demo-capture-$(date +%Y%m%d-%H%M).txt
```

Verifica que el output incluye:
- ✅ Las 3 (o 2) alternativas con labels emoji
- ✅ Km totales por alternativa
- ✅ Costo MXN total + breakdown (combustible/desgaste/chofer/overhead)
- ✅ Comparativa rápida "cambiar de económica a rápida cuesta $X más, ahorra Yh"

**El archivo `/tmp/demo-capture-*.txt` es tu plan B**: si Railway/Google fallan en vivo, abres el txt y muestras eso.

---

## 3. Demo en vivo (T-0)

### Setup terminal (antes de que entre cliente)

Terminal 1 (pnpm dev corriendo, NO lo cierres):
```bash
pnpm --filter @tripdrive/platform dev
```

Terminal 2 (listo para el demo, con comando pre-tipeado pero sin ejecutar):
```bash
node scripts/demo-propose-routes.mjs --dispatch=<UUID> --user=<UUID>
```
(NO presiones Enter aún.)

### Guion de presentación

**Cliente**: explica su problema. Renta limitada por km, dispatcher arma rutas a mano.

**Tú**:
> "Antes el sistema sólo optimizaba la secuencia dentro de cada ruta. Pero el problema real es: ¿cuántas camionetas usar? ¿qué tiendas a cada una? Y sobre todo: ¿cuánto cuesta?"
>
> "Hicimos esto. Te muestro." [Enter en el comando]

[Output corre 30-90 segundos. **Importante**: no lo dejes en silencio. Mientras corre:]

> "Está calculando alternativas en paralelo: 2 camionetas, 3 camionetas, etc. Para cada combinación: la asignación geográfica óptima (clustering por zona), la secuencia dentro de cada ruta (VROOM), y el costo MXN con las constantes de tu operación."

[Cuando termina, **muestra el output**:]

> "Aquí están tus 3 opciones:
>   - **Más económica**: 2 camionetas, 280 km, $1,820. Una camioneta hace 6h.
>   - **Más rápida**: 3 camionetas, 240 km, $2,150. Pero ningún chofer pasa de 4h."
>
> "Si tu contrato de renta te penaliza por km arriba de 350, la económica está dentro de límite. Si te interesa entregar todo más temprano (ej. para tener choferes libres para 2do turno), la rápida cuesta $330 más pero gana 2 horas."
>
> "La decisión la sigue tomando el dispatcher. El sistema PROPONE; tú DECIDES."

### Preguntas del cliente — respuestas pre-armadas

**P: "¿De dónde salen esos costos?"**
> "Defaults para mercado MX 2026: Kangoo 14 km/l, gasolina $35/L → $2.50/km combustible. Chofer $80/h. Desgaste $0.50/km. Overhead despacho $50. Cada uno se ajusta por cliente — si tu Kangoo rinde diferente, lo cambiamos."

**P: "¿Por qué K=2 y K=3, no K=4?"**
> "El sistema explora desde el mínimo factible (ceil de stops / capacidad) hasta el máximo razonable (1 vehículo por cada 4 stops). Más camionetas = más overhead por despacho — no siempre paga. El sistema te lo dice."

**P: "¿Qué pasa con ventanas horarias?"**
> "VROOM las respeta. Si una tienda tiene ventana 8-10am, sólo se asignará a una ruta que pueda llegar a tiempo. Si no es posible con ninguna alternativa, aparece en `always_unassigned_store_ids` y te la flagea para revisar."

**P: "¿Puedo aplicar la opción que elija?"**
> "Hoy: te muestro las alternativas, tú las aplicas manualmente con el botón existente de 'optimizar tiro'. **Próxima iteración**: te lo aplico en un click directamente desde la propuesta." (No prometer fecha.)

**P: "¿Funciona en producción ahora mismo?"**
> "El backend está listo y la migración ya está aplicada en tu tenant. Lo que ves en pantalla es la salida real del endpoint. La UI conversacional (donde el AI te lo presenta como cards interactivas) es lo siguiente del roadmap."

### Si algo falla en vivo

**Errors del CLI durante demo**:
- `Optimizer falló`: VROOM/Railway problema. → "Déjame ver lo que tenía pre-corrido" → abrir `/tmp/demo-capture-*.txt`
- `Ninguna alternativa pudo computarse`: usualmente ventanas horarias imposibles. → "Hay constraints estrictos en este tiro; déjame mostrarte con otro."
- `unauthorized`: el INTERNAL_AGENT_TOKEN. → Verifica que el `.env.local` está cargado.
- Timeout: 90s sin respuesta. → Plan B (capture).

**Regla de oro**: si pasa algo raro, **NO improvises debug en vivo**. "Esto es algo que en estado de demo a veces pasa; tengo la captura de la prueba anterior que muestra el output, te lo enseño." Continúa.

---

## 4. Post-demo (cuando se vayan)

Si todo salió bien:
1. Avísale a Richard (el dev) cuál opción eligió el cliente — ese feedback alimenta el ranking default de OE-3.
2. Si pagaron, mover el plan a OE-3 (UI conversacional + apply_route_plan).
3. Aplicar migración 046 a otros tenants pendientes (`scripts/migrate-all-tenants.sh`).

Si no pagaron / quieren ver más:
1. Documentar qué pidieron específicamente.
2. Si pidieron UI, OE-3 sube en prioridad.
3. Si pidieron multi-día (Capa 5), agregarlo al roadmap V2.

---

## Referencias

- [OPTIMIZATION_ENGINE.md](./OPTIMIZATION_ENGINE.md) — spec técnica completa.
- [ROADMAP.md](./ROADMAP.md) — Streams OE + R, estado por sprint.
- [DECISIONS.md](./DECISIONS.md) — ADRs 097-101 cubren todo el trabajo de hoy.
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — sección "Estado Streams OE + R" arriba del documento.
- `scripts/preflight-demo.mjs` — verificador pre-demo.
- `scripts/demo-propose-routes.mjs` — CLI del demo.

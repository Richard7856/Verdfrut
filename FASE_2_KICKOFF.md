# Fase 2 — Driver App (kickoff)

Documento de arranque para construir `apps/driver` (PWA del chofer y encargado de zona).

## Contexto previo (no rehacer)

- Fases 0 y 1 cerradas. Schema en Supabase aplicado, advisors limpios, tipos TS generados.
- Backend de logística completo: el dispatcher puede crear → optimizar → aprobar → publicar rutas.
- La función `notifyDriverOfPublishedRoute(routeId)` ya existe pero es STUB — solo loggea, no envía push real.
- Sidebar del platform tiene link `/incidents` que es stub esperando los reportes que generará la driver app.
- Tablas en DB que la driver app va a usar: `routes`, `stops`, `delivery_reports`, `messages`, `push_subscriptions`, `route_breadcrumbs`.

## Decisión pendiente al arrancar

El usuario debe elegir estrategia de arranque (preguntar):

### (a) Estructura completa
Construir todo el scaffold + auth + 3 flujos completos en una pasada (3-4 semanas).
**Pro:** Una vez termina está todo.
**Contra:** Mucha superficie sin probar end-to-end hasta el final.

### (b) Por capas
1. Auth chofer + recibir ruta del día (lista de paradas)
2. Flujo entrega completo (con OCR, evidencia, chat)
3. Flujo tienda cerrada
4. Flujo báscula
5. GPS broadcast + push real
**Pro:** Ship incremental, cada capa demoable.
**Contra:** Más sprints, más coordinación.

### (c) Vertical slice ⭐ RECOMENDADO
Construir UN solo flujo (entrega) end-to-end con TODO lo necesario:
- PWA shell (Serwist + manifest + service worker)
- Auth chofer
- Recibir ruta + lista de paradas
- Flujo entrega: arrival → product_arranged → waste_check → receipt_check → finish
- Chat realtime con encargado
- GPS broadcast cada 5-10s
- Push notifications VAPID (real, no stub)
- OCR Claude Vision para tickets
- Cola offline IndexedDB

**Pro:** Demo end-to-end al primer cliente potencial. Aprende todos los problemas operativos en un solo flujo antes de duplicar.
**Contra:** Los otros 2 flujos (cerrada, báscula) quedan pendientes pero como variantes simples.

## Arquitectura de la driver app

### Stack
- Next.js 16 PWA con [Serwist](https://serwist.pages.dev/) (sucesor de next-pwa)
- Supabase para auth + queries + Realtime channels
- Mapbox GL JS para mapa de navegación (ya en `packages/maps`)
- IndexedDB (vía `idb`) para cola offline
- VAPID web push (real, web-push npm package)
- Claude Vision via `@verdfrut/ai` (ya implementado)

### Estructura propuesta

```
apps/driver/
├── package.json (Next 16, Serwist, idb, web-push)
├── next.config.ts (Serwist plugin)
├── public/
│   ├── manifest.json (PWA installable)
│   ├── icon-192.png, icon-512.png (logo VerdFrut)
│   └── sw.js (auto-generado por Serwist)
├── src/
│   ├── app/
│   │   ├── layout.tsx (Geist + Toaster + RegisterSW)
│   │   ├── (auth)/login/ — auth chofer (¿código numérico o magic link?)
│   │   ├── (route)/
│   │   │   ├── page.tsx — lista de paradas del día
│   │   │   └── stop/[id]/ — flujo paso a paso
│   │   ├── (chat)/[reportId]/ — chat con encargado
│   │   └── (supervisor)/ — vista del encargado de zona
│   ├── lib/
│   │   ├── auth-driver.ts — auth flow
│   │   ├── flow-engine — usa @verdfrut/flow-engine
│   │   ├── offline-queue.ts — IndexedDB outbox
│   │   ├── gps.ts — Geolocation API + Broadcast
│   │   └── push.ts — registro VAPID
│   └── proxy.ts — middleware Next 16
└── .env.example
```

### Decisiones a definir al arrancar
1. **Auth de chofer:** ¿código numérico (más simple), magic link via email/SMS, o user/password? El prototipo de Verdefrut usaba email/password, sugiero seguir igual.
2. **Mapa de navegación:** ¿integrar Mapbox Directions API para turn-by-turn o solo mostrar puntos en el mapa? El primero es más caro.
3. **Realtime channel naming:** `gps:{routeId}` para posición, `chat:{reportId}` para mensajes. Confirmar.
4. **Service worker scope:** `/` para toda la app, o subscope `/conductor/*` como en el prototipo viejo.

## Issues abiertos a contemplar en Fase 2

Ninguno crítico. Solo cosméticos:
- #9 — separador de miles en distancias (aplica al supervisor también)
- #10 — rate limiting del optimizer (no afecta driver app)

## Pendiente del usuario antes de arrancar

- **Bootstrap del primer admin** completado — sin esto no se puede invitar choferes desde UI
- **Crear al menos 1 chofer** vía `/settings/users` con rol `driver` y zona asignada
- **Crear ruta + publicarla a ese chofer** desde el platform — para tener algo que la driver app reciba

## Comandos útiles para empezar

```bash
# Crear app driver desde cero
mkdir -p apps/driver/src/app
cd apps/driver
# Copiar package.json del platform como base, ajustar nombres y agregar Serwist

# Generar tipos VAPID (una vez)
npx web-push generate-vapid-keys
# Guardar las claves en .env.local del platform Y de la driver app

# Levantar driver en dev (cuando esté listo)
pnpm --filter @verdfrut/driver dev --port 3001
```

## Práctica de cierre

Recordatorio: al finalizar Fase 2 (o cualquier capa significativa), responder las **4 preguntas**:
1. ¿Qué casos edge no estás manejando?
2. ¿Qué pasa si [X servicio] falla o tarda mucho?
3. ¿Hay algún supuesto que estés haciendo sobre los datos?
4. Si tuvieras que romper este código intencionalmente, ¿cómo lo harías?

Documentado en `~/.claude/projects/-Users-richardfigueroa-Downloads-VerdFrut/memory/closing-questions.md`.

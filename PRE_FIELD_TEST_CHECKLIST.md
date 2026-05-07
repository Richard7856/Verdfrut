# PRE FIELD TEST CHECKLIST — VerdFrut

> Runbook concreto para ejecutar la noche anterior + la mañana del field test.
> Imprime esto o ténlo abierto en otra ventana cuando salgas a campo.

---

## 🌙 La noche anterior (15-30 min)

### 1. Sanity check de los 4 servicios (`/health`)

Desde tu terminal local:

```bash
curl -s https://verdfrut-platform.vercel.app/api/health
curl -s https://verdfrut-driver.vercel.app/api/health
curl -s https://verdfrut-control-plane.vercel.app/api/health
curl -s https://verdfrut-production.up.railway.app/health
```

Los 4 deben devolver 200 con JSON `{ status: "ok"... }`. Si alguno falla → fix antes de dormir.

### 2. ⚠️ QUITAR `DEMO_MODE_BYPASS_GEO` (CRÍTICO)

Si lo dejas activo, **cualquier chofer puede reportar entregado desde su casa**. Anti-fraude muere.

1. Vercel → `verdfrut-driver` → **Settings → Environment Variables**
2. Encuentra `DEMO_MODE_BYPASS_GEO` → 3 puntitos → **Delete**
3. Pestaña **Deployments** → Redeploy último (sin cache)
4. Espera 2-3 min que termine
5. Verifica en `verdfrut-driver/api/health` que sigue 200

### 3. Agregar `ANTHROPIC_API_KEY` al driver

Si vas a probar OCR de tickets en campo, lo necesitas:

1. Vercel → `verdfrut-driver` → **Settings → Environment Variables**
2. Add: `ANTHROPIC_API_KEY` = `sk-ant-...` (mismo del platform)
3. Redeploy

### 4. Cargar data real del cliente (si aplica)

Si vas a usar tiendas reales en lugar del seed CDMX, antes de dormir:

```sql
-- Opcional: cleanup data operativa de testing antes de cargar real
-- (vivirá en scripts/cleanup-operational-data.sql)
\i scripts/cleanup-operational-data.sql

-- Cargar tiendas reales por SQL o via UI /settings/stores
INSERT INTO public.stores (...) VALUES (...);
```

Si NO hay datos reales y vas a probar con seed CDMX → no hagas nada.

### 5. Probar flujo end-to-end con seed (no skip)

Esta es la prueba definitiva de que el sistema funciona:

1. Login admin: `https://verdfrut-platform.vercel.app/login` con `rifigue97@gmail.com`
2. Crear ruta nueva en `/routes/new`:
   - Vehículo Renault Kangoo
   - 3 tiendas CDMX
   - Fecha mañana
3. Optimizar → debe responder en <5s
4. Asignar chofer `villafrtty@gmail.com`
5. Aprobar → Publicar
6. Login chofer en cel/tablet: `https://verdfrut-driver.vercel.app/login`
7. Verificar:
   - Ve la ruta del día con las 3 paradas
   - Botón "🧭 Iniciar navegación" funciona
   - Botones Maps/Waze abren las apps externas
   - Botón "⚠ Reportar problema" abre chat con zone_manager
8. NO necesitas completar el flow físicamente — basta verificar que la UI carga sin errores

Si algo falla → fix antes de salir mañana.

---

## 🌅 La mañana del field test (5-10 min antes de salir)

### 1. Verificar que el chofer real puede entrar

- Su email + password está en `auth.users`?
- Si invitaste con magic link, el chofer debe haber abierto el `/auth/invite?t=...` y establecido password.
- Test login en su cel.

### 2. Verificar que recibió la ruta del día

- En `/routes` desde admin, la ruta de hoy debe estar en `PUBLISHED` y asignada a su email.
- Su cel debe ver la ruta al hacer login.

### 3. Verificar que el chofer aceptó push notifications

- Cuando abre la app por primera vez, hay opt-in arriba.
- Tap "Permitir" — sino no le llegan avisos.

### 4. Verificar GPS encendido

- En su cel, settings → permitir location para Chrome/Safari del driver app.
- Sin esto, no puede arrivar (validación geo bloqueante en producción real).

### 5. Tomar screenshot de la pantalla principal del chofer

Para que en caso de duda durante el día puedas verificar que arrancó OK.

---

## 🚨 Plan de contingencia durante operación

### Si chofer NO ve la ruta

1. Confirma desde admin que la ruta está `PUBLISHED` y asignada a su `driver_id`.
2. Si está OK, pídele al chofer que cierre tab y vuelva a hacer login.
3. Si sigue sin verla → revisa logs en Vercel del driver app (puedo leerlos via MCP).

### Si chofer reporta "Recalculando ruta" en loop

1. Dile que cierre la app de navegación in-app y use Waze/Maps directo (botones del header).
2. Si sigue, log en Vercel runtime → buscar request `/api/route/dynamic-polyline` y ver respuesta.
3. **Causa más probable**: GPS con accuracy baja en interior. Salir a la calle ayuda.

### Si chofer dice "no me deja arrivar, dice estoy lejos"

1. **Sin DEMO_MODE_BYPASS_GEO** (correcto en field test): chofer DEBE estar a <300m de la tienda. Si está más cerca y sigue rechazando → la coord de la tienda en BD está mal. Edita en `/settings/stores`.
2. **Con DEMO_MODE_BYPASS_GEO=true** activo (NO debería en field test): la validación está saltada y SIEMPRE acepta. Si rechaza igual, hay otro bug.

### Si el chofer reporta avería del camión

**HOY (V1, sin feature de transfer):**
1. Chofer abre chat con zone_manager via "⚠ Reportar problema".
2. Zone_manager coordina manualmente (llama por teléfono al admin, etc.).
3. Admin desde platform marca la ruta como `CANCELLED` o la deja en pausa.
4. Las paradas pendientes quedan sin atender hoy. Se replanean al día siguiente.

**MAÑANA (Sprint 18, transfer feature):** desde admin podrá transferir paradas pendientes a otro chofer/camión activo en 2 clicks.

### Si el optimizer Railway no responde

1. `curl https://verdfrut-production.up.railway.app/health`
2. Si HTTP 5xx → ve a Railway dashboard, reinicia el servicio.
3. Si está dormido (no debería con plan starter): primer request despierta, pero tarda ~30s.

### Si Supabase está caído (raro)

1. Status: https://status.supabase.com/
2. Si es incidente real, no hay nada que hacer del lado nuestro.
3. Comunicar al cliente.

---

## 📊 Datos a recolectar durante el día

Para evaluar mejoras post-field-test:

- [ ] # paradas reportadas exitosamente vs intentos
- [ ] # veces que el chofer abrió chat con zone_manager
- [ ] # veces que el chofer salió a Waze/Maps externo (si tienes manera de tracking)
- [ ] Tiempo total de operación (start_route → end_route)
- [ ] Distancia real recorrida vs estimada del optimizer
- [ ] Issues reportados por el chofer (lista en notas)

---

## 🌆 Al finalizar el field test (5 min)

### 1. Verificar reportes en `/incidents`

Desde admin: revisar que todos los reportes del día estén en estado correcto.

### 2. Backup de la BD (importante)

Desde Supabase Dashboard → Database → Backups → Create on-demand backup. Guardar referencia.

### 3. Recolectar feedback del chofer

5 min con el chofer:
- ¿Qué te confundió de la app?
- ¿Qué te facilitó vs operar sin app?
- ¿Algún momento donde no pudiste hacer lo que necesitabas?

Apunta literal sus palabras — eso alimenta el roadmap.

### 4. Quick wins immediatos

Si el chofer mencionó algo simple (ej. "el botón estaba muy chico"), apunta y se arregla esa noche para usar al día siguiente.

---

## 📝 Plantilla de reporte post-field-test

Al terminar el día, tener este resumen:

```
Field test 2026-05-08
- Chofer: villafrtty@
- Ruta: <route_id>
- Paradas planeadas: X
- Paradas completadas: Y
- Issues operativos:
  1. ...
  2. ...
- Issues técnicos:
  1. ...
- Feedback del chofer:
  - ...
- Decisiones para mañana:
  - ...
```

---

**Mantén este archivo abierto en una pestaña durante el field test.** Si algo se rompe, primero busca aquí — la mayoría de issues comunes ya están listados con su resolución.

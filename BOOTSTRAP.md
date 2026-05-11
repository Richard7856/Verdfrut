# Bootstrap — primer login

Guía para preparar un proyecto Supabase recién migrado para que puedas loguearte
como admin y empezar a usar la plataforma.

## Pre-requisitos

- ✅ Migraciones 001–013 aplicadas
- ✅ `.env.local` configurado en `apps/platform/` con las credenciales del proyecto

## Pasos

### 1. Crear el usuario en Auth

**Dashboard de Supabase → Authentication → Users → Add user → Create new user**

- Email: tu email
- Password: el que quieras (mínimo 6 chars)
- Auto Confirm User: **SÍ** (importante — sin esto el login fallará)

Copia el `User ID` (UUID) que aparece tras crearlo.

### 2. Crear su perfil con rol `admin`

En Supabase Dashboard → SQL Editor, ejecuta (reemplazando el UUID y email):

```sql
INSERT INTO user_profiles (id, email, full_name, role, zone_id, is_active)
VALUES (
  'AQUÍ_EL_USER_ID_DE_AUTH'::UUID,
  'tu@email.com',
  'Tu Nombre',
  'admin',
  NULL,           -- admin no necesita zona específica
  TRUE
);
```

Sin esto el login fallará porque `requireProfile()` busca un row en `user_profiles`.

### 3. (Opcional) Crear zona inicial para tener algo que ver

```sql
INSERT INTO zones (code, name) VALUES
  ('CDMX', 'Ciudad de México'),
  ('GDL', 'Guadalajara'),
  ('MTY', 'Monterrey');
```

### 4. Probar login

```bash
pnpm --filter @tripdrive/platform exec next dev --port 3001
```

- Abre http://localhost:3001
- Te redirige a `/login`
- Email + password del paso 1
- Te redirige a `/routes` (la home del rol admin/dispatcher)

### 5. Crear datos para probar el flujo completo

Desde la UI:

1. **`/settings/zones`** — ya tienes 3 zonas si hiciste el paso 3, si no, crea una
2. **`/settings/stores`** — crea 5+ tiendas en la misma zona con coordenadas reales (ej: CDMX lat ~19.4, lng ~-99.1)
3. **`/settings/vehicles`** — crea 1+ camiones en esa zona, **con coordenadas de depósito** (lat/lng del centro de distribución)
4. **`/settings/users`** — invita un chofer (rol `driver`, asigna zona)
5. **`/routes/new`** — selecciona zona, fecha, camión + chofer, marca todas las tiendas → **Optimizar y crear ruta**
6. **`/routes/[id]`** — ves las paradas optimizadas con sequence + ETAs → **Aprobar** → **Publicar**

### 6. Verificar que todo se conecta

- Revisa Supabase Dashboard → Tables → `routes` que el row exista con `status='PUBLISHED'`
- Revisa `stops` que tenga las paradas con sequence asignado
- En consola del server verás `[push:stub] enviaría a ...` (push notification simulada — VAPID real se conecta en Fase 2)

## Próximos pasos: invitar más usuarios desde la UI

Una vez logueado como admin, ve a `/settings/users` → **Invitar usuario** — ya no necesitas SQL para más usuarios.

## Si algo falla

| Error | Causa probable |
|---|---|
| Login redirige a `/login` con error "Tu cuenta no tiene perfil" | Falta el INSERT del paso 2 |
| Login dice "Esta cuenta es de chofer. Usa la app móvil" | Pusiste `role='driver'` en el INSERT — cámbialo a `'admin'` |
| `/routes/new` dice "No hay zonas activas" | Crea zonas en `/settings/zones` o ejecuta el paso 3 |
| Al optimizar dice "OPTIMIZER_URL no está definida" | El optimizer FastAPI no está corriendo. Levántalo con `docker compose up optimizer` o ignora — el resto del flujo funciona sin optimizar |
| Coordenadas inválidas al crear tienda | Las coords deben estar dentro de México (lat 14.3–32.8, lng -118.7 a -86.5) |

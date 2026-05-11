# TripDrive — Configuración de dominios

> Sprint H6 (2026-05-11) · ADR-056. Cómo exponer `tripdrive.xyz` para los 3 deploys de Vercel.

---

## Arquitectura

```
                                ┌─────────────────────────────┐
                                │  tripdrive.xyz              │
                                │  (apex — landing/redirect)  │
                                └──────────────┬──────────────┘
                                               │
              ┌────────────────────────────────┼────────────────────────────┐
              ▼                                ▼                            ▼
   ┌────────────────────┐         ┌──────────────────────┐      ┌──────────────────────┐
   │ app.tripdrive.xyz  │         │ driver.tripdrive.xyz │      │ admin.tripdrive.xyz  │
   │  (platform)        │         │  (driver PWA)        │      │  (control-plane)     │
   └────────────────────┘         └──────────────────────┘      └──────────────────────┘
              │
              ▼  (futuro multi-tenant via subdomain)
   ┌────────────────────────┐
   │ verdfrut.tripdrive.xyz │
   │  (alias del tenant)    │
   └────────────────────────┘
```

| Subdominio | Vercel project | Para qué |
|---|---|---|
| `tripdrive.xyz` | `tripdrive-platform` (redirect a `/login` o landing) | Apex — puerta de entrada |
| `app.tripdrive.xyz` | `tripdrive-platform` | Logística + dashboard cliente |
| `driver.tripdrive.xyz` | `tripdrive-driver` | PWA del chofer |
| `admin.tripdrive.xyz` | `tripdrive-control-plane` | Super-admin (CP) |
| `verdfrut.tripdrive.xyz` | `tripdrive-platform` | Subdominio "branded" del tenant VerdFrut (resolución multi-tenant) |

---

## Setup paso a paso

### 1. Comprar dominio (5 min)

Recomendado: **Cloudflare Registrar** (`https://dash.cloudflare.com/?to=/:account/registrar`). $9/año `.xyz`, sin markup, transferible. Otra opción Porkbun ($7-10).

**No es necesario activar Cloudflare como proxy hoy.** Solo usamos Cloudflare como registrar; los DNS pueden apuntar directamente a Vercel.

### 2. Cambiar nameservers a Vercel (opcional — recomendado)

Si compraste en Cloudflare, en el panel del dominio → **DNS** → cambiar nameservers a los de Vercel:

```
ns1.vercel-dns.com
ns2.vercel-dns.com
```

Esto delega el DNS completo a Vercel — más simple. Si prefieres mantener Cloudflare como DNS, salta al paso 3 y usa registros tradicionales.

### 3. DNS records (15 min)

Si Vercel maneja DNS (paso 2 hecho), los records se crean automáticamente al "Add domain" en cada proyecto.

Si Cloudflare maneja DNS, agregar manualmente en el panel CF:

```
# Apex (tripdrive.xyz)
Type: A          Name: @         Value: 76.76.21.21       Proxy: ❌ DNS only

# Subdominios
Type: CNAME      Name: app       Value: cname.vercel-dns.com.    Proxy: ❌
Type: CNAME      Name: driver    Value: cname.vercel-dns.com.    Proxy: ❌
Type: CNAME      Name: admin     Value: cname.vercel-dns.com.    Proxy: ❌
Type: CNAME      Name: verdfrut  Value: cname.vercel-dns.com.    Proxy: ❌
Type: CNAME      Name: www       Value: cname.vercel-dns.com.    Proxy: ❌
```

**Importante:** `Proxy: ❌ DNS only` para que Cloudflare NO se ponga al medio (orange cloud). Si activas el proxy:
- Vercel no puede emitir cert TLS automático (challenge HTTP-01 falla).
- Pierdes algunas features de Vercel (Edge Functions, Analytics).
- Si en futuro quieres Cloudflare como WAF, activas el proxy DESPUÉS de que Vercel emita el cert; Vercel y CF coexisten con el handshake doble.

### 4. Agregar dominios en Vercel (15 min)

En el panel de cada proyecto Vercel → **Settings → Domains → Add**:

#### Proyecto `tripdrive-platform`
- `app.tripdrive.xyz`
- `verdfrut.tripdrive.xyz`
- `tripdrive.xyz` (apex) — Vercel auto-redirige a `app.tripdrive.xyz` (configurar el redirect en Settings → Domains → click apex → Redirect to www).
- `www.tripdrive.xyz` (redirect al apex)

#### Proyecto `tripdrive-driver`
- `driver.tripdrive.xyz`

#### Proyecto `tripdrive-control-plane`
- `admin.tripdrive.xyz`

Cuando agregas un dominio Vercel:
1. Detecta el CNAME → emite cert TLS via Let's Encrypt (1-2 min).
2. Si los nameservers están en Vercel, configura los records solo.
3. Si nameservers externos, te muestra qué records crear (paso 3).

### 5. Validar (5 min)

```bash
# DNS resuelve a Vercel
dig app.tripdrive.xyz +short          # → cname.vercel-dns.com → IP Vercel
dig driver.tripdrive.xyz +short
dig admin.tripdrive.xyz +short

# TLS válido (Let's Encrypt)
curl -I https://app.tripdrive.xyz/api/health
curl -I https://driver.tripdrive.xyz/api/health
curl -I https://admin.tripdrive.xyz
# Esperado: HTTP/2 200 + server: Vercel + strict-transport-security

# Apex redirige a app
curl -I https://tripdrive.xyz
# Esperado: HTTP/2 308 + location: https://app.tripdrive.xyz/
```

---

## Multi-tenant via subdomain

`verdfrut.tripdrive.xyz` apunta al mismo proyecto `tripdrive-platform` que `app.tripdrive.xyz`. La diferencia: el middleware/proxy del platform lee el header `host` y resuelve el tenant:

- `app.tripdrive.xyz` → sin tenant explícito (usa env vars del deploy)
- `verdfrut.tripdrive.xyz` → tenant slug `verdfrut` → busca en `tenants.json`

El registry de tenants (`/etc/tripdrive/tenants.json` en VPS o `TENANT_REGISTRY_PATH` env) mapea:

```json
{
  "verdfrut": {
    "supabaseUrl": "https://hidlxgajcjbtlwyxerhy.supabase.co",
    "supabaseAnonKey": "...",
    "name": "VerdFrut"
  }
}
```

Pasos cuando agregues 2º cliente (ej. `xyzlogistics`):

1. Provisionar nuevo proyecto Supabase con `./scripts/provision-tenant.sh xyzlogistics "XYZ Logistics" America/Mexico_City`.
2. Agregar entrada al tenant registry.
3. Vercel → `tripdrive-platform` → Domains → Add `xyzlogistics.tripdrive.xyz`.
4. DNS CNAME `xyzlogistics → cname.vercel-dns.com` (si Vercel maneja DNS, automático).

---

## Email transaccional

Independiente del web hosting:

| Servicio | Tier free | Uso |
|---|---|---|
| **Resend** | 100 emails/día gratis | Welcome emails, password reset, alerts |
| Cloudflare Email Routing | Ilimitado | Forwarding `hola@tripdrive.xyz` → tu inbox personal |

Recomendación: empezar con **Cloudflare Email Routing** para forwarding (`hola@tripdrive.xyz` → `tu@gmail.com`) — cero costo, cero ops. Si después necesitas mandar emails programados desde la app (welcome, password reset), agregar **Resend** con DNS records propios.

### Setup Cloudflare Email Routing

1. CF Dashboard → tu dominio → **Email** → **Email Routing** → Enable.
2. Agrega routes:
   - `hola@tripdrive.xyz` → `tu-email-personal`
   - `soporte@tripdrive.xyz` → `tu-email-personal`
   - `noreply@tripdrive.xyz` → discarded (o reject)
3. CF agrega los MX records automáticamente.

---

## Cuándo agregar Cloudflare como proxy (WAF)

Triggers para activar el orange cloud:
- ☐ Tráfico bot abusivo en `/share/dispatch/[token]` (ver Sentry).
- ☐ Más de 2 tenants productivos (necesidad de rate-limit edge).
- ☐ Reportes de scraping de tiendas de competidores.
- ☐ Auditoría de seguridad pide WAF activo.

Cuando suceda, en CF DNS panel cambias el ❌ por 🟠 (proxy). Vercel ya tiene cert, no necesita re-emisión. Validar después con `curl -I` que `server: cloudflare` aparece.

---

## Estado actual

| Recurso | Estado |
|---|---|
| Dominio `tripdrive.xyz` | ⚠ Pendiente compra |
| Nameservers Vercel | ⚠ Pendiente |
| DNS records 4 subdominios | ⚠ Pendiente |
| Custom domains en 3 Vercel projects | ⚠ Pendiente |
| TLS Let's Encrypt | ⚠ Pendiente (automático tras step 4) |
| Email forwarding | ⚠ Pendiente decisión |

Cuando termines los pasos 1-5, marca este estado en el `DEPLOY_CHECKLIST.md` y procedemos al testing real.

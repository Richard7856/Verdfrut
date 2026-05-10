# TripDrive — Identidad de marca

> Última actualización: 2026-05-09 · ADR-049

## Nombre

**TripDrive** (un solo término, T y D mayúsculas en marca, todo minúscula en URL/handle).

- ✅ Correcto: `TripDrive`, `tripdrive.xyz`, `@tripdrive`
- ❌ Evitar: `Trip Drive`, `Tripdrive`, `TRIPDRIVE`, `tripDrive`

**Pronunciación:** *trip-DRIVE* (inglés). En español se acepta el calco fonético "trip-draiv".

## Etimología y posicionamiento

Compuesto **Trip** (viaje, recorrido, tiro de entregas) + **Drive** (conducir, propulsar). El nombre describe el producto a la primera lectura: software que **conduce un viaje de entregas** end-to-end — desde el dispatcher planeando el tiro hasta el chofer ejecutando cada parada.

**Posicionamiento:** SaaS B2B de optimización y ejecución de rutas de última milla. Multi-tenant. Target inicial: distribuidoras urbanas en México con flotas de 3-30 vehículos.

## Tagline (candidatos a validar)

1. *Drive every trip, every stop.* (inglés, agresivo)
2. *Cada parada, cada tiro, bajo control.* (español, operativo)
3. *Logística de última milla que entrega.* (español, B2B)

## Dominio y handles

| Recurso | Valor | Estado |
|---|---|---|
| Dominio primario | `tripdrive.xyz` | ⏳ por comprar |
| `tripdrive.com` | — | revisar disponibilidad |
| Subdominio cliente | `<slug>.tripdrive.xyz` | — |
| Subdominio driver | `driver.tripdrive.xyz` | — |
| Subdominio admin | `admin.tripdrive.xyz` | — |
| Email | `hola@tripdrive.xyz`, `soporte@tripdrive.xyz` | — |
| LinkedIn | `linkedin.com/company/tripdrive` | revisar |
| X / Instagram | `@tripdrive` | revisar |

## Paleta de color (heredada de ADR-037)

Variables `oklch()` ya implementadas. Marca master:

| Token | Light mode | Dark mode | Uso |
|---|---|---|---|
| `--vf-green-600` | `oklch(0.45 0.18 145)` | `oklch(0.55 0.18 145)` | Primario (CTA, ruta activa) |
| `--vf-text` | `oklch(0.18 0 0)` | `oklch(0.92 0 0)` | Texto principal |
| `--vf-surface` | `oklch(1 0 0)` | `oklch(0.18 0 0)` | Fondo |
| `--vf-warn` | `oklch(0.78 0.16 75)` | `oklch(0.72 0.16 75)` | Warning |
| `--vf-crit` | `oklch(0.55 0.22 25)` | `oklch(0.62 0.22 25)` | Crítico |

> Los tokens conservan el prefijo `--vf-*` por compatibilidad con código existente (no romper). Próximo paso: aliasar `--td-*` apuntando a los mismos valores (ADR-049 fase 2).

## Tipografía

**Geist** (sans) — autohosteada vía `next/font/google`. Numeric tabular para tablas de métricas. Sin tipografía secundaria.

## Tono de voz

- **Operativo** sobre poético. El usuario es dispatcher / chofer / zone manager — necesita instrucciones claras, no copy de marketing.
- **Bilingüe es/en** sin code-switching innecesario. UI en español de México por defecto (es-MX).
- **Concreto** sobre genérico. "Tiro" mejor que "envío", "parada" mejor que "punto de entrega", "ruta" mejor que "trayectoria".
- **Honesto** sobre los límites. Si el ETA es haversine, decirlo. Si el modo es demo, decirlo.

## Mascot / símbolo (a definir)

Pendiente. Candidato directo: una hormiga estilizada con línea de ruta (referencia al algoritmo Ant Colony Optimization usado en routing). El primer naming candidato era *Antroute* — la metáfora aplica a TripDrive también como ilustración secundaria.

## Cliente vs producto

- **TripDrive** = la plataforma SaaS (lo que se factura, lo que tiene dominio, lo que aparece en navegador).
- **VerdFrut** = primer tenant productivo (cliente del cliente final NETO). Operacionalmente VerdFrut es una empresa real que distribuye fruta/verdura desde CEDA a tiendas Neto en CDMX y Toluca.
- En todas las pantallas internas del tenant aparece la marca **TripDrive** + opcional logo cobranded del cliente arriba (cuando llegue el caso). El cliente final del cliente nunca ve "VerdFrut" en TripDrive.

## Diferenciación vs competidores

| Competidor | Posicionamiento | TripDrive diferencia |
|---|---|---|
| Beetrack | LatAm, tracking-céntrico, simple | TripDrive integra optimización VROOM + dispatcher avanzado |
| Onfleet | US, dispatcher fuerte, caro | TripDrive es es-MX nativo, mitad de precio (target) |
| Routific | Solo optimización | TripDrive incluye driver app + supervisión + dashboard |
| Locus | Enterprise India, ML | TripDrive entry-level, deploy en horas no meses |
| DispatchTrack | Furniture / appliance USA | TripDrive entiende comercio retail mexicano (NETO, OXXO) |

## Reglas de uso

1. El logo (a diseñar) **nunca** se pone sobre fondos saturados sin caja.
2. Los colores de marca **se cambian solo vía tokens** — nunca hardcoded en componentes.
3. La marca del cliente (VerdFrut, futuros) **no reemplaza** a TripDrive; convive como cobranding.
4. Internal docs pueden seguir diciendo "el sistema" / "la plataforma"; documentos public-facing siempre **TripDrive**.

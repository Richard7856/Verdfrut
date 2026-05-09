# VerdFrut Driver — APK (Trusted Web Activity)

Wrapper Android para la PWA `verdfrut-driver.vercel.app`. Genera un `.apk` firmado
que se instala vía sideload o (cuando llegue prod) Play Store.

## Estado

**Demo APK** firmada con keystore demo. Para probar en campo. NO es la versión final
de producción — para Play Store hay que regenerar con custom domain + keystore real.

## Stack

- **Bubblewrap CLI** — wrap PWA en TWA (Trusted Web Activity).
- **Android SDK + Gradle** — descargados automáticamente por Bubblewrap (~700MB) en
  primer build. Cache en `~/.bubblewrap/`.
- **JDK 17** (Temurin) — requerido por Android Gradle Plugin moderno.

## Cómo regenerar

Asume que ya corriste `bubblewrap init` una vez (este repo ya lo hizo).

```bash
cd /Users/richardfigueroa/Downloads/VerdFrut/mobile/driver-apk

# 1. Si cambió el manifest del PWA o quieres bumpar versión:
#    Edita twa-manifest.json (subir appVersionCode y appVersionName).

# 2. Regenera Android project a partir del twa-manifest.json:
npx @bubblewrap/cli@latest update

# 3. Build APK firmada:
npx @bubblewrap/cli@latest build

# Output:
#   ./app-release-signed.apk    ← esta es la que mandas a los choferes
```

## Pasar la APK al chofer (sideload)

1. Manda `app-release-signed.apk` por WhatsApp / email / Drive.
2. Chofer abre la APK en su Android.
3. Si Android pregunta "App de origen desconocido": **Configuración > Seguridad >
   Permitir esta fuente** (depende de la versión Android, normalmente toggle "Instalar
   apps desconocidas" para el browser/app desde donde descargó).
4. Instalar. Ícono "VerdFrut" aparece en el launcher.
5. Primera apertura: pide login con email/password (mismo que en la PWA web).
6. Permisos: aceptar **Ubicación** (GPS) y **Notificaciones** cuando pregunte.

## Por qué la primera vez se ve la barra del navegador

La APK demo usa `verdfrut-driver.vercel.app`. El `assetlinks.json` se sirve desde
ese mismo dominio para que Android verifique que la APK está autorizada.

**Si el `assetlinks.json` no responde 200 con el SHA-256 correcto del keystore,
la APK abre la PWA en "Custom Tab" (con la barra de URL visible)** en vez de modo
"trusted full-screen". No es bloqueante — la app funciona — pero se ve menos
nativa.

Verificar:
```bash
curl -I https://verdfrut-driver.vercel.app/.well-known/assetlinks.json
# Debe responder HTTP/2 200, content-type application/json
```

Si responde 307/404, es que el deploy de Vercel aún no incluye el archivo.
Hacer `git push` del cambio `apps/driver/public/.well-known/assetlinks.json` y
esperar al redeploy automático de Vercel.

## Cuando llegue producción (custom domain)

```
1. Comprar custom domain (ej. app.verdfrut.com)
2. DNS → Vercel → driver app
3. Generar NUEVO keystore "release" con passwords fuertes (NO el demo)
4. Calcular SHA-256 del nuevo keystore
5. Actualizar apps/driver/public/.well-known/assetlinks.json con ambos
   SHA-256 (demo + release) si quieres compatibilidad temporal, o solo release
6. Editar twa-manifest.json:
     - host: app.verdfrut.com
     - webManifestUrl: https://app.verdfrut.com/manifest.json
     - iconUrl, maskableIconUrl: con custom domain
     - signingKey.path: path al nuevo keystore
     - appVersionCode: 2 (incremento obligatorio)
7. bubblewrap update + bubblewrap build
8. Subir AAB (no APK) a Play Store: bubblewrap build genera también
   app-release-bundle.aab
9. Configurar listing en Play Store (icono 512x512, screenshots, política
   de privacidad)
```

## Archivos

```
mobile/driver-apk/
├── twa-manifest.json          ← config TWA (editable)
├── README.md                  ← este archivo
├── .gitignore                 ← excluye keystore + APK del repo
├── .keystore/
│   ├── verdfrut-driver-demo.jks   ← KEYSTORE — no commitear, backup en vault
│   └── PASSWORDS.txt              ← passwords + SHA-256
├── app/                       ← Android project generado por Bubblewrap
│   ├── build.gradle
│   ├── src/...
│   └── ...
├── build.gradle
├── settings.gradle
├── gradle.properties
└── (build/)                   ← APK output, gitignored
```

## Troubleshooting

### "JDK no encontrado"
Bubblewrap requiere Java 17. Verificar `java -version` y si no es 17, instalar:
```bash
brew install --cask temurin@17
```

### "Android SDK no encontrado"
Bubblewrap descarga su propio SDK en `~/.bubblewrap/`. Si falla, eliminar y reintentar:
```bash
rm -rf ~/.bubblewrap && npx @bubblewrap/cli@latest doctor
```

### "Build falla con error de Gradle"
Limpiar caches:
```bash
cd mobile/driver-apk
./gradlew clean
npx @bubblewrap/cli@latest build
```

### APK abre con barra de URL visible
El `assetlinks.json` no se valida. Ver sección "Por qué la primera vez se ve la barra".

### Cambios al PWA no se reflejan en la APK
La APK no contiene código del PWA — carga el sitio en vivo. Los cambios al PWA
se ven en cuanto el chofer reabre la APK (después del refresh del service worker).
NO necesitas regenerar APK por cambios de código del PWA.
**Sí** necesitas regenerar APK si:
- Cambia `manifest.json` (icons, theme color, name)
- Cambia el dominio
- Cambia el keystore
- Bumpas versión Android (Play Store)

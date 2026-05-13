// Config plugin: elimina la línea `enableBundleCompression` del build.gradle
// generado por expo prebuild.
//
// Por qué:
//   @expo/cli@0.24.x para SDK 53 emite un template de android/app/build.gradle
//   que incluye `enableBundleCompression = true` en el bloque `react { }`.
//   Esta property es NUEVA en RN 0.79+ y NO existe en RN 0.76.5 que usamos
//   (SDK 53). El gradle build falla con:
//
//     Could not set unknown property 'enableBundleCompression' for extension
//     'react' of type com.facebook.react.ReactExtension.
//
//   Eliminar esa línea post-prebuild deja el build.gradle compatible.
//
// Eliminar este plugin cuando:
//   - Actualicemos a Expo SDK 54 (RN 0.79+), o
//   - Expo emita un patch en @expo/cli@0.24.x que respete RN 0.76, o
//   - El template SDK 53 ya no incluya la línea (no espero esto — SDK 53 está
//     en mantenimiento, no en development).

const { withAppBuildGradle } = require('@expo/config-plugins');

const PROPERTY_REGEX = /^\s*enableBundleCompression\s*=.*$/gm;

const withStripBundleCompression = (config) => {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      return cfg;
    }
    const before = cfg.modResults.contents;
    const after = before.replace(PROPERTY_REGEX, '// removed by strip-bundle-compression plugin (RN 0.76 incompat)');
    if (before === after) {
      // No matchea — el template ya no incluye la línea, no hacemos nada.
      return cfg;
    }
    cfg.modResults.contents = after;
    return cfg;
  });
};

module.exports = withStripBundleCompression;

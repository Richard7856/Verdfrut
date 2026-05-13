// Metro config con soporte para monorepo pnpm.
// Sin esto, RN/Metro no resuelve dependencias de paquetes workspace
// (@tripdrive/types, @tripdrive/supabase, etc.) porque viven en /node_modules
// del root del monorepo, no en apps/driver-native/node_modules.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files in the monorepo (no solo apps/driver-native).
config.watchFolders = [workspaceRoot];

// 2. Resolve modules desde dos node_modules: el local y el del workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Hierarchical lookups HABILITADOS (default).
//    Razón: pnpm con node-linker=isolated guarda transitive deps en
//    `.pnpm/<pkg>@<ver>/node_modules/<dep>`. Cuando Metro bundlea código
//    DESDE un paquete que vive en .pnpm/, su `require('invariant')` necesita
//    poder subir el árbol para encontrar `invariant` un nivel arriba. Con
//    `disableHierarchicalLookup=true` Metro no lo hace y falla.
//    Trade-off: pequeño riesgo de resolver una versión incorrecta si hay
//    duplicates — mitigado porque pnpm garantiza una sola versión por
//    package en la tree.
config.resolver.disableHierarchicalLookup = false;

// 4. Enable symlinks resolution — pnpm con node-linker=isolated crea symlinks
//    para casi todo. Sin este flag, Metro NO sigue los symlinks correctamente
//    y falla resolviendo deps anidadas (expo-modules-core, etc.).
//    Documentación: https://reactnative.dev/blog/2023/06/21/0.72-metro-package-exports-symlinks
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

module.exports = config;

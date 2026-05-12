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

// 3. Disable hierarchical lookups — fuerza a Metro a usar SOLO las paths arriba.
//    Evita confusión cuando hay versions distintas de React en node_modules
//    de packages internos.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

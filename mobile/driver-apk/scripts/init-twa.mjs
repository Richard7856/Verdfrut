#!/usr/bin/env node
// Init programático del proyecto TWA — sin prompts del CLI.
//
// Por qué no `bubblewrap init`: el CLI es interactivo y un `yes |` rompe
// cuando llega al prompt de packageId (no acepta "y" como input válido).
// `@bubblewrap/core` expone TwaGenerator que respeta el twa-manifest.json
// existente y genera el Android project sin preguntar nada.
//
// Tras correr esto:
//   1. Se genera el Android project en ./
//   2. `bubblewrap build` completa el SDK download (al primer run) y compila APK firmada.

import bubblewrapCore from '@bubblewrap/core';
const { TwaGenerator, TwaManifest } = bubblewrapCore;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'twa-manifest.json');

if (!existsSync(MANIFEST_PATH)) {
  console.error(`[init-twa] No encontré twa-manifest.json en ${MANIFEST_PATH}`);
  process.exit(1);
}

console.log('[init-twa] Leyendo twa-manifest.json…');
const manifest = await TwaManifest.fromFile(MANIFEST_PATH);

console.log('[init-twa] Generando Android project en', ROOT);
const generator = new TwaGenerator();
await generator.createTwaProject(ROOT, manifest, console);

console.log('[init-twa] OK. Próximo paso: `npx @bubblewrap/cli build` (o npm run build).');

#!/usr/bin/env node
// Build programmatic de la APK firmada — sin prompts del CLI.
//
// Pipeline:
//   1. Verificar JDK + Android SDK (descargar si falta — Bubblewrap los maneja).
//   2. Compilar el Android project con Gradle.
//   3. Firmar la APK con el keystore configurado en twa-manifest.json.
//   4. Output en ./app-release-signed.apk

import bubblewrapCore from '@bubblewrap/core';
const {
  TwaManifest,
  Config,
  GradleWrapper,
  AndroidSdkTools,
  JdkHelper,
  ApkSigner,
} = bubblewrapCore;
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

console.log('[build] Cargando twa-manifest.json…');
const manifest = await TwaManifest.fromFile(path.join(ROOT, 'twa-manifest.json'));

// Config: Bubblewrap busca JDK + Android SDK en ~/.bubblewrap/ por convención.
const HOME = homedir();
const BW_HOME = path.join(HOME, '.bubblewrap');
const config = new Config(
  path.join(BW_HOME, 'jdk', 'jdk-17.0.11+9'),  // JDK path
  path.join(BW_HOME, 'android_sdk'),             // Android SDK path
);

// Si Android SDK no tiene cmdline-tools, AndroidSdkTools complete download
if (!existsSync(path.join(config.androidSdkPath, 'cmdline-tools'))) {
  console.log('[build] Android SDK incompleto — completando descarga…');
}

const process_ = (await import('node:process')).default;
const jdkHelper = new JdkHelper(process_, config);
const androidSdkTools = await AndroidSdkTools.create(process_, config, jdkHelper, console);

console.log('[build] Verificando build-tools…');
await androidSdkTools.checkBuildTools();

const gradleWrapper = new GradleWrapper(process_, androidSdkTools, ROOT);

console.log('[build] Compilando assemble (release unsigned)…');
await gradleWrapper.assembleRelease();

console.log('[build] Firmando APK con keystore…');
const apkSigner = new ApkSigner(androidSdkTools, jdkHelper);
const unsigned = path.join(ROOT, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk');
const signed = path.join(ROOT, 'app-release-signed.apk');

if (!manifest.signingKey) {
  throw new Error('twa-manifest.json no tiene signingKey configurado');
}

await apkSigner.sign(
  manifest.signingKey,
  'VerdFrutDemo2026',  // store password
  'VerdFrutDemo2026',  // key password
  unsigned,
  signed,
);

console.log('[build] OK — APK firmada:', signed);
console.log('[build] Pasa este archivo a los choferes via WhatsApp/Drive.');

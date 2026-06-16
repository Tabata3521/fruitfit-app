#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");

const options = parseArgs(process.argv.slice(2));
const apkPath = options.apk ? path.resolve(options.apk) : "";
const version = options.version || "";
const build = Number(options.build || 0);
const minSupportedBuild = Number(options.minSupportedBuild || options.min || build || 1);
const updateRequired = options.updateRequired === "true" || options.required === "true";
const notes = options.notes ? String(options.notes).split("\\n").filter(Boolean) : [];
const downloadsDir = path.resolve(options.downloadsDir || process.env.FRUITFIT_DOWNLOADS_DIR || "/var/www/fruitfit-downloads");
const manifestPath = path.resolve(options.manifest || process.env.APP_VERSION_MANIFEST_PATH || path.join(backendRoot, "app-version.json"));

if (!apkPath || !fs.existsSync(apkPath)) fail("Usage: publish-apk --apk /path/app.apk --version 0.1.1 --build 2");
if (!version) fail("--version is required");
if (!Number.isInteger(build) || build < 1) fail("--build must be a positive integer");

fs.mkdirSync(downloadsDir, { recursive: true });

const filename = `fruitfit-android-v${version}-build${build}.apk`;
const targetPath = path.join(downloadsDir, filename);
const latestPath = path.join(downloadsDir, "fruitfit-latest.apk");

fs.copyFileSync(apkPath, targetPath);
try {
  fs.rmSync(latestPath, { force: true });
  fs.symlinkSync(filename, latestPath);
} catch (_) {
  fs.copyFileSync(targetPath, latestPath);
}

const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
manifest.android = {
  latestVersion: version,
  latestBuild: build,
  minSupportedBuild,
  updateRequired,
  apkUrl: "https://client.tagirfruit.ru/downloads/fruitfit-latest.apk",
  releaseNotes: notes,
  publishedAt: new Date().toISOString()
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({ targetPath, latestPath, manifestPath, android: manifest.android }, null, 2));

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = "true";
    }
  }
  return result;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

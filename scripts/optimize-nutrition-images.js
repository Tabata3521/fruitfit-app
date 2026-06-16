import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const nutritionPath = path.join(projectRoot, "public", "data", "nutrition.json");
const imageDir = path.join(projectRoot, "public", "nutrition-images");
const manifestPath = path.join(imageDir, "manifest.json");

const MAX_SIZE = 720;
const WEBP_QUALITY = 76;

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const nutrition = JSON.parse(await fs.readFile(nutritionPath, "utf8"));
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const entries = Object.entries(manifest.images || {});
const pathMap = new Map();
let converted = 0;
let skipped = 0;
let removedOriginals = 0;

for (const [, entry] of entries) {
  const localPath = entry.localPath;
  if (!localPath?.startsWith("/nutrition-images/")) {
    skipped += 1;
    continue;
  }

  const fileName = path.basename(localPath);
  const sourcePath = path.join(imageDir, fileName);
  const targetName = `${path.basename(fileName, path.extname(fileName))}.webp`;
  const targetPath = path.join(imageDir, targetName);
  const nextLocalPath = `/nutrition-images/${targetName}`;

  if (!(await fileExists(sourcePath)) && !(await fileExists(targetPath))) {
    skipped += 1;
    continue;
  }

  if (!(await fileExists(targetPath))) {
    const source = await sharp(sourcePath);
    const metadata = await source.metadata();
    const shouldResize = (metadata.width || 0) > MAX_SIZE || (metadata.height || 0) > MAX_SIZE;
    await source
      .rotate()
      .resize(shouldResize ? { width: MAX_SIZE, height: MAX_SIZE, fit: "inside", withoutEnlargement: true } : undefined)
      .webp({ quality: WEBP_QUALITY, effort: 5 })
      .toFile(targetPath);
    converted += 1;
  } else {
    skipped += 1;
  }

  if (path.extname(fileName).toLowerCase() !== ".webp" && await fileExists(sourcePath)) {
    await fs.unlink(sourcePath);
    removedOriginals += 1;
  }

  pathMap.set(localPath, nextLocalPath);
  entry.localPath = nextLocalPath;
  entry.optimized = {
    format: "webp",
    maxSize: MAX_SIZE,
    quality: WEBP_QUALITY,
  };
  const stat = await fs.stat(targetPath);
  entry.bytes = stat.size;
  entry.contentType = "image/webp";
}

for (const meal of nutrition.meals || []) {
  if (pathMap.has(meal.photo)) {
    meal.photo = pathMap.get(meal.photo);
  }
}

nutrition.imageSource = {
  ...(nutrition.imageSource || {}),
  optimizedAt: new Date().toISOString(),
  imageFormat: "webp",
  maxImageSize: MAX_SIZE,
  webpQuality: WEBP_QUALITY,
};

manifest.optimizedAt = new Date().toISOString();
manifest.imageFormat = "webp";
manifest.maxImageSize = MAX_SIZE;
manifest.webpQuality = WEBP_QUALITY;

await fs.writeFile(nutritionPath, `${JSON.stringify(nutrition, null, 2)}\n`, "utf8");
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  entries: entries.length,
  converted,
  skipped,
  removedOriginals,
  maxSize: MAX_SIZE,
  webpQuality: WEBP_QUALITY,
}, null, 2));

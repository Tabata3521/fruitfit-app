import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const nutritionPath = path.join(projectRoot, "public", "data", "nutrition.json");
const imageDir = path.join(projectRoot, "public", "nutrition-images");
const manifestPath = path.join(imageDir, "manifest.json");

function hashUrl(url) {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
}

function extensionFor(url, contentType = "") {
  const fromPath = path.extname(new URL(url).pathname).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(fromPath)) return fromPath;
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("jpeg")) return ".jpg";
  if (contentType.includes("png")) return ".png";
  return ".img";
}

async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
  return {
    bytes: buffer.length,
    contentType: response.headers.get("content-type") || "",
  };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readExistingManifest() {
  try {
    const payload = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    return payload?.images && typeof payload.images === "object" ? payload.images : {};
  } catch {
    return {};
  }
}

const nutrition = JSON.parse(await fs.readFile(nutritionPath, "utf8"));
const meals = Array.isArray(nutrition.meals) ? nutrition.meals : [];
const remoteUrls = [...new Set(meals.map((meal) => meal.photo).filter((photo) => /^https?:\/\//i.test(photo)))];

await fs.mkdir(imageDir, { recursive: true });

const previousManifest = await readExistingManifest();
const manifest = {};
const failures = [];

for (const url of remoteUrls) {
  const previous = previousManifest[url];
  const previousLocalPath = typeof previous?.localPath === "string" ? previous.localPath : "";
  if (previousLocalPath.startsWith("/nutrition-images/")) {
    const previousFilePath = path.join(imageDir, path.basename(previousLocalPath));
    if (await fileExists(previousFilePath)) {
      manifest[url] = previous;
      continue;
    }
  }

  const guessedExt = extensionFor(url);
  let fileName = `${hashUrl(url)}${guessedExt}`;
  let outputPath = path.join(imageDir, fileName);

  try {
    if (!(await fileExists(outputPath))) {
      const result = await downloadImage(url, outputPath);
      const actualExt = extensionFor(url, result.contentType);
      if (actualExt !== guessedExt) {
        const actualFileName = `${hashUrl(url)}${actualExt}`;
        const actualOutputPath = path.join(imageDir, actualFileName);
        await fs.rename(outputPath, actualOutputPath);
        fileName = actualFileName;
        outputPath = actualOutputPath;
      }
      manifest[url] = {
        localPath: `/nutrition-images/${fileName}`,
        bytes: result.bytes,
        contentType: result.contentType,
      };
    } else {
      const stat = await fs.stat(outputPath);
      manifest[url] = {
        localPath: `/nutrition-images/${fileName}`,
        bytes: stat.size,
        contentType: "",
      };
    }
  } catch (error) {
    failures.push({ url, error: error.message });
  }
}

for (const meal of meals) {
  if (manifest[meal.photo]?.localPath) {
    meal.photo = manifest[meal.photo].localPath;
  }
}

nutrition.imageSource = {
  mode: "local",
  importedAt: new Date().toISOString(),
  originalHost: "static.tildacdn.com",
  imagesDir: "/nutrition-images/",
  localizedImages: Object.keys(manifest).length,
  failedImages: failures.length,
};

await fs.writeFile(nutritionPath, `${JSON.stringify(nutrition, null, 2)}\n`, "utf8");
await fs.writeFile(manifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), images: manifest, failures }, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  meals: meals.length,
  remoteUrls: remoteUrls.length,
  localizedImages: Object.keys(manifest).length,
  failedImages: failures.length,
  imageDir,
  manifestPath,
}, null, 2));

if (failures.length) {
  process.exitCode = 1;
}

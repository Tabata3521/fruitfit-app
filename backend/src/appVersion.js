import fs from "node:fs/promises";
import express from "express";
import { config } from "./config.js";

export const appVersionRouter = express.Router();

appVersionRouter.get("/version", async (req, res, next) => {
  try {
    const platform = normalizePlatform(req.query.platform);
    if (!platform) {
      res.status(400).json({ error: "Unsupported platform" });
      return;
    }

    const currentBuild = normalizeBuild(req.query.build);
    const manifest = await readVersionManifest();
    const version = manifest[platform];
    if (!version) {
      res.status(404).json({ error: "Version manifest is not configured for platform" });
      return;
    }

    const latestBuild = normalizeBuild(version.latestBuild);
    const minSupportedBuild = normalizeBuild(version.minSupportedBuild);
    const hasUpdate = currentBuild !== null && latestBuild !== null ? currentBuild < latestBuild : false;
    const updateRequiredByBuild =
      currentBuild !== null && minSupportedBuild !== null ? currentBuild < minSupportedBuild : false;

    res.json({
      platform,
      currentBuild,
      latestVersion: String(version.latestVersion || ""),
      latestBuild,
      minSupportedBuild,
      hasUpdate,
      updateRequired: Boolean(version.updateRequired) || updateRequiredByBuild,
      apkUrl: version.apkUrl || null,
      releaseNotes: Array.isArray(version.releaseNotes) ? version.releaseNotes : [],
      publishedAt: version.publishedAt || null
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      res.status(503).json({ error: "APP_VERSION_MANIFEST_NOT_CONFIGURED" });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(500).json({ error: "APP_VERSION_MANIFEST_INVALID" });
      return;
    }
    next(error);
  }
});

async function readVersionManifest() {
  const raw = await fs.readFile(config.appVersionManifestPath, "utf8");
  return JSON.parse(raw);
}

function normalizePlatform(value) {
  const platform = String(value || "").trim().toLowerCase();
  return platform === "android" || platform === "android_admin" ? platform : null;
}

function normalizeBuild(value) {
  if (value === undefined || value === null || value === "") return null;
  const build = Number(value);
  return Number.isInteger(build) && build >= 0 ? build : null;
}

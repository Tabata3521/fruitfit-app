import express from "express";
import { fileURLToPath } from "node:url";
import { assertProductionConfig, config } from "./config.js";
import { appVersionRouter } from "./appVersion.js";
import { authRouter, deviceRouter } from "./auth.js";
import { catalogRouter, rawDataRouter } from "./catalog.js";
import { coachRouter } from "./coach.js";
import { query } from "./db.js";
import { runMigrations } from "./migrate.js";
import { nutritionRouter } from "./nutrition.js";
import { notificationRouter } from "./notifications.js";
import { paymentsRouter, startPaymentAssignmentWorker } from "./payments.js";
import { referralsRouter } from "./referrals.js";
import { adminPushRouter } from "./adminPush.js";
import { adminAiRouter, openAiWebhookRouter } from "./aiUsage.js";
import { pushRouter } from "./push.js";
import { adminLmsRouter, lmsRouter } from "./lms.js";
import { adminRouter, meRouter } from "./userState.js";

assertProductionConfig();

const legalFilesDir = fileURLToPath(new URL("../public/legal/", import.meta.url));

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use("/api/webhooks/openai", express.raw({ type: "application/json", limit: "2mb" }), openAiWebhookRouter);
  app.use(express.json({ limit: "50mb" }));
  app.use(corsMiddleware);
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.get("/api/health", async (_req, res) => {
    const db = await query("SELECT now() AS now");
    res.json({
      ok: true,
      service: "fruitfit-backend",
      time: db.rows[0].now,
      openaiConfigured: Boolean(config.openAiApiKey)
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/app", appVersionRouter);
  app.use("/api/device", deviceRouter);
  app.use("/api/nutrition", nutritionRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/data", rawDataRouter);
  app.use("/api/coach", coachRouter);
  app.use("/api/notifications", notificationRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/referrals", referralsRouter);
  app.use("/api/push", pushRouter);
  app.use("/api/lms", lmsRouter);
  app.use("/api/me", meRouter);
  app.use("/api/admin/push", adminPushRouter);
  app.use("/api/admin/ai", adminAiRouter);
  app.use("/api/admin/lms", adminLmsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/legal", express.static(legalFilesDir, {
    dotfiles: "deny",
    index: false,
    maxAge: "5m",
    setHeaders(res) {
      res.setHeader("Content-Disposition", "inline");
    }
  }));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((error, _req, res, _next) => {
    console.error("[fruitfit-backend] request failed", {
      message: error?.message || "unknown",
      stack: config.nodeEnv === "production" ? undefined : error?.stack
    });
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (!origin || config.corsOrigins.includes(origin)) {
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

if (process.env.FRUITFIT_SKIP_LISTEN !== "1") {
  runMigrations()
    .then(() => {
      const app = createApp();
      app.listen(config.port, config.host, () => {
        console.log(`FruitFit backend listening on http://${config.host}:${config.port}`);
      });
      startPaymentAssignmentWorker();
    })
    .catch((error) => {
      console.error("[fruitfit-backend] startup failed", error);
      process.exit(1);
    });
}

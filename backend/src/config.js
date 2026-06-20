import fs from "node:fs";
import path from "node:path";

export function loadEnv(filePath = path.resolve(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  host: process.env.HOST || process.env.FRUITFIT_API_HOST || "127.0.0.1",
  port: Number(process.env.PORT || process.env.FRUITFIT_API_PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "",
  cookieSecret: process.env.COOKIE_SECRET || "",
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
  appPublicUrl: process.env.APP_PUBLIC_URL || process.env.APP_BASE_URL || "http://localhost:5173",
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:5173",
  apiPublicUrl: process.env.API_PUBLIC_URL || process.env.FRUITFIT_API_PUBLIC_URL || "https://api.tagirfruit.ru",
  appDeepLinkScheme: process.env.APP_DEEP_LINK_SCHEME || "fruitfit",
  androidPackageName: process.env.ANDROID_PACKAGE_NAME || "com.tagirfruit.fruitfit",
  adminBaseUrl: process.env.ADMIN_BASE_URL || "https://admin.tagirfruit.ru",
  siteBaseUrl: process.env.SITE_BASE_URL || "https://tagirfruit.ru",
  authAppRouterUrl: process.env.AUTH_APP_ROUTER_URL || process.env.APP_ROUTER_URL || "",
  adminAllowedEmails: parseList(process.env.ADMIN_ALLOWED_EMAILS),
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  openAiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  openAiWebhookSecret: process.env.OPENAI_WEBHOOK_SECRET || "",
  openAiInputCostPer1M: Number(process.env.OPENAI_INPUT_COST_PER_1M || 0),
  openAiOutputCostPer1M: Number(process.env.OPENAI_OUTPUT_COST_PER_1M || 0),
  openAiBudgetUsd: Number(process.env.OPENAI_BUDGET_USD || 0),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramClientId: process.env.TELEGRAM_CLIENT_ID || "8800719097",
  telegramJwksUrl: process.env.TELEGRAM_JWKS_URL || "https://sub.system-f-api.site:2097/api/telegram/jwks",
  yandexClientId: process.env.YANDEX_CLIENT_ID || "",
  yandexClientSecret: process.env.YANDEX_CLIENT_SECRET || "",
  yandexRedirectUri: process.env.YANDEX_REDIRECT_URI || "",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || "",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "",
  emailVerificationTtlMinutes: Number(process.env.EMAIL_VERIFICATION_TTL_MINUTES || 60),
  passwordResetTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30),
  appVersionManifestPath: process.env.APP_VERSION_MANIFEST_PATH || path.resolve(process.cwd(), "app-version.json"),
  pushProvider: process.env.PUSH_PROVIDER || "fcm",
  fcmProjectId: process.env.FCM_PROJECT_ID || "",
  fcmServiceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON || "",
  adminApiToken: process.env.ADMIN_API_TOKEN || "",
  robokassaMerchantLogin: process.env.ROBOKASSA_MERCHANT_LOGIN || "",
  robokassaPassword1: process.env.ROBOKASSA_PASSWORD_1 || "",
  robokassaPassword2: process.env.ROBOKASSA_PASSWORD_2 || "",
  robokassaTestPassword1: process.env.ROBOKASSA_TEST_PASSWORD_1 || "",
  robokassaTestPassword2: process.env.ROBOKASSA_TEST_PASSWORD_2 || "",
  robokassaHashAlgorithm: process.env.ROBOKASSA_HASH_ALGORITHM || "md5",
  robokassaTestMode: process.env.ROBOKASSA_TEST_MODE === "1" || process.env.ROBOKASSA_TEST_MODE === "true",
  robokassaRecurringEnabled: process.env.ROBOKASSA_RECURRING_ENABLED === "1" || process.env.ROBOKASSA_RECURRING_ENABLED === "true",
  robokassaPaymentUrl: process.env.ROBOKASSA_PAYMENT_URL || "https://auth.robokassa.ru/Merchant/Index.aspx",
  robokassaRecurringUrl: process.env.ROBOKASSA_RECURRING_URL || "https://auth.robokassa.ru/Merchant/Recurring",
  robokassaRecurringWorkerEnabled: process.env.ROBOKASSA_RECURRING_WORKER_ENABLED === "1" || process.env.ROBOKASSA_RECURRING_WORKER_ENABLED === "true",
  robokassaRecurringWorkerIntervalMs: Number(process.env.ROBOKASSA_RECURRING_WORKER_INTERVAL_MS || 0),
  robokassaRecurringWorkerIntervalSeconds: Number(process.env.ROBOKASSA_RECURRING_WORKER_INTERVAL_SECONDS || 900),
  robokassaRecurringWorkerBatchSize: Number(process.env.ROBOKASSA_RECURRING_WORKER_BATCH_SIZE || 10),
  robokassaRecurringDryRun: process.env.ROBOKASSA_RECURRING_DRY_RUN === "1" || process.env.ROBOKASSA_RECURRING_DRY_RUN === "true",
  programPriceMode: process.env.PROGRAM_PRICE_MODE || "",
  programPriceTest: Number(process.env.PROGRAM_PRICE_TEST || 100),
  programPriceProd: Number(process.env.PROGRAM_PRICE_PROD || 2990),
  paymentProgramAssignmentDelaySeconds: Number(process.env.PAYMENT_PROGRAM_ASSIGNMENT_DELAY_SECONDS || 180),
  paymentAssignmentWorkerIntervalSeconds: Number(process.env.PAYMENT_ASSIGNMENT_WORKER_INTERVAL_SECONDS || 30)
};

export function assertProductionConfig() {
  if (config.nodeEnv !== "production") return;
  const missing = [];
  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.jwtSecret || config.jwtSecret.length < 48) missing.push("JWT_SECRET");
  if (!config.cookieSecret || config.cookieSecret.length < 48) missing.push("COOKIE_SECRET");
  if (missing.length) {
    throw new Error(`Missing required production env keys: ${missing.join(", ")}`);
  }
}

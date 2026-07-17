import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const authPromptPath = path.resolve(scriptDir, "../src/screens/AuthPrompt.jsx");
const source = readFileSync(authPromptPath, "utf8");

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  if (start < 0 || end < 0) {
    return "";
  }

  return source.slice(start, end);
}

const verifySection = section(
  "async function verifyEmail",
  "async function resendVerification",
);
const resetSection = section(
  "async function submitReset",
  "async function verifyEmail",
);

const checks = [
  ["friendly invalid credentials error", source.includes('code === "INVALID_CREDENTIALS"')],
  ["rate-limit error is mapped", source.includes('code === "RATE_LIMITED"')],
  ["verification resend path exists", source.includes("Отправить новую ссылку")],
  ["reset recovery path exists", source.includes("Запросить новую ссылку")],
  ["verification screen has login exit", source.includes("Перейти ко входу")],
  ["reset screen has login exit", source.includes("Назад ко входу")],
  [
    "email verification preserves an existing session",
    verifySection.length > 0 && !verifySection.includes("setAuthToken(null)"),
  ],
  [
    "password reset clears stale local sessions",
    resetSection.includes("setAuthToken(null)") && resetSection.includes("saveAuthUser(null)"),
  ],
  ["failed link state is tracked", source.includes("setActionFailed(true)")],
];

const failed = checks.filter(([, passed]) => !passed);

for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
}

if (failed.length > 0) {
  process.exitCode = 1;
}

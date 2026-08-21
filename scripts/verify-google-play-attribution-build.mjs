import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const assetsDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("dist", "assets");
assert.equal(fs.existsSync(assetsDir), true, `${assetsDir} is missing; run build:google-play first`);

const javascript = fs.readdirSync(assetsDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => fs.readFileSync(path.join(assetsDir, name), "utf8"))
  .join("\n");

assert.match(
  javascript,
  /["']google_play["']\.trim\(\)\.toLowerCase\(\)/,
  "Google Play build was not compiled with VITE_DISTRIBUTION_CHANNEL=google_play"
);
assert.match(javascript, /FruitFitInstallReferrer/, "Install Referrer bridge is absent from the web bundle");
assert.match(
  javascript,
  /\/api\/analytics\/installations\/first-open/,
  "first-open attribution endpoint is absent from the web bundle"
);
assert.match(javascript, /fruitfit\.attribution\.installReferrer\.v1/, "Install Referrer retry/cache state is absent");

process.stdout.write(`Google Play attribution bundle verification: PASS (${assetsDir})\n`);

const baseUrl = (process.argv[2] || process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

const checks = [
  ["/api/health", (data) => data.ok === true],
  ["/api/catalog", (data) => Array.isArray(data.catalogs)],
  ["/api/nutrition/search?q=%D1%82%D0%B2%D0%BE%D1%80%D0%BE%D0%B3", (data) => Array.isArray(data.items)]
];

for (const [path, validate] of checks) {
  const response = await fetch(`${baseUrl}${path}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !validate(data)) {
    console.error(`[smoke] failed ${path}`, { status: response.status, data });
    process.exit(1);
  }
  console.log(`[smoke] ok ${path}`);
}

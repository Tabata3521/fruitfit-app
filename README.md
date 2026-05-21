# FruitFit PWA

Mobile-first React/Vite PWA prototype with workouts, nutrition, health widgets, exercise replacement, and FruitFit Coach AI.

## Project Memory / Handoff

Before continuing development, read these files:

- `docs/PROJECT_STATE.md` — current state and known issues.
- `docs/ARCHITECTURE.md` — how the app is wired.
- `docs/DECISIONS.md` — engineering decisions and constraints.
- `docs/CHANGELOG.md` — behavior changes by date.
- `docs/NEXT_AGENT_CHECKLIST.md` — checklist for the next coding session.
- `docs/RUNBOOK.md` — local run, audit, build, and deploy commands.

The most important current rule: anatomy images are driven by manual muscle label mapping in `src/data/anatomyMuscleMapping.js`. Do not reintroduce crop/slice heuristics or final image selection by exercise name.

## Local Run

```powershell
npm.cmd install
npm.cmd run dev -- --port 5176
```

Open:

```text
http://127.0.0.1:5176/
```

AI health:

```text
http://127.0.0.1:5176/api/health
```

## Local Env

Create `.env` in the project root:

```text
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5-nano
```

The key is used only by local backend middleware or `server.js`; it is not exposed to the frontend.

## VDS Backend / Nutrition DB

The Node backend can be run locally with:

```powershell
npm.cmd run api
```

Seed the local SQLite nutrition database:

```powershell
npm.cmd run db:nutrition:seed
```

This creates:

```text
data/nutrition.db
```

Useful endpoints:

```text
GET  /api/health
GET  /api/nutrition/search?q=творог
POST /api/nutrition/calc
POST /api/coach
```

Example nutrition calculation:

```powershell
$body = @{
  items = @(
    @{ name = "творог 5%"; grams = 300 },
    @{ name = "грецкие орехи"; grams = 50 }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/nutrition/calc" -Body $body -ContentType "application/json; charset=utf-8"
```

When a Coach message contains food and grams, `/api/coach` parses the items, calculates KBJU through SQLite, and returns an OpenAI-compatible `choices[0].message.content` response. The LLM is not used as a source of calories.

## Cloudflare Pages Deployment

Recommended settings for the existing `fruitfit.pages.dev` project:

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Root directory: tagirfruit-fitness-app, if this app is inside a bigger repo
Functions directory: functions
```

Add Cloudflare Pages environment variables:

```text
OPENAI_API_KEY=<secret>
OPENAI_MODEL=gpt-5-nano
```

The production AI endpoint is implemented as Pages Functions:

```text
/api/health
/api/coach
```

After deployment, check:

```text
https://fruitfit.pages.dev/api/health
```

Expected:

```json
{
  "ok": true,
  "openaiKeyLoaded": true,
  "model": "gpt-5-nano",
  "endpoint": "responses",
  "runtime": "cloudflare-pages-functions"
}
```

## Build

```powershell
npm.cmd run build
```

## Data

The app reads local parsed data from `public/data/`:

- `courses.json`
- `lessons.json`
- `exercises.json`
- `nutrition.json`
- `exercise-catalog.json`
- `exercise-catalog.csv`
- `quality-report.json`

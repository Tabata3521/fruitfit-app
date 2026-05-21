# FruitFit Runbook

## Local Dev

```bash
npm install
npm run dev -- --port 5176
```

Open:

```text
http://127.0.0.1:5176/
```

## Production Build

```bash
npm run build
```

Output:

```text
dist/
```

## Audit Muscle Mapping

```bash
npm run audit:muscle-templates
```

Output:

```text
audit/exercise_muscle_template_audit.csv
```

The audit must report:

- `missingImages: 0`
- `missingLabels: 0`

If missing values appear, do not claim the anatomy mapping is complete.

## Cloudflare Deploy

Set credentials in the current shell, then:

```bash
npx --yes wrangler pages deploy dist --project-name fruitfit --branch main
```

Production:

```text
https://fruitfit.pages.dev/
```

Health:

```text
https://fruitfit.pages.dev/api/health
```

## Android

Do not build APK unless explicitly requested.

Relevant scripts:

```bash
npm run android:sync
npm run android:debug
```

## Useful Files

- `fruitfit-report-2026-05-16-muscle-map-pwa.txt` - last emailed report.
- `audit/exercise_muscle_template_audit.csv` - latest anatomy mapping audit.
- `audit/exercise_video_matching_audit.csv` - exercise video matching audit.
- `tools/video-upload/` - Selectel exercise video tooling.
- `tools/lecture-upload/` - Selectel lecture upload tooling.


# FruitFit Project State

Last updated: 2026-05-16 18:00 +03:00

This file is the handoff entry point for humans and coding agents. Read it before changing the app.

## Current Product

FruitFit is a mobile-first React/Vite/PWA fitness app with:

- training programs and workout flow;
- exercise videos from Selectel when available;
- local exercise replacement logic;
- anatomy / muscle map cards;
- nutrition screen and nutrition widget;
- health widgets and simulated health data;
- profile, onboarding quiz, measurements, theme support;
- AI Coach through Cloudflare Pages Functions / VDS-compatible API.

Production URL:

- https://fruitfit.pages.dev/

Latest Cloudflare preview known:

- https://630400ce.fruitfit.pages.dev

## Current Muscle Map State

The muscle map system was moved from template heuristics to manual label mapping.

Current flow:

```text
exercise
  -> exercise_table_meta.targetZone / targetZone / target_zone
  -> normalizeMuscleLabel()
  -> muscleImageMap[label]
  -> <img object-fit: contain>
```

Important files:

- `src/data/anatomyMuscleMapping.js`
- `src/data/muscleTemplates.js`
- `src/components/MuscleWorkBlock.jsx`
- `scripts/audit-muscle-templates.mjs`
- `audit/exercise_muscle_template_audit.csv`
- `public/muscle-templates/manual/`

Current audit result:

- total exercises: 190
- exact mapped ok: 167
- alias used: 23
- missing images: 0
- missing labels: 0
- needs review: 25

Known needs review:

- `Бицепс`
- `Бицепс / брахиалис`
- `Брахиалис / предплечье`
- `Внутренняя головка бицепса`

Reason: the uploaded `Анатомический мапинг.xlsx` references `xl/media/image35.png`, but that media file was not extractable from the workbook. The app temporarily uses `public/muscle-templates/manual/upper_biceps_needs_review.jpg`, which is an existing project biceps asset. Do not mark it approved until a proper exported biceps image is provided.

## What Not To Do

- Do not use auto-crop / auto-slice / CSS crop for anatomy images.
- Do not use `object-fit: cover` for anatomy images.
- Do not use transform/translate/scale hacks to align anatomy.
- Do not infer final anatomy images from exercise names.
- Do not silently show a wrong anatomy image when a label is missing.
- Do not deploy without running the audit and build.

## Required Checks Before Deploy

Run:

```bash
npm run audit:muscle-templates
npm run build
```

Confirm:

- `missingImages: 0`
- `missingLabels: 0`
- only expected `needsReview` labels remain
- production build succeeds

Then deploy:

```bash
npx --yes wrangler pages deploy dist --project-name fruitfit --branch main
```

Production smoke checks:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://fruitfit.pages.dev/"
Invoke-RestMethod -Uri "https://fruitfit.pages.dev/api/health"
```


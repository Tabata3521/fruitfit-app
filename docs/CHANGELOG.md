# FruitFit Changelog

This is a human-readable project log. Add entries whenever behavior changes.

## 2026-05-17

### Workout Warm-Up UI

- Polished the workout warm-up accordion in `src/screens/WorkoutScreen.jsx`.
- Warm-up now opens by default and uses a more compact premium dark card.
- Added structured joint cards, short movement cues, and cleaner duration/safety/breathing tips.
- Added `docs/WORKLOG.md` as an operational journal for parallel development.
- No admin, backend, nutrition, video, replacement, or anatomy mapping logic was changed.

## 2026-05-16

### Manual Anatomy Mapping

- Added `src/data/anatomyMuscleMapping.js`.
- Switched anatomy image lookup to manual muscle label mapping.
- Added canonical labels, aliases, and explicit label-to-image asset paths.
- Added extracted manual anatomy assets under `public/muscle-templates/manual/`.
- Updated `src/data/muscleTemplates.js` to return image info from label mapping.
- Updated `src/components/MuscleWorkBlock.jsx` to render image assets directly with `object-fit: contain`.
- Updated `scripts/audit-muscle-templates.mjs` to audit label/image status, not just template presence.

Audit after the change:

- total exercises: 190
- exact mapped ok: 167
- alias used: 23
- missing images: 0
- missing labels: 0
- needs review: 25

Known review item:

- biceps-related labels use `upper_biceps_needs_review.jpg` because the xlsx referenced a missing `xl/media/image35.png`.

### Replacement Undo

- Added `Вернуть` button for replaced exercise in `WorkoutScreen.jsx`.
- Undo removes the replacement from localStorage so original exercise, video, description, and anatomy image are restored together.

### Deploy

- Production build succeeded.
- Deployed to https://fruitfit.pages.dev/
- Latest known JS bundle after deploy: `index-BBvDipfb.js`.

## 2026-05-15 and Earlier

### Videos and Lectures

- Exercise videos are intended to prefer Selectel / Russian-hosted URLs.
- Lecture migration to Selectel was worked on previously.
- YouTube should be treated as fallback or temporary source, not the stable production video base.

### Training App MVP

- Built mobile-first FruitFit PWA.
- Added Home, Workout, Nutrition, Coach, Profile, widgets, timers, measurements, and replacement logic.

### InSkill Parser

- Earlier work parsed InSkill programs into local JSON/CSV exports.
- Parsed training data feeds the app via `public/data`.

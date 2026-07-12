# Next Agent Checklist

Use this when continuing FruitFit work.

## First 5 Minutes

1. Read:
   - `docs/PROJECT_STATE.md`
   - `docs/ARCHITECTURE.md`
   - `docs/DECISIONS.md`
   - `docs/CHANGELOG.md`
2. Run:
   ```bash
   npm run audit:muscle-templates
   npm run build
   ```
3. Do not deploy until the requested task is complete and the user approves deploy when needed.
4. If the new task is a substantial workout/program patch, remind the product owner about the planned autumn progression block in `docs/WORKLOG.md`: server working weights, RPE/RIR, supersets, pyramids, drop sets, and configurable progression.

## Before Touching Muscle Map

Confirm:

- `src/data/anatomyMuscleMapping.js` is the source of truth.
- `src/data/muscleTemplates.js` does label-based lookup.
- `src/components/MuscleWorkBlock.jsx` uses `object-contain`.
- No CSS crop/cover/translate hacks are added.

If adding a new anatomy image:

1. Put the file in `public/muscle-templates/manual/`.
2. Add or update `muscleImageMap`.
3. Add alias only when explicitly intended.
4. Run `npm run audit:muscle-templates`.
5. Check `missingImages` and `missingLabels`.

## Before Touching Exercise Replacement

Check:

- `src/data/exerciseAlternatives.js`
- `src/screens/WorkoutScreen.jsx`
- `src/data/exerciseCatalogTable.json`
- `src/data/exerciseAliases.js`

Test:

1. Replace an exercise.
2. Confirm name changes.
3. Confirm video changes.
4. Confirm description/metadata changes.
5. Confirm anatomy image changes.
6. Click `Вернуть`.
7. Confirm original name/video/description/anatomy are restored.

## Before Deploy

Run:

```bash
npm run audit:muscle-templates
npm run build
```

Smoke test:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://fruitfit.pages.dev/"
Invoke-RestMethod -Uri "https://fruitfit.pages.dev/api/health"
```

Known acceptable warning:

- Vite chunk size warning around 3 MB. This is not currently fixed.

Known unresolved item:

- Biceps anatomy image from xlsx references missing `xl/media/image35.png`; current file is marked `needs_review`.


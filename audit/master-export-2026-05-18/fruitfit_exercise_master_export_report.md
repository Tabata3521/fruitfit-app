# FruitFit Exercise Master Export Report

Generated: 2026-05-18

## Output Folder

`C:\Users\Meyva\Documents\Codex\2026-05-08\files-mentioned-by-the-user-inskill\tagirfruit-fitness-app\audit\master-export-2026-05-18`

## Sources Scanned

- `src/data/exerciseCatalogTable.json`
- `public/data/exercise-catalog.json`
- `public/data/exercises.json`
- `public/data/training-programs.json`
- `src/data/anatomyMuscleMapping.js`
- `src/data/exerciseAliases.js`
- `src/data/exerciseMuscles.js`
- `replacement_audit.json`

## Summary

- Total merged exercises: 208
- Missing any video: 9
- Missing Selectel video: 18
- Missing YouTube link: 208
- Missing muscle map: 18
- Missing muscle label: 18
- Unknown difficulty: 199
- Duplicate risk: 27
- Needs manual review: 53
- Replacement audit pairs: 825

## Specific Case: Приседание в кроссовере

Found as `table_124`.

- Clean name: `Приседание в кроссовере`
- Raw names merged: `Приседание в кроссовере, техника выполнения упражнения`; `Приседания в кроссовере`
- Used in programs: 70
- Selectel video: present
- YouTube link: missing
- Muscle map: present
- Muscle label: `Квадрицепс / ягодицы`
- Didactic pattern: `Приседание`
- Technical pattern: `приседание`
- Data quality flags: `missing_youtube; unknown_difficulty; suspicious_equipment`

Note: `suspicious_equipment` appears because the current metadata says `bodyweight`, while the name indicates a cable/crossover movement. This should be reviewed manually.

## Fields Usually Missing Or Weak

- YouTube links are not preserved in the current app dataset, so `video_youtube_url` is empty for all 208 master rows.
- Difficulty is mostly `unknown`; only a small subset has old generated difficulty data.
- Some old `public/data/exercise-catalog.json` rows do not have muscle labels or Selectel videos and are kept as review candidates.
- Sets/reps/rest are program-row data and are not treated as canonical exercise metadata.

## Admin Editor Preparation

Use the master export as the first review queue for the future exercise editor:

- start with `missing_selectel_video`;
- then `missing_muscle_map`;
- then `duplicate_name`;
- then `unknown_difficulty`;
- then `suspicious_equipment`.

The file `fruitfit_exercise_admin_editor_recommendations.md` contains the suggested admin UI fields.

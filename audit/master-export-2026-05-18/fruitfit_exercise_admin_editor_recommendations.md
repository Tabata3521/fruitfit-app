# FruitFit Exercise Admin Editor Recommendations

Generated: 2026-05-18T19:51:39.772Z

Recommended admin editor fields:

- Exercise identity: canonical name, user-friendly name, aliases, normalized base name.
- Media review: Selectel video, YouTube fallback, preview image, video status.
- Muscle review: muscle label, muscle map preview, primary/secondary/stabilizers.
- Pattern review: didactic pattern, technical pattern, hierarchy category/level.
- Safety review: restrictions, contraindication tags, suspicious equipment flag.
- Replacement review: replacement group, current candidates, duplicate-risk warnings.
- Usage review: used in programs count, program IDs, lesson IDs.
- Data quality filters: missing video, missing muscle map, missing pattern, unknown difficulty, duplicate names, needs manual review.

Admin UX notes:

- Show video and muscle map previews side by side.
- Put quality flags at the top as chips.
- Make aliases editable without changing program exercise names.
- Separate exercise metadata from program prescription: sets/reps/rest/comment belong to program rows, not exercise entity.
- Add filters for missing Selectel video, missing muscle map, missing label, duplicate name, suspicious equipment.

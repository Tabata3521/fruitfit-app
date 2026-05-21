# FruitFit Architecture Notes

## Stack

- React 19
- Vite 6
- Tailwind CSS
- Framer Motion
- Lucide React
- Cloudflare Pages + Pages Functions
- Capacitor Android exists, but APK work is separate from PWA work

## Main Folders

- `src/screens/` - top-level screens: home, workout, profile, nutrition, coach, onboarding.
- `src/components/` - reusable UI and workout components.
- `src/data/` - local stores, parsed training data adapters, exercise catalog, anatomy mapping, lectures.
- `src/services/` - external service wrappers, including AI coach fetch layer.
- `src/utils/` - helpers such as weight memory and text decoding.
- `public/data/` - parsed courses/lessons/exercises JSON.
- `public/muscle-templates/` - anatomy images.
- `functions/api/` - Cloudflare Pages Functions.
- `scripts/` - audit/import/build helper scripts.
- `audit/` - generated audit output.

## Training Data Flow

`src/data/useTrainingData.js` loads parsed JSON:

- `/data/courses.json`
- `/data/lessons.json`
- `/data/exercises.json`

Then it normalizes:

- course metadata;
- lesson names/descriptions;
- exercise names/comments;
- attached exercise table metadata;
- video URLs;
- muscle map IDs/labels.

Exercise metadata comes from:

- `src/data/exerciseCatalogTable.json`
- `src/data/exerciseAliases.js`

## Exercise Replacement Flow

Main files:

- `src/data/exerciseAlternatives.js`
- `src/screens/WorkoutScreen.jsx`

Replacement state is stored in localStorage:

```text
fruitfit.exerciseReplacements.<workoutId>
```

When replacing an exercise, the replacement object must include:

- name / exercise_name
- video URL fields
- muscle metadata
- target zone
- pattern
- restrictions
- `exercise_table_meta`
- `muscle_template_id`

Undo:

- `WorkoutScreen.jsx` has a `Вернуть` button for replaced exercises.
- It removes the replacement by `exercise_order`.
- The original exercise object then restores name, video, description, and anatomy image.

## Anatomy / Muscle Map Flow

Source of truth:

- `src/data/anatomyMuscleMapping.js`

Runtime API:

- `assignMuscleTemplate(exercise)` in `src/data/muscleTemplates.js`
- `MuscleWorkBlock.jsx` renders the returned `imageSrc`.

The image must be rendered as:

```jsx
<img className="h-full w-full object-contain object-center" />
```

Never use cover/crop/translate for these anatomy images.

## AI Coach

Frontend:

- `src/services/openai.js`
- `src/screens/CoachScreen.jsx`

Cloudflare Functions:

- `functions/api/coach.js`
- `functions/api/health.js`

Health endpoint:

```text
https://fruitfit.pages.dev/api/health
```

The frontend must not contain an OpenAI key.

## PWA Deploy

Build:

```bash
npm run build
```

Deploy:

```bash
npx --yes wrangler pages deploy dist --project-name fruitfit --branch main
```

Cloudflare API variables are currently provided manually in the shell before deploy.


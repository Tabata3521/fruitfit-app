# FruitFit Engineering Decisions

## Anatomy Images

Decision:

- Use manual muscle label mapping, not final heuristics by exercise name.
- Use provided production anatomy images as static assets.
- Render with `object-fit: contain`.

Reason:

- Previous auto-crop/slice logic caused shifted anatomy, artifacts, and wrong images.
- Manual label mapping is auditable and stable.

Consequences:

- If a label has no image, the app must show a fallback/warning and audit it.
- Do not silently substitute a “close enough” image unless an explicit alias exists.

## Exercise Replacement

Decision:

- Replacement must update the full exercise object surface:
  - name
  - media/video
  - metadata
  - restrictions
  - target zone
  - anatomy image

Reason:

- Earlier replacement could change the name while leaving stale video/anatomy data.

Consequence:

- Replacement and undo must be tested together.

## Nutrition

Decision:

- Nutrition calculation should be backend/database driven, not invented by AI.
- The UI can show parsed nutrition plans locally.

Reason:

- AI-generated calories are unreliable.

## AI

Decision:

- API key must stay out of frontend.
- `/api/coach` and/or VDS backend handle AI calls.
- `/api/health` must expose key-loaded/model status without leaking secrets.

## Deployment

Decision:

- PWA deploys to Cloudflare Pages.
- APK work is separate and only done when explicitly requested.

Reason:

- Prevents accidental Android build churn during web/PWA polish.


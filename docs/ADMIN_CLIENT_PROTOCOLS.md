# FruitFit Admin / Client Protocols

This document is the working contract between the public PWA, the admin panel, and the future Selectel-hosted backend/database.

## Current Deployment Shape

- Client PWA: `fruitfit.pages.dev`
- Admin panel: separate Cloudflare Pages project, intended URL `fruitfit-admin.pages.dev`
- AI/backend API: `https://tagirfruit-mini.duckdns.org`
- Video storage: Selectel S3 public base `https://ac22cf36-390e-4f3a-b58f-98eb399f6f3b.selstorage.ru`

## Shared Content Sources

For the current static MVP:

- Lectures live in client `src/data/lectures.js`.
- Admin has a copied static lecture catalog in `src/data/lectures.js`.
- Exercise metadata lives in client `src/data/exerciseCatalogTable.json`.
- Admin has a copied static catalog in `public/data/exercise-catalog-table.json`.
- Parsed programs/lessons/exercises are served from `public/data/*.json`.

When a real backend is introduced, these static files should become database-backed API responses.

## Future API Contracts

### Lectures

`GET /api/admin/lectures`

Returns:

```json
{
  "items": [
    {
      "id": "lecture-01",
      "order": 1,
      "title": "Лекция...",
      "shortTitle": "Лекция по мотивации",
      "videoUrl": "https://...selstorage.ru/lectures/...",
      "thumbnailUrl": "https://...",
      "status": "published"
    }
  ]
}
```

`PATCH /api/admin/lectures/:id`

Accepts editable fields: `title`, `shortTitle`, `videoUrl`, `thumbnailUrl`, `status`.

### Exercises

`GET /api/admin/exercises`

Returns exercise metadata merged from parsed programs and the curated exercise table:

- `name`
- `movementPattern`
- `targetZone`
- `muscleGroup`
- `restrictions`
- `equipment`
- `videoUrl`
- `anatomyImage`
- `occurrences`

`PATCH /api/admin/exercises/:id`

Accepts editable fields: `movementPattern`, `targetZone`, `muscleGroup`, `restrictions`, `equipment`, `videoUrl`, `anatomyImage`, `aliases`.

### Uploads

`POST /api/admin/uploads/video`

Multipart upload contract:

- field `file`: mp4 video
- field `entityType`: `exercise` or `lecture`
- field `entityId`: exercise or lecture id

Backend responsibilities:

- validate file type and size;
- transcode if needed to h264/aac mp4;
- upload to Selectel S3;
- return public URL;
- update DB row after explicit save.

## Rules

- Frontend must never store Selectel secret keys.
- Frontend admin upload UI can prepare metadata, but real upload must go through backend.
- Client PWA reads published content only.
- Admin panel can edit draft/published content.
- Exercise video URLs should prefer Selectel; YouTube remains fallback only.

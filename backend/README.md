# FruitFit Backend

Production backend for FruitFit. It is intentionally separate from the mobile/web client so the app can move catalog, auth, access, progress, payment, referral, reports, and push data to PostgreSQL without touching Health Connect code.

## Local commands

```bash
npm install
cp .env.example .env
npm run migrate
npm run import:local
npm start
```

The import script expects to run from `backend/` inside the existing FruitFit repository. Set `FRUITFIT_SOURCE_ROOT` if the source JSON/SQLite files live elsewhere.

# FruitFit Email Auth Contract

Backend base URL:

```text
https://api.tagirfruit.ru
```

All endpoints accept and return JSON.

## Register

```http
POST /api/auth/email/register
```

Request:

```json
{
  "email": "user@example.com",
  "password": "StrongPass123",
  "confirmPassword": "StrongPass123",
  "device": {
    "installationId": "stable-installation-id",
    "platform": "android",
    "appVersion": "1.0.0",
    "timezone": "Europe/Moscow",
    "language": "ru"
  }
}
```

Success `202`:

```json
{
  "ok": true,
  "verificationRequired": true,
  "message": "If the email can be registered, a verification email will be sent."
}
```

Errors:

- `400 INVALID_EMAIL`
- `400 PASSWORD_TOO_SHORT`
- `400 PASSWORD_TOO_LONG`
- `400 PASSWORD_REQUIRES_LETTER_AND_NUMBER`
- `400 PASSWORD_CANNOT_MATCH_EMAIL`
- `400 MISSING_PASSWORD_CONFIRMATION`
- `400 PASSWORD_CONFIRMATION_MISMATCH`
- `429 RATE_LIMITED`
- `503 SMTP_NOT_CONFIGURED`
- `500 EMAIL_REGISTER_FAILED`

## Verify Email

```http
POST /api/auth/email/verify
```

Request:

```json
{
  "token": "email-verification-token"
}
```

Success `200`:

```json
{
  "ok": true,
  "emailVerified": true,
  "user": {}
}
```

Errors:

- `400 MISSING_TOKEN`
- `400 INVALID_OR_EXPIRED_TOKEN`
- `500 EMAIL_VERIFY_FAILED`

## Login

```http
POST /api/auth/email/login
```

Request:

```json
{
  "email": "user@example.com",
  "password": "StrongPass123",
  "device": {
    "installationId": "stable-installation-id",
    "platform": "android"
  }
}
```

Success `200`:

```json
{
  "token": "jwt",
  "user": {}
}
```

Errors:

- `401 INVALID_CREDENTIALS`
- `403 EMAIL_NOT_VERIFIED`
- `429 RATE_LIMITED`
- `500 EMAIL_LOGIN_FAILED`

## Resend Verification

```http
POST /api/auth/email/resend-verification
```

Request:

```json
{
  "email": "user@example.com"
}
```

Success `202` uses the same response as register.

Errors:

- `429 RATE_LIMITED`
- `503 SMTP_NOT_CONFIGURED`

## Request Password Reset

```http
POST /api/auth/email/request-password-reset
```

Request:

```json
{
  "email": "user@example.com"
}
```

Success `202`:

```json
{
  "ok": true,
  "message": "If the email has password login, a reset email will be sent."
}
```

Errors:

- `429 RATE_LIMITED`
- `503 SMTP_NOT_CONFIGURED`

## Reset Password

```http
POST /api/auth/email/reset-password
```

Request:

```json
{
  "token": "password-reset-token",
  "password": "NewStrongPass123"
}
```

Success `200`:

```json
{
  "ok": true,
  "passwordReset": true
}
```

Errors:

- `400 MISSING_TOKEN`
- `400 INVALID_OR_EXPIRED_TOKEN`
- `400 PASSWORD_TOO_SHORT`
- `400 PASSWORD_TOO_LONG`
- `400 PASSWORD_REQUIRES_LETTER_AND_NUMBER`
- `400 PASSWORD_CANNOT_MATCH_EMAIL`
- `429 RATE_LIMITED`
- `500 PASSWORD_RESET_FAILED`

## Frontend Notes

- Email verification link path: `/email/verify?token=...`.
- Password reset link path: `/email/reset-password?token=...`.
- The frontend should read `token` from query params and call the backend endpoint.
- Auth endpoints never grant `paid`, `vip`, `admin`, or `trainer` access.
- Server access remains the source of truth through `/api/me/access`.

## Payment Session Requirement

```http
POST /api/payments/sessions
Authorization: Bearer <jwt>
```

- Public clients must be authenticated before creating payment sessions.
- The backend ignores public `userId`/`user_id` from the request body.
- The session user is taken from the current JWT user.
- Demo/admin exceptions are reserved for dev/admin-token flows only.

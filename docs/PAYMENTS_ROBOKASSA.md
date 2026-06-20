# FruitFit Robokassa payments

## Production flow

FruitFit uses the Robokassa API recurring flow. The cabinet SubscriptionPage can exist for manual checks, but it is not the main production checkout.

```text
Client app
-> POST /api/payments/sessions productCode=program_subscription recurringEnabled=true
-> Tilda /payment?ps=<paymentSessionId>
-> POST /api/payments/robokassa/checkout
-> Robokassa Merchant/Index.aspx with Recurring=true
-> POST /api/payments/robokassa/result
-> backend verifies SignatureValue and OutSum
-> backend updates payments, subscriptions, cycles, user_access
```

## Parent and child invoices

- Parent invoice: the first successful Robokassa invoice created through `Merchant/Index.aspx` with `Recurring=true`.
- Child renewal invoice: the backend worker creates a new `InvoiceID` and calls `ROBOKASSA_RECURRING_URL`.
- `PreviousInvoiceID` is the parent invoice id. It is sent to Robokassa, but it is not included in `SignatureValue`.
- `Result URL` is the only source of truth for extending access. The worker must not extend `paid_until` after it only submits `/Merchant/Recurring`.

Child recurring request parameters:

```text
MerchantLogin
OutSum
InvoiceID
PreviousInvoiceID
Description
SignatureValue
Shp_paymentSessionId
Shp_productCode=program_subscription
Shp_subscriptionDbId
```

`SignatureValue` is built as:

```text
MerchantLogin:OutSum:InvoiceID:Password#1:Shp_paymentSessionId=...:Shp_productCode=...:Shp_subscriptionDbId=...
```

`Shp_*` parameters are sorted alphabetically.

## Cancellation

Cancellation is controlled by FruitFit backend:

- set subscription `status='cancelled'`;
- set `cancelled_at=now()`;
- set `next_payment_date=null`;
- set payment session `recurring_enabled=false` when the column exists;
- keep `paid_until` unchanged.

The recurring worker skips cancelled subscriptions, so the user keeps already paid access but no future charge is initiated.

## Worker env

```bash
ROBOKASSA_RECURRING_ENABLED=true
ROBOKASSA_RECURRING_WORKER_ENABLED=false
ROBOKASSA_RECURRING_WORKER_INTERVAL_MS=900000
ROBOKASSA_RECURRING_DRY_RUN=true
```

- `ROBOKASSA_RECURRING_WORKER_ENABLED=false` fully disables automatic renewal attempts.
- `ROBOKASSA_RECURRING_DRY_RUN=true` lets the worker find due subscriptions and log/return planned requests without calling Robokassa.
- For production charging, use `ROBOKASSA_RECURRING_WORKER_ENABLED=true` and `ROBOKASSA_RECURRING_DRY_RUN=false`.

## Database checks

Due subscriptions:

```sql
SELECT s.id, s.user_id, s.payment_session_id, s.status, s.amount, s.paid_until,
       s.next_payment_date, s.robokassa_parent_inv_id, ps.recurring_enabled
FROM subscriptions s
JOIN payment_sessions ps ON ps.id = s.payment_session_id
WHERE s.status = 'active'
  AND ps.recurring_enabled = true
  AND s.cancelled_at IS NULL
  AND s.next_payment_date <= now()
  AND s.robokassa_parent_inv_id IS NOT NULL;
```

Pending/processing child payments:

```sql
SELECT id, payment_session_id, robokassa_inv_id, status, amount, recurring_parent_inv_id,
       recurring_child, meta, updated_at
FROM payments
WHERE recurring_child = true
ORDER BY updated_at DESC
LIMIT 20;
```

Cycles:

```sql
SELECT subscription_id, cycle_number, payment_id, delivery_mode, access_from, access_until, created_at
FROM subscription_program_cycles
ORDER BY created_at DESC
LIMIT 20;
```

## Test checklist

- First payment creates or updates `subscriptions`.
- First payment gives `paid_until + 30 days`.
- First payment sets `next_payment_date + 30 days`.
- Renewal worker creates one pending child payment for a due active subscription.
- Robokassa Result callback marks the child payment paid.
- Duplicate Result callback does not duplicate access or cycles.
- Cancel before renewal stops the worker from creating a new child payment.
- Cancel does not remove access before `paid_until`.
- Amount mismatch returns `AMOUNT_MISMATCH` and does not activate access.
- Changed questionnaire before renewal does not break cycle selection.

## Simulation commands

These commands are server-side only and do not call Robokassa:

```bash
node backend/scripts/simulate-recurring-flow.mjs due-dry-run --limit 10
node backend/scripts/simulate-recurring-flow.mjs first-success --session-id <id>
node backend/scripts/simulate-recurring-flow.mjs renewal-success --subscription-id <id>
node backend/scripts/simulate-recurring-flow.mjs fake-recurring-success --subscription-id <id>
node backend/scripts/simulate-recurring-flow.mjs duplicate-callback --subscription-id <id>
node backend/scripts/simulate-recurring-flow.mjs cancel --user-id <id>
node backend/scripts/simulate-recurring-flow.mjs cancel-before-due --subscription-id <id>
node backend/scripts/simulate-recurring-flow.mjs expired-paid-until --subscription-id <id>
node backend/scripts/simulate-recurring-flow.mjs amount-mismatch --session-id <id>
```

If Robokassa returns an error during `/Merchant/Recurring`, FruitFit keeps the pending payment as not paid/processing with the raw Robokassa response. Access is not extended until a valid Result callback arrives.

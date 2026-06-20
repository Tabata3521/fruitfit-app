import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://fruitfit_test:test@127.0.0.1:5432/fruitfit_test";
process.env.JWT_SECRET ||= "test-secret-with-enough-length-for-local-unit-tests-only";
process.env.COOKIE_SECRET ||= "test-cookie-secret-with-enough-length-for-local-unit-tests";
process.env.ROBOKASSA_MERCHANT_LOGIN = "demo";
process.env.ROBOKASSA_TEST_PASSWORD_1 = "password_1";
process.env.ROBOKASSA_TEST_PASSWORD_2 = "password_2";
process.env.ROBOKASSA_TEST_MODE = "true";
process.env.ROBOKASSA_RECURRING_ENABLED = "true";
process.env.ROBOKASSA_HASH_ALGORITHM = "md5";
process.env.SITE_BASE_URL = "https://tagirfruit.ru";
process.env.API_PUBLIC_URL = "https://api.tagirfruit.ru";
process.env.APP_BASE_URL = "https://client.tagirfruit.ru";

const payments = await import("../src/payments.js");
const recurring = await import("../src/robokassaRecurringWorker.js");

test("sorts Shp_* params alphabetically for Robokassa signatures", () => {
  assert.deepEqual(payments.shpSignatureParts({
    Shp_productCode: "individual_program",
    Shp_paymentSessionId: "abc",
    OutSum: "100.00"
  }), [
    "Shp_paymentSessionId=abc",
    "Shp_productCode=individual_program"
  ]);
});

test("verifies ResultURL signature with Password #2", () => {
  const payload = {
    OutSum: "100.000000",
    InvId: "450009",
    Shp_login: "Vasya",
    Shp_oplata: "1"
  };
  payload.SignatureValue = payments.robokassaHash("100.000000:450009:password_2:Shp_login=Vasya:Shp_oplata=1");
  assert.equal(payments.verifyRobokassaResultSignature(payload, "password_2"), true);
  assert.equal(payments.verifyRobokassaResultSignature({ ...payload, OutSum: "99.000000" }, "password_2"), false);
});

test("builds test checkout URL without trusting frontend production amount", () => {
  const checkoutUrl = payments.buildRobokassaCheckoutUrl({
    session: {
      id: "ps_test",
      product_code: "individual_program",
      amount: 100,
      email: "client@example.com",
      robokassa_inv_id: 12345,
      recurring_enabled: false
    },
    product: payments.PAYMENT_PRODUCTS.individual_program,
    successUrl: "https://tagirfruit.ru/payment-success",
    failUrl: "https://tagirfruit.ru/payment-fail"
  });

  const url = new URL(checkoutUrl);
  assert.equal(url.hostname, "auth.robokassa.ru");
  assert.equal(url.searchParams.get("MerchantLogin"), "demo");
  assert.equal(url.searchParams.get("OutSum"), "100.00");
  assert.equal(url.searchParams.get("InvId"), "12345");
  assert.equal(url.searchParams.get("IsTest"), "1");
  assert.equal(url.searchParams.get("Shp_paymentSessionId"), "ps_test");
  assert.ok(url.searchParams.get("SignatureValue"));
});

test("adds Recurring=true only for eligible recurring checkout", () => {
  const checkoutUrl = payments.buildRobokassaCheckoutUrl({
    session: {
      id: "ps_recurring",
      product_code: "individual_program",
      amount: 100,
      robokassa_inv_id: 67890,
      recurring_enabled: true
    },
    product: payments.PAYMENT_PRODUCTS.individual_program,
    successUrl: "https://tagirfruit.ru/payment-success",
    failUrl: "https://tagirfruit.ru/payment-fail"
  });

  const url = new URL(checkoutUrl);
  assert.equal(url.searchParams.get("Recurring"), "true");
  assert.equal(url.searchParams.get("Shp_productCode"), "individual_program");
});

test("program subscription checkout uses recurring product code", () => {
  const checkoutUrl = payments.buildRobokassaCheckoutUrl({
    session: {
      id: "ps_subscription",
      product_code: "program_subscription",
      amount: 100,
      robokassa_inv_id: 67891,
      recurring_enabled: true
    },
    product: payments.PAYMENT_PRODUCTS.program_subscription,
    successUrl: "https://tagirfruit.ru/payment-success",
    failUrl: "https://tagirfruit.ru/payment-fail"
  });

  const url = new URL(checkoutUrl);
  assert.equal(url.searchParams.get("Recurring"), "true");
  assert.equal(url.searchParams.get("Shp_productCode"), "program_subscription");
});

test("program criteria can prefer current profile for recurring cycles", () => {
  const session = {
    profile_snapshot: {
      gender: "female",
      goal: "fat loss",
      experience: "beginner",
      trainingFrequency: "2",
      restrictions: "none"
    },
    program_params: {
      gender: "female",
      trainingFrequency: "2"
    }
  };
  const currentProfile = {
    gender: "male",
    goal: "muscle gain",
    experience: "advanced",
    trainingFrequency: "3",
    restrictions: "back"
  };

  const firstCycle = payments.buildProgramCriteria(session);
  assert.equal(firstCycle.gender, "female");
  assert.equal(firstCycle.frequency, 2);
  assert.equal(firstCycle.raw.criteriaSource, "payment_session");

  const nextCycle = payments.buildProgramCriteria(session, {
    profileSnapshot: currentProfile,
    preferProfile: true
  });
  assert.equal(nextCycle.gender, "male");
  assert.equal(nextCycle.goal, "muscle_gain");
  assert.equal(nextCycle.level, "advanced");
  assert.equal(nextCycle.frequency, 3);
  assert.equal(nextCycle.restrictions, "back");
  assert.equal(nextCycle.raw.criteriaSource, "current_user_profile");
});

test("builds recurring child signature without PreviousInvoiceID", () => {
  const params = {
    MerchantLogin: "demo",
    OutSum: "2990.00",
    InvoiceID: "2002",
    PreviousInvoiceID: "1001",
    Shp_productCode: "program_subscription",
    Shp_paymentSessionId: "ps_recurring",
    Shp_subscriptionDbId: "7"
  };
  const signature = recurring.buildRobokassaRecurringSignature(params, "password_1");
  const expected = recurring.robokassaRecurringHash(
    "demo:2990.00:2002:password_1:Shp_paymentSessionId=ps_recurring:Shp_productCode=program_subscription:Shp_subscriptionDbId=7"
  );
  assert.equal(signature, expected);
});

test("builds recurring child request params for Merchant/Recurring", () => {
  const params = recurring.buildRobokassaRecurringParams({
    childInvId: "2003",
    subscription: {
      id: 9,
      amount: 2990,
      payment_session_id: "ps_child",
      robokassa_parent_inv_id: 1001
    }
  });

  assert.equal(params.MerchantLogin, "demo");
  assert.equal(params.OutSum, "2990.00");
  assert.equal(params.InvoiceID, "2003");
  assert.equal(params.PreviousInvoiceID, "1001");
  assert.equal(params.Shp_paymentSessionId, "ps_child");
  assert.equal(params.Shp_productCode, "program_subscription");
  assert.equal(params.Shp_subscriptionDbId, "9");
  assert.ok(params.SignatureValue);
});

test("uses backend-hosted Robokassa return URLs", () => {
  assert.equal(payments.paymentReturnUrl("success"), "https://api.tagirfruit.ru/api/payments/robokassa/success");
  assert.equal(payments.paymentReturnUrl("fail"), "https://api.tagirfruit.ru/api/payments/robokassa/fail");
});

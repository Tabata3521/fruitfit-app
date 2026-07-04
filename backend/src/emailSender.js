import nodemailer from "nodemailer";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const VERIFY_SUBJECT = "Подтверждение email в FruitFit";
const RESET_SUBJECT = "Сброс пароля FruitFit";
const SERVICE_REMINDER_SUBJECT = "FruitFit: напоминание об оплате сервисов";
const PAYMENT_LINK_SUBJECT = "FruitFit: ссылка на оплату тренировочной программы";
const PAYMENT_OFFER_URL = "https://static.inskill.ru/media/13890020/%D0%94%D0%9E%D0%93%D0%9E%D0%92%D0%9E%D0%A0-%D0%9E%D0%A4%D0%95%D0%A0%D0%A2%D0%AB.pdf?v=1750346360";
const PAYMENT_RECURRING_TERMS_URL = "https://api.tagirfruit.ru/legal/fruitfit-recurring-terms.docx";
const PAYMENT_PRIVACY_POLICY_URL = "https://api.tagirfruit.ru/legal/fruitfit-privacy-policy.docx";
const PAYMENT_REFUND_RULES_URL = "https://api.tagirfruit.ru/legal/fruitfit-payment-refund-rules.docx";
const TRAINER_REQUEST_SUBJECT = "FruitFit: новая заявка на тренировочную программу";

export function isEmailSmtpConfigured() {
  return Boolean(config.smtpHost && config.smtpPort && config.smtpFrom);
}

function smtpSecure() {
  return Number(config.smtpPort) === 465;
}

function isLocalSmtpHost() {
  return ["127.0.0.1", "localhost", "::1"].includes(String(config.smtpHost || "").trim().toLowerCase());
}

function shouldIgnoreTls() {
  return isLocalSmtpHost() && Number(config.smtpPort) === 25 && !config.smtpUser && !config.smtpPass;
}

const BRAND_IMAGE_CID = "fruitfit-email-avatar@tagirfruit";
const BRAND_IMAGE_PATH = path.resolve(process.cwd(), "public/email/fruitfit-email-avatar.png");

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function brandImageHtml() {
  return `<div style="margin:0 0 18px;text-align:center;">
                  <img src="cid:${BRAND_IMAGE_CID}" width="96" height="96" alt="FruitFit" style="display:inline-block;width:96px;height:96px;border-radius:24px;object-fit:cover;border:1px solid #f0d6a5;background:#111;">
                </div>`;
}

function brandImageAttachments() {
  if (!fs.existsSync(BRAND_IMAGE_PATH)) return [];
  return [{
    filename: "fruitfit-email-avatar.png",
    path: BRAND_IMAGE_PATH,
    cid: BRAND_IMAGE_CID,
    contentDisposition: "inline"
  }];
}

function verificationText(link) {
  return [
    "Здравствуйте!",
    "",
    "Подтвердите email для входа в FruitFit:",
    link,
    "",
    "Если вы не регистрировались в FruitFit, просто проигнорируйте это письмо.",
    "",
    "FruitFit"
  ].join("\n");
}

function verificationHtml(link) {
  const safeLink = escapeHtml(link);
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${VERIFY_SUBJECT}</title>
  </head>
  <body style="margin:0;background:#f4f7f2;font-family:Arial,Helvetica,sans-serif;color:#172016;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7f2;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #dce7d8;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 18px;">
                ${brandImageHtml()}
                <div style="font-size:22px;font-weight:700;line-height:1.25;color:#12351f;">FruitFit</div>
                <h1 style="font-size:20px;line-height:1.35;margin:22px 0 10px;color:#172016;">Подтвердите email</h1>
                <p style="font-size:15px;line-height:1.6;margin:0 0 22px;color:#31402f;">Нажмите кнопку ниже, чтобы подтвердить email и использовать вход в FruitFit.</p>
                <p style="margin:0 0 24px;">
                  <a href="${safeLink}" style="display:inline-block;background:#236b3a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 18px;border-radius:8px;">Подтвердить email</a>
                </p>
                <p style="font-size:13px;line-height:1.55;margin:0;color:#60705e;">Если кнопка не открывается, скопируйте ссылку:</p>
                <p style="font-size:13px;line-height:1.55;margin:8px 0 0;word-break:break-all;color:#236b3a;">${safeLink}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 24px;border-top:1px solid #edf2ea;">
                <p style="font-size:12px;line-height:1.5;margin:0;color:#7a8877;">Если вы не регистрировались в FruitFit, просто проигнорируйте это письмо.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function passwordResetText(link) {
  return [
    "Здравствуйте!",
    "",
    "Вы запросили сброс пароля в FruitFit.",
    "Чтобы задать новый пароль, откройте ссылку:",
    link,
    "",
    "Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.",
    "",
    "FruitFit"
  ].join("\n");
}

function passwordResetHtml(link) {
  const safeLink = escapeHtml(link);
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${RESET_SUBJECT}</title>
  </head>
  <body style="margin:0;background:#f4f7f2;font-family:Arial,Helvetica,sans-serif;color:#172016;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7f2;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #dce7d8;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 18px;">
                ${brandImageHtml()}
                <div style="font-size:22px;font-weight:700;line-height:1.25;color:#12351f;">FruitFit</div>
                <h1 style="font-size:20px;line-height:1.35;margin:22px 0 10px;color:#172016;">Сброс пароля</h1>
                <p style="font-size:15px;line-height:1.6;margin:0 0 22px;color:#31402f;">Нажмите кнопку ниже, чтобы задать новый пароль для входа в FruitFit.</p>
                <p style="margin:0 0 24px;">
                  <a href="${safeLink}" style="display:inline-block;background:#236b3a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 18px;border-radius:8px;">Задать новый пароль</a>
                </p>
                <p style="font-size:13px;line-height:1.55;margin:0;color:#60705e;">Если кнопка не открывается, скопируйте ссылку:</p>
                <p style="font-size:13px;line-height:1.55;margin:8px 0 0;word-break:break-all;color:#236b3a;">${safeLink}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 24px;border-top:1px solid #edf2ea;">
                <p style="font-size:12px;line-height:1.5;margin:0;color:#7a8877;">Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function createTransporter() {
  const transport = {
    host: config.smtpHost,
    port: Number(config.smtpPort),
    secure: smtpSecure(),
    ignoreTLS: shouldIgnoreTls()
  };
  if (config.smtpUser && config.smtpPass) {
    transport.auth = {
      user: config.smtpUser,
      pass: config.smtpPass
    };
  }
  return nodemailer.createTransport(transport);
}

export async function sendVerificationEmail(email, link) {
  return sendEmail({
    email,
    link,
    subject: VERIFY_SUBJECT,
    text: verificationText(link),
    html: verificationHtml(link),
    kind: "verification"
  });
}

export async function sendPasswordResetEmail(email, link) {
  return sendEmail({
    email,
    link,
    subject: RESET_SUBJECT,
    text: passwordResetText(link),
    html: passwordResetHtml(link),
    kind: "password_reset"
  });
}

export async function sendServiceReminderEmail(email, { services = [], leadDays = 7, note = "" } = {}) {
  const normalizedServices = Array.isArray(services) ? services : [];
  return sendEmail({
    email,
    subject: SERVICE_REMINDER_SUBJECT,
    text: serviceReminderText(normalizedServices, leadDays, note),
    html: serviceReminderHtml(normalizedServices, leadDays, note),
    kind: "service_reminder"
  });
}

export async function sendProgramPaymentLinkEmail(email, { link, amount = 2990, productTitle = "Абонемент FruitFit", programTitle = "", questionnaireSummary = [], referralCode = "", recipientName = "", recipientGender = "" } = {}) {
  return sendEmail({
    email,
    link,
    subject: PAYMENT_LINK_SUBJECT,
    text: tagirPaymentLinkText({ link, amount, productTitle, programTitle, questionnaireSummary, referralCode, recipientName, recipientGender }),
    html: tagirPaymentLinkHtml({ link, amount, productTitle, programTitle, questionnaireSummary, referralCode, recipientName, recipientGender }),
    kind: "program_payment_link"
  });
}

export async function sendTrainerRequestEmail(email, request = {}) {
  return sendEmail({
    email,
    subject: TRAINER_REQUEST_SUBJECT,
    text: trainerRequestText(request),
    html: trainerRequestHtml(request),
    kind: "trainer_request"
  });
}

function trainerRequestRows(request = {}) {
  const profile = request.profileSnapshot && typeof request.profileSnapshot === "object" ? request.profileSnapshot : {};
  const params = request.programParams && typeof request.programParams === "object" ? request.programParams : {};
  const rows = [
    ["Request ID", request.requestId],
    ["Имя", request.name],
    ["Email", request.email],
    ["Телефон", request.phone],
    ["Источник", request.source],
    ["Цель", profile.goal || params.goal],
    ["Пол", profile.gender || params.gender],
    ["Возраст", profile.age || params.age],
    ["Рост", profile.height || profile.heightCm],
    ["Вес", profile.weight || profile.weightKg],
    ["Опыт", profile.experience || profile.level || params.level],
    ["Частота тренировок", profile.trainingFrequency || params.trainingFrequency || params.frequency],
    ["Тип питания", profile.dietType || params.dietType],
    ["Ограничения", profile.restrictions || profile.limitations || params.limitations],
    ["Комментарий", profile.comment || request.comment]
  ];
  return rows
    .map(([label, value]) => [label, Array.isArray(value) ? value.filter(Boolean).join(", ") : value])
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
}

function trainerRequestText(request = {}) {
  const rows = trainerRequestRows(request).map(([label, value]) => `${label}: ${value}`);
  return [
    "Новая заявка на тренировочную программу FruitFit.",
    "",
    ...rows,
    "",
    "FruitFit Backend"
  ].join("\n");
}

function trainerRequestHtml(request = {}) {
  const rows = trainerRequestRows(request)
    .map(([label, value]) => `<tr><td style="padding:10px;border-bottom:1px solid #edf2ea;color:#60705e;font-size:12px;text-transform:uppercase;">${escapeHtml(label)}</td><td style="padding:10px;border-bottom:1px solid #edf2ea;color:#172016;font-size:14px;">${escapeHtml(value)}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${TRAINER_REQUEST_SUBJECT}</title>
  </head>
  <body style="margin:0;background:#f4f7f2;font-family:Arial,Helvetica,sans-serif;color:#172016;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7f2;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:14px;border:1px solid #dce7d8;overflow:hidden;">
            <tr>
              <td style="padding:28px;">
                ${brandImageHtml()}
                <div style="font-size:22px;font-weight:700;line-height:1.25;color:#12351f;">FruitFit</div>
                <h1 style="font-size:20px;line-height:1.35;margin:22px 0 16px;color:#172016;">Новая заявка на тренировочную программу</h1>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #edf2ea;border-radius:10px;overflow:hidden;">
                  <tbody>${rows || `<tr><td style="padding:14px;color:#60705e;">Данные анкеты не переданы.</td></tr>`}</tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 24px;border-top:1px solid #edf2ea;">
                <p style="font-size:12px;line-height:1.5;margin:0;color:#7a8877;">Письмо отправлено backend FruitFit после отправки заявки.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function paymentLinkText({ link, amount, productTitle }) {
  return [
    "Здравствуйте!",
    "",
    "Мы получили вашу анкету на тренировочную программу FruitFit.",
    `Для продолжения оплатите ${productTitle}: ${formatRubles(amount)}.`,
    "",
    "Ссылка на оплату:",
    link,
    "",
    "После оплаты тренер подготовит для вас тренировочный план по анкете.",
    "",
    "Юридические документы:",
    `- Договор оферты: ${PAYMENT_OFFER_URL}`,
    `- Условия автопродления: ${PAYMENT_RECURRING_TERMS_URL}`,
    `- Политика конфиденциальности: ${PAYMENT_PRIVACY_POLICY_URL}`,
    `- Правила оплаты и возврата: ${PAYMENT_REFUND_RULES_URL}`,
    "",
    "FruitFit"
  ].join("\n");
}

function paymentLinkHtml({ link, amount, productTitle }) {
  const safeLink = escapeHtml(link);
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${PAYMENT_LINK_SUBJECT}</title>
  </head>
  <body style="margin:0;background:#f4f7f2;font-family:Arial,Helvetica,sans-serif;color:#172016;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7f2;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #dce7d8;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 18px;">
                ${brandImageHtml()}
                <div style="font-size:22px;font-weight:700;line-height:1.25;color:#12351f;">FruitFit</div>
                <h1 style="font-size:20px;line-height:1.35;margin:22px 0 10px;color:#172016;">Ваша заявка принята</h1>
                <p style="font-size:15px;line-height:1.6;margin:0 0 14px;color:#31402f;">Мы получили анкету на тренировочную программу. Чтобы продолжить, оплатите ${escapeHtml(productTitle)}.</p>
                <p style="font-size:18px;line-height:1.35;margin:0 0 22px;color:#172016;font-weight:700;">${escapeHtml(formatRubles(amount))}</p>
                <p style="margin:0 0 24px;">
                  <a href="${safeLink}" style="display:inline-block;background:#236b3a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 18px;border-radius:8px;">Перейти к оплате</a>
                </p>
                <p style="font-size:13px;line-height:1.55;margin:0;color:#60705e;">Если кнопка не открывается, скопируйте ссылку:</p>
                <p style="font-size:13px;line-height:1.55;margin:8px 0 0;word-break:break-all;color:#236b3a;">${safeLink}</p>
                <div style="margin:22px 0 0;padding:14px;border:1px solid #edf2ea;border-radius:10px;background:#f8faf6;">
                  <p style="font-size:13px;line-height:1.55;margin:0 0 10px;color:#31402f;font-weight:700;">Юридические документы</p>
                  ${paymentLegalLinksHtml()}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 24px;border-top:1px solid #edf2ea;">
                <p style="font-size:12px;line-height:1.5;margin:0;color:#7a8877;">После оплаты доступ и программа будут оформлены по условиям FruitFit.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function paymentLegalLinksHtml() {
  return [
    ["Договор оферты", PAYMENT_OFFER_URL],
    ["Условия автопродления", PAYMENT_RECURRING_TERMS_URL],
    ["Политика конфиденциальности", PAYMENT_PRIVACY_POLICY_URL],
    ["Правила оплаты и возврата", PAYMENT_REFUND_RULES_URL]
  ].map(([label, url]) => {
    const safeUrl = escapeHtml(url);
    return `<p style="font-size:13px;line-height:1.55;margin:6px 0;color:#60705e;"><a href="${safeUrl}" style="color:#236b3a;text-decoration:underline;">${escapeHtml(label)}</a></p>`;
  }).join("");
}

function formatRubles(value) {
  const amount = Number(value || 0);
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(amount)} ₽`;
}

function tagirPaymentLinkText({ link, amount, productTitle, programTitle, questionnaireSummary, referralCode, recipientName, recipientGender }) {
  const summaryLines = normalizeQuestionnaireSummary(questionnaireSummary)
    .map((item) => `- ${item.label}: ${item.value}`);
  const normalizedReferralCode = normalizeReferralCode(referralCode);
  const greetingName = paymentEmailGreetingName(recipientName, recipientGender);
  const referralLines = normalizedReferralCode ? [
    "Твой промокод для друзей:",
    normalizedReferralCode,
    "",
    "Он не меняется. Можешь сохранить его и отправлять друзьям.",
    "Друг вводит твой промокод перед оплатой и получает скидку на первый месяц.",
    "После его успешной оплаты тебе начисляется +14 дней доступа.",
    "Один человек может применить промокод только один раз. Следующее продление идёт по обычной цене 2 990 ₽ за 30 дней.",
    ""
  ] : [];
  return [
    `Привет, ${greetingName}! Это Тагир.`,
    "",
    `Я подготовил твою программу${programTitle ? `: ${programTitle}` : " по анкете"}.`,
    summaryLines.length ? "Коротко по анкете:" : null,
    ...summaryLines,
    "",
    `Чтобы открыть программу в приложении, нужно оплатить ${productTitle} — ${formatRubles(amount)}.`,
    "После оплаты открой приложение FruitFit: доступ и программа должны появиться автоматически.",
    "",
    "Ссылка на оплату:",
    link,
    "",
    ...referralLines,
    "Дальше каждый месяц я буду готовить для тебя новый этап или обновлённую программу.",
    "Если изменятся цель, вес, самочувствие или ограничения — обнови анкету перед следующим списанием, чтобы программа была точнее.",
    "",
    "Юридические документы:",
    `- Договор оферты: ${PAYMENT_OFFER_URL}`,
    `- Условия автопродления: ${PAYMENT_RECURRING_TERMS_URL}`,
    `- Политика конфиденциальности: ${PAYMENT_PRIVACY_POLICY_URL}`,
    `- Правила оплаты и возврата: ${PAYMENT_REFUND_RULES_URL}`,
    "",
    "Тагир, FruitFit"
  ].filter((line) => line !== null).join("\n");
}

function tagirPaymentLinkHtml({ link, amount, productTitle, programTitle, questionnaireSummary, referralCode, recipientName, recipientGender }) {
  const safeLink = escapeHtml(link);
  const summary = normalizeQuestionnaireSummary(questionnaireSummary);
  const normalizedReferralCode = normalizeReferralCode(referralCode);
  const greetingName = paymentEmailGreetingName(recipientName, recipientGender);
  const summaryHtml = summary.length
    ? `<div style="margin:18px 0 0;padding:14px;border:1px solid #edf2ea;border-radius:10px;background:#f8faf6;">
         <p style="font-size:13px;line-height:1.55;margin:0 0 10px;color:#31402f;font-weight:700;">Коротко по анкете</p>
         ${summary.map((item) => `<p style="font-size:13px;line-height:1.55;margin:6px 0;color:#60705e;"><b>${escapeHtml(item.label)}:</b> ${escapeHtml(item.value)}</p>`).join("")}
       </div>`
    : "";
  const referralHtml = normalizedReferralCode
    ? `<div style="margin:18px 0 0;padding:16px;border:1px solid #dce7d8;border-radius:10px;background:#f8faf6;">
         <p style="font-size:13px;line-height:1.55;margin:0 0 8px;color:#31402f;font-weight:700;">Твой промокод для друзей</p>
         <p style="font-size:22px;letter-spacing:0.08em;line-height:1.25;margin:0 0 10px;color:#172016;font-weight:800;">${escapeHtml(normalizedReferralCode)}</p>
         <p style="font-size:13px;line-height:1.55;margin:0 0 8px;color:#60705e;">Он не меняется. Можешь сохранить его и отправлять друзьям.</p>
         <p style="font-size:13px;line-height:1.55;margin:0;color:#60705e;">Друг вводит твой промокод перед оплатой и получает скидку на первый месяц. После его успешной оплаты тебе начисляется +14 дней доступа. Один человек может применить промокод только один раз, а следующее продление идёт по обычной цене 2 990 ₽ за 30 дней.</p>
       </div>`
    : "";
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${PAYMENT_LINK_SUBJECT}</title>
  </head>
  <body style="margin:0;background:#f4f7f2;font-family:Arial,Helvetica,sans-serif;color:#172016;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7f2;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border-radius:14px;border:1px solid #dce7d8;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 18px;">
                ${brandImageHtml()}
                <div style="font-size:22px;font-weight:700;line-height:1.25;color:#12351f;">Привет, ${escapeHtml(greetingName)}! Это Тагир.</div>
                <h1 style="font-size:20px;line-height:1.35;margin:22px 0 10px;color:#172016;">Я подготовил твою программу</h1>
                <p style="font-size:15px;line-height:1.6;margin:0 0 12px;color:#31402f;">${programTitle ? `Подобрал под твою анкету: <b>${escapeHtml(programTitle)}</b>.` : "Подобрал программу под данные из анкеты."}</p>
                ${summaryHtml}
                ${referralHtml}
                <p style="font-size:15px;line-height:1.6;margin:18px 0 10px;color:#31402f;">Чтобы открыть программу в приложении, нужно оплатить ${escapeHtml(productTitle)}.</p>
                <p style="font-size:18px;line-height:1.35;margin:0 0 20px;color:#172016;font-weight:700;">${escapeHtml(formatRubles(amount))}</p>
                <p style="margin:0 0 20px;">
                  <a href="${safeLink}" style="display:inline-block;background:#236b3a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 18px;border-radius:8px;">Оплатить программу</a>
                </p>
                <p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#31402f;">После оплаты открой приложение FruitFit: доступ и программа должны появиться автоматически.</p>
                <p style="font-size:14px;line-height:1.6;margin:0;color:#31402f;">Дальше каждый месяц я буду готовить для тебя новый этап или обновлённую программу. Если изменятся цель, вес, самочувствие или ограничения — обнови анкету перед следующим списанием.</p>
                <p style="font-size:13px;line-height:1.55;margin:18px 0 0;color:#60705e;">Если кнопка не открывается, скопируй ссылку:</p>
                <p style="font-size:13px;line-height:1.55;margin:8px 0 0;word-break:break-all;color:#236b3a;">${safeLink}</p>
                <div style="margin:22px 0 0;padding:14px;border:1px solid #edf2ea;border-radius:10px;background:#f8faf6;">
                  <p style="font-size:13px;line-height:1.55;margin:0 0 10px;color:#31402f;font-weight:700;">Юридические документы</p>
                  ${paymentLegalLinksHtml()}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 24px;border-top:1px solid #edf2ea;">
                <p style="font-size:12px;line-height:1.5;margin:0;color:#7a8877;">Тагир, FruitFit</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function normalizeQuestionnaireSummary(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      label: String(item?.label || "").trim(),
      value: String(item?.value || "").trim()
    }))
    .filter((item) => item.label && item.value)
    .slice(0, 16);
}

function paymentEmailGreetingName(name = "", gender = "") {
  const firstName = String(name || "").trim().split(/\s+/)[0]?.slice(0, 48);
  if (firstName) return firstName;
  const normalizedGender = String(gender || "").trim().toLowerCase();
  if (/female|woman|girl|жен|дев/.test(normalizedGender)) return "спортсменка";
  return "спортсмен";
}

function normalizeReferralCode(value = "") {
  return String(value || "").trim().toUpperCase().slice(0, 64);
}

function serviceReminderText(services, leadDays, note) {
  const lines = services.map((service) => {
    const daysText = Number(service.daysUntil) < 0
      ? `просрочено на ${Math.abs(Number(service.daysUntil))} дн.`
      : Number(service.daysUntil) === 0
        ? "оплата сегодня"
        : `до оплаты ${service.daysUntil} дн.`;
    return `- ${service.title}: ${daysText}, дата ${service.nextPaymentLabel || service.nextPayment || "не указана"}`;
  });
  return [
    "Здравствуйте!",
    "",
    `Напоминание FruitFit по сервисам. Горизонт: ${leadDays} дн.`,
    "",
    ...(lines.length ? lines : ["Нет сервисов, требующих оплаты в выбранном горизонте."]),
    note ? "" : null,
    note || null,
    "",
    "FruitFit Admin"
  ].filter(Boolean).join("\n");
}

function serviceReminderHtml(services, leadDays, note) {
  const rows = services.length
    ? services.map((service) => {
        const days = Number(service.daysUntil);
        const color = days < 0 ? "#d9642f" : days <= 2 ? "#b7791f" : "#236b3a";
        const daysText = days < 0
          ? `просрочено на ${Math.abs(days)} дн.`
          : days === 0
            ? "оплата сегодня"
            : `до оплаты ${days} дн.`;
        return `<tr>
                  <td style="padding:12px;border-bottom:1px solid #edf2ea;font-weight:700;color:#172016;">${escapeHtml(service.title)}</td>
                  <td style="padding:12px;border-bottom:1px solid #edf2ea;color:${color};font-weight:700;">${escapeHtml(daysText)}</td>
                  <td style="padding:12px;border-bottom:1px solid #edf2ea;color:#31402f;">${escapeHtml(service.nextPaymentLabel || service.nextPayment || "не указана")}</td>
                </tr>`;
      }).join("")
    : `<tr><td colspan="3" style="padding:14px;color:#60705e;">Нет сервисов, требующих оплаты в выбранном горизонте.</td></tr>`;
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${SERVICE_REMINDER_SUBJECT}</title>
  </head>
  <body style="margin:0;background:#f4f7f2;font-family:Arial,Helvetica,sans-serif;color:#172016;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7f2;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:14px;border:1px solid #dce7d8;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 18px;">
                ${brandImageHtml()}
                <div style="font-size:22px;font-weight:700;line-height:1.25;color:#12351f;">FruitFit Admin</div>
                <h1 style="font-size:20px;line-height:1.35;margin:22px 0 10px;color:#172016;">Оплата сервисов</h1>
                <p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#31402f;">Напоминание по сервисам в горизонте ${escapeHtml(leadDays)} дн.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #edf2ea;border-radius:10px;overflow:hidden;">
                  <thead>
                    <tr style="background:#f4f7f2;">
                      <th align="left" style="padding:12px;color:#60705e;font-size:12px;text-transform:uppercase;">Сервис</th>
                      <th align="left" style="padding:12px;color:#60705e;font-size:12px;text-transform:uppercase;">Статус</th>
                      <th align="left" style="padding:12px;color:#60705e;font-size:12px;text-transform:uppercase;">Дата</th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
                ${note ? `<p style="font-size:13px;line-height:1.55;margin:18px 0 0;color:#60705e;">${escapeHtml(note)}</p>` : ""}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 24px;border-top:1px solid #edf2ea;">
                <p style="font-size:12px;line-height:1.5;margin:0;color:#7a8877;">Письмо отправлено backend FruitFit через серверную почту.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendEmail({ email, link, subject, text, html, kind }) {
  if (!isEmailSmtpConfigured()) {
    const payload = {
      email,
      kind,
      status: "SMTP_NOT_CONFIGURED"
    };
    if (config.nodeEnv === "production") {
      console.error("[fruitfit-email] SMTP is not configured", payload);
      return { sent: false, status: "SMTP_NOT_CONFIGURED" };
    }
    console.info("[fruitfit-email] SMTP is not configured; email link is available in local logs", {
      ...payload,
      link
    });
    return { sent: false, status: "SMTP_NOT_CONFIGURED", debugLink: link };
  }
  try {
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: config.smtpFrom,
      to: email,
      subject,
      text,
      html,
      attachments: brandImageAttachments()
    });
    console.info("[fruitfit-email] email sent", {
      email,
      kind,
      host: config.smtpHost,
      port: config.smtpPort,
      secure: smtpSecure(),
      messageId: info.messageId || null
    });
    return { sent: true, status: "sent", messageId: info.messageId || null };
  } catch (error) {
    console.error("[fruitfit-email] email failed", {
      email,
      kind,
      host: config.smtpHost,
      port: config.smtpPort,
      secure: smtpSecure(),
      code: error?.code || null,
      command: error?.command || null,
      responseCode: error?.responseCode || null,
      message: error?.message || "unknown"
    });
    throw error;
  }
}

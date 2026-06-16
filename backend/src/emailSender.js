import nodemailer from "nodemailer";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const VERIFY_SUBJECT = "Подтверждение email в FruitFit";
const RESET_SUBJECT = "Сброс пароля FruitFit";

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

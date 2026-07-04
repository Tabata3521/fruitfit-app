import crypto from "node:crypto";
import express from "express";
import { config } from "./config.js";
import { optionalUserFromRequest } from "./auth.js";
import { query } from "./db.js";
import { sendTrainerRequestEmail } from "./emailSender.js";

export const trainerRequestsRouter = express.Router();

const CONFIRMATION_MESSAGE = "Тренер рассмотрит заявку и свяжется с вами по электронной почте.";

function compactRequestId() {
  return crypto.randomBytes(10).toString("base64url");
}

function uuid() {
  return crypto.randomUUID();
}

function cleanString(value, max = 500) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, max);
}

function firstString(body, keys, max = 500) {
  for (const key of keys) {
    const value = cleanString(body?.[key], max);
    if (value) return value;
  }
  return "";
}

function safeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function pickProfileSnapshot(body = {}) {
  const source = {
    ...safeObject(body.profile),
    ...safeObject(body.profileSnapshot),
    ...safeObject(body.questionnaire)
  };
  const keys = [
    "name",
    "firstName",
    "lastName",
    "middleName",
    "gender",
    "age",
    "height",
    "heightCm",
    "weight",
    "weightKg",
    "goal",
    "experience",
    "level",
    "trainingFrequency",
    "dietType",
    "calculatedCalories",
    "recommendedCaloriesTarget",
    "calories",
    "protein",
    "fat",
    "carbs",
    "restrictions",
    "limitations",
    "injuries",
    "comment",
    "message"
  ];
  for (const key of keys) {
    if (body[key] !== undefined && source[key] === undefined) source[key] = body[key];
  }
  return source;
}

function pickProgramParams(body = {}) {
  const source = {
    ...safeObject(body.programParams),
    ...safeObject(body.program_params)
  };
  for (const key of ["goal", "gender", "level", "experience", "trainingFrequency", "frequency", "dietType", "limitations"]) {
    if (body[key] !== undefined && source[key] === undefined) source[key] = body[key];
  }
  return source;
}

function profileFromRow(row = {}) {
  const payload = safeObject(row.payload);
  const profile = {
    ...safeObject(payload.profile),
    ...safeObject(payload.profileSnapshot),
    ...safeObject(payload.questionnaire),
    ...safeObject(row.profile_snapshot)
  };
  const keys = [
    "name",
    "firstName",
    "lastName",
    "middleName",
    "gender",
    "age",
    "height",
    "heightCm",
    "weight",
    "weightKg",
    "goal",
    "experience",
    "level",
    "trainingFrequency",
    "dietType",
    "calculatedCalories",
    "recommendedCaloriesTarget",
    "calories",
    "protein",
    "fat",
    "carbs",
    "restrictions",
    "limitations",
    "injuries",
    "comment",
    "message"
  ];
  for (const key of keys) {
    if (payload[key] !== undefined && profile[key] === undefined) profile[key] = payload[key];
  }
  if (row.name && profile.name === undefined) profile.name = row.name;
  return profile;
}

function shouldNotifyTrainer(body = {}) {
  const truthy = (value) => value === true || ["true", "1", "yes", "on", "submitted"].includes(cleanString(value).toLowerCase());
  return truthy(body.submit)
    || truthy(body.submitted)
    || truthy(body.formSubmitted)
    || truthy(body.notifyTrainer)
    || truthy(body.sendEmail)
    || cleanString(body.status).toLowerCase() === "submitted";
}

function publicRequestUrl(requestId) {
  return `${String(config.siteBaseUrl || "https://tagirfruit.ru").replace(/\/+$/, "")}/trainer-request?requestId=${encodeURIComponent(requestId)}`;
}

async function findExistingRequest(requestId) {
  if (!requestId) return null;
  const result = await query("SELECT * FROM trainer_requests WHERE request_id = $1", [requestId]);
  return result.rows[0] || null;
}

async function handleTrainerRequestPost(req, res, next) {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const authUser = await optionalUserFromRequest(req);
    const existingRequestId = cleanString(body.requestId || body.request_id || req.params?.requestId, 160);
    const existing = await findExistingRequest(existingRequestId);
    const requestId = existing?.request_id || existingRequestId || compactRequestId();
    const status = shouldNotifyTrainer(body) ? "submitted" : "created";
    const email = firstString(body, ["email", "userEmail", "user_email"], 320) || existing?.email || authUser?.email || "";
    const name = firstString(body, ["name", "fullName", "full_name", "firstName"], 200) || existing?.name || "";
    const phone = firstString(body, ["phone", "phoneNumber", "phone_number"], 80) || existing?.phone || "";
    const source = firstString(body, ["source", "utm_source", "platform"], 120) || existing?.source || "trainer_request";
    const profileSnapshot = {
      ...safeObject(existing?.profile_snapshot),
      ...pickProfileSnapshot(body)
    };
    const programParams = {
      ...safeObject(existing?.program_params),
      ...pickProgramParams(body)
    };
    const payload = {
      ...safeObject(existing?.payload),
      ...body,
      userId: undefined,
      user_id: undefined,
      adminToken: undefined,
      token: undefined
    };
    const userAgent = cleanString(req.headers["user-agent"], 500);
    const ip = cleanString(req.ip || req.headers["x-forwarded-for"], 120);

    const saved = await query(
      `
        INSERT INTO trainer_requests (
          id,
          request_id,
          user_id,
          email,
          name,
          phone,
          status,
          submitted_at,
          source,
          profile_snapshot,
          program_params,
          payload,
          user_agent,
          ip,
          confirmation_message,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = 'submitted' THEN now() ELSE NULL END, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, now())
        ON CONFLICT (request_id) DO UPDATE
        SET user_id = COALESCE(EXCLUDED.user_id, trainer_requests.user_id),
            email = COALESCE(EXCLUDED.email, trainer_requests.email),
            name = COALESCE(EXCLUDED.name, trainer_requests.name),
            phone = COALESCE(EXCLUDED.phone, trainer_requests.phone),
            status = EXCLUDED.status,
            submitted_at = CASE
              WHEN EXCLUDED.status = 'submitted'
                THEN COALESCE(trainer_requests.submitted_at, EXCLUDED.submitted_at, now())
              ELSE trainer_requests.submitted_at
            END,
            source = COALESCE(EXCLUDED.source, trainer_requests.source),
            profile_snapshot = trainer_requests.profile_snapshot || EXCLUDED.profile_snapshot,
            program_params = trainer_requests.program_params || EXCLUDED.program_params,
            payload = trainer_requests.payload || EXCLUDED.payload,
            user_agent = COALESCE(EXCLUDED.user_agent, trainer_requests.user_agent),
            ip = COALESCE(EXCLUDED.ip, trainer_requests.ip),
            confirmation_message = EXCLUDED.confirmation_message,
            updated_at = now()
        RETURNING *
      `,
      [
        existing?.id || uuid(),
        requestId,
        authUser?.id || existing?.user_id || null,
        email || null,
        name || null,
        phone || null,
        status,
        source || null,
        JSON.stringify(profileSnapshot),
        JSON.stringify(programParams),
        JSON.stringify(payload),
        userAgent || existing?.user_agent || null,
        ip || existing?.ip || null,
        CONFIRMATION_MESSAGE
      ]
    );
    const request = saved.rows[0];

    let emailStatus = request.email_status || null;
    let emailMessageId = request.email_message_id || null;
    if (status === "submitted") {
      if (!config.trainerRequestEmail) {
        await query(
          "UPDATE trainer_requests SET email_status = $2, email_error = $3, updated_at = now() WHERE request_id = $1",
          [requestId, "not_configured", "TRAINER_REQUEST_EMAIL is missing"]
        );
        res.status(503).json({
          ok: false,
          error: "TRAINER_REQUEST_EMAIL_NOT_CONFIGURED",
          requestId,
          requestUrl: publicRequestUrl(requestId),
          message: CONFIRMATION_MESSAGE
        });
        return;
      }

      const emailResult = await sendTrainerRequestEmail(config.trainerRequestEmail, {
        requestId,
        email,
        name,
        phone,
        source,
        profileSnapshot,
        programParams,
        comment: cleanString(body.comment || body.message, 1200)
      });
      emailStatus = emailResult.status || (emailResult.sent ? "sent" : "not_sent");
      emailMessageId = emailResult.messageId || null;
      await query(
        `
          UPDATE trainer_requests
          SET email_sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE email_sent_at END,
              email_status = $2,
              email_message_id = $3,
              email_error = NULL,
              updated_at = now()
          WHERE request_id = $1
        `,
        [requestId, emailStatus, emailMessageId]
      );
    }

    const responsePayload = {
      ok: true,
      requestId,
      status,
      requestUrl: publicRequestUrl(requestId),
      email: email || null,
      profile: profileSnapshot,
      request: {
        id: requestId,
        status,
        profile: profileSnapshot
      },
      message: CONFIRMATION_MESSAGE,
      emailStatus,
      emailSent: emailStatus === "sent"
    };
    if (req.trainerRequestResponseMode === "submit") {
      res.status(200).json({
        ok: true,
        requestId,
        status,
        emailStatus,
        emailSent: emailStatus === "sent",
        emailMessageId,
        requestUrl: publicRequestUrl(requestId)
      });
      return;
    }
    res.status(existing ? 200 : 201).json(responsePayload);
  } catch (error) {
    const failedRequestId = req.body?.requestId || req.body?.request_id || req.params?.requestId;
    if (failedRequestId) {
      await query(
        "UPDATE trainer_requests SET email_status = $2, email_error = $3, updated_at = now() WHERE request_id = $1",
        [cleanString(failedRequestId, 160), "failed", cleanString(error?.message || "unknown", 1000)]
      ).catch(() => {});
    }
    next(error);
  }
}

async function handleTrainerRequestSubmit(req, res, next) {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const requestId = cleanString(req.params?.requestId || body.requestId || body.request_id, 160);
    if (!requestId) {
      res.status(400).json({ ok: false, error: "REQUEST_ID_REQUIRED" });
      return;
    }
    const existing = await findExistingRequest(requestId);
    if (!existing) {
      res.status(404).json({ ok: false, error: "REQUEST_NOT_FOUND" });
      return;
    }
    req.body = {
      ...body,
      requestId,
      status: "submitted",
      submit: true
    };
    req.trainerRequestResponseMode = "submit";
    await handleTrainerRequestPost(req, res, next);
  } catch (error) {
    next(error);
  }
}

trainerRequestsRouter.post("/", handleTrainerRequestPost);
trainerRequestsRouter.post("/:requestId/submit", handleTrainerRequestSubmit);
trainerRequestsRouter.post("/:requestId", handleTrainerRequestPost);

trainerRequestsRouter.get("/:requestId", async (req, res, next) => {
  try {
    const requestId = cleanString(req.params.requestId, 160);
    const result = await query(
      `
        SELECT request_id,
               status,
               email,
               name,
               phone,
               source,
               profile_snapshot,
               program_params,
               payload,
               confirmation_message,
               submitted_at,
               created_at,
               updated_at
        FROM trainer_requests
        WHERE request_id = $1
      `,
      [requestId]
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const row = result.rows[0];
    const profile = profileFromRow(row);
    res.json({
      ok: true,
      requestId: row.request_id,
      status: row.status,
      requestUrl: publicRequestUrl(row.request_id),
      email: row.email || null,
      profile,
      request: {
        id: row.request_id,
        status: row.status,
        email: row.email || null,
        profile,
        programParams: safeObject(row.program_params),
        source: row.source || null
      },
      message: row.confirmation_message || CONFIRMATION_MESSAGE,
      submittedAt: row.submitted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch (error) {
    next(error);
  }
});

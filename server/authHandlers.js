import express from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import cookie from "cookie";
import { getNutritionDb } from "./nutritionDb.js";
import { findOrCreateUserByProvider, getUserById } from "./authDb.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "fallback_dev_jwt_secret_12345";
const JWT_EXPIRES_IN = "30d";

function signUserToken(user) {
  return jwt.sign({ id: user.id, name: user.name, username: user.username, email: user.email, photo_url: user.photo_url }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

function setAuthCookie(res, token) {
  const domain = process.env.COOKIE_DOMAIN || undefined;
  res.setHeader(
    "Set-Cookie",
    cookie.serialize("fruitfit_token", token, {
      httpOnly: false, // allowing client to read if needed, or better keep httpOnly: false since PWA uses it?
      // Wait, if frontend is on a different domain during dev, it needs cross-site.
      // But we will pass it back via URL hash to be absolutely safe for PWA cross-domain redirects.
      domain,
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
      secure: true,
      sameSite: "lax",
    })
  );
}

function checkTelegramLoginSignature(botToken, data) {
  if (!data || !data.hash) return false;
  const { hash, ...params } = data;
  const dataCheckString = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('\n');
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return calculatedHash === hash;
}

router.post("/telegram", (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return res.status(500).json({ error: "TELEGRAM_BOT_TOKEN not configured" });

  const isValid = checkTelegramLoginSignature(botToken, req.body);
  if (!isValid) return res.status(401).json({ error: "Invalid Telegram signature" });

  const authDate = Number(req.body.auth_date);
  if (Date.now() / 1000 - authDate > 86400) {
    return res.status(401).json({ error: "Telegram auth expired" });
  }

  const profile = {
    username: req.body.username ? `@${req.body.username}` : null,
    name: [req.body.first_name, req.body.last_name].filter(Boolean).join(" "),
    photo_url: req.body.photo_url || null,
  };

  const db = getNutritionDb();
  const user = findOrCreateUserByProvider(db, "telegram", req.body.id, profile);
  const token = signUserToken(user);
  
  setAuthCookie(res, token);
  res.json({ token, user });
});

router.get("/yandex", (req, res) => {
  const clientId = process.env.YANDEX_CLIENT_ID;
  const redirectUri = process.env.YANDEX_REDIRECT_URI || "https://fruitfit.pages.dev/api/auth/yandex/callback";
  if (!clientId) return res.status(500).json({ error: "YANDEX_CLIENT_ID not configured" });

  const authUrl = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(authUrl);
});

router.get("/yandex/callback", async (req, res) => {
  const { code } = req.query;
  const clientId = process.env.YANDEX_CLIENT_ID;
  const clientSecret = process.env.YANDEX_CLIENT_SECRET;
  const redirectUri = process.env.YANDEX_REDIRECT_URI || "https://fruitfit.pages.dev/api/auth/yandex/callback";

  if (!code) return res.status(400).json({ error: "No code provided" });
  if (!clientId || !clientSecret) return res.status(500).json({ error: "Yandex credentials not configured" });

  try {
    const tokenRes = await fetch("https://oauth.yandex.ru/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) return res.status(tokenRes.status).json({ error: "Yandex token exchange failed", details: tokenData });

    const profileRes = await fetch("https://login.yandex.ru/info?format=json", {
      headers: { Authorization: `OAuth ${tokenData.access_token}` },
    });
    const profileData = await profileRes.json();
    if (!profileRes.ok) return res.status(profileRes.status).json({ error: "Yandex profile failed", details: profileData });

    const profile = {
      username: profileData.login,
      name: profileData.real_name || profileData.display_name,
      email: profileData.default_email,
      photo_url: profileData.is_avatar_empty ? null : `https://avatars.yandex.net/get-yapic/${profileData.default_avatar_id}/islands-200`,
    };

    const db = getNutritionDb();
    const user = findOrCreateUserByProvider(db, "yandex", profileData.id, profile);
    const token = signUserToken(user);

    setAuthCookie(res, token);
    const appBaseUrl = process.env.APP_BASE_URL || "https://fruitfit.pages.dev";
    res.redirect(`${appBaseUrl}/#auth_token=${token}`);
  } catch (error) {
    console.error("[FruitFit Auth] Yandex callback error", error);
    res.status(500).json({ error: "Yandex callback processing failed" });
  }
});

router.get("/me", (req, res) => {
  const authHeader = req.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else {
    // try reading from cookies if we used them
    const cookies = cookie.parse(req.headers.cookie || "");
    token = cookies.fruitfit_token;
  }

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ user: decoded });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

export default router;

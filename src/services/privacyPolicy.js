import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { APP_STORE_REVIEW } from "../config/appStoreReview";
import { PRIVACY_POLICY_TEXT, PRIVACY_POLICY_URL } from "../data/privacyPolicyText";

export function normalizePrivacyPolicyText(value = "") {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function policyTextFromHtml(html = "") {
  if (typeof DOMParser === "undefined") return "";
  const document = new DOMParser().parseFromString(String(html || ""), "text/html");
  const content = document.querySelector("[field='text']") || document.querySelector(".t-text") || document.body;
  return normalizePrivacyPolicyText(content?.innerText || "");
}

function ensurePolicyText(value) {
  const text = policyTextFromHtml(value) || normalizePrivacyPolicyText(value);
  if (text.length < 400) throw new Error("privacy-policy-empty");
  return text;
}

export async function loadPrivacyPolicyText() {
  if (APP_STORE_REVIEW) return PRIVACY_POLICY_TEXT;

  if (Capacitor?.isNativePlatform?.()) {
    const response = await CapacitorHttp.get({
      url: PRIVACY_POLICY_URL,
      responseType: "text",
      headers: { Accept: "text/html,text/plain" },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error("privacy-policy-request-failed");
    }
    return ensurePolicyText(response.data);
  }

  const response = await fetch(PRIVACY_POLICY_URL, {
    cache: "no-store",
    credentials: "omit",
    mode: "cors",
  });
  if (!response.ok) throw new Error("privacy-policy-request-failed");
  return ensurePolicyText(await response.text());
}

export async function loadPrivacyPolicyTextWithFallback() {
  try {
    return await loadPrivacyPolicyText();
  } catch (_) {
    return PRIVACY_POLICY_TEXT;
  }
}

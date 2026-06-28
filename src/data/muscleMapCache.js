import { useEffect, useMemo, useState } from "react";

const CACHE_NAME = "fruitfit-muscle-maps-v1";
const CACHE_PREFIX = "/__fruitfit_muscle_map_cache__/";

function isBrowser() {
  return typeof window !== "undefined";
}

function isRemoteImageUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function fallbackHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

async function digestText(value) {
  const text = String(value || "");
  try {
    if (globalThis.crypto?.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
    }
  } catch (_) {
    // Fallback below is enough for a local cache key.
  }
  return fallbackHash(text);
}

async function cacheRequestFor(imageUrl, version) {
  const key = await digestText(`${imageUrl}|${version || imageUrl}`);
  const cacheUrl = isBrowser()
    ? new URL(`${CACHE_PREFIX}${key}`, window.location.origin).toString()
    : `${CACHE_PREFIX}${key}`;
  return new Request(cacheUrl);
}

async function responseToObjectUrl(response) {
  const blob = await response.blob();
  if (!blob || blob.size <= 0) return "";
  return URL.createObjectURL(blob);
}

export function muscleMapCacheVersion(assigned = {}) {
  return String(
    assigned.cacheKey
      || assigned.version
      || assigned.hash
      || assigned.updatedAt
      || assigned.imageSrc
      || "",
  );
}

export async function resolveCachedMuscleMapImage(imageUrl, version) {
  if (!isBrowser() || !isRemoteImageUrl(imageUrl) || !("caches" in window) || !URL.createObjectURL) {
    return { src: imageUrl, fromCache: false, fallback: true };
  }

  const cache = await caches.open(CACHE_NAME);
  const cacheRequest = await cacheRequestFor(imageUrl, version);
  const cached = await cache.match(cacheRequest);
  if (cached) {
    const objectUrl = await responseToObjectUrl(cached);
    if (objectUrl) return { src: objectUrl, fromCache: true, fallback: false };
  }

  const response = await fetch(imageUrl, { cache: "no-store", credentials: "omit", mode: "cors" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const blob = await response.blob();
  if (!blob || blob.size <= 0) throw new Error("Empty image response");

  const contentType = response.headers.get("content-type") || blob.type || "image/*";
  await cache.put(cacheRequest, new Response(blob, {
    headers: {
      "Content-Type": contentType,
      "X-FruitFit-Source": imageUrl,
      "X-FruitFit-Version": String(version || imageUrl),
      "X-FruitFit-Saved-At": new Date().toISOString(),
    },
  }));

  return { src: URL.createObjectURL(blob), fromCache: false, fallback: false };
}

export function useCachedMuscleMapImage(assigned = {}) {
  const imageSrc = String(assigned?.imageSrc || "");
  const cacheVersion = useMemo(() => muscleMapCacheVersion(assigned), [assigned]);
  const shouldCache = Boolean(assigned?.serverOverride && isRemoteImageUrl(imageSrc));
  const [resolvedSrc, setResolvedSrc] = useState(() => (shouldCache ? "" : imageSrc));

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    if (!imageSrc) {
      setResolvedSrc("");
      return undefined;
    }

    if (!shouldCache) {
      setResolvedSrc(imageSrc);
      return undefined;
    }

    setResolvedSrc("");
    resolveCachedMuscleMapImage(imageSrc, cacheVersion)
      .then((result) => {
        if (cancelled) {
          if (result.src?.startsWith("blob:")) URL.revokeObjectURL(result.src);
          return;
        }
        objectUrl = result.src?.startsWith("blob:") ? result.src : "";
        setResolvedSrc(result.src || imageSrc);
      })
      .catch(() => {
        if (!cancelled) setResolvedSrc(imageSrc);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cacheVersion, imageSrc, shouldCache]);

  return resolvedSrc;
}

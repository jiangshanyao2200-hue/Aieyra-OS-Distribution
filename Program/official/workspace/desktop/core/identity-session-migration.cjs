"use strict";

const { cookieDomain: configuredCookieDomain } = require("../../shared/config/official-service.json");

const AIEYRA_COOKIE_DOMAIN = String(configuredCookieDomain || "").trim().replace(/^\.+/, "").toLowerCase();
if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(AIEYRA_COOKIE_DOMAIN)) {
  throw new Error("Official service cookieDomain is invalid.");
}
const ALLOWED_SAME_SITE = new Set(["unspecified", "no_restriction", "lax", "strict"]);

function normalizedCookieDomain(value) {
  return String(value || "").trim().replace(/^\.+/, "").toLowerCase();
}

function isAieyraCookie(cookie) {
  const domain = normalizedCookieDomain(cookie?.domain);
  return domain === AIEYRA_COOKIE_DOMAIN || domain.endsWith(`.${AIEYRA_COOKIE_DOMAIN}`);
}

function normalizedCookiePath(value) {
  const path = String(value || "/").trim();
  return path.startsWith("/") && !/[\u0000-\u001f\u007f]/.test(path) ? path : "/";
}

function cookieUrl(cookie) {
  const domain = normalizedCookieDomain(cookie?.domain);
  if (!domain || !isAieyraCookie(cookie)) throw new Error("AIEYRA_COOKIE_DOMAIN_INVALID");
  return new URL(normalizedCookiePath(cookie?.path), `https://${domain}`).toString();
}

function cookieKey(cookie) {
  return `${normalizedCookieDomain(cookie?.domain)}\u0000${normalizedCookiePath(cookie?.path)}\u0000${String(cookie?.name || "")}`;
}

function portableCookieDetails(cookie) {
  const name = String(cookie?.name || "");
  const value = String(cookie?.value || "");
  if (!name || /[\u0000-\u001f\u007f;]/.test(name)) throw new Error("AIEYRA_COOKIE_NAME_INVALID");
  const details = {
    url: cookieUrl(cookie),
    name,
    value,
    path: normalizedCookiePath(cookie?.path),
    secure: Boolean(cookie?.secure),
    httpOnly: Boolean(cookie?.httpOnly)
  };
  if (!cookie?.hostOnly && String(cookie?.domain || "").trim()) details.domain = String(cookie.domain).trim().toLowerCase();
  const expirationDate = Number(cookie?.expirationDate);
  if (Number.isFinite(expirationDate) && expirationDate > 0) details.expirationDate = expirationDate;
  const sameSite = String(cookie?.sameSite || "").trim().toLowerCase();
  if (ALLOWED_SAME_SITE.has(sameSite)) details.sameSite = sameSite;
  return details;
}

function migrationErrorCategory(error) {
  const code = String(error?.code || "").trim();
  if (code && /^[A-Z0-9_]{1,80}$/.test(code)) return code;
  return error instanceof Error ? error.name || "Error" : "UnknownError";
}

async function scopedCookies(cookieStore) {
  const cookies = await cookieStore.get({});
  return (Array.isArray(cookies) ? cookies : []).filter(isAieyraCookie);
}

async function migrateAieyraAccountOrigin({ currentSession, sourceOrigins = [], targetOrigin } = {}) {
  const target = new URL(targetOrigin);
  if (target.protocol !== "https:" || target.origin !== targetOrigin || !isAieyraCookie({ domain: target.hostname })) {
    throw new Error("AIEYRA_COOKIE_DOMAIN_INVALID");
  }
  const cookies = currentSession.cookies;
  if ((await cookies.get({ url: `${target.origin}/`, name: "session" })).length) return { migrated: false, status: "target-nonempty" };
  for (const origin of sourceOrigins) {
    const source = new URL(origin);
    if (source.origin === target.origin || source.protocol !== "https:" || !isAieyraCookie({ domain: source.hostname })) continue;
    const candidates = await cookies.get({ url: `${source.origin}/`, name: "session" });
    const cookie = candidates.find(item => normalizedCookieDomain(item.domain) === source.hostname && item.hostOnly &&
      item.secure && item.httpOnly && item.path === "/" && (!item.expirationDate || item.expirationDate > Date.now() / 1000));
    if (!cookie) continue;
    // Only the named account service's host-only session is moved. Never
    // broaden cookie scope to the parent domain or replace a newer login.
    const details = { ...portableCookieDetails(cookie), url: `${target.origin}/` };
    delete details.domain;
    try {
      await cookies.set(details);
      await cookies.flushStore?.();
    } catch (error) {
      await cookies.remove(`${target.origin}/`, "session").catch(() => {});
      throw error;
    }
    return { migrated: true, status: "account-origin-migrated" };
  }
  return { migrated: false, status: "no-legacy-session" };
}

async function migrateLegacyAieyraCookies(options = {}) {
  const currentSession = options.currentSession;
  const legacySessions = Array.isArray(options.legacySessions) ? options.legacySessions : [];
  const log = typeof options.log === "function" ? options.log : () => {};
  const onFailure = typeof options.onFailure === "function" ? options.onFailure : () => {};
  if (options.externalSessionPath) {
    return { ok: true, migrated: false, status: "external-session-path", candidateCount: 0, migratedCount: 0 };
  }
  if (!currentSession?.cookies || typeof currentSession.cookies.get !== "function") {
    throw new TypeError("Current Electron session cookie store is unavailable.");
  }
  const existing = await scopedCookies(currentSession.cookies);
  if (existing.length) {
    return { ok: true, migrated: false, status: "target-nonempty", candidateCount: 0, migratedCount: 0 };
  }

  const candidates = new Map();
  const sourcePartitions = [];
  for (const item of legacySessions) {
    if (!item?.session?.cookies || typeof item.session.cookies.get !== "function") continue;
    const sourceCookies = await scopedCookies(item.session.cookies);
    if (sourceCookies.length) sourcePartitions.push(String(item.partition || "legacy"));
    for (const cookie of sourceCookies) {
      const key = cookieKey(cookie);
      if (!candidates.has(key)) candidates.set(key, cookie);
    }
  }
  if (!candidates.size) {
    return { ok: true, migrated: false, status: "no-legacy-cookie", candidateCount: 0, migratedCount: 0 };
  }

  const written = [];
  try {
    for (const cookie of candidates.values()) {
      const details = portableCookieDetails(cookie);
      await currentSession.cookies.set(details);
      written.push({ url: details.url, name: details.name, key: cookieKey(cookie), value: details.value });
    }
    if (typeof currentSession.cookies.flushStore === "function") await currentSession.cookies.flushStore();
    const verified = new Map((await scopedCookies(currentSession.cookies)).map((cookie) => [cookieKey(cookie), String(cookie.value || "")]));
    if (written.some((item) => verified.get(item.key) !== item.value)) {
      const error = new Error("Aieyra cookie migration verification failed.");
      error.code = "AIEYRA_COOKIE_MIGRATION_VERIFY_FAILED";
      throw error;
    }
    const result = {
      ok: true,
      migrated: true,
      status: "migrated",
      candidateCount: candidates.size,
      migratedCount: written.length,
      sourcePartitions
    };
    log({ ...result, sourcePartitions: [...sourcePartitions] });
    return result;
  } catch (error) {
    let rollbackFailureCount = 0;
    for (const item of written.reverse()) {
      try {
        await currentSession.cookies.remove(item.url, item.name);
      } catch {
        rollbackFailureCount += 1;
      }
    }
    try {
      if (typeof currentSession.cookies.flushStore === "function") await currentSession.cookies.flushStore();
    } catch {
      rollbackFailureCount += 1;
    }
    const result = {
      ok: false,
      migrated: false,
      status: "relogin-required",
      fallback: "relogin",
      candidateCount: candidates.size,
      migratedCount: 0,
      rollbackFailureCount,
      errorCategory: migrationErrorCategory(error),
      sourcePartitions
    };
    await onFailure(result);
    log({ ...result, sourcePartitions: [...sourcePartitions] });
    return result;
  }
}

module.exports = {
  AIEYRA_COOKIE_DOMAIN,
  cookieKey,
  isAieyraCookie,
  migrateLegacyAieyraCookies,
  migrateAieyraAccountOrigin,
  normalizedCookieDomain,
  portableCookieDetails
};

const crypto = require("crypto");

const RESERVED_CODES = new Set([
  "admin",
  "api",
  "auth",
  "dashboard",
  "health",
  "history",
  "links",
  "shorten",
]);

function normalizeUrl(input) {
  if (!input || typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    return parsed.toString();
  } catch (error) {
    return null;
  }
}

function normalizeTitle(input) {
  const title = String(input || "").trim();
  return title ? title.slice(0, 120) : null;
}

function normalizeName(input) {
  const name = String(input || "").trim();
  return name ? name.slice(0, 80) : null;
}

function normalizeStatus(input) {
  const allowed = new Set(["all", "active", "inactive", "expired"]);
  return allowed.has(input) ? input : "all";
}

function normalizeQrConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const safeConfig = {
    dotsColor: typeof input.dotsColor === "string" ? input.dotsColor : null,
    backgroundColor:
      typeof input.backgroundColor === "string" ? input.backgroundColor : null,
    dotsType: typeof input.dotsType === "string" ? input.dotsType : null,
    cornersType:
      typeof input.cornersType === "string" ? input.cornersType : null,
    gradient: Boolean(input.gradient),
    gradientColor2:
      typeof input.gradientColor2 === "string" ? input.gradientColor2 : null,
  };

  return Object.fromEntries(
    Object.entries(safeConfig).filter(([, value]) => value !== null),
  );
}

function normalizeCustomSlug(input) {
  const value = String(input || "").trim();

  if (!value) {
    return null;
  }

  if (!/^[a-zA-Z0-9_-]{4,32}$/.test(value)) {
    return {
      error: "Custom slug must be 4-32 chars using letters, numbers, - or _",
    };
  }

  if (RESERVED_CODES.has(value.toLowerCase())) {
    return { error: "Custom slug is reserved" };
  }

  return { value };
}

function normalizeExpiry(input) {
  if (!input) {
    return null;
  }

  const value = new Date(input);

  if (Number.isNaN(value.getTime())) {
    return { error: "Invalid expiry date" };
  }

  if (value <= new Date()) {
    return { error: "Expiry date must be in the future" };
  }

  return { value };
}

function normalizeProvider(input) {
  return input === "internal" ? "internal" : "shortio";
}

function normalizeDeleteMode(input, provider) {
  if (provider !== "shortio") {
    return "internal";
  }

  return input === "internal" ? "internal" : "provider";
}

function getEffectiveProvider(user, input) {
  if (!user || user.role !== "admin") {
    return "shortio";
  }

  return normalizeProvider(input);
}

function getBaseUrl(req) {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, "");
  }

  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  return `${protocol}://${req.get("host")}`;
}

function generateShortCode(length = 7) {
  return crypto
    .randomBytes(Math.ceil((length * 3) / 4))
    .toString("base64url")
    .slice(0, length);
}

function hashIpAddress(ip) {
  return crypto
    .createHash("sha256")
    .update(`${process.env.APP_SECRET || "qr-shortener"}:${ip || "unknown"}`)
    .digest("hex");
}

function isLinkExpired(link, now = new Date()) {
  return Boolean(link?.expiresAt && new Date(link.expiresAt) <= now);
}

function extractShortCodeFromShortUrl(shortUrl) {
  if (!shortUrl) {
    return null;
  }

  try {
    return new URL(shortUrl).pathname.split("/").filter(Boolean).at(-1) || null;
  } catch (error) {
    const fallback = String(shortUrl)
      .split("?")[0]
      .split("#")[0]
      .replace(/\/+$/, "");

    return fallback.split("/").filter(Boolean).at(-1) || null;
  }
}

module.exports = {
  DEFAULT_PAGE_SIZE: 20,
  RESERVED_CODES,
  extractShortCodeFromShortUrl,
  generateShortCode,
  getBaseUrl,
  getEffectiveProvider,
  hashIpAddress,
  isLinkExpired,
  normalizeCustomSlug,
  normalizeDeleteMode,
  normalizeExpiry,
  normalizeName,
  normalizeProvider,
  normalizeQrConfig,
  normalizeStatus,
  normalizeTitle,
  normalizeUrl,
};

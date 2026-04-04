require("dotenv").config();

const crypto = require("crypto");
const axios = require("axios");
const cors = require("cors");
const express = require("express");
const {
  createSessionToken,
  getSessionExpiryDate,
  hashPassword,
  hashToken,
  normalizeEmail,
  normalizeRole,
  validatePassword,
  verifyPassword,
} = require("./auth");
const {
  countUsers,
  createLink,
  createSession,
  createUser,
  deleteLink,
  deleteSession,
  ensureSchema,
  findSessionByTokenHash,
  findUserByEmail,
  getClickSeries,
  getDashboardSummary,
  getLinkById,
  getShortIoTrafficInsights,
  getTopLinks,
  listShortIoLinksForSync,
  listAuditLogs,
  listLinks,
  listRedirectLinksByCode,
  listUsers,
  logAudit,
  markShortIoLinkSyncStatus,
  recordClick,
  upsertShortIoAnalyticsSnapshot,
  updateShortIoClickCounts,
  upsertImportedShortIoLink,
  updateLink,
} = require("./db");
const { createRateLimiter } = require("./rateLimit");
const {
  buildShortIoReconcileReport,
  buildShortIoSyncHealth,
} = require("./shortioSyncUtils");

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const DEFAULT_PAGE_SIZE = 20;
const SESSION_COOKIE_NAME = "qr_session";
const SHORT_IO_CLICK_SYNC_TTL_MS = Math.max(
  Number(process.env.SHORT_IO_CLICK_SYNC_TTL_MS) || 60_000,
  0,
);
const SHORT_IO_CLICK_SYNC_CHUNK_SIZE = 150;
const SHORT_IO_ANALYTICS_SYNC_TTL_MS = Math.max(
  Number(process.env.SHORT_IO_ANALYTICS_SYNC_TTL_MS) || 15 * 60_000,
  0,
);
const SHORT_IO_ANALYTICS_PERIOD_KEY =
  process.env.SHORT_IO_ANALYTICS_PERIOD || "last30";
const SHORT_IO_STATS_TZ_OFFSET = String(
  Number(process.env.SHORT_IO_STATS_TZ_OFFSET_MINUTES) || 420,
);
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
let resolvedShortIoDomainId = process.env.SHORT_IO_DOMAIN_ID || null;
const shortIoClickRefreshState = new Map();
const shortIoAnalyticsRefreshState = new Map();

function getRequestIdentity(req) {
  return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip || "unknown"}`;
}

function getCookieValue(req, name) {
  const cookieHeader = String(req.headers.cookie || "");

  for (const item of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = item.trim().split("=");

    if (rawName !== name) {
      continue;
    }

    return decodeURIComponent(rawValue.join("="));
  }

  return null;
}

function shouldUseSecureCookies(req) {
  if (process.env.COOKIE_SECURE === "true") {
    return true;
  }

  if (process.env.COOKIE_SECURE === "false") {
    return false;
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")
    .at(0)
    ?.trim();

  return forwardedProto === "https" || req.secure === true;
}

function getSessionCookieOptions(req) {
  const secure = shouldUseSecureCookies(req);
  return {
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure: secure,
    path: "/",
  };
}

function setSessionCookie(req, res, token, expiresAt) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    ...getSessionCookieOptions(req),
    expires: expiresAt,
  });
}

function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions(req));
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow relative requests, localhost, and Vercel domains
      if (!origin || origin.includes("localhost") || origin.includes("vercel.app") || origin.includes("pmkitera")) {
        callback(null, true);
      } else {
        callback(null, true); // Still liberal for easy deployment, but better to fix
      }
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.set("trust proxy", 1);

// Added for Vercel unified deployment: strip /api prefix so routes work
app.use((req, res, next) => {
  if (req.url.startsWith("/api")) {
    req.url = req.url.replace("/api", "");
  }
  next();
});

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many authentication attempts",
  prefix: "auth",
  keyFn: (req) => {
    const email = normalizeEmail(req.body?.email);
    return email
      ? `ip:${req.ip || "unknown"}:email:${email}`
      : `ip:${req.ip || "unknown"}`;
  },
});

const writeLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many write requests",
  prefix: "write",
  keyFn: (req) => getRequestIdentity(req),
});

function getShortIoHeaders() {
  return {
    authorization: process.env.SHORT_IO_API_KEY,
    accept: "application/json",
    "content-type": "application/json",
  };
}

function getRequiredShortIoConfig() {
  if (!process.env.SHORT_IO_API_KEY || !process.env.SHORT_IO_DOMAIN) {
    throw new Error("Short.io is not configured");
  }

  return {
    apiKey: process.env.SHORT_IO_API_KEY,
    domain: process.env.SHORT_IO_DOMAIN,
    domainId: process.env.SHORT_IO_DOMAIN_ID || null,
  };
}

function normalizeProvider(input) {
  return input === "internal" ? "internal" : "shortio";
}

function getEffectiveProvider(user, input) {
  if (!user || user.role !== "admin") {
    return "shortio";
  }

  return normalizeProvider(input);
}

async function resolveShortIoDomainId() {
  const config = getRequiredShortIoConfig();

  if (resolvedShortIoDomainId) {
    return resolvedShortIoDomainId;
  }

  if (config.domainId) {
    resolvedShortIoDomainId = config.domainId;
    return resolvedShortIoDomainId;
  }

  const { data } = await axios.get("https://api.short.io/api/domains", {
    headers: getShortIoHeaders(),
  });

  const domains = Array.isArray(data) ? data : data?.domains || [];
  const normalizedDomain = String(config.domain || "").toLowerCase();
  const match = domains.find((item) => {
    const hostname = String(
      item?.hostname || item?.domain || item?.name || "",
    ).toLowerCase();
    return hostname === normalizedDomain;
  });

  if (!match?.id) {
    throw new Error(
      "Configured SHORT_IO_DOMAIN was not found. Set SHORT_IO_DOMAIN_ID or verify SHORT_IO_DOMAIN.",
    );
  }

  resolvedShortIoDomainId = match.id;
  return resolvedShortIoDomainId;
}

function chunkArray(items, chunkSize) {
  const safeChunkSize = Math.max(Number(chunkSize) || 1, 1);
  const chunks = [];

  for (let index = 0; index < items.length; index += safeChunkSize) {
    chunks.push(items.slice(index, index + safeChunkSize));
  }

  return chunks;
}

function normalizeShortIoClickCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

async function fetchShortIoClickCountsByLinkIds(providerLinkIds, domainId) {
  const uniqueProviderLinkIds = [...new Set(
    providerLinkIds
      .map((providerLinkId) => String(providerLinkId || "").trim())
      .filter(Boolean),
  )];

  if (uniqueProviderLinkIds.length === 0) {
    return {};
  }

  const resolvedDomainId = domainId || (await resolveShortIoDomainId());
  const clicksByProviderLinkId = {};

  for (const idsChunk of chunkArray(
    uniqueProviderLinkIds,
    SHORT_IO_CLICK_SYNC_CHUNK_SIZE,
  )) {
    const { data } = await axios.get(
      `https://statistics.short.io/statistics/domain/${resolvedDomainId}/link_clicks`,
      {
        headers: getShortIoHeaders(),
        params: {
          ids: idsChunk.join(","),
        },
        timeout: 10000,
      },
    );

    const clickMap =
      data && typeof data === "object" && !Array.isArray(data) ? data : {};

    for (const providerLinkId of idsChunk) {
      if (
        Object.prototype.hasOwnProperty.call(clickMap, providerLinkId)
      ) {
        clicksByProviderLinkId[providerLinkId] = normalizeShortIoClickCount(
          clickMap[providerLinkId],
        );
      }
    }
  }

  return clicksByProviderLinkId;
}

function normalizeShortIoAnalyticsDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function mapShortIoBreakdownItems(dimension, items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      if (dimension === "country") {
        return {
          valueKey: String(item.country || item.countryName || "").trim(),
          valueLabel: String(item.countryName || item.country || "").trim(),
          clicks: normalizeShortIoClickCount(item.score),
        };
      }

      if (dimension === "city") {
        return {
          valueKey: String(item.city || item.name || "").trim(),
          valueLabel: String(item.name || item.city || "").trim(),
          clicks: normalizeShortIoClickCount(item.score),
        };
      }

      const rawValue = item[dimension];
      return {
        valueKey: String(rawValue || "direct").trim() || "direct",
        valueLabel: String(rawValue || "Direct").trim() || "Direct",
        clicks: normalizeShortIoClickCount(item.score),
      };
    })
    .filter((item) => item?.valueKey);
}

function extractShortIoDailyStats(statsPayload) {
  const datasets = statsPayload?.clickStatistics?.datasets;
  const series = Array.isArray(datasets) ? datasets[0]?.data : [];

  if (!Array.isArray(series)) {
    return [];
  }

  return series
    .map((point) => {
      const statDate = normalizeShortIoAnalyticsDate(point?.x);

      if (!statDate) {
        return null;
      }

      const humanClicks = normalizeShortIoClickCount(point?.y);
      return {
        statDate,
        humanClicks,
        totalClicks: humanClicks,
      };
    })
    .filter(Boolean);
}

function extractShortIoBreakdowns(statsPayload) {
  const dimensions = [
    "country",
    "browser",
    "os",
    "city",
    "referer",
    "social",
    "device",
    "utm_source",
    "utm_medium",
    "utm_campaign",
  ];

  return dimensions.reduce((accumulator, dimension) => {
    accumulator[dimension] = mapShortIoBreakdownItems(
      dimension,
      statsPayload?.[dimension],
    );
    return accumulator;
  }, {});
}

async function fetchShortIoLinkStatistics(providerLinkId) {
  const { data } = await axios.get(
    `https://statistics.short.io/statistics/link/${providerLinkId}`,
    {
      headers: getShortIoHeaders(),
      params: {
        period: SHORT_IO_ANALYTICS_PERIOD_KEY,
        tzOffset: SHORT_IO_STATS_TZ_OFFSET,
      },
      timeout: 15000,
    },
  );

  return {
    totalClicks: normalizeShortIoClickCount(data?.totalClicks),
    humanClicks: normalizeShortIoClickCount(
      data?.humanClicks ?? data?.totalClicks,
    ),
    dailyStats: extractShortIoDailyStats(data),
    breakdowns: extractShortIoBreakdowns(data),
    raw: data,
  };
}

function getShortIoClickRefreshScope({ user, ownerId = null }) {
  const normalizedOwnerId = ownerId ? Number(ownerId) || null : null;

  if (user?.role === "admin") {
    return `admin:${normalizedOwnerId || "all"}`;
  }

  return `user:${user?.id || "anonymous"}`;
}

function markShortIoClickRefreshComplete({ user, ownerId = null }) {
  const scope = getShortIoClickRefreshScope({ user, ownerId });
  shortIoClickRefreshState.set(scope, {
    lastFinishedAt: Date.now(),
  });
}

async function maybeRefreshShortIoClicks({ user, ownerId = null, force = false }) {
  if (
    !process.env.DATABASE_URL ||
    !process.env.SHORT_IO_API_KEY ||
    !process.env.SHORT_IO_DOMAIN ||
    !user
  ) {
    return { total: 0, updated: 0, skipped: true };
  }

  const scope = getShortIoClickRefreshScope({ user, ownerId });
  const existingState = shortIoClickRefreshState.get(scope);
  const now = Date.now();

  if (!force && existingState?.promise) {
    return existingState.promise;
  }

  if (
    !force &&
    existingState?.lastFinishedAt &&
    now - existingState.lastFinishedAt < SHORT_IO_CLICK_SYNC_TTL_MS
  ) {
    return { total: 0, updated: 0, skipped: true };
  }

  const refreshPromise = (async () => {
    const shortIoLinks = await listShortIoLinksForSync({
      userId: user.id,
      isAdmin: user.role === "admin",
      ownerId,
    });

    if (shortIoLinks.length === 0) {
      return { total: 0, updated: 0, skipped: false };
    }

    const clicksByProviderLinkId = await fetchShortIoClickCountsByLinkIds(
      shortIoLinks.map((link) => link.providerLinkId),
    );
    const providerMetrics = {};

    for (const link of shortIoLinks) {
      const providerLinkId = String(link.providerLinkId || "").trim();

      if (
        !providerLinkId ||
        !Object.prototype.hasOwnProperty.call(
          clicksByProviderLinkId,
          providerLinkId,
        )
      ) {
        continue;
      }

      const latestClickCount = clicksByProviderLinkId[providerLinkId];
      providerMetrics[providerLinkId] = {
        clickCount: latestClickCount,
        totalClicks: latestClickCount,
        humanClicks: latestClickCount,
      };
    }

    const updated = await updateShortIoClickCounts(providerMetrics);
    return {
      total: shortIoLinks.length,
      updated,
      skipped: false,
    };
  })();

  shortIoClickRefreshState.set(scope, {
    promise: refreshPromise,
  });

  try {
    const result = await refreshPromise;
    markShortIoClickRefreshComplete({ user, ownerId });
    return result;
  } catch (error) {
    shortIoClickRefreshState.delete(scope);
    throw error;
  }
}

async function safeMaybeRefreshShortIoClicks(options) {
  try {
    return await maybeRefreshShortIoClicks(options);
  } catch (error) {
    console.error("Short.io click refresh failed:", error.message);
    return { total: 0, updated: 0, skipped: true, error: error.message };
  }
}

function getShortIoAnalyticsRefreshScope({ user, ownerId = null }) {
  return getShortIoClickRefreshScope({ user, ownerId });
}

function markShortIoAnalyticsRefreshComplete({ user, ownerId = null }) {
  const scope = getShortIoAnalyticsRefreshScope({ user, ownerId });
  shortIoAnalyticsRefreshState.set(scope, {
    lastFinishedAt: Date.now(),
  });
}

async function maybeRefreshShortIoAnalytics({
  user,
  ownerId = null,
  force = false,
}) {
  if (
    !process.env.DATABASE_URL ||
    !process.env.SHORT_IO_API_KEY ||
    !process.env.SHORT_IO_DOMAIN ||
    !user
  ) {
    return { total: 0, updated: 0, failed: 0, skipped: true };
  }

  const scope = getShortIoAnalyticsRefreshScope({ user, ownerId });
  const existingState = shortIoAnalyticsRefreshState.get(scope);
  const now = Date.now();

  if (!force && existingState?.promise) {
    return existingState.promise;
  }

  if (
    !force &&
    existingState?.lastFinishedAt &&
    now - existingState.lastFinishedAt < SHORT_IO_ANALYTICS_SYNC_TTL_MS
  ) {
    return { total: 0, updated: 0, failed: 0, skipped: true };
  }

  const refreshPromise = (async () => {
    const shortIoLinks = await listShortIoLinksForSync({
      userId: user.id,
      isAdmin: user.role === "admin",
      ownerId,
    });

    if (shortIoLinks.length === 0) {
      return { total: 0, updated: 0, failed: 0, skipped: false };
    }

    let updated = 0;
    let failed = 0;

    for (const linksBatch of chunkArray(shortIoLinks, 4)) {
      const batchResults = await Promise.allSettled(
        linksBatch.map(async (link) => {
          try {
            const stats = await fetchShortIoLinkStatistics(link.providerLinkId);
            await upsertShortIoAnalyticsSnapshot({
              linkId: link.id,
              humanClicks: stats.humanClicks,
              totalClicks: stats.totalClicks,
              dailyStats: stats.dailyStats,
              breakdowns: stats.breakdowns,
              periodKey: SHORT_IO_ANALYTICS_PERIOD_KEY,
              syncedAt: new Date(),
            });
          } catch (error) {
            await markShortIoLinkSyncStatus({
              linkId: link.id,
              providerLinkId: link.providerLinkId,
              syncStatus: "error",
              syncError: error.message,
              syncedAt: new Date(),
            });
            throw error;
          }
        }),
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          updated += 1;
        } else {
          failed += 1;
          console.error("Short.io analytics sync failed:", result.reason?.message);
        }
      }
    }

    return {
      total: shortIoLinks.length,
      updated,
      failed,
      skipped: false,
    };
  })();

  shortIoAnalyticsRefreshState.set(scope, {
    promise: refreshPromise,
  });

  try {
    const result = await refreshPromise;
    markShortIoAnalyticsRefreshComplete({ user, ownerId });
    return result;
  } catch (error) {
    shortIoAnalyticsRefreshState.delete(scope);
    throw error;
  }
}

async function safeMaybeRefreshShortIoAnalytics(options) {
  try {
    return await maybeRefreshShortIoAnalytics(options);
  } catch (error) {
    console.error("Short.io analytics refresh failed:", error.message);
    return { total: 0, updated: 0, failed: 0, skipped: true, error: error.message };
  }
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

function getImportedShortIoClickCount(link) {
  const rawCount =
    link?.clicksCount ??
    link?.clicks ??
    link?.statistics?.totalClicks ??
    link?.statistics?.clicks ??
    0;
  const parsed = Number(rawCount);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeImportedShortIoLink(link) {
  const shortUrl = link.shortURL || link.shortUrl || null;
  const shortCode =
    link.path || link.slug || extractShortCodeFromShortUrl(shortUrl);
  const createdAt = link.createdAt ? new Date(link.createdAt) : null;
  const expiresAt = link.expiredAt
    ? new Date(link.expiredAt)
    : link.expiresAt
      ? new Date(link.expiresAt)
      : null;

  return {
    providerLinkId: link.idString || link.id || null,
    title: normalizeTitle(link.title),
    originalUrl: normalizeUrl(link.originalURL || link.originalUrl),
    shortUrl,
    shortCode,
    customSlug: shortCode,
    isActive: !Boolean(link.archived),
    createdAt:
      createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
    expiresAt:
      expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
    ownerEmail: normalizeEmail(link.user?.email || link.owner?.email || ""),
    clickCount: getImportedShortIoClickCount(link),
  };
}

function normalizeDeleteMode(input, provider) {
  if (provider !== "shortio") {
    return "internal";
  }

  return input === "internal" ? "internal" : "provider";
}

async function fetchAllShortIoLinks() {
  const domainId = await resolveShortIoDomainId();
  const items = [];
  let before = null;

  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const { data } = await axios.get("https://api.short.io/api/links", {
      headers: getShortIoHeaders(),
      params: {
        domain_id: domainId,
        limit: 150,
        ...(before ? { before } : {}),
      },
      timeout: 15000,
    });

    const pageItems = Array.isArray(data) ? data : data?.links || [];
    if (pageItems.length === 0) {
      break;
    }

    for (const item of pageItems) {
      const normalized = normalizeImportedShortIoLink(item);

      if (
        !normalized.providerLinkId ||
        !normalized.originalUrl ||
        !normalized.shortUrl
      ) {
        continue;
      }

      items.push(normalized);
    }

    before = data?.nextPageToken || null;

    if (!before) {
      break;
    }
  }

  return {
    domainId,
    links: items,
  };
}

async function importShortIoLinksToDatabase(actor) {
  const { domainId, links: fetchedLinks } = await fetchAllShortIoLinks();
  const ownerCache = new Map();
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const total = fetchedLinks.length;
  let pageClickCounts = {};

  try {
    pageClickCounts = await fetchShortIoClickCountsByLinkIds(
      fetchedLinks.map((item) => item.providerLinkId),
      domainId,
    );
  } catch (error) {
    console.error("Failed to fetch Short.io click counts during import:", error.message);
  }

  for (const normalized of fetchedLinks) {
    try {
      let ownerId = actor.id;

      if (normalized.ownerEmail) {
        if (!ownerCache.has(normalized.ownerEmail)) {
          const matchedUser = await findUserByEmail(normalized.ownerEmail);
          ownerCache.set(normalized.ownerEmail, matchedUser?.id || null);
        }

        ownerId = ownerCache.get(normalized.ownerEmail) || actor.id;
      }

      const providerLinkId = String(normalized.providerLinkId);
      const liveClickCount = Object.prototype.hasOwnProperty.call(
        pageClickCounts,
        providerLinkId,
      )
        ? pageClickCounts[providerLinkId]
        : normalizeShortIoClickCount(normalized.clickCount);

      const result = await upsertImportedShortIoLink({
        userId: ownerId,
        title: normalized.title,
        originalUrl: normalized.originalUrl,
        shortUrl: normalized.shortUrl,
        shortCode: normalized.shortCode,
        providerLinkId: normalized.providerLinkId,
        customSlug: normalized.customSlug,
        isActive: normalized.isActive,
        expiresAt: normalized.expiresAt,
        createdAt: normalized.createdAt,
        clickCount: liveClickCount,
      });

      if (result.inserted) {
        imported += 1;
      } else {
        updated += 1;
      }
    } catch (error) {
      skipped += 1;
    }
  }

  return {
    total,
    imported,
    updated,
    skipped,
  };
}

async function getShortIoDiagnostics({ user, ownerId = null }) {
  const [{ links: providerLinks, domainId }, dbLinks] = await Promise.all([
    fetchAllShortIoLinks(),
    listShortIoLinksForSync({
      userId: user.id,
      isAdmin: user.role === "admin",
      ownerId,
    }),
  ]);

  const providerClicksById = await fetchShortIoClickCountsByLinkIds(
    providerLinks.map((link) => link.providerLinkId),
    domainId,
  );

  return {
    syncHealth: buildShortIoSyncHealth({
      links: dbLinks,
      staleAfterMs: SHORT_IO_ANALYTICS_SYNC_TTL_MS,
      now: new Date(),
    }),
    reconcile: buildShortIoReconcileReport({
      providerLinks,
      dbLinks,
      providerClicksById,
      staleAfterMs: SHORT_IO_ANALYTICS_SYNC_TTL_MS,
      now: new Date(),
    }),
  };
}

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

function extractBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

function extractCookieToken(req) {
  return getCookieValue(req, SESSION_COOKIE_NAME);
}

function sanitizeAuthUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

async function attachAuth(req, res, next) {
  const candidates = [
    { token: extractCookieToken(req), source: "cookie" },
    { token: extractBearerToken(req), source: "bearer" },
  ].filter((candidate) => candidate.token);

  if (candidates.length === 0) {
    req.authToken = null;
    req.user = null;
    return next();
  }

  for (const candidate of candidates) {
    const tokenHash = hashToken(candidate.token);
    const session = await findSessionByTokenHash(tokenHash);

    if (!session) {
      if (candidate.source === "cookie") {
        clearSessionCookie(req, res);
      }
      continue;
    }

    if (new Date(session.expiresAt) <= new Date()) {
      await deleteSession(tokenHash);

      if (candidate.source === "cookie") {
        clearSessionCookie(req, res);
      }
      continue;
    }

    req.authToken = candidate.token;
    req.user = session.user;
    return next();
  }

  req.authToken = null;
  req.user = null;
  return next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  return next();
}

async function createInternalShortLink({
  req,
  userId,
  normalizedUrl,
  title,
  customSlug,
  expiresAt,
  qrConfig,
  requestedProvider,
}) {
  if (!process.env.DATABASE_URL) {
    throw new Error("Internal shortener requires DATABASE_URL");
  }

  const baseUrl = getBaseUrl(req);
  const preferredSlug = customSlug || null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const shortCode = preferredSlug || generateShortCode();
    const shortURL = `${baseUrl}/${shortCode}`;
    const existingLinks = await listRedirectLinksByCode(shortCode);

    if (existingLinks.length > 0) {
      if (preferredSlug) {
        throw new Error("Custom slug is already in use");
      }

      continue;
    }

    try {
      const link = await createLink({
        userId,
        title,
        originalUrl: normalizedUrl,
        shortUrl: shortURL,
        shortCode,
        customSlug: preferredSlug,
        provider: "internal",
        requestedProvider,
        expiresAt,
        qrConfig,
      });

      return link;
    } catch (error) {
      if (error.code !== "23505") {
        throw error;
      }

      if (preferredSlug) {
        throw new Error("Custom slug is already in use");
      }
    }
  }

  throw new Error("Failed to generate a unique short code");
}

async function createShortIoLink({
  userId,
  normalizedUrl,
  title,
  customSlug,
  expiresAt,
  qrConfig,
  requestedProvider,
}) {
  if (!process.env.SHORT_IO_API_KEY || !process.env.SHORT_IO_DOMAIN) {
    throw new Error("Short.io is not configured");
  }

  if (customSlug) {
    const existingLinks = await listRedirectLinksByCode(customSlug);

    if (existingLinks.length > 0) {
      throw new Error("Custom slug is already in use");
    }
  }

  const payload = {
    originalURL: normalizedUrl,
    domain: process.env.SHORT_IO_DOMAIN,
  };

  if (customSlug) {
    payload.path = customSlug;
  }

  const response = await axios.post("https://api.short.io/links", payload, {
    headers: {
      authorization: process.env.SHORT_IO_API_KEY,
      "content-type": "application/json",
    },
  });

  const shortURL = response.data.shortURL || response.data.shortUrl;
  const shortCode = extractShortCodeFromShortUrl(shortURL);
  const providerLinkId = response.data.idString || response.data.id || null;

  return createLink({
    userId,
    title,
    originalUrl: normalizedUrl,
    shortUrl: shortURL,
    shortCode,
    providerLinkId,
    customSlug: shortCode,
    provider: "shortio",
    requestedProvider,
    expiresAt,
    qrConfig,
  });
}

async function deleteShortIoLink(providerLinkId) {
  if (!providerLinkId) {
    throw new Error("Short.io link id is required");
  }

  await axios.delete(`https://api.short.io/links/${providerLinkId}`, {
    headers: {
      authorization: process.env.SHORT_IO_API_KEY,
      accept: "application/json",
    },
    timeout: 15000,
  });
}

async function createLinkWithFallback({
  req,
  userId,
  normalizedUrl,
  title,
  provider,
  customSlug,
  expiresAt,
  qrConfig,
}) {
  const primary = normalizeProvider(provider);
  const fallback = primary === "shortio" ? "internal" : "shortio";
  const attempts = [primary, fallback];
  const errors = [];

  for (const currentProvider of attempts) {
    try {
      const link =
        currentProvider === "internal"
          ? await createInternalShortLink({
              req,
              userId,
              normalizedUrl,
              title,
              customSlug,
              expiresAt,
              qrConfig,
              requestedProvider: primary,
            })
          : await createShortIoLink({
              userId,
              normalizedUrl,
              title,
              customSlug,
              expiresAt,
              qrConfig,
              requestedProvider: primary,
            });

      return {
        link,
        providerUsed: currentProvider,
      };
    } catch (error) {
      errors.push(
        `${currentProvider}: ${error.response?.data?.error || error.message}`,
      );
    }
  }

  const failure = new Error("Failed to shorten URL");
  failure.details = errors;
  throw failure;
}

async function handleCreateLinkRequest(req, res) {
  const normalizedUrl = normalizeUrl(req.body?.url);
  const title = normalizeTitle(req.body?.title);
  const provider = getEffectiveProvider(req.user, req.body?.provider);
  const qrConfig = normalizeQrConfig(req.body?.qrConfig);
  const slugResult = normalizeCustomSlug(req.body?.customSlug);
  const expiryResult = normalizeExpiry(req.body?.expiresAt);

  if (!normalizedUrl) {
    return res.status(400).json({ error: "A valid URL is required" });
  }

  if (slugResult?.error) {
    return res.status(400).json({ error: slugResult.error });
  }

  if (expiryResult?.error) {
    return res.status(400).json({ error: expiryResult.error });
  }

  try {
    const result = await createLinkWithFallback({
      req,
      userId: req.user.id,
      normalizedUrl,
      title,
      provider,
      customSlug: slugResult?.value || null,
      expiresAt: expiryResult?.value || null,
      qrConfig,
    });

    await logAudit({
      userId: req.user.id,
      action: "link.create",
      entityType: "link",
      entityId: String(result.link.id),
      payload: {
        provider: result.link.provider,
        requestedProvider: result.link.requestedProvider,
      },
    });

    return res.status(201).json({
      link: result.link,
      shortURL: result.link.short,
      providerUsed: result.providerUsed,
      historyItem: result.link,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to shorten URL",
      details: error.details || error.message,
    });
  }
}

async function sendDashboard(res, user, query = {}) {
  const status = normalizeStatus(query.status);
  const provider = query.provider || "all";
  const search = String(query.search || "").trim();
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(
    Math.max(Number(query.limit) || DEFAULT_PAGE_SIZE, 1),
    50,
  );
  const ownerId =
    user.role === "admin" && query.ownerId
      ? Number(query.ownerId) || null
      : null;

  await safeMaybeRefreshShortIoClicks({ user, ownerId });
  await safeMaybeRefreshShortIoAnalytics({ user, ownerId });

  const [summary, clicksSeries, topLinks, auditLogs, shortIoHistory, trafficInsights] =
    await Promise.all([
      getDashboardSummary({ userId: user.id, isAdmin: user.role === "admin" }),
      getClickSeries({
        userId: user.id,
        isAdmin: user.role === "admin",
        days: 7,
      }),
      getTopLinks({
        userId: user.id,
        isAdmin: user.role === "admin",
        limit: 5,
      }),
      listAuditLogs({
        userId: user.id,
        isAdmin: user.role === "admin",
        limit: 8,
      }),
      listLinks({
        userId: user.id,
        isAdmin: user.role === "admin",
        provider: "shortio",
        page: 1,
        limit: 8,
      }),
      getShortIoTrafficInsights({
        userId: user.id,
        isAdmin: user.role === "admin",
        ownerId,
        periodKey: SHORT_IO_ANALYTICS_PERIOD_KEY,
        limit: 5,
      }),
    ]);
  const links = await listLinks({
    userId: user.id,
    isAdmin: user.role === "admin",
    search,
    provider,
    status,
    page,
    limit,
    ownerId,
  });

  return res.json({
    summary,
    clicksSeries,
    topLinks,
    auditLogs,
    trafficInsights,
    shortIoHistory: shortIoHistory.links,
    links: links.links,
    totalLinks: links.total,
    page,
    limit,
  });
}

app.use(attachAuth);

app.get("/health", async (_req, res) => {
  try {
    await ensureSchema();
    res.json({
      ok: true,
      database: Boolean(process.env.DATABASE_URL),
      appBaseUrl: process.env.APP_BASE_URL || null,
      shortIoConfigured: Boolean(
        process.env.SHORT_IO_API_KEY && process.env.SHORT_IO_DOMAIN,
      ),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/auth/register", authLimiter, async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: "DATABASE_URL is required for auth" });
  }

  const email = normalizeEmail(req.body?.email);
  const name = normalizeName(req.body?.name);
  const password = String(req.body?.password || "");

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email is required" });
  }

  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    return res.status(409).json({ error: "Email is already registered" });
  }

  const role = normalizeRole((await countUsers()) === 0 ? "admin" : "user");
  const user = await createUser({
    email,
    name,
    passwordHash: hashPassword(password),
    role,
  });
  const token = createSessionToken();
  const expiresAt = getSessionExpiryDate();
  await createSession({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt,
  });
  await logAudit({
    userId: user.id,
    action: "register",
    entityType: "user",
    entityId: String(user.id),
    payload: { role: user.role },
  });
  setSessionCookie(req, res, token, expiresAt);

  return res.status(201).json({
    user: sanitizeAuthUser(user),
    token,
  });
});

app.post("/auth/login", authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  const user = await findUserByEmail(email);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = createSessionToken();
  const expiresAt = getSessionExpiryDate();
  await createSession({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt,
  });
  await logAudit({
    userId: user.id,
    action: "login",
    entityType: "session",
    entityId: String(user.id),
  });
  setSessionCookie(req, res, token, expiresAt);

  return res.json({
    user: sanitizeAuthUser(user),
    token,
  });
});

app.post("/auth/logout", requireAuth, async (req, res) => {
  if (req.authToken) {
    await deleteSession(hashToken(req.authToken));
  }

  await logAudit({
    userId: req.user.id,
    action: "logout",
    entityType: "session",
    entityId: String(req.user.id),
  });
  clearSessionCookie(req, res);

  return res.status(204).send();
});

app.get("/auth/me", requireAuth, async (req, res) => {
  return res.json({ user: sanitizeAuthUser(req.user) });
});

app.get("/dashboard", requireAuth, async (req, res) => {
  return sendDashboard(res, req.user, req.query);
});

app.get("/links", requireAuth, async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(
    Math.max(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 1),
    50,
  );
  const provider = req.query.provider || "all";
  const ownerId =
    req.user.role === "admin" && req.query.ownerId
      ? Number(req.query.ownerId) || null
      : null;

  if (provider !== "internal") {
    await safeMaybeRefreshShortIoClicks({
      user: req.user,
      ownerId,
    });
  }

  const links = await listLinks({
    userId: req.user.id,
    isAdmin: req.user.role === "admin",
    search: String(req.query.search || "").trim(),
    provider,
    status: normalizeStatus(req.query.status),
    page,
    limit,
    ownerId,
  });

  return res.json({
    links: links.links,
    total: links.total,
    page,
    limit,
  });
});

app.get("/history", requireAuth, async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(
    Math.max(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 1),
    50,
  );
  const provider = req.query.provider || "all";
  const ownerId =
    req.user.role === "admin" && req.query.ownerId
      ? Number(req.query.ownerId) || null
      : null;

  if (provider !== "internal") {
    await safeMaybeRefreshShortIoClicks({
      user: req.user,
      ownerId,
    });
  }

  const links = await listLinks({
    userId: req.user.id,
    isAdmin: req.user.role === "admin",
    search: String(req.query.search || "").trim(),
    provider,
    status: normalizeStatus(req.query.status),
    limit,
    page,
    ownerId,
  });

  return res.json({
    history: links.links,
    total: links.total,
    page,
    limit,
  });
});

app.post("/links", requireAuth, writeLimiter, async (req, res) => {
  return handleCreateLinkRequest(req, res);
});

app.post("/shorten", requireAuth, writeLimiter, async (req, res) => {
  return handleCreateLinkRequest(req, res);
});

app.patch("/links/:id", requireAuth, writeLimiter, async (req, res) => {
  const linkId = Number(req.params.id);

  if (!Number.isInteger(linkId)) {
    return res.status(400).json({ error: "Invalid link id" });
  }

  const existingLink = await getLinkById(linkId, {
    userId: req.user.id,
    isAdmin: req.user.role === "admin",
  });

  if (!existingLink) {
    return res.status(404).json({ error: "Link not found" });
  }

  const updates = {};

  if (Object.prototype.hasOwnProperty.call(req.body, "title")) {
    updates.title = normalizeTitle(req.body.title);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "isActive")) {
    updates.isActive = Boolean(req.body.isActive);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "expiresAt")) {
    const expiryResult = normalizeExpiry(req.body.expiresAt);

    if (req.body.expiresAt && expiryResult?.error) {
      return res.status(400).json({ error: expiryResult.error });
    }

    updates.expiresAt = expiryResult?.value || null;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "qrConfig")) {
    updates.qrConfig = normalizeQrConfig(req.body.qrConfig);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "customSlug")) {
    const incomingSlug = String(req.body.customSlug || "").trim();
    const currentSlug = String(
      existingLink.customSlug || existingLink.shortCode || "",
    ).trim();

    if (existingLink.provider === "shortio" && !existingLink.providerLinkId) {
      if (incomingSlug && incomingSlug !== currentSlug) {
        return res.status(400).json({
          error:
            "Short.io slug editing is only available for links created after this update",
        });
      }
    } else {
      const slugResult = normalizeCustomSlug(req.body.customSlug);

      if (slugResult?.error) {
        return res.status(400).json({ error: slugResult.error });
      }

      const shortCode = slugResult?.value || null;

      if (!shortCode) {
        return res.status(400).json({ error: "Custom slug is required" });
      }

      const conflictingLinks = await listRedirectLinksByCode(shortCode);
      const hasConflict = conflictingLinks.some(
        (link) => String(link.id) !== String(existingLink.id),
      );

      if (hasConflict) {
        return res.status(400).json({ error: "Custom slug is already in use" });
      }

      if (existingLink.provider === "shortio") {
        if (!existingLink.providerLinkId) {
          return res.status(400).json({
            error:
              "Short.io slug editing is only available for links created after this update",
          });
        }

        try {
          const response = await axios.post(
            `https://api.short.io/links/${existingLink.providerLinkId}`,
            {
              path: shortCode,
            },
            {
              headers: {
                authorization: process.env.SHORT_IO_API_KEY,
                accept: "application/json",
                "content-type": "application/json",
              },
            },
          );

          const updatedShortURL =
            response.data.shortURL || response.data.shortUrl;
          const updatedCode =
            response.data.path ||
            extractShortCodeFromShortUrl(updatedShortURL) ||
            shortCode;

          updates.customSlug = shortCode;
          updates.shortCode = updatedCode;
          updates.shortUrl = updatedShortURL;
          updates.providerLinkId =
            response.data.idString ||
            response.data.id ||
            existingLink.providerLinkId;
        } catch (error) {
          return res.status(502).json({
            error: "Failed to update Short.io slug",
            details:
              error.response?.data?.error ||
              error.response?.data?.message ||
              error.message,
          });
        }
      } else {
        updates.customSlug = shortCode;
        updates.shortCode = shortCode;
        updates.shortUrl = `${getBaseUrl(req)}/${shortCode}`;
      }
    }
  }

  try {
    const link = await updateLink(linkId, updates, {
      userId: req.user.id,
      isAdmin: req.user.role === "admin",
    });

    if (!link) {
      return res.status(404).json({ error: "Link not found" });
    }

    await logAudit({
      userId: req.user.id,
      action: "link.update",
      entityType: "link",
      entityId: String(link.id),
      payload: updates,
    });

    return res.json({ link });
  } catch (error) {
    return res.status(error.code === "23505" ? 409 : 500).json({
      error:
        error.code === "23505"
          ? "Custom slug is already in use"
          : "Failed to update link",
      details: error.message,
    });
  }
});

app.delete("/links/:id", requireAuth, writeLimiter, async (req, res) => {
  const linkId = Number(req.params.id);

  if (!Number.isInteger(linkId)) {
    return res.status(400).json({ error: "Invalid link id" });
  }

  const existingLink = await getLinkById(linkId, {
    userId: req.user.id,
    isAdmin: req.user.role === "admin",
  });

  if (!existingLink) {
    return res.status(404).json({ error: "Link not found" });
  }

  const deleteMode = normalizeDeleteMode(req.query.mode, existingLink.provider);

  if (
    deleteMode === "provider" &&
    existingLink.provider === "shortio" &&
    existingLink.providerLinkId
  ) {
    try {
      await deleteShortIoLink(existingLink.providerLinkId);
    } catch (error) {
      const status = Number(error?.response?.status || 0);

      if (status !== 404) {
        return res.status(502).json({
          error: "Failed to delete link from Short.io",
          details:
            error?.response?.data?.error ||
            error?.response?.data?.message ||
            error.message,
        });
      }
    }
  }

  const link = await deleteLink(linkId, {
    userId: req.user.id,
    isAdmin: req.user.role === "admin",
  });

  await logAudit({
    userId: req.user.id,
    action: "link.delete",
    entityType: "link",
    entityId: String(link.id),
    payload: {
      short: link.short,
      deleteMode,
      provider: link.provider,
    },
  });

  return res.status(204).send();
});

app.get("/admin/audit", requireAuth, requireAdmin, async (req, res) => {
  const logs = await listAuditLogs({
    userId: req.user.id,
    isAdmin: true,
    limit: Math.min(Math.max(Number(req.query.limit) || 20, 1), 50),
  });

  return res.json({ logs });
});

app.get("/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await listUsers({ limit: 100 });
    return res.json({ users });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to load users",
      details: error.message,
    });
  }
});

app.post(
  "/admin/users",
  requireAuth,
  requireAdmin,
  writeLimiter,
  async (req, res) => {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({
        error: "DATABASE_URL is required for user management",
      });
    }

    const email = normalizeEmail(req.body?.email);
    const name = normalizeName(req.body?.name);
    const password = String(req.body?.password || "");
    const role = normalizeRole(req.body?.role || "user");

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "A valid email is required" });
    }

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: "Email is already registered" });
    }

    try {
      const user = await createUser({
        email,
        name,
        passwordHash: hashPassword(password),
        role,
      });

      await logAudit({
        userId: req.user.id,
        action: "user.create",
        entityType: "user",
        entityId: String(user.id),
        payload: {
          createdEmail: user.email,
          createdRole: user.role,
        },
      });

      return res.status(201).json({
        user: sanitizeAuthUser(user),
      });
    } catch (error) {
      return res.status(error.code === "23505" ? 409 : 500).json({
        error:
          error.code === "23505"
            ? "Email is already registered"
            : "Failed to create user",
        details: error.message,
      });
    }
  },
);

app.get(
  "/admin/shortio/diagnostics",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const ownerId = req.query.ownerId ? Number(req.query.ownerId) || null : null;
      const diagnostics = await getShortIoDiagnostics({
        user: req.user,
        ownerId,
      });

      return res.json(diagnostics);
    } catch (error) {
      return res.status(500).json({
        error: "Failed to load Short.io diagnostics",
        details: error.message,
      });
    }
  },
);

app.post(
  "/admin/shortio/import",
  requireAuth,
  requireAdmin,
  writeLimiter,
  async (req, res) => {
    try {
      const result = await importShortIoLinksToDatabase(req.user);
      markShortIoClickRefreshComplete({ user: req.user });
      const analyticsSync = await safeMaybeRefreshShortIoAnalytics({
        user: req.user,
        force: true,
      });
      markShortIoAnalyticsRefreshComplete({ user: req.user });

      await logAudit({
        userId: req.user.id,
        action: "shortio.import",
        entityType: "integration",
        entityId: "shortio",
        payload: {
          ...result,
          analyticsSync,
        },
      });

      return res.json({
        ...result,
        analyticsSync,
      });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to import Short.io links",
        details: error.message,
      });
    }
  },
);

app.get("/:code([^/]+)", async (req, res) => {
  const { code } = req.params;

  if (RESERVED_CODES.has(code.toLowerCase())) {
    return res.status(404).json({ error: "Not found" });
  }

  const candidates = await listRedirectLinksByCode(code);
  const now = new Date();
  const link =
    candidates.find(
      (candidate) => candidate.isActive && !isLinkExpired(candidate, now),
    ) || null;

  if (!link) {
    const fallbackLink = candidates[0] || null;

    if (!fallbackLink) {
      return res.status(404).json({ error: "Short code not found" });
    }

    if (!fallbackLink.isActive) {
      return res.status(410).json({ error: "This link is inactive" });
    }

    if (isLinkExpired(fallbackLink, now)) {
      return res.status(410).json({ error: "This link has expired" });
    }

    return res.status(404).json({ error: "Short code not found" });
  }

  if (!link.isActive) {
    return res.status(410).json({ error: "This link is inactive" });
  }

  if (isLinkExpired(link, now)) {
    return res.status(410).json({ error: "This link has expired" });
  }

  await recordClick({
    linkId: link.id,
    referrer: req.get("referer") || null,
    userAgent: req.get("user-agent") || null,
    ipHash: hashIpAddress(req.ip),
  });

  return res.redirect(302, link.original);
});

if (require.main === module || process.env.NODE_ENV !== "production") {
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    if (process.env.DATABASE_URL) {
      ensureSchema()
        .then(() => console.log("Neon schema ready"))
        .catch((error) => {
          console.error("Failed to initialize Neon schema:", error.message);
        });
    } else {
      console.log("DATABASE_URL not set, auth/internal links are disabled");
    }
  });

  server.on("error", (error) => {
    console.error("Server error:", error.message);
  });
}

module.exports = app;

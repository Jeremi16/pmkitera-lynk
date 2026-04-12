const axios = require("axios");
const {
  findUserByEmail,
  listShortIoLinksForSync,
  markShortIoLinkSyncStatus,
  updateShortIoClickCounts,
  upsertImportedShortIoLink,
  upsertShortIoAnalyticsSnapshot,
} = require("./db");
const {
  buildShortIoReconcileReport,
  buildShortIoSyncHealth,
} = require("./shortioSyncUtils");
const { extractShortCodeFromShortUrl, normalizeUrl, normalizeTitle } = require("./linkUtils");
const { normalizeEmail } = require("./auth");

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

let resolvedShortIoDomainId = process.env.SHORT_IO_DOMAIN_ID || null;
const shortIoClickRefreshState = new Map();
const shortIoAnalyticsRefreshState = new Map();

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

async function createShortIoApiLink({ normalizedUrl, customSlug }) {
  if (!process.env.SHORT_IO_API_KEY || !process.env.SHORT_IO_DOMAIN) {
    throw new Error("Short.io is not configured");
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

  return response.data;
}

async function updateShortIoApiSlug(providerLinkId, shortCode) {
  const response = await axios.post(
    `https://api.short.io/links/${providerLinkId}`,
    { path: shortCode },
    {
      headers: {
        authorization: process.env.SHORT_IO_API_KEY,
        accept: "application/json",
        "content-type": "application/json",
      },
    },
  );

  return response.data;
}

module.exports = {
  SHORT_IO_ANALYTICS_PERIOD_KEY,
  createShortIoApiLink,
  deleteShortIoLink,
  extractShortCodeFromShortUrl,
  fetchShortIoClickCountsByLinkIds,
  getShortIoDiagnostics,
  importShortIoLinksToDatabase,
  markShortIoAnalyticsRefreshComplete,
  markShortIoClickRefreshComplete,
  normalizeShortIoClickCount,
  resolveShortIoDomainId,
  safeMaybeRefreshShortIoAnalytics,
  safeMaybeRefreshShortIoClicks,
  updateShortIoApiSlug,
  updateShortIoClickCounts,
};

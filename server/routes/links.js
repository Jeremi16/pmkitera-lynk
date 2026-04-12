const axios = require("axios");
const express = require("express");
const {
  createLink,
  deleteLink,
  getClickSeries,
  getDashboardSummary,
  getLinkById,
  getShortIoTrafficInsights,
  getTopLinks,
  listAuditLogs,
  listLinks,
  listRedirectLinksByCode,
  logAudit,
  recordClick,
  updateLink,
} = require("../db");
const {
  DEFAULT_PAGE_SIZE,
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
  normalizeProvider,
  normalizeQrConfig,
  normalizeStatus,
  normalizeTitle,
  normalizeUrl,
} = require("../linkUtils");
const { requireAuth } = require("../session");
const { createRateLimiter } = require("../rateLimit");
const {
  SHORT_IO_ANALYTICS_PERIOD_KEY,
  createShortIoApiLink,
  deleteShortIoLink,
  safeMaybeRefreshShortIoAnalytics,
  safeMaybeRefreshShortIoClicks,
  updateShortIoApiSlug,
} = require("../shortio");

const router = express.Router();

function getRequestIdentity(req) {
  return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip || "unknown"}`;
}

const writeLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many write requests",
  prefix: "write",
  keyFn: (req) => getRequestIdentity(req),
});

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
  if (customSlug) {
    const existingLinks = await listRedirectLinksByCode(customSlug);

    if (existingLinks.length > 0) {
      throw new Error("Custom slug is already in use");
    }
  }

  const responseData = await createShortIoApiLink({ normalizedUrl, customSlug });

  const shortURL = responseData.shortURL || responseData.shortUrl;
  const shortCode = extractShortCodeFromShortUrl(shortURL);
  const providerLinkId = responseData.idString || responseData.id || null;

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
  const normalizedUrlValue = normalizeUrl(req.body?.url);
  const title = normalizeTitle(req.body?.title);
  const provider = getEffectiveProvider(req.user, req.body?.provider);
  const qrConfig = normalizeQrConfig(req.body?.qrConfig);
  const slugResult = normalizeCustomSlug(req.body?.customSlug);
  const expiryResult = normalizeExpiry(req.body?.expiresAt);

  if (!normalizedUrlValue) {
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
      normalizedUrl: normalizedUrlValue,
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

  // Run sync operations in parallel instead of sequentially
  await Promise.all([
    safeMaybeRefreshShortIoClicks({ user, ownerId }),
    safeMaybeRefreshShortIoAnalytics({ user, ownerId }),
  ]);

  const [summary, clicksSeries, topLinks, auditLogs, shortIoHistory, trafficInsights, links] =
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
      listLinks({
        userId: user.id,
        isAdmin: user.role === "admin",
        search,
        provider,
        status,
        page,
        limit,
        ownerId,
      }),
    ]);

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

router.get("/dashboard", requireAuth, async (req, res) => {
  return sendDashboard(res, req.user, req.query);
});

router.get("/links", requireAuth, async (req, res) => {
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

router.get("/history", requireAuth, async (req, res) => {
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

router.post("/links", requireAuth, writeLimiter, async (req, res) => {
  return handleCreateLinkRequest(req, res);
});

router.post("/shorten", requireAuth, writeLimiter, async (req, res) => {
  return handleCreateLinkRequest(req, res);
});

router.patch("/links/:id", requireAuth, writeLimiter, async (req, res) => {
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
    if (
      existingLink.provider === "internal" ||
      existingLink.provider === "shortio"
    ) {
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
          const responseData = await updateShortIoApiSlug(
            existingLink.providerLinkId,
            shortCode,
          );

          const updatedShortURL =
            responseData.shortURL || responseData.shortUrl;
          const updatedCode =
            responseData.path ||
            extractShortCodeFromShortUrl(updatedShortURL) ||
            shortCode;

          updates.customSlug = shortCode;
          updates.shortCode = updatedCode;
          updates.shortUrl = updatedShortURL;
          updates.providerLinkId =
            responseData.idString ||
            responseData.id ||
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

router.delete("/links/:id", requireAuth, writeLimiter, async (req, res) => {
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

// Short code redirect handler — must be registered last
router.get("/:code([^/]+)", async (req, res) => {
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

module.exports = router;

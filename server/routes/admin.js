const express = require("express");
const {
  hashPassword,
  normalizeEmail,
  normalizeRole,
  validatePassword,
} = require("../auth");
const {
  createUser,
  findUserByEmail,
  listAuditLogs,
  listUsers,
  logAudit,
  updateShortIoClickCounts,
  upsertImportedShortIoLink,
} = require("../db");
const { extractShortCodeFromShortUrl, normalizeName } = require("../linkUtils");
const { requireAdmin, requireAuth, sanitizeAuthUser } = require("../session");
const { createRateLimiter } = require("../rateLimit");
const {
  fetchShortIoClickCountsByLinkIds,
  getShortIoDiagnostics,
  importShortIoLinksToDatabase,
  markShortIoAnalyticsRefreshComplete,
  markShortIoClickRefreshComplete,
  normalizeShortIoClickCount,
  resolveShortIoDomainId,
  safeMaybeRefreshShortIoAnalytics,
} = require("../shortio");

const router = express.Router();

function getRequestIdentity(req) {
  return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip || "unknown"}`;
}

const writeLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many write requests",
  prefix: "admin_write",
  keyFn: (req) => getRequestIdentity(req),
});

router.get("/audit", requireAuth, requireAdmin, async (req, res) => {
  const logs = await listAuditLogs({
    userId: req.user.id,
    isAdmin: true,
    limit: Math.min(Math.max(Number(req.query.limit) || 20, 1), 50),
  });

  return res.json({ logs });
});

router.get("/users", requireAuth, requireAdmin, async (_req, res) => {
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

router.post(
  "/users",
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

router.get(
  "/shortio/diagnostics",
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

router.post(
  "/shortio/import",
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

router.post(
  "/shortio/import-single",
  requireAuth,
  requireAdmin,
  writeLimiter,
  async (req, res) => {
    try {
      const link = req.body;
      if (!link || !link.providerLinkId || !link.originalUrl) {
        return res.status(400).json({ error: "Invalid link payload" });
      }

      let ownerId = req.user.id;
      if (link.ownerEmail) {
        const matchedUser = await findUserByEmail(link.ownerEmail);
        ownerId = matchedUser?.id || req.user.id;
      }

      const result = await upsertImportedShortIoLink({
        userId: ownerId,
        title: link.title || "",
        originalUrl: link.originalUrl,
        shortUrl: link.shortUrl,
        shortCode: link.shortCode || extractShortCodeFromShortUrl(link.shortUrl),
        providerLinkId: String(link.providerLinkId),
        customSlug: link.customSlug || link.shortCode,
        isActive: link.isActive !== false,
        expiresAt: link.expiresAt ? new Date(link.expiresAt) : null,
        createdAt: link.createdAt ? new Date(link.createdAt) : new Date(),
        clickCount: normalizeShortIoClickCount(link.clickCount || 0),
      });

      // Optimistically fetch latest clicks for this specific link if possible
      try {
        const domainId = await resolveShortIoDomainId();
        const liveClicks = await fetchShortIoClickCountsByLinkIds([String(link.providerLinkId)], domainId);
        if (liveClicks[String(link.providerLinkId)] !== undefined) {
          result.clickCount = liveClicks[String(link.providerLinkId)];
          await updateShortIoClickCounts({
            [String(link.providerLinkId)]: {
               clickCount: result.clickCount,
               totalClicks: result.clickCount,
               humanClicks: result.clickCount
            }
          });
        }
      } catch (e) {
        // Ignored
      }
      
      markShortIoClickRefreshComplete({ user: req.user });

      await logAudit({
        userId: req.user.id,
        action: "shortio.import_single",
        entityType: "link",
        entityId: String(link.providerLinkId),
        payload: { linkId: result.inserted ? "new" : "updated" },
      });

      return res.json({ success: true, inserted: result.inserted });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: "Failed to import Short.io link",
        details: error.message,
      });
    }
  },
);

module.exports = router;

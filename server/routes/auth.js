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
} = require("../auth");
const {
  countUsers,
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
  logAudit,
} = require("../db");
const { normalizeName } = require("../linkUtils");
const {
  clearSessionCookie,
  requireAuth,
  sanitizeAuthUser,
  setSessionCookie,
} = require("../session");
const { createRateLimiter } = require("../rateLimit");

const router = express.Router();

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

router.post("/register", authLimiter, async (req, res) => {
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

router.post("/login", authLimiter, async (req, res) => {
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

router.post("/logout", requireAuth, async (req, res) => {
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

router.get("/me", requireAuth, async (req, res) => {
  return res.json({ user: sanitizeAuthUser(req.user) });
});

module.exports = router;

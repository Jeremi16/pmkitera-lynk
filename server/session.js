const { hashToken } = require("./auth");
const { deleteSession, findSessionByTokenHash } = require("./db");

const SESSION_COOKIE_NAME = "qr_session";

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

module.exports = {
  SESSION_COOKIE_NAME,
  attachAuth,
  clearSessionCookie,
  extractBearerToken,
  extractCookieToken,
  requireAdmin,
  requireAuth,
  sanitizeAuthUser,
  setSessionCookie,
};

const crypto = require("crypto");

const SESSION_TTL_DAYS = 7;

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expected] = String(storedHash || "").split(":");

  if (!salt || !expected) {
    return false;
  }

  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(derivedKey, "hex"),
    Buffer.from(expected, "hex"),
  );
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getSessionExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_TTL_DAYS);
  return expiresAt;
}

function validatePassword(password) {
  const value = String(password || "");

  if (value.length < 8) {
    return "Password must be at least 8 characters";
  }

  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value)) {
    return "Password must include upper, lower, and numeric characters";
  }

  return null;
}

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase() === "admin"
    ? "admin"
    : "user";
}

module.exports = {
  createSessionToken,
  getSessionExpiryDate,
  hashPassword,
  hashToken,
  normalizeEmail,
  normalizeRole,
  validatePassword,
  verifyPassword,
};

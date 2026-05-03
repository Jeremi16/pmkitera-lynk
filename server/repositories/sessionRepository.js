const { getPool } = require("../config/database");

async function createSession({ userId, tokenHash, expiresAt }) {
  const db = getPool();

  if (!db) {
    throw new Error("DATABASE_URL is required");
  }

  await db.query(
    `
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3);
    `,
    [userId, tokenHash, expiresAt],
  );
}

async function findSessionByTokenHash(tokenHash) {
  const db = getPool();

  if (!db) {
    return null;
  }

  const { rows } = await db.query(
    `
      SELECT
        s.user_id,
        s.expires_at,
        u.id,
        u.email,
        u.name,
        u.role,
        u.created_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
      LIMIT 1;
    `,
    [tokenHash],
  );

  if (!rows[0]) {
    return null;
  }

  const { mapUser } = require("./userRepository");

  return {
    expiresAt: rows[0].expires_at,
    user: mapUser(rows[0]),
  };
}

async function deleteSession(tokenHash) {
  const db = getPool();

  if (!db) {
    return;
  }

  await db.query("DELETE FROM sessions WHERE token_hash = $1;", [tokenHash]);
}

async function deleteExpiredSessions() {
  const db = getPool();

  if (!db) {
    return 0;
  }

  const result = await db.query(
    "DELETE FROM sessions WHERE expires_at <= NOW();",
  );
  return Number(result.rowCount || 0);
}

module.exports = {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  findSessionByTokenHash,
};

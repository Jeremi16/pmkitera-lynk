const { getPool } = require("../config/database");

// ── Row mappers ──

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role:
      String(row.role || "user").toLowerCase() === "admin" ? "admin" : "user",
    createdAt: row.created_at,
  };
}

// ── Queries ──

async function countUsers() {
  const db = getPool();

  if (!db) {
    return 0;
  }

  const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM users;");
  return rows[0]?.count || 0;
}

async function createUser({ email, name, passwordHash, role = "user" }) {
  const db = getPool();

  if (!db) {
    throw new Error("DATABASE_URL is required");
  }

  const { rows } = await db.query(
    `
      INSERT INTO users (email, name, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, name, role, created_at;
    `,
    [
      email,
      name,
      passwordHash,
      String(role || "user").toLowerCase() === "admin" ? "admin" : "user",
    ],
  );

  return mapUser(rows[0]);
}

async function findUserByEmail(email) {
  const db = getPool();

  if (!db) {
    return null;
  }

  const { rows } = await db.query(
    `
      SELECT *
      FROM users
      WHERE email = $1
      LIMIT 1;
    `,
    [email],
  );

  return rows[0] || null;
}

async function findUserById(id) {
  const db = getPool();

  if (!db) {
    return null;
  }

  const { rows } = await db.query(
    `
      SELECT id, email, name, role, created_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `,
    [id],
  );

  return mapUser(rows[0]);
}

async function listUsers({ limit = 50 } = {}) {
  const db = getPool();

  if (!db) {
    return [];
  }

  const { rows } = await db.query(
    `
      SELECT
        u.id,
        u.email,
        u.name,
        u.role,
        u.created_at,
        COUNT(l.id)::int AS links_count
      FROM users u
      LEFT JOIN links l ON l.user_id = u.id
      GROUP BY u.id, u.email, u.name, u.role, u.created_at
      ORDER BY
        CASE WHEN LOWER(u.role) = 'admin' THEN 0 ELSE 1 END ASC,
        u.created_at DESC
      LIMIT $1;
    `,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );

  return rows.map((row) => ({
    ...mapUser(row),
    linksCount: Number(row.links_count || 0),
  }));
}

module.exports = {
  countUsers,
  createUser,
  findUserByEmail,
  findUserById,
  listUsers,
  mapUser,
};

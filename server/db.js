const { Pool } = require("pg");

let pool;
let schemaReady = false;

function getPool() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 8,
      idleTimeoutMillis: 30000,
    });
  }

  return pool;
}

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

function mapLink(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    original: row.original_url,
    short: row.short_url,
    shortCode: row.short_code,
    providerLinkId: row.provider_link_id,
    customSlug: row.custom_slug,
    provider: row.provider,
    requestedProvider: row.requested_provider,
    isActive: row.is_active,
    expiresAt: row.expires_at,
    clickCount: Number(row.click_count || 0),
    lastProviderSyncAt: row.last_provider_sync_at || null,
    providerSyncStatus: row.provider_sync_status || "pending",
    providerSyncError: row.provider_sync_error || null,
    lastProviderTotalClicks: Number(row.last_provider_total_clicks || 0),
    lastProviderHumanClicks: Number(row.last_provider_human_clicks || 0),
    lastProviderPeriodKey: row.last_provider_period_key || null,
    lastProviderPeriodHumanClicks: Number(
      row.last_provider_period_human_clicks || 0,
    ),
    lastClickedAt: row.last_clicked_at,
    ownerId: row.user_id,
    ownerEmail: row.owner_email || null,
    qrConfig: row.qr_config || {},
    createdAt: row.created_at,
    timestamp: new Date(row.created_at).toLocaleString(),
  };
}

function mapAudit(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload || {},
    createdAt: row.created_at,
    actorEmail: row.actor_email || null,
    actorName: row.actor_name || null,
  };
}

async function ensureSchema() {
  const db = getPool();

  if (!db) {
    return false;
  }

  if (schemaReady) {
    return true;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    UPDATE users
    SET role = 'user'
    WHERE role IS DISTINCT FROM 'admin';
  `);

  await db.query(`
    ALTER TABLE users
    ALTER COLUMN role SET DEFAULT 'user';
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS links (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      original_url TEXT NOT NULL,
      short_url TEXT NOT NULL,
      short_code TEXT,
      provider_link_id TEXT,
      custom_slug TEXT,
      provider TEXT NOT NULL DEFAULT 'shortio',
      requested_provider TEXT NOT NULL DEFAULT 'shortio',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      expires_at TIMESTAMPTZ,
      click_count INTEGER NOT NULL DEFAULT 0,
      last_clicked_at TIMESTAMPTZ,
      qr_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS title TEXT;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS custom_slug TEXT;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS provider_link_id TEXT;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS requested_provider TEXT NOT NULL DEFAULT 'shortio';
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS last_provider_sync_at TIMESTAMPTZ;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS provider_sync_status TEXT NOT NULL DEFAULT 'pending';
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS provider_sync_error TEXT;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS last_provider_total_clicks INTEGER NOT NULL DEFAULT 0;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS last_provider_human_clicks INTEGER NOT NULL DEFAULT 0;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS last_provider_period_key TEXT;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS last_provider_period_human_clicks INTEGER NOT NULL DEFAULT 0;
  `);

  await db.query(`
    ALTER TABLE links
    ADD COLUMN IF NOT EXISTS qr_config JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS click_events (
      id BIGSERIAL PRIMARY KEY,
      link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      referrer TEXT,
      user_agent TEXT,
      ip_hash TEXT
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS shortio_link_daily_stats (
      id BIGSERIAL PRIMARY KEY,
      link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      stat_date DATE NOT NULL,
      human_clicks INTEGER NOT NULL DEFAULT 0,
      total_clicks INTEGER NOT NULL DEFAULT 0,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS shortio_link_breakdowns (
      id BIGSERIAL PRIMARY KEY,
      link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL DEFAULT 'last30',
      dimension TEXT NOT NULL,
      value_key TEXT NOT NULL,
      value_label TEXT,
      clicks INTEGER NOT NULL DEFAULT 0,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx
    ON sessions (user_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
    ON sessions (expires_at DESC);
  `);

  await db.query(`
    ALTER TABLE links
    DROP CONSTRAINT IF EXISTS links_short_url_key;
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS links_user_id_idx
    ON links (user_id, created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS links_created_at_idx
    ON links (created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS links_provider_short_code_idx
    ON links (provider, short_code);
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS links_internal_code_unique_idx
    ON links (provider, short_code)
    WHERE short_code IS NOT NULL AND provider = 'internal';
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS links_shortio_provider_link_id_unique_idx
    ON links (provider, provider_link_id)
    WHERE provider = 'shortio' AND provider_link_id IS NOT NULL;
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS click_events_link_id_idx
    ON click_events (link_id, clicked_at DESC);
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS shortio_link_daily_stats_link_date_unique_idx
    ON shortio_link_daily_stats (link_id, stat_date);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS shortio_link_daily_stats_date_idx
    ON shortio_link_daily_stats (stat_date DESC, link_id);
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS shortio_link_breakdowns_unique_idx
    ON shortio_link_breakdowns (link_id, period_key, dimension, value_key);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS shortio_link_breakdowns_dim_idx
    ON shortio_link_breakdowns (dimension, period_key, clicks DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
    ON audit_logs (created_at DESC);
  `);

  schemaReady = true;
  return true;
}

async function countUsers() {
  const db = getPool();

  if (!db) {
    return 0;
  }

  await ensureSchema();
  const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM users;");
  return rows[0]?.count || 0;
}

async function createUser({ email, name, passwordHash, role = "user" }) {
  const db = getPool();

  if (!db) {
    throw new Error("DATABASE_URL is required");
  }

  await ensureSchema();

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

  await ensureSchema();

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

  await ensureSchema();

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

  await ensureSchema();

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

async function createSession({ userId, tokenHash, expiresAt }) {
  const db = getPool();

  if (!db) {
    throw new Error("DATABASE_URL is required");
  }

  await ensureSchema();

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

  await ensureSchema();

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

  await ensureSchema();
  await db.query("DELETE FROM sessions WHERE token_hash = $1;", [tokenHash]);
}

async function createLink({
  userId,
  title,
  originalUrl,
  shortUrl,
  shortCode = null,
  providerLinkId = null,
  customSlug = null,
  provider = "shortio",
  requestedProvider = provider,
  expiresAt = null,
  qrConfig = {},
}) {
  const db = getPool();

  if (!db) {
    throw new Error("DATABASE_URL is required");
  }

  await ensureSchema();

  const { rows } = await db.query(
    `
      INSERT INTO links (
        user_id,
        title,
        original_url,
        short_url,
        short_code,
        provider_link_id,
        custom_slug,
        provider,
        requested_provider,
        expires_at,
        qr_config
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      RETURNING *;
    `,
    [
      userId,
      title || null,
      originalUrl,
      shortUrl,
      shortCode,
      providerLinkId,
      customSlug,
      provider,
      requestedProvider,
      expiresAt,
      JSON.stringify(qrConfig || {}),
    ],
  );

  return mapLink(rows[0]);
}

async function upsertImportedShortIoLink({
  userId,
  title,
  originalUrl,
  shortUrl,
  shortCode = null,
  providerLinkId,
  customSlug = null,
  isActive = true,
  expiresAt = null,
  createdAt = null,
  clickCount = 0,
}) {
  const db = getPool();

  if (!db) {
    throw new Error("DATABASE_URL is required");
  }

  if (!providerLinkId) {
    throw new Error("providerLinkId is required for Short.io import");
  }

  await ensureSchema();

  const { rows } = await db.query(
    `
      INSERT INTO links (
        user_id,
        title,
        original_url,
        short_url,
        short_code,
        provider_link_id,
        custom_slug,
        provider,
        requested_provider,
        is_active,
        expires_at,
        click_count,
        qr_config,
        created_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'shortio', 'shortio', $8, $9, $11, '{}'::jsonb,
        COALESCE($10, NOW())
      )
      ON CONFLICT (provider, provider_link_id)
      WHERE provider = 'shortio' AND provider_link_id IS NOT NULL
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        title = EXCLUDED.title,
        original_url = EXCLUDED.original_url,
        short_url = EXCLUDED.short_url,
        short_code = EXCLUDED.short_code,
        provider_link_id = EXCLUDED.provider_link_id,
        custom_slug = EXCLUDED.custom_slug,
        is_active = EXCLUDED.is_active,
        expires_at = EXCLUDED.expires_at,
        click_count = EXCLUDED.click_count
      RETURNING *, (xmax = 0) AS inserted;
    `,
    [
      userId,
      title || null,
      originalUrl,
      shortUrl,
      shortCode,
      providerLinkId,
      customSlug,
      Boolean(isActive),
      expiresAt,
      createdAt,
      Number(clickCount || 0),
    ],
  );

  return {
    link: mapLink(rows[0]),
    inserted: Boolean(rows[0]?.inserted),
  };
}

function buildLinkFilters({
  userId,
  isAdmin,
  search,
  provider,
  status,
  ownerId,
}) {
  const clauses = [];
  const values = [];

  if (!isAdmin && userId) {
    values.push(userId);
    clauses.push(`l.user_id = $${values.length}`);
  }

  if (isAdmin && ownerId) {
    values.push(ownerId);
    clauses.push(`l.user_id = $${values.length}`);
  }

  if (provider && provider !== "all") {
    values.push(provider);
    clauses.push(`l.provider = $${values.length}`);
  }

  if (status === "active") {
    clauses.push("l.is_active = TRUE");
    clauses.push("(l.expires_at IS NULL OR l.expires_at > NOW())");
  } else if (status === "inactive") {
    clauses.push("l.is_active = FALSE");
  } else if (status === "expired") {
    clauses.push("l.expires_at IS NOT NULL AND l.expires_at <= NOW()");
  }

  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    clauses.push(`
      (
        LOWER(COALESCE(l.title, '')) LIKE $${values.length}
        OR LOWER(l.original_url) LIKE $${values.length}
        OR LOWER(l.short_url) LIKE $${values.length}
        OR LOWER(COALESCE(l.short_code, '')) LIKE $${values.length}
        OR LOWER(COALESCE(l.custom_slug, '')) LIKE $${values.length}
      )
    `);
  }

  return {
    values,
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
  };
}

async function listLinks({
  userId,
  isAdmin = false,
  search = "",
  provider = "all",
  status = "all",
  ownerId = null,
  limit = 20,
  page = 1,
}) {
  const db = getPool();

  if (!db) {
    return { links: [], total: 0 };
  }

  await ensureSchema();

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const filters = buildLinkFilters({
    userId,
    isAdmin,
    search,
    provider,
    status,
    ownerId,
  });

  const listValues = [...filters.values, safeLimit, offset];
  const countValues = [...filters.values];

  const [listResult, countResult] = await Promise.all([
    db.query(
      `
        SELECT
          l.*,
          u.email AS owner_email
        FROM links l
        JOIN users u ON u.id = l.user_id
        ${filters.whereSql}
        ORDER BY l.created_at DESC
        LIMIT $${listValues.length - 1}
        OFFSET $${listValues.length};
      `,
      listValues,
    ),
    db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM links l
        ${filters.whereSql};
      `,
      countValues,
    ),
  ]);

  return {
    links: listResult.rows.map(mapLink),
    total: countResult.rows[0]?.total || 0,
  };
}

async function listShortIoLinksForSync({
  userId,
  isAdmin = false,
  ownerId = null,
}) {
  const db = getPool();

  if (!db) {
    return [];
  }

  await ensureSchema();

  const filters = buildLinkFilters({
    userId,
    isAdmin,
    search: "",
    provider: "shortio",
    status: "all",
    ownerId,
  });

  const { rows } = await db.query(
    `
      SELECT
        l.id,
        l.title,
        l.short_url,
        l.short_code,
        l.original_url,
        l.provider_link_id,
        l.click_count,
        l.last_provider_sync_at,
        l.provider_sync_status,
        l.provider_sync_error,
        l.last_provider_total_clicks,
        l.last_provider_human_clicks,
        l.last_provider_period_key,
        l.last_provider_period_human_clicks,
        l.created_at
      FROM links l
      ${filters.whereSql}
        AND l.provider_link_id IS NOT NULL
      ORDER BY l.created_at DESC;
    `,
    filters.values,
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    shortUrl: row.short_url,
    shortCode: row.short_code,
    originalUrl: row.original_url,
    providerLinkId: row.provider_link_id,
    clickCount: Number(row.click_count || 0),
    lastProviderSyncAt: row.last_provider_sync_at || null,
    providerSyncStatus: row.provider_sync_status || "pending",
    providerSyncError: row.provider_sync_error || null,
    lastProviderTotalClicks: Number(row.last_provider_total_clicks || 0),
    lastProviderHumanClicks: Number(row.last_provider_human_clicks || 0),
    lastProviderPeriodKey: row.last_provider_period_key || null,
    lastProviderPeriodHumanClicks: Number(
      row.last_provider_period_human_clicks || 0,
    ),
    createdAt: row.created_at,
  }));
}

async function updateShortIoClickCounts(clicksByProviderLinkId = {}) {
  const db = getPool();

  if (!db) {
    return 0;
  }

  await ensureSchema();

  const updates = Object.entries(clicksByProviderLinkId)
    .map(([providerLinkId, payload]) => {
      const details =
        payload && typeof payload === "object"
          ? payload
          : {
              clickCount: payload,
              totalClicks: payload,
              humanClicks: payload,
            };

      return {
        providerLinkId: String(providerLinkId || "").trim(),
        clickCount: Math.max(0, Math.trunc(Number(details.clickCount) || 0)),
        totalClicks: Math.max(
          0,
          Math.trunc(Number(details.totalClicks ?? details.clickCount) || 0),
        ),
        humanClicks: Math.max(
          0,
          Math.trunc(Number(details.humanClicks ?? details.clickCount) || 0),
        ),
      };
    })
    .filter((item) => item.providerLinkId);

  if (updates.length === 0) {
    return 0;
  }

  const values = [];
  const tuples = updates.map((item, index) => {
    values.push(
      item.providerLinkId,
      item.clickCount,
      item.totalClicks,
      item.humanClicks,
    );
    const base = index * 4;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });

  const result = await db.query(
    `
      UPDATE links AS l
      SET
        click_count = v.click_count::integer,
        last_provider_total_clicks = v.total_clicks::integer,
        last_provider_human_clicks = v.human_clicks::integer,
        last_provider_sync_at = NOW(),
        provider_sync_status = 'ok',
        provider_sync_error = NULL
      FROM (
        VALUES ${tuples.join(", ")}
      ) AS v(provider_link_id, click_count, total_clicks, human_clicks)
      WHERE l.provider = 'shortio'
        AND l.provider_link_id = v.provider_link_id
        AND (
          l.click_count IS DISTINCT FROM v.click_count::integer
          OR l.last_provider_total_clicks IS DISTINCT FROM v.total_clicks::integer
          OR l.last_provider_human_clicks IS DISTINCT FROM v.human_clicks::integer
          OR l.provider_sync_status IS DISTINCT FROM 'ok'
          OR l.provider_sync_error IS NOT NULL
        );
    `,
    values,
  );

  return Number(result.rowCount || 0);
}

async function markShortIoLinkSyncStatus({
  linkId,
  providerLinkId = null,
  syncStatus = "ok",
  syncError = null,
  totalClicks = null,
  humanClicks = null,
  periodKey = null,
  periodHumanClicks = null,
  syncedAt = new Date(),
}) {
  const db = getPool();

  if (!db) {
    return 0;
  }

  await ensureSchema();

  const whereClauses = [];
  const values = [];

  if (linkId) {
    values.push(linkId);
    whereClauses.push(`id = $${values.length}`);
  }

  if (providerLinkId) {
    values.push(providerLinkId);
    whereClauses.push(`provider_link_id = $${values.length}`);
  }

  if (whereClauses.length === 0) {
    return 0;
  }

  values.push(syncStatus || "pending");
  values.push(syncError || null);
  values.push(syncedAt);
  values.push(totalClicks == null ? null : Math.max(0, Math.trunc(Number(totalClicks) || 0)));
  values.push(humanClicks == null ? null : Math.max(0, Math.trunc(Number(humanClicks) || 0)));
  values.push(periodKey || null);
  values.push(
    periodHumanClicks == null
      ? null
      : Math.max(0, Math.trunc(Number(periodHumanClicks) || 0)),
  );

  const result = await db.query(
    `
      UPDATE links
      SET
        provider_sync_status = $${values.length - 6},
        provider_sync_error = $${values.length - 5},
        last_provider_sync_at = $${values.length - 4},
        last_provider_total_clicks = COALESCE($${values.length - 3}, last_provider_total_clicks),
        last_provider_human_clicks = COALESCE($${values.length - 2}, last_provider_human_clicks),
        last_provider_period_key = COALESCE($${values.length - 1}, last_provider_period_key),
        last_provider_period_human_clicks = COALESCE($${values.length}, last_provider_period_human_clicks)
      WHERE provider = 'shortio'
        AND (${whereClauses.join(" OR ")});
    `,
    values,
  );

  return Number(result.rowCount || 0);
}

async function upsertShortIoAnalyticsSnapshot({
  linkId,
  humanClicks = 0,
  totalClicks = 0,
  dailyStats = [],
  breakdowns = {},
  periodKey = "last30",
  syncedAt = new Date(),
}) {
  const db = getPool();

  if (!db) {
    return { updatedLink: false, dailyStats: 0, breakdowns: 0 };
  }

  await ensureSchema();

  const safeHumanClicks = Math.max(0, Math.trunc(Number(humanClicks) || 0));
  const safeTotalClicks = Math.max(0, Math.trunc(Number(totalClicks) || 0));
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const normalizedDailyStats = dailyStats
      .map((item) => ({
        statDate: item?.statDate || null,
        humanClicks: Math.max(0, Math.trunc(Number(item?.humanClicks) || 0)),
        totalClicks: Math.max(
          0,
          Math.trunc(Number(item?.totalClicks ?? item?.humanClicks) || 0),
        ),
      }))
      .filter((item) => item.statDate);

    const periodHumanClicks = normalizedDailyStats.reduce(
      (total, item) => total + item.humanClicks,
      0,
    );

    await client.query(
      `
        UPDATE links
        SET
          last_provider_sync_at = $2,
          provider_sync_status = 'ok',
          provider_sync_error = NULL,
          last_provider_total_clicks = $3,
          last_provider_human_clicks = $4,
          last_provider_period_key = $5,
          last_provider_period_human_clicks = $6
        WHERE id = $1
          AND provider = 'shortio';
      `,
      [
        linkId,
        syncedAt,
        safeTotalClicks,
        safeHumanClicks,
        periodKey,
        periodHumanClicks,
      ],
    );

    if (normalizedDailyStats.length > 0) {
      const sortedDates = normalizedDailyStats
        .map((item) => item.statDate)
        .sort();

      await client.query(
        `
          DELETE FROM shortio_link_daily_stats
          WHERE link_id = $1
            AND stat_date BETWEEN $2::date AND $3::date;
        `,
        [linkId, sortedDates[0], sortedDates[sortedDates.length - 1]],
      );

      const values = [];
      const tuples = normalizedDailyStats.map((item, index) => {
        values.push(
          linkId,
          item.statDate,
          item.humanClicks,
          item.totalClicks,
          syncedAt,
        );

        const base = index * 5;
        return `($${base + 1}, $${base + 2}::date, $${base + 3}, $${base + 4}, $${base + 5})`;
      });

      await client.query(
        `
          INSERT INTO shortio_link_daily_stats (
            link_id,
            stat_date,
            human_clicks,
            total_clicks,
            synced_at
          )
          VALUES ${tuples.join(", ")}
          ON CONFLICT (link_id, stat_date)
          DO UPDATE SET
            human_clicks = EXCLUDED.human_clicks,
            total_clicks = EXCLUDED.total_clicks,
            synced_at = EXCLUDED.synced_at;
        `,
        values,
      );
    }

    let breakdownRows = 0;
    const breakdownEntries = Object.entries(breakdowns || {});

    for (const [dimension, items] of breakdownEntries) {
      await client.query(
        `
          DELETE FROM shortio_link_breakdowns
          WHERE link_id = $1
            AND period_key = $2
            AND dimension = $3;
        `,
        [linkId, periodKey, dimension],
      );

      const normalizedItems = (Array.isArray(items) ? items : [])
        .map((item) => ({
          valueKey: String(item?.valueKey || "").trim(),
          valueLabel: String(item?.valueLabel || item?.valueKey || "").trim(),
          clicks: Math.max(0, Math.trunc(Number(item?.clicks) || 0)),
        }))
        .filter((item) => item.valueKey);

      if (normalizedItems.length === 0) {
        continue;
      }

      breakdownRows += normalizedItems.length;

      const values = [];
      const tuples = normalizedItems.map((item, index) => {
        values.push(
          linkId,
          periodKey,
          dimension,
          item.valueKey,
          item.valueLabel || null,
          item.clicks,
          syncedAt,
        );

        const base = index * 7;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
      });

      await client.query(
        `
          INSERT INTO shortio_link_breakdowns (
            link_id,
            period_key,
            dimension,
            value_key,
            value_label,
            clicks,
            synced_at
          )
          VALUES ${tuples.join(", ")}
          ON CONFLICT (link_id, period_key, dimension, value_key)
          DO UPDATE SET
            value_label = EXCLUDED.value_label,
            clicks = EXCLUDED.clicks,
            synced_at = EXCLUDED.synced_at;
        `,
        values,
      );
    }

    await client.query("COMMIT");

    return {
      updatedLink: false,
      dailyStats: normalizedDailyStats.length,
      breakdowns: breakdownRows,
      totalClicks: safeTotalClicks,
      humanClicks: safeHumanClicks,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getShortIoTrafficInsights({
  userId,
  isAdmin = false,
  ownerId = null,
  periodKey = "last30",
  limit = 5,
}) {
  const db = getPool();

  if (!db) {
    return {
      lastSyncedAt: null,
      country: [],
      browser: [],
      os: [],
      city: [],
      referer: [],
      summary: {
        periodKey,
        lifetimeClicks: 0,
        periodClicks: 0,
        syncedLinks: 0,
      },
    };
  }

  await ensureSchema();

  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 10);
  const dimensions = ["country", "browser", "os", "city", "referer"];
  const breakdownValues = [dimensions, periodKey];
  let breakdownOwnerClause = "";
  const syncValues = [];
  let syncOwnerClause = "";
  const summaryValues = [];
  let summaryOwnerClause = "";

  if (!isAdmin) {
    breakdownValues.push(userId);
    breakdownOwnerClause = `AND l.user_id = $${breakdownValues.length}`;
    syncValues.push(userId);
    syncOwnerClause = `AND l.user_id = $${syncValues.length}`;
    summaryValues.push(userId);
    summaryOwnerClause = `AND l.user_id = $${summaryValues.length}`;
  } else if (ownerId) {
    breakdownValues.push(ownerId);
    breakdownOwnerClause = `AND l.user_id = $${breakdownValues.length}`;
    syncValues.push(ownerId);
    syncOwnerClause = `AND l.user_id = $${syncValues.length}`;
    summaryValues.push(ownerId);
    summaryOwnerClause = `AND l.user_id = $${summaryValues.length}`;
  }

  const [breakdownResult, syncResult, summaryResult] = await Promise.all([
    db.query(
      `
        SELECT
          b.dimension,
          COALESCE(NULLIF(b.value_label, ''), b.value_key) AS label,
          b.value_key,
          SUM(b.clicks)::int AS clicks
        FROM shortio_link_breakdowns b
        JOIN links l ON l.id = b.link_id
        WHERE b.dimension = ANY($1::text[])
          AND b.period_key = $2
          ${breakdownOwnerClause}
        GROUP BY b.dimension, label, b.value_key
        ORDER BY b.dimension ASC, clicks DESC, label ASC;
      `,
      breakdownValues,
    ),
    db.query(
      `
        SELECT MAX(s.synced_at) AS last_synced_at
        FROM shortio_link_daily_stats s
        JOIN links l ON l.id = s.link_id
        WHERE 1 = 1
        ${syncOwnerClause};
      `,
      syncValues,
    ),
    db.query(
      `
        SELECT
          COALESCE(SUM(l.click_count), 0)::int AS lifetime_clicks,
          COALESCE(SUM(l.last_provider_period_human_clicks), 0)::int AS period_clicks,
          COUNT(*) FILTER (WHERE l.last_provider_sync_at IS NOT NULL)::int AS synced_links
        FROM links l
        WHERE l.provider = 'shortio'
        ${summaryOwnerClause};
      `,
      summaryValues,
    ),
  ]);

  const grouped = {
    country: [],
    browser: [],
    os: [],
    city: [],
    referer: [],
  };

  for (const row of breakdownResult.rows) {
    const bucket = grouped[row.dimension];
    if (!bucket || bucket.length >= safeLimit) {
      continue;
    }

    bucket.push({
      label: row.label,
      valueKey: row.value_key,
      clicks: Number(row.clicks || 0),
    });
  }

  return {
    lastSyncedAt: syncResult.rows[0]?.last_synced_at || null,
    country: grouped.country,
    browser: grouped.browser,
    os: grouped.os,
    city: grouped.city,
    referer: grouped.referer,
    summary: {
      periodKey,
      lifetimeClicks: Number(summaryResult.rows[0]?.lifetime_clicks || 0),
      periodClicks: Number(summaryResult.rows[0]?.period_clicks || 0),
      syncedLinks: Number(summaryResult.rows[0]?.synced_links || 0),
    },
  };
}

async function getLinkById(id, { userId, isAdmin = false }) {
  const db = getPool();

  if (!db) {
    return null;
  }

  await ensureSchema();

  const values = [id];
  let ownerClause = "";

  if (!isAdmin) {
    values.push(userId);
    ownerClause = `AND l.user_id = $${values.length}`;
  }

  const { rows } = await db.query(
    `
      SELECT
        l.*,
        u.email AS owner_email
      FROM links l
      JOIN users u ON u.id = l.user_id
      WHERE l.id = $1
      ${ownerClause}
      LIMIT 1;
    `,
    values,
  );

  return mapLink(rows[0]);
}

async function getInternalLinkByCode(shortCode) {
  const db = getPool();

  if (!db || !shortCode) {
    return null;
  }

  await ensureSchema();

  const { rows } = await db.query(
    `
      SELECT
        l.*,
        u.email AS owner_email
      FROM links l
      JOIN users u ON u.id = l.user_id
      WHERE l.provider = 'internal'
        AND l.short_code = $1
      ORDER BY l.created_at DESC
      LIMIT 1;
    `,
    [shortCode],
  );

  return mapLink(rows[0]);
}

async function listRedirectLinksByCode(shortCode) {
  const db = getPool();

  if (!db || !shortCode) {
    return [];
  }

  await ensureSchema();

  const { rows } = await db.query(
    `
      SELECT
        l.*,
        u.email AS owner_email
      FROM links l
      JOIN users u ON u.id = l.user_id
      WHERE l.short_code = $1
      ORDER BY
        CASE WHEN l.provider = 'internal' THEN 0 ELSE 1 END ASC,
        l.created_at DESC;
    `,
    [shortCode],
  );

  return rows.map(mapLink);
}

async function updateLink(id, updates, { userId, isAdmin = false }) {
  const db = getPool();

  if (!db) {
    throw new Error("DATABASE_URL is required");
  }

  await ensureSchema();

  const setClauses = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(updates, "title")) {
    values.push(updates.title || null);
    setClauses.push(`title = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "isActive")) {
    values.push(Boolean(updates.isActive));
    setClauses.push(`is_active = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "expiresAt")) {
    values.push(updates.expiresAt || null);
    setClauses.push(`expires_at = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "shortCode")) {
    values.push(updates.shortCode || null);
    setClauses.push(`short_code = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "providerLinkId")) {
    values.push(updates.providerLinkId || null);
    setClauses.push(`provider_link_id = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "customSlug")) {
    values.push(updates.customSlug || null);
    setClauses.push(`custom_slug = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "shortUrl")) {
    values.push(updates.shortUrl || null);
    setClauses.push(`short_url = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "qrConfig")) {
    values.push(JSON.stringify(updates.qrConfig || {}));
    setClauses.push(`qr_config = $${values.length}::jsonb`);
  }

  if (setClauses.length === 0) {
    return getLinkById(id, { userId, isAdmin });
  }

  values.push(id);
  const idIndex = values.length;
  let ownerClause = "";

  if (!isAdmin) {
    values.push(userId);
    ownerClause = `AND user_id = $${values.length}`;
  }

  const { rows } = await db.query(
    `
      UPDATE links
      SET ${setClauses.join(", ")}
      WHERE id = $${idIndex}
      ${ownerClause}
      RETURNING *;
    `,
    values,
  );

  return mapLink(rows[0]);
}

async function deleteLink(id, { userId, isAdmin = false }) {
  const db = getPool();

  if (!db) {
    throw new Error("DATABASE_URL is required");
  }

  await ensureSchema();

  const values = [id];
  let ownerClause = "";

  if (!isAdmin) {
    values.push(userId);
    ownerClause = `AND user_id = $${values.length}`;
  }

  const { rows } = await db.query(
    `
      DELETE FROM links
      WHERE id = $1
      ${ownerClause}
      RETURNING *;
    `,
    values,
  );

  return mapLink(rows[0]);
}

async function recordClick({ linkId, referrer, userAgent, ipHash }) {
  const db = getPool();

  if (!db) {
    return;
  }

  await ensureSchema();

  await db.query(
    `
      INSERT INTO click_events (link_id, referrer, user_agent, ip_hash)
      VALUES ($1, $2, $3, $4);
    `,
    [linkId, referrer || null, userAgent || null, ipHash || null],
  );

  await db.query(
    `
      UPDATE links
      SET
        click_count = click_count + 1,
        last_clicked_at = NOW()
      WHERE id = $1;
    `,
    [linkId],
  );
}

async function getDashboardSummary({ userId, isAdmin = false }) {
  const db = getPool();

  if (!db) {
    return {
      totalLinks: 0,
      activeLinks: 0,
      expiredLinks: 0,
      totalClicks: 0,
      internalLinks: 0,
      shortIoLinks: 0,
      usersCount: 0,
    };
  }

  await ensureSchema();

  const values = [];
  let whereSql = "";

  if (!isAdmin) {
    values.push(userId);
    whereSql = `WHERE l.user_id = $1`;
  }

  const summaryResult = await db.query(
    `
      SELECT
        COUNT(*)::int AS total_links,
        COUNT(*) FILTER (
          WHERE l.is_active = TRUE
            AND (l.expires_at IS NULL OR l.expires_at > NOW())
        )::int AS active_links,
        COUNT(*) FILTER (
          WHERE l.expires_at IS NOT NULL AND l.expires_at <= NOW()
        )::int AS expired_links,
        COALESCE(SUM(l.click_count), 0)::int AS total_clicks,
        COUNT(*) FILTER (WHERE l.provider = 'internal')::int AS internal_links,
        COUNT(*) FILTER (WHERE l.provider = 'shortio')::int AS shortio_links
      FROM links l
      ${whereSql};
    `,
    values,
  );

  const usersResult = isAdmin
    ? await db.query("SELECT COUNT(*)::int AS users_count FROM users;")
    : { rows: [{ users_count: 0 }] };

  return {
    totalLinks: summaryResult.rows[0]?.total_links || 0,
    activeLinks: summaryResult.rows[0]?.active_links || 0,
    expiredLinks: summaryResult.rows[0]?.expired_links || 0,
    totalClicks: summaryResult.rows[0]?.total_clicks || 0,
    internalLinks: summaryResult.rows[0]?.internal_links || 0,
    shortIoLinks: summaryResult.rows[0]?.shortio_links || 0,
    usersCount: usersResult.rows[0]?.users_count || 0,
  };
}

async function getClickSeries({ userId, isAdmin = false, days = 7 }) {
  const db = getPool();

  if (!db) {
    return [];
  }

  await ensureSchema();

  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 90);
  const values = [safeDays];
  let internalOwnerClause = "";
  let shortIoOwnerClause = "";

  if (!isAdmin) {
    values.push(userId);
    internalOwnerClause = `AND l.user_id = $${values.length}`;
    shortIoOwnerClause = `AND l.user_id = $${values.length}`;
  }

  const { rows } = await db.query(
    `
      WITH requested_days AS (
        SELECT GENERATE_SERIES(
          CURRENT_DATE - ($1::int - 1),
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS stat_date
      ),
      internal_clicks AS (
        SELECT
          DATE_TRUNC('day', c.clicked_at)::date AS stat_date,
          COUNT(*)::int AS clicks
        FROM click_events c
        JOIN links l ON l.id = c.link_id
        WHERE c.clicked_at >= CURRENT_DATE - ($1::int - 1)
        ${internalOwnerClause}
        GROUP BY 1
      ),
      shortio_clicks AS (
        SELECT
          s.stat_date,
          COALESCE(SUM(s.human_clicks), 0)::int AS clicks
        FROM shortio_link_daily_stats s
        JOIN links l ON l.id = s.link_id
        WHERE s.stat_date >= CURRENT_DATE - ($1::int - 1)
        ${shortIoOwnerClause}
        GROUP BY 1
      )
      SELECT
        TO_CHAR(d.stat_date, 'YYYY-MM-DD') AS day,
        (
          COALESCE(i.clicks, 0) + COALESCE(s.clicks, 0)
        )::int AS clicks
      FROM requested_days d
      LEFT JOIN internal_clicks i ON i.stat_date = d.stat_date
      LEFT JOIN shortio_clicks s ON s.stat_date = d.stat_date
      ORDER BY d.stat_date ASC;
    `,
    values,
  );

  return rows.map((row) => ({
    day: row.day,
    clicks: row.clicks,
  }));
}

async function getTopLinks({ userId, isAdmin = false, limit = 5 }) {
  const db = getPool();

  if (!db) {
    return [];
  }

  await ensureSchema();

  const values = [Math.min(Math.max(limit, 1), 10)];
  let whereSql = "";

  if (!isAdmin) {
    values.push(userId);
    whereSql = `WHERE l.user_id = $${values.length}`;
  }

  const { rows } = await db.query(
    `
      SELECT
        l.*,
        u.email AS owner_email
      FROM links l
      JOIN users u ON u.id = l.user_id
      ${whereSql}
      ORDER BY l.click_count DESC, l.created_at DESC
      LIMIT $1;
    `,
    values,
  );

  return rows.map(mapLink);
}

async function logAudit({
  userId = null,
  action,
  entityType,
  entityId = null,
  payload = {},
}) {
  const db = getPool();

  if (!db) {
    return;
  }

  await ensureSchema();

  await db.query(
    `
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb);
    `,
    [userId, action, entityType, entityId, JSON.stringify(payload || {})],
  );
}

async function listAuditLogs({ userId, isAdmin = false, limit = 10 }) {
  const db = getPool();

  if (!db) {
    return [];
  }

  await ensureSchema();

  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const values = [safeLimit];
  let whereSql = "";

  if (!isAdmin) {
    values.push(userId);
    whereSql = `WHERE a.user_id = $${values.length}`;
  }

  const { rows } = await db.query(
    `
      SELECT
        a.*,
        u.email AS actor_email,
        u.name AS actor_name
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT $1;
    `,
    values,
  );

  return rows.map(mapAudit);
}

module.exports = {
  countUsers,
  createLink,
  createSession,
  createUser,
  deleteLink,
  deleteSession,
  ensureSchema,
  findSessionByTokenHash,
  findUserByEmail,
  findUserById,
  getDashboardSummary,
  getInternalLinkByCode,
  listRedirectLinksByCode,
  getLinkById,
  getPool,
  getClickSeries,
  getShortIoTrafficInsights,
  getTopLinks,
  listAuditLogs,
  listLinks,
  listShortIoLinksForSync,
  listUsers,
  logAudit,
  markShortIoLinkSyncStatus,
  mapLink,
  recordClick,
  upsertShortIoAnalyticsSnapshot,
  updateShortIoClickCounts,
  upsertImportedShortIoLink,
  updateLink,
};

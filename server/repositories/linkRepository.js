const { getPool } = require("../config/database");

function mapLink(row) {
  if (!row) return null;
  return {
    id: row.id, title: row.title, original: row.original_url, short: row.short_url,
    shortCode: row.short_code, providerLinkId: row.provider_link_id, customSlug: row.custom_slug,
    provider: row.provider, requestedProvider: row.requested_provider, isActive: row.is_active,
    expiresAt: row.expires_at, clickCount: Number(row.click_count || 0),
    lastProviderSyncAt: row.last_provider_sync_at || null,
    providerSyncStatus: row.provider_sync_status || "pending",
    providerSyncError: row.provider_sync_error || null,
    lastProviderTotalClicks: Number(row.last_provider_total_clicks || 0),
    lastProviderHumanClicks: Number(row.last_provider_human_clicks || 0),
    lastProviderPeriodKey: row.last_provider_period_key || null,
    lastProviderPeriodHumanClicks: Number(row.last_provider_period_human_clicks || 0),
    lastClickedAt: row.last_clicked_at, ownerId: row.user_id, ownerEmail: row.owner_email || null,
    qrConfig: row.qr_config || {}, createdAt: row.created_at,
    timestamp: new Date(row.created_at).toLocaleString(),
  };
}

function buildLinkFilters({ userId, isAdmin, search, provider, status, ownerId }) {
  const clauses = [];
  const values = [];
  if (!isAdmin && userId) { values.push(userId); clauses.push(`l.user_id = $${values.length}`); }
  if (isAdmin && ownerId) { values.push(ownerId); clauses.push(`l.user_id = $${values.length}`); }
  if (provider && provider !== "all") { values.push(provider); clauses.push(`l.provider = $${values.length}`); }
  if (status === "active") { clauses.push("l.is_active = TRUE"); clauses.push("(l.expires_at IS NULL OR l.expires_at > NOW())"); }
  else if (status === "inactive") { clauses.push("l.is_active = FALSE"); }
  else if (status === "expired") { clauses.push("l.expires_at IS NOT NULL AND l.expires_at <= NOW()"); }
  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    clauses.push(`(LOWER(COALESCE(l.title, '')) LIKE $${values.length} OR LOWER(l.original_url) LIKE $${values.length} OR LOWER(l.short_url) LIKE $${values.length} OR LOWER(COALESCE(l.short_code, '')) LIKE $${values.length} OR LOWER(COALESCE(l.custom_slug, '')) LIKE $${values.length})`);
  }
  return { values, whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "" };
}

async function createLink({ userId, title, originalUrl, shortUrl, shortCode = null, providerLinkId = null, customSlug = null, provider = "shortio", requestedProvider = provider, expiresAt = null, qrConfig = {} }) {
  const db = getPool();
  if (!db) throw new Error("DATABASE_URL is required");
  const { rows } = await db.query(
    `INSERT INTO links (user_id, title, original_url, short_url, short_code, provider_link_id, custom_slug, provider, requested_provider, expires_at, qr_config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) RETURNING *;`,
    [userId, title || null, originalUrl, shortUrl, shortCode, providerLinkId, customSlug, provider, requestedProvider, expiresAt, JSON.stringify(qrConfig || {})],
  );
  return mapLink(rows[0]);
}

async function upsertImportedShortIoLink({ userId, title, originalUrl, shortUrl, shortCode = null, providerLinkId, customSlug = null, isActive = true, expiresAt = null, createdAt = null, clickCount = 0 }) {
  const db = getPool();
  if (!db) throw new Error("DATABASE_URL is required");
  if (!providerLinkId) throw new Error("providerLinkId is required for Short.io import");
  const { rows } = await db.query(
    `INSERT INTO links (user_id, title, original_url, short_url, short_code, provider_link_id, custom_slug, provider, requested_provider, is_active, expires_at, click_count, qr_config, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'shortio', 'shortio', $8, $9, $11, '{}'::jsonb, COALESCE($10, NOW()))
     ON CONFLICT (provider, provider_link_id) WHERE provider = 'shortio' AND provider_link_id IS NOT NULL
     DO UPDATE SET title = EXCLUDED.title, original_url = EXCLUDED.original_url, short_url = EXCLUDED.short_url, short_code = EXCLUDED.short_code, provider_link_id = EXCLUDED.provider_link_id, custom_slug = EXCLUDED.custom_slug, is_active = EXCLUDED.is_active, expires_at = EXCLUDED.expires_at, click_count = EXCLUDED.click_count
     RETURNING *, (xmax = 0) AS inserted;`,
    [userId, title || null, originalUrl, shortUrl, shortCode, providerLinkId, customSlug, Boolean(isActive), expiresAt, createdAt, Number(clickCount || 0)],
  );
  return { link: mapLink(rows[0]), inserted: Boolean(rows[0]?.inserted) };
}

async function listLinks({ userId, isAdmin = false, search = "", provider = "all", status = "all", ownerId = null, limit = 20, page = 1 }) {
  const db = getPool();
  if (!db) return { links: [], total: 0 };
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const filters = buildLinkFilters({ userId, isAdmin, search, provider, status, ownerId });
  const listValues = [...filters.values, safeLimit, offset];
  const countValues = [...filters.values];
  const [listResult, countResult] = await Promise.all([
    db.query(`SELECT l.*, u.email AS owner_email FROM links l JOIN users u ON u.id = l.user_id ${filters.whereSql} ORDER BY l.created_at DESC LIMIT $${listValues.length - 1} OFFSET $${listValues.length};`, listValues),
    db.query(`SELECT COUNT(*)::int AS total FROM links l ${filters.whereSql};`, countValues),
  ]);
  return { links: listResult.rows.map(mapLink), total: countResult.rows[0]?.total || 0 };
}

async function listShortIoLinksForSync({ userId, isAdmin = false, ownerId = null }) {
  const db = getPool();
  if (!db) return [];
  const filters = buildLinkFilters({ userId, isAdmin, search: "", provider: "shortio", status: "all", ownerId });
  const { rows } = await db.query(
    `SELECT l.id, l.title, l.short_url, l.short_code, l.original_url, l.provider_link_id, l.click_count, l.last_provider_sync_at, l.provider_sync_status, l.provider_sync_error, l.last_provider_total_clicks, l.last_provider_human_clicks, l.last_provider_period_key, l.last_provider_period_human_clicks, l.created_at FROM links l ${filters.whereSql} AND l.provider_link_id IS NOT NULL ORDER BY l.created_at DESC;`,
    filters.values,
  );
  return rows.map((row) => ({
    id: row.id, title: row.title, shortUrl: row.short_url, shortCode: row.short_code, originalUrl: row.original_url, providerLinkId: row.provider_link_id, clickCount: Number(row.click_count || 0),
    lastProviderSyncAt: row.last_provider_sync_at || null, providerSyncStatus: row.provider_sync_status || "pending", providerSyncError: row.provider_sync_error || null,
    lastProviderTotalClicks: Number(row.last_provider_total_clicks || 0), lastProviderHumanClicks: Number(row.last_provider_human_clicks || 0),
    lastProviderPeriodKey: row.last_provider_period_key || null, lastProviderPeriodHumanClicks: Number(row.last_provider_period_human_clicks || 0), createdAt: row.created_at,
  }));
}

async function getLinkById(id, { userId, isAdmin = false }) {
  const db = getPool();
  if (!db) return null;
  const values = [id];
  let ownerClause = "";
  if (!isAdmin) { values.push(userId); ownerClause = `AND l.user_id = $${values.length}`; }
  const { rows } = await db.query(`SELECT l.*, u.email AS owner_email FROM links l JOIN users u ON u.id = l.user_id WHERE l.id = $1 ${ownerClause} LIMIT 1;`, values);
  return mapLink(rows[0]);
}

async function getInternalLinkByCode(shortCode) {
  const db = getPool();
  if (!db || !shortCode) return null;
  const { rows } = await db.query(`SELECT l.*, u.email AS owner_email FROM links l JOIN users u ON u.id = l.user_id WHERE l.provider = 'internal' AND l.short_code = $1 ORDER BY l.created_at DESC LIMIT 1;`, [shortCode]);
  return mapLink(rows[0]);
}

async function listRedirectLinksByCode(shortCode) {
  const db = getPool();
  if (!db || !shortCode) return [];
  const { rows } = await db.query(`SELECT l.*, u.email AS owner_email FROM links l JOIN users u ON u.id = l.user_id WHERE l.short_code = $1 ORDER BY CASE WHEN l.provider = 'internal' THEN 0 ELSE 1 END ASC, l.created_at DESC;`, [shortCode]);
  return rows.map(mapLink);
}

async function updateLink(id, updates, { userId, isAdmin = false }) {
  const db = getPool();
  if (!db) throw new Error("DATABASE_URL is required");
  const setClauses = [];
  const values = [];
  const fields = { title: "title", isActive: "is_active", expiresAt: "expires_at", shortCode: "short_code", providerLinkId: "provider_link_id", customSlug: "custom_slug", shortUrl: "short_url" };
  for (const [key, col] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      values.push(key === "isActive" ? Boolean(updates[key]) : (updates[key] || null));
      setClauses.push(`${col} = $${values.length}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, "qrConfig")) {
    values.push(JSON.stringify(updates.qrConfig || {}));
    setClauses.push(`qr_config = $${values.length}::jsonb`);
  }
  if (setClauses.length === 0) return getLinkById(id, { userId, isAdmin });
  values.push(id);
  const idIndex = values.length;
  let ownerClause = "";
  if (!isAdmin) { values.push(userId); ownerClause = `AND user_id = $${values.length}`; }
  const { rows } = await db.query(`UPDATE links SET ${setClauses.join(", ")} WHERE id = $${idIndex} ${ownerClause} RETURNING *;`, values);
  return mapLink(rows[0]);
}

async function deleteLink(id, { userId, isAdmin = false }) {
  const db = getPool();
  if (!db) throw new Error("DATABASE_URL is required");
  const values = [id];
  let ownerClause = "";
  if (!isAdmin) { values.push(userId); ownerClause = `AND user_id = $${values.length}`; }
  const { rows } = await db.query(`DELETE FROM links WHERE id = $1 ${ownerClause} RETURNING *;`, values);
  return mapLink(rows[0]);
}

async function recordClick({ linkId, referrer, userAgent, ipHash }) {
  const db = getPool();
  if (!db) return;
  await db.query(
    `WITH inserted AS (INSERT INTO click_events (link_id, referrer, user_agent, ip_hash) VALUES ($1, $2, $3, $4))
     UPDATE links SET click_count = click_count + 1, last_clicked_at = NOW() WHERE id = $1;`,
    [linkId, referrer || null, userAgent || null, ipHash || null],
  );
}

module.exports = {
  buildLinkFilters, createLink, deleteLink, getInternalLinkByCode, getLinkById,
  listLinks, listRedirectLinksByCode, listShortIoLinksForSync, mapLink, recordClick,
  updateLink, upsertImportedShortIoLink,
};

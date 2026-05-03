const { getPool } = require("../config/database");
const { mapLink } = require("./linkRepository");

async function updateShortIoClickCounts(clicksByProviderLinkId = {}) {
  const db = getPool();
  if (!db) return 0;
  const updates = Object.entries(clicksByProviderLinkId)
    .map(([providerLinkId, payload]) => {
      const details = payload && typeof payload === "object" ? payload : { clickCount: payload, totalClicks: payload, humanClicks: payload };
      return {
        providerLinkId: String(providerLinkId || "").trim(),
        clickCount: Math.max(0, Math.trunc(Number(details.clickCount) || 0)),
        totalClicks: Math.max(0, Math.trunc(Number(details.totalClicks ?? details.clickCount) || 0)),
        humanClicks: Math.max(0, Math.trunc(Number(details.humanClicks ?? details.clickCount) || 0)),
      };
    })
    .filter((item) => item.providerLinkId);
  if (updates.length === 0) return 0;
  const values = [];
  const tuples = updates.map((item, index) => {
    values.push(item.providerLinkId, item.clickCount, item.totalClicks, item.humanClicks);
    const base = index * 4;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });
  const result = await db.query(
    `UPDATE links AS l SET click_count = v.click_count::integer, last_provider_total_clicks = v.total_clicks::integer, last_provider_human_clicks = v.human_clicks::integer, last_provider_sync_at = NOW(), provider_sync_status = 'ok', provider_sync_error = NULL
     FROM (VALUES ${tuples.join(", ")}) AS v(provider_link_id, click_count, total_clicks, human_clicks)
     WHERE l.provider = 'shortio' AND l.provider_link_id = v.provider_link_id
       AND (l.click_count IS DISTINCT FROM v.click_count::integer OR l.last_provider_total_clicks IS DISTINCT FROM v.total_clicks::integer OR l.last_provider_human_clicks IS DISTINCT FROM v.human_clicks::integer OR l.provider_sync_status IS DISTINCT FROM 'ok' OR l.provider_sync_error IS NOT NULL);`,
    values,
  );
  return Number(result.rowCount || 0);
}

async function markShortIoLinkSyncStatus({ linkId, providerLinkId = null, syncStatus = "ok", syncError = null, totalClicks = null, humanClicks = null, periodKey = null, periodHumanClicks = null, syncedAt = new Date() }) {
  const db = getPool();
  if (!db) return 0;
  const whereClauses = [];
  const values = [];
  if (linkId) { values.push(linkId); whereClauses.push(`id = $${values.length}`); }
  if (providerLinkId) { values.push(providerLinkId); whereClauses.push(`provider_link_id = $${values.length}`); }
  if (whereClauses.length === 0) return 0;
  values.push(syncStatus || "pending");
  values.push(syncError || null);
  values.push(syncedAt);
  values.push(totalClicks == null ? null : Math.max(0, Math.trunc(Number(totalClicks) || 0)));
  values.push(humanClicks == null ? null : Math.max(0, Math.trunc(Number(humanClicks) || 0)));
  values.push(periodKey || null);
  values.push(periodHumanClicks == null ? null : Math.max(0, Math.trunc(Number(periodHumanClicks) || 0)));
  const result = await db.query(
    `UPDATE links SET provider_sync_status = $${values.length - 6}, provider_sync_error = $${values.length - 5}, last_provider_sync_at = $${values.length - 4}, last_provider_total_clicks = COALESCE($${values.length - 3}, last_provider_total_clicks), last_provider_human_clicks = COALESCE($${values.length - 2}, last_provider_human_clicks), last_provider_period_key = COALESCE($${values.length - 1}, last_provider_period_key), last_provider_period_human_clicks = COALESCE($${values.length}, last_provider_period_human_clicks) WHERE provider = 'shortio' AND (${whereClauses.join(" OR ")});`,
    values,
  );
  return Number(result.rowCount || 0);
}

async function upsertShortIoAnalyticsSnapshot({ linkId, humanClicks = 0, totalClicks = 0, dailyStats = [], breakdowns = {}, periodKey = "last30", syncedAt = new Date() }) {
  const db = getPool();
  if (!db) return { updatedLink: false, dailyStats: 0, breakdowns: 0 };
  const safeHumanClicks = Math.max(0, Math.trunc(Number(humanClicks) || 0));
  const safeTotalClicks = Math.max(0, Math.trunc(Number(totalClicks) || 0));
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const normalizedDailyStats = dailyStats.map((item) => ({ statDate: item?.statDate || null, humanClicks: Math.max(0, Math.trunc(Number(item?.humanClicks) || 0)), totalClicks: Math.max(0, Math.trunc(Number(item?.totalClicks ?? item?.humanClicks) || 0)) })).filter((item) => item.statDate);
    const periodHumanClicks = normalizedDailyStats.reduce((total, item) => total + item.humanClicks, 0);
    await client.query(`UPDATE links SET last_provider_sync_at = $2, provider_sync_status = 'ok', provider_sync_error = NULL, last_provider_total_clicks = $3, last_provider_human_clicks = $4, last_provider_period_key = $5, last_provider_period_human_clicks = $6 WHERE id = $1 AND provider = 'shortio';`, [linkId, syncedAt, safeTotalClicks, safeHumanClicks, periodKey, periodHumanClicks]);
    if (normalizedDailyStats.length > 0) {
      const sortedDates = normalizedDailyStats.map((item) => item.statDate).sort();
      await client.query(`DELETE FROM shortio_link_daily_stats WHERE link_id = $1 AND stat_date BETWEEN $2::date AND $3::date;`, [linkId, sortedDates[0], sortedDates[sortedDates.length - 1]]);
      const vals = [];
      const tups = normalizedDailyStats.map((item, index) => { vals.push(linkId, item.statDate, item.humanClicks, item.totalClicks, syncedAt); const base = index * 5; return `($${base + 1}, $${base + 2}::date, $${base + 3}, $${base + 4}, $${base + 5})`; });
      await client.query(`INSERT INTO shortio_link_daily_stats (link_id, stat_date, human_clicks, total_clicks, synced_at) VALUES ${tups.join(", ")} ON CONFLICT (link_id, stat_date) DO UPDATE SET human_clicks = EXCLUDED.human_clicks, total_clicks = EXCLUDED.total_clicks, synced_at = EXCLUDED.synced_at;`, vals);
    }
    let breakdownRows = 0;
    for (const [dimension, items] of Object.entries(breakdowns || {})) {
      await client.query(`DELETE FROM shortio_link_breakdowns WHERE link_id = $1 AND period_key = $2 AND dimension = $3;`, [linkId, periodKey, dimension]);
      const normalizedItems = (Array.isArray(items) ? items : []).map((item) => ({ valueKey: String(item?.valueKey || "").trim(), valueLabel: String(item?.valueLabel || item?.valueKey || "").trim(), clicks: Math.max(0, Math.trunc(Number(item?.clicks) || 0)) })).filter((item) => item.valueKey);
      if (normalizedItems.length === 0) continue;
      breakdownRows += normalizedItems.length;
      const vals = [];
      const tups = normalizedItems.map((item, index) => { vals.push(linkId, periodKey, dimension, item.valueKey, item.valueLabel || null, item.clicks, syncedAt); const base = index * 7; return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`; });
      await client.query(`INSERT INTO shortio_link_breakdowns (link_id, period_key, dimension, value_key, value_label, clicks, synced_at) VALUES ${tups.join(", ")} ON CONFLICT (link_id, period_key, dimension, value_key) DO UPDATE SET value_label = EXCLUDED.value_label, clicks = EXCLUDED.clicks, synced_at = EXCLUDED.synced_at;`, vals);
    }
    await client.query("COMMIT");
    return { updatedLink: false, dailyStats: normalizedDailyStats.length, breakdowns: breakdownRows, totalClicks: safeTotalClicks, humanClicks: safeHumanClicks };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function getShortIoTrafficInsights({ userId, isAdmin = false, ownerId = null, periodKey = "last30", limit = 5 }) {
  const db = getPool();
  if (!db) return { lastSyncedAt: null, country: [], browser: [], os: [], city: [], referer: [], summary: { periodKey, lifetimeClicks: 0, periodClicks: 0, syncedLinks: 0 } };
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 10);
  const dimensions = ["country", "browser", "os", "city", "referer"];
  const breakdownValues = [dimensions, periodKey];
  let breakdownOwnerClause = "";
  const syncValues = [];
  let syncOwnerClause = "";
  const summaryValues = [];
  let summaryOwnerClause = "";
  if (!isAdmin) {
    breakdownValues.push(userId); breakdownOwnerClause = `AND l.user_id = $${breakdownValues.length}`;
    syncValues.push(userId); syncOwnerClause = `AND l.user_id = $${syncValues.length}`;
    summaryValues.push(userId); summaryOwnerClause = `AND l.user_id = $${summaryValues.length}`;
  } else if (ownerId) {
    breakdownValues.push(ownerId); breakdownOwnerClause = `AND l.user_id = $${breakdownValues.length}`;
    syncValues.push(ownerId); syncOwnerClause = `AND l.user_id = $${syncValues.length}`;
    summaryValues.push(ownerId); summaryOwnerClause = `AND l.user_id = $${summaryValues.length}`;
  }
  const [breakdownResult, syncResult, summaryResult] = await Promise.all([
    db.query(`SELECT b.dimension, COALESCE(NULLIF(b.value_label, ''), b.value_key) AS label, b.value_key, SUM(b.clicks)::int AS clicks FROM shortio_link_breakdowns b JOIN links l ON l.id = b.link_id WHERE b.dimension = ANY($1::text[]) AND b.period_key = $2 ${breakdownOwnerClause} GROUP BY b.dimension, label, b.value_key ORDER BY b.dimension ASC, clicks DESC, label ASC;`, breakdownValues),
    db.query(`SELECT MAX(s.synced_at) AS last_synced_at FROM shortio_link_daily_stats s JOIN links l ON l.id = s.link_id WHERE 1 = 1 ${syncOwnerClause};`, syncValues),
    db.query(`SELECT COALESCE(SUM(l.click_count), 0)::int AS lifetime_clicks, COALESCE(SUM(l.last_provider_period_human_clicks), 0)::int AS period_clicks, COUNT(*) FILTER (WHERE l.last_provider_sync_at IS NOT NULL)::int AS synced_links FROM links l WHERE l.provider = 'shortio' ${summaryOwnerClause};`, summaryValues),
  ]);
  const grouped = { country: [], browser: [], os: [], city: [], referer: [] };
  for (const row of breakdownResult.rows) { const bucket = grouped[row.dimension]; if (!bucket || bucket.length >= safeLimit) continue; bucket.push({ label: row.label, valueKey: row.value_key, clicks: Number(row.clicks || 0) }); }
  return { lastSyncedAt: syncResult.rows[0]?.last_synced_at || null, ...grouped, summary: { periodKey, lifetimeClicks: Number(summaryResult.rows[0]?.lifetime_clicks || 0), periodClicks: Number(summaryResult.rows[0]?.period_clicks || 0), syncedLinks: Number(summaryResult.rows[0]?.synced_links || 0) } };
}

async function getDashboardSummary({ userId, isAdmin = false }) {
  const db = getPool();
  if (!db) return { totalLinks: 0, activeLinks: 0, expiredLinks: 0, totalClicks: 0, internalLinks: 0, shortIoLinks: 0, usersCount: 0 };
  const values = [];
  let whereSql = "";
  if (!isAdmin) { values.push(userId); whereSql = `WHERE l.user_id = $1`; }
  const summaryResult = await db.query(`SELECT COUNT(*)::int AS total_links, COUNT(*) FILTER (WHERE l.is_active = TRUE AND (l.expires_at IS NULL OR l.expires_at > NOW()))::int AS active_links, COUNT(*) FILTER (WHERE l.expires_at IS NOT NULL AND l.expires_at <= NOW())::int AS expired_links, COALESCE(SUM(l.click_count), 0)::int AS total_clicks, COUNT(*) FILTER (WHERE l.provider = 'internal')::int AS internal_links, COUNT(*) FILTER (WHERE l.provider = 'shortio')::int AS shortio_links FROM links l ${whereSql};`, values);
  const usersResult = isAdmin ? await db.query("SELECT COUNT(*)::int AS users_count FROM users;") : { rows: [{ users_count: 0 }] };
  return { totalLinks: summaryResult.rows[0]?.total_links || 0, activeLinks: summaryResult.rows[0]?.active_links || 0, expiredLinks: summaryResult.rows[0]?.expired_links || 0, totalClicks: summaryResult.rows[0]?.total_clicks || 0, internalLinks: summaryResult.rows[0]?.internal_links || 0, shortIoLinks: summaryResult.rows[0]?.shortio_links || 0, usersCount: usersResult.rows[0]?.users_count || 0 };
}

async function getClickSeries({ userId, isAdmin = false, days = 7 }) {
  const db = getPool();
  if (!db) return [];
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 90);
  const values = [safeDays];
  let internalOwnerClause = "";
  let shortIoOwnerClause = "";
  if (!isAdmin) { values.push(userId); internalOwnerClause = `AND l.user_id = $${values.length}`; shortIoOwnerClause = `AND l.user_id = $${values.length}`; }
  const { rows } = await db.query(`WITH requested_days AS (SELECT GENERATE_SERIES(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, INTERVAL '1 day')::date AS stat_date), internal_clicks AS (SELECT DATE_TRUNC('day', c.clicked_at)::date AS stat_date, COUNT(*)::int AS clicks FROM click_events c JOIN links l ON l.id = c.link_id WHERE c.clicked_at >= CURRENT_DATE - ($1::int - 1) ${internalOwnerClause} GROUP BY 1), shortio_clicks AS (SELECT s.stat_date, COALESCE(SUM(s.human_clicks), 0)::int AS clicks FROM shortio_link_daily_stats s JOIN links l ON l.id = s.link_id WHERE s.stat_date >= CURRENT_DATE - ($1::int - 1) ${shortIoOwnerClause} GROUP BY 1) SELECT TO_CHAR(d.stat_date, 'YYYY-MM-DD') AS day, (COALESCE(i.clicks, 0) + COALESCE(s.clicks, 0))::int AS clicks FROM requested_days d LEFT JOIN internal_clicks i ON i.stat_date = d.stat_date LEFT JOIN shortio_clicks s ON s.stat_date = d.stat_date ORDER BY d.stat_date ASC;`, values);
  return rows.map((row) => ({ day: row.day, clicks: row.clicks }));
}

async function getTopLinks({ userId, isAdmin = false, limit = 5 }) {
  const db = getPool();
  if (!db) return [];
  const values = [Math.min(Math.max(limit, 1), 10)];
  let whereSql = "";
  if (!isAdmin) { values.push(userId); whereSql = `WHERE l.user_id = $${values.length}`; }
  const { rows } = await db.query(`SELECT l.*, u.email AS owner_email FROM links l JOIN users u ON u.id = l.user_id ${whereSql} ORDER BY l.click_count DESC, l.created_at DESC LIMIT $1;`, values);
  return rows.map(mapLink);
}

module.exports = {
  getDashboardSummary, getClickSeries, getShortIoTrafficInsights, getTopLinks,
  markShortIoLinkSyncStatus, updateShortIoClickCounts, upsertShortIoAnalyticsSnapshot,
};

const { getPool } = require("../config/database");

function mapAudit(row) {
  if (!row) return null;
  return {
    id: row.id, action: row.action, entityType: row.entity_type, entityId: row.entity_id,
    payload: row.payload || {}, createdAt: row.created_at,
    actorEmail: row.actor_email || null, actorName: row.actor_name || null,
  };
}

async function logAudit({ userId = null, action, entityType, entityId = null, payload = {} }) {
  const db = getPool();
  if (!db) return;
  await db.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb);`,
    [userId, action, entityType, entityId, JSON.stringify(payload || {})],
  );
}

async function listAuditLogs({ userId, isAdmin = false, limit = 10 }) {
  const db = getPool();
  if (!db) return [];
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const values = [safeLimit];
  let whereSql = "";
  if (!isAdmin) { values.push(userId); whereSql = `WHERE a.user_id = $${values.length}`; }
  const { rows } = await db.query(
    `SELECT a.*, u.email AS actor_email, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${whereSql} ORDER BY a.created_at DESC LIMIT $1;`,
    values,
  );
  return rows.map(mapAudit);
}

module.exports = { logAudit, listAuditLogs };

/**
 * Backward-compatible facade that re-exports everything from the
 * new repository modules. Existing consumers (routes, shortio.js, etc.)
 * continue to `require("./db")` without any changes.
 */

const { getPool } = require("./config/database");
const { ensureSchema } = require("./config/schema");

const { countUsers, createUser, findUserByEmail, findUserById, listUsers, mapUser } = require("./repositories/userRepository");
const { createSession, deleteExpiredSessions, deleteSession, findSessionByTokenHash } = require("./repositories/sessionRepository");
const { buildLinkFilters, createLink, deleteLink, getInternalLinkByCode, getLinkById, listLinks, listRedirectLinksByCode, listShortIoLinksForSync, mapLink, recordClick, updateLink, upsertImportedShortIoLink } = require("./repositories/linkRepository");
const { getDashboardSummary, getClickSeries, getShortIoTrafficInsights, getTopLinks, markShortIoLinkSyncStatus, updateShortIoClickCounts, upsertShortIoAnalyticsSnapshot } = require("./repositories/analyticsRepository");
const { logAudit, listAuditLogs } = require("./repositories/auditRepository");

module.exports = {
  // config
  getPool,
  ensureSchema,
  // users
  countUsers, createUser, findUserByEmail, findUserById, listUsers, mapUser,
  // sessions
  createSession, deleteExpiredSessions, deleteSession, findSessionByTokenHash,
  // links
  createLink, deleteLink, getInternalLinkByCode, getLinkById, listLinks,
  listRedirectLinksByCode, listShortIoLinksForSync, mapLink, recordClick,
  updateLink, upsertImportedShortIoLink,
  // analytics & sync
  getDashboardSummary, getClickSeries, getShortIoTrafficInsights, getTopLinks,
  markShortIoLinkSyncStatus, updateShortIoClickCounts, upsertShortIoAnalyticsSnapshot,
  // audit
  logAudit, listAuditLogs,
};

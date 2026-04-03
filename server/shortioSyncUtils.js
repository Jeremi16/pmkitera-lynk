function normalizeShortIoSyncStatus(status, { lastSyncedAt, staleAfterMs, now }) {
  if (status === "error") {
    return "error";
  }

  if (!lastSyncedAt) {
    return "pending";
  }

  const syncedAt = new Date(lastSyncedAt);
  if (Number.isNaN(syncedAt.getTime())) {
    return "pending";
  }

  if (Math.max(Number(staleAfterMs) || 0, 0) > 0) {
    const referenceNow =
      now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();

    if (referenceNow.getTime() - syncedAt.getTime() > staleAfterMs) {
      return "stale";
    }
  }

  return status || "ok";
}

function buildShortIoSyncHealth({ links = [], staleAfterMs = 0, now = new Date() }) {
  const items = Array.isArray(links) ? links : [];
  const statuses = items.map((link) =>
    normalizeShortIoSyncStatus(link.providerSyncStatus, {
      lastSyncedAt: link.lastProviderSyncAt,
      staleAfterMs,
      now,
    }),
  );

  return {
    totalLinks: items.length,
    syncedOk: statuses.filter((status) => status === "ok").length,
    stale: statuses.filter((status) => status === "stale").length,
    pending: statuses.filter((status) => status === "pending").length,
    failed: statuses.filter((status) => status === "error").length,
    lastSyncedAt: items.reduce((latest, link) => {
      if (!link.lastProviderSyncAt) {
        return latest;
      }

      if (!latest) {
        return link.lastProviderSyncAt;
      }

      return new Date(link.lastProviderSyncAt) > new Date(latest)
        ? link.lastProviderSyncAt
        : latest;
    }, null),
  };
}

function buildShortIoReconcileReport({
  providerLinks = [],
  dbLinks = [],
  providerClicksById = {},
  staleAfterMs = 0,
  now = new Date(),
}) {
  const liveLinks = Array.isArray(providerLinks) ? providerLinks : [];
  const storedLinks = Array.isArray(dbLinks) ? dbLinks : [];
  const dbByProviderId = new Map(
    storedLinks
      .filter((link) => link.providerLinkId)
      .map((link) => [String(link.providerLinkId), link]),
  );
  const providerById = new Map(
    liveLinks
      .filter((link) => link.providerLinkId)
      .map((link) => [String(link.providerLinkId), link]),
  );

  const missingInDatabase = liveLinks
    .filter((link) => !dbByProviderId.has(String(link.providerLinkId)))
    .map((link) => ({
      providerLinkId: link.providerLinkId,
      shortUrl: link.shortUrl,
      shortCode: link.shortCode,
      title: link.title || null,
      originalUrl: link.originalUrl,
      createdAt: link.createdAt || null,
    }));

  const missingInProvider = storedLinks
    .filter((link) => !providerById.has(String(link.providerLinkId)))
    .map((link) => ({
      id: link.id,
      providerLinkId: link.providerLinkId,
      shortUrl: link.shortUrl,
      shortCode: link.shortCode,
      title: link.title || null,
      clickCount: Number(link.clickCount || 0),
    }));

  const clickMismatches = liveLinks
    .map((link) => {
      const stored = dbByProviderId.get(String(link.providerLinkId));

      if (!stored) {
        return null;
      }

      const providerClicks = Number(
        providerClicksById[String(link.providerLinkId)] ?? 0,
      );
      const storedClicks = Number(stored.clickCount || 0);

      if (providerClicks === storedClicks) {
        return null;
      }

      return {
        id: stored.id,
        providerLinkId: link.providerLinkId,
        shortUrl: stored.shortUrl || link.shortUrl,
        title: stored.title || link.title || null,
        storedClicks,
        providerClicks,
        delta: providerClicks - storedClicks,
      };
    })
    .filter(Boolean)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));

  const staleSyncs = storedLinks
    .map((link) => ({
      id: link.id,
      providerLinkId: link.providerLinkId,
      shortUrl: link.shortUrl,
      title: link.title || null,
      syncStatus: normalizeShortIoSyncStatus(link.providerSyncStatus, {
        lastSyncedAt: link.lastProviderSyncAt,
        staleAfterMs,
        now,
      }),
      lastProviderSyncAt: link.lastProviderSyncAt || null,
      providerSyncError: link.providerSyncError || null,
    }))
    .filter((link) => link.syncStatus === "stale" || link.syncStatus === "error");

  return {
    summary: {
      providerCount: liveLinks.length,
      databaseCount: storedLinks.length,
      missingInDatabase: missingInDatabase.length,
      missingInProvider: missingInProvider.length,
      clickMismatches: clickMismatches.length,
      staleSyncs: staleSyncs.length,
    },
    missingInDatabase,
    missingInProvider,
    clickMismatches,
    staleSyncs,
  };
}

module.exports = {
  buildShortIoReconcileReport,
  buildShortIoSyncHealth,
  normalizeShortIoSyncStatus,
};

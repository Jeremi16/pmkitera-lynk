const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildShortIoReconcileReport,
  buildShortIoSyncHealth,
  normalizeShortIoSyncStatus,
} = require("../shortioSyncUtils");

test("normalizeShortIoSyncStatus marks stale links without overriding errors", () => {
  const now = new Date("2026-04-03T12:00:00.000Z");

  assert.equal(
    normalizeShortIoSyncStatus("ok", {
      lastSyncedAt: "2026-04-03T11:59:00.000Z",
      staleAfterMs: 5 * 60 * 1000,
      now,
    }),
    "ok",
  );

  assert.equal(
    normalizeShortIoSyncStatus("ok", {
      lastSyncedAt: "2026-04-03T11:00:00.000Z",
      staleAfterMs: 5 * 60 * 1000,
      now,
    }),
    "stale",
  );

  assert.equal(
    normalizeShortIoSyncStatus("error", {
      lastSyncedAt: "2026-04-03T11:00:00.000Z",
      staleAfterMs: 5 * 60 * 1000,
      now,
    }),
    "error",
  );
});

test("buildShortIoReconcileReport detects provider and click mismatches", () => {
  const report = buildShortIoReconcileReport({
    providerLinks: [
      {
        providerLinkId: "a",
        shortUrl: "https://s.example/a",
        shortCode: "a",
        originalUrl: "https://example.com/a",
      },
      {
        providerLinkId: "b",
        shortUrl: "https://s.example/b",
        shortCode: "b",
        originalUrl: "https://example.com/b",
      },
    ],
    dbLinks: [
      {
        id: 1,
        providerLinkId: "a",
        shortUrl: "https://s.example/a",
        title: "Alpha",
        clickCount: 10,
        providerSyncStatus: "ok",
        lastProviderSyncAt: "2026-04-03T11:00:00.000Z",
      },
      {
        id: 2,
        providerLinkId: "c",
        shortUrl: "https://s.example/c",
        title: "Gamma",
        clickCount: 7,
        providerSyncStatus: "error",
        lastProviderSyncAt: "2026-04-03T10:00:00.000Z",
      },
    ],
    providerClicksById: {
      a: 14,
      b: 3,
    },
    staleAfterMs: 30 * 60 * 1000,
    now: new Date("2026-04-03T12:00:00.000Z"),
  });

  assert.equal(report.summary.missingInDatabase, 1);
  assert.equal(report.summary.missingInProvider, 1);
  assert.equal(report.summary.clickMismatches, 1);
  assert.equal(report.summary.staleSyncs, 2);
  assert.equal(report.clickMismatches[0].delta, 4);
});

test("buildShortIoSyncHealth summarizes statuses correctly", () => {
  const health = buildShortIoSyncHealth({
    links: [
      {
        providerSyncStatus: "ok",
        lastProviderSyncAt: "2026-04-03T11:59:00.000Z",
      },
      {
        providerSyncStatus: "ok",
        lastProviderSyncAt: "2026-04-03T11:00:00.000Z",
      },
      {
        providerSyncStatus: "error",
        lastProviderSyncAt: "2026-04-03T11:30:00.000Z",
      },
      {
        providerSyncStatus: "pending",
        lastProviderSyncAt: null,
      },
    ],
    staleAfterMs: 5 * 60 * 1000,
    now: new Date("2026-04-03T12:00:00.000Z"),
  });

  assert.equal(health.totalLinks, 4);
  assert.equal(health.syncedOk, 1);
  assert.equal(health.stale, 1);
  assert.equal(health.failed, 1);
  assert.equal(health.pending, 1);
});

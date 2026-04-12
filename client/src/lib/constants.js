export const QR_STYLES = ["square", "dots", "rounded", "classy", "extra-rounded"];
export const CORNER_STYLES = ["square", "dot", "extra-rounded"];
export const PROVIDERS = {
  shortio: {
    label: "Short.io",
    description: "External provider with instant backup behavior",
  },
  internal: {
    label: "My system",
    description: "Self-hosted short codes backed by Neon",
  },
};
export const EMPTY_SUMMARY = {
  totalLinks: 0,
  activeLinks: 0,
  expiredLinks: 0,
  totalClicks: 0,
  internalLinks: 0,
  shortIoLinks: 0,
  usersCount: 0,
};
export const EMPTY_TRAFFIC_INSIGHTS = {
  lastSyncedAt: null,
  country: [],
  browser: [],
  os: [],
  city: [],
  referer: [],
  summary: {
    periodKey: "last30",
    lifetimeClicks: 0,
    periodClicks: 0,
    syncedLinks: 0,
  },
};
export const EMPTY_SYNC_HEALTH = {
  totalLinks: 0,
  syncedOk: 0,
  stale: 0,
  pending: 0,
  failed: 0,
  lastSyncedAt: null,
};
export const EMPTY_RECONCILE = {
  summary: {
    providerCount: 0,
    databaseCount: 0,
    missingInDatabase: 0,
    missingInProvider: 0,
    clickMismatches: 0,
    staleSyncs: 0,
  },
  missingInDatabase: [],
  missingInProvider: [],
  clickMismatches: [],
  staleSyncs: [],
};
export const EMPTY_NEW_USER_FORM = {
  name: "",
  email: "",
  password: "",
  role: "user",
};
export const TOKEN_STORAGE_KEY = "qr_shortener_token_storage";
export const QR_DEFAULT_SIZE = 1024;
export const DEFAULT_SETTINGS = {
  dotsColor: "#0f172a",
  backgroundColor: "#ffffff",
  dotsType: "rounded",
  cornersType: "extra-rounded",
  logo: null,
  gradient: false,
  gradientColor2: "#0ea5e9",
};

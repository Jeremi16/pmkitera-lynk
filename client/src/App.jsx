import React, { useDeferredValue, useEffect, useRef, useState } from "react";
import axios from "axios";
import QRCodeStyling from "qr-code-styling";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  History as HistoryIcon,
  Link as LinkIcon,
  Loader2,
  LogOut,
  Palette,
  QrCode,
  RefreshCcw,
  Search,
  Settings2,
  Shield,
  Trash2,
  Upload,
  UserRound,
  Globe,
  Zap,
} from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  withCredentials: true,
});

const QR_STYLES = ["square", "dots", "rounded", "classy", "extra-rounded"];
const CORNER_STYLES = ["square", "dot", "extra-rounded"];
const PROVIDERS = {
  shortio: {
    label: "Short.io",
    description: "External provider with instant backup behavior",
  },
  internal: {
    label: "My system",
    description: "Self-hosted short codes backed by Neon",
  },
};
const EMPTY_SUMMARY = {
  totalLinks: 0,
  activeLinks: 0,
  expiredLinks: 0,
  totalClicks: 0,
  internalLinks: 0,
  shortIoLinks: 0,
  usersCount: 0,
};
const EMPTY_TRAFFIC_INSIGHTS = {
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
const EMPTY_SYNC_HEALTH = {
  totalLinks: 0,
  syncedOk: 0,
  stale: 0,
  pending: 0,
  failed: 0,
  lastSyncedAt: null,
};
const EMPTY_RECONCILE = {
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
const EMPTY_NEW_USER_FORM = {
  name: "",
  email: "",
  password: "",
  role: "user",
};
const TOKEN_STORAGE_KEY = "qr_shortener_token_storage";
const DEFAULT_SETTINGS = {
    dotsColor: "#0f172a",
    backgroundColor: "#ffffff",
    dotsType: "rounded",
    cornersType: "extra-rounded",
    logo: null,
    gradient: false,
    gradientColor2: "#0ea5e9",
};

function formatApiError(error, fallback) {
  const detail = error?.response?.data?.details;
  const message = error?.response?.data?.error;

  if (Array.isArray(detail)) {
    return detail.join(" | ");
  }

  return detail || message || fallback;
}

function isUnauthorizedError(error) {
  return error?.response?.status === 401;
}

function formatDateTimeInput(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const offset = parsed.getTimezoneOffset();
  const adjusted = new Date(parsed.getTime() - offset * 60 * 1000);
  return adjusted.toISOString().slice(0, 16);
}

function formatReadableDate(value) {
  if (!value) {
    return "No expiry";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Invalid date";
  }

  return parsed.toLocaleString();
}

function isExpired(link) {
  return Boolean(link.expiresAt && new Date(link.expiresAt) <= new Date());
}

function getStatusLabel(link) {
  if (!link.isActive) {
    return "Inactive";
  }

  if (isExpired(link)) {
    return "Expired";
  }

  return "Active";
}

function SummaryCard({ label, value, tone = "slate", helper }) {
  return (
    <div className={cn("stat-card", `stat-card-${tone}`)}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {helper && <span className="stat-helper">{helper}</span>}
    </div>
  );
}

function MiniBarChart({ data }) {
  const max = Math.max(...data.map((item) => item.clicks), 1);

  return (
    <div className="space-y-3">
      {data.length === 0 ? (
        <div className="empty-state">
          <BarChart3 size={28} />
          <p>No clicks yet.</p>
        </div>
      ) : (
        data.map((item) => (
          <div key={item.day} className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{item.day}</span>
              <span>{item.clicks} clicks</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 to-amber-400"
                style={{ width: `${(item.clicks / max) * 100}%` }}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function InsightList({ title, items }) {
  return (
    <div className="panel-inset p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-900">{title}</p>
        <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
          Top 5
        </span>
      </div>

      {items.length === 0 ? (
        <div className="empty-state py-6">No synced data yet</div>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div
              key={`${title}-${item.valueKey || item.label}-${index}`}
              className="flex items-center justify-between gap-3"
            >
              <p className="text-sm text-slate-700 truncate">
                {index + 1}. {item.label}
              </p>
              <span className="text-xs font-bold text-slate-900">
                {item.clicks}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SyncMetricCard({ label, value, helper, tone = "slate" }) {
  const tones = {
    slate: "from-slate-50 to-white border-slate-100 text-slate-900",
    emerald: "from-emerald-50 to-white border-emerald-100 text-emerald-700",
    amber: "from-amber-50 to-white border-amber-100 text-amber-700",
    rose: "from-rose-50 to-white border-rose-100 text-rose-700",
    sky: "from-sky-50 to-white border-sky-100 text-sky-700",
  };

  return (
    <div className={cn("panel-inset p-4 bg-gradient-to-br", tones[tone] || tones.slate)}>
      <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400">
        {label}
      </p>
      <p className="text-2xl font-black mt-2">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{helper}</p>
    </div>
  );
}

function AuthScreen({
  authMode,
  authForm,
  authLoading,
  error,
  onChange,
  onSubmit,
  onToggleMode,
}) {
  return (
    <div className="min-h-screen auth-shell">
      <div className="auth-backdrop" />
      <div className="max-w-6xl mx-auto px-4 py-10 md:py-16 relative">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)] items-stretch">
          <section className="panel auth-hero">
            <div className="space-y-5">
              <span className="inline-flex items-center gap-2 badge badge-dark">
                <Shield size={14} />
                Secure Link Ops
              </span>
              <h1 className="text-4xl md:text-6xl font-black tracking-[-0.05em] leading-[0.95] text-slate-950">
                QR shortener with real auth, analytics, and provider fallback.
              </h1>
              <p className="text-base md:text-lg text-slate-600 max-w-2xl">
                Sign in to manage internal short links, Short.io backups, click
                analytics, expiry policies, and admin audit history from one
                workspace.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="feature-card">
                <LinkIcon size={18} />
                <strong>Link control</strong>
                <p>Create, disable, expire, and search links precisely.</p>
              </div>
              <div className="feature-card">
                <BarChart3 size={18} />
                <strong>Analytics</strong>
                <p>Track click volume, top links, and recent activity.</p>
              </div>
              <div className="feature-card">
                <Shield size={18} />
                <strong>Roles</strong>
                <p>Admin users can inspect audit trails and team-wide stats.</p>
              </div>
            </div>
          </section>

          <section className="panel auth-card">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                {authMode === "login" ? "Sign In" : "Create Account"}
              </p>
              <h2 className="text-2xl font-bold text-slate-900">
                {authMode === "login"
                  ? "Enter your workspace"
                  : "Provision your first operator"}
              </h2>
            </div>

            <form className="space-y-4" onSubmit={onSubmit}>
              {authMode === "register" && (
                <div className="space-y-2">
                  <label className="label-text">Name</label>
                  <input
                    className="input-field"
                    value={authForm.name}
                    onChange={(event) => onChange("name", event.target.value)}
                    placeholder="Jeremi"
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="label-text">Email</label>
                <input
                  className="input-field"
                  type="email"
                  value={authForm.email}
                  onChange={(event) => onChange("email", event.target.value)}
                  placeholder="name@example.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="label-text">Password</label>
                <input
                  className="input-field"
                  type="password"
                  value={authForm.password}
                  onChange={(event) => onChange("password", event.target.value)}
                  placeholder="At least 8 chars with upper/lower/number"
                  required
                />
              </div>

              {error && (
                <div className="feedback feedback-error">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              <button
                className="btn-primary w-full h-12"
                disabled={authLoading}
              >
                {authLoading ? (
                  <Loader2 className="animate-spin" />
                ) : authMode === "login" ? (
                  <>
                    <ArrowRight size={16} />
                    Continue to dashboard
                  </>
                ) : (
                  <>
                    <Shield size={16} />
                    Create account
                  </>
                )}
              </button>
            </form>

            <button
              type="button"
              className="btn-secondary w-full"
              onClick={onToggleMode}
            >
              {authMode === "login"
                ? "Need an account? Register"
                : "Already registered? Login"}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_STORAGE_KEY) || "",
  );
  const [user, setUser] = useState(null);
  const [currentTab, setCurrentTab] = useState("overview"); // Added view state
  const [sessionLoading, setSessionLoading] = useState(Boolean(token));
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [message, setMessage] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [importingShortIo, setImportingShortIo] = useState(false);
  const [importingSingleLinkId, setImportingSingleLinkId] = useState(null);
  const [submittingLink, setSubmittingLink] = useState(false);
  const [savingLinkId, setSavingLinkId] = useState(null);
  const [deletingLinkId, setDeletingLinkId] = useState(null);
  const [links, setLinks] = useState([]);
  const [totalLinks, setTotalLinks] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [clicksSeries, setClicksSeries] = useState([]);
  const [topLinks, setTopLinks] = useState([]);
  const [trafficInsights, setTrafficInsights] = useState(EMPTY_TRAFFIC_INSIGHTS);
  const [syncHealth, setSyncHealth] = useState(EMPTY_SYNC_HEALTH);
  const [reconcileReport, setReconcileReport] = useState(EMPTY_RECONCILE);
  const [providerDiagnosticsLoading, setProviderDiagnosticsLoading] = useState(false);
  const [shortIoHistory, setShortIoHistory] = useState([]);
  const [shortIoHistoryLoading, setShortIoHistoryLoading] = useState(false);
  const [shortIoHistoryTotal, setShortIoHistoryTotal] = useState(0);
  const [shortIoHistoryPage, setShortIoHistoryPage] = useState(1);
  const [shortIoHistoryLimit] = useState(10);
  const [shortIoHistoryFilters, setShortIoHistoryFilters] = useState({
    search: "",
    status: "all",
  });
  const [auditLogs, setAuditLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUserForm, setNewUserForm] = useState(EMPTY_NEW_USER_FORM);
  const [filters, setFilters] = useState({
    search: "",
    provider: "all",
    status: "all",
  });
  const deferredSearch = useDeferredValue(filters.search);
  const deferredShortIoHistorySearch = useDeferredValue(
    shortIoHistoryFilters.search,
  );
  const [shortUrl, setShortUrl] = useState("");
  const [providerUsed, setProviderUsed] = useState("shortio");
  const [copiedValue, setCopiedValue] = useState("");
  const [editingLinkId, setEditingLinkId] = useState(null);
  const [editDraft, setEditDraft] = useState({
    title: "",
    customSlug: "",
    expiresAt: "",
    isActive: true,
  });
  const [form, setForm] = useState({
    url: "",
    title: "",
    provider: "shortio",
    customSlug: "",
    expiresAt: "",
  });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const qrRef = useRef(null);
  const isAdmin = user?.role === "admin";
  const selectedProvider = isAdmin ? form.provider : "shortio";
  const [qrCode] = useState(
    () =>
      new QRCodeStyling({
        width: 320,
        height: 320,
        type: "svg",
        dotsOptions: {
          color: DEFAULT_SETTINGS.dotsColor,
          type: DEFAULT_SETTINGS.dotsType,
        },
        backgroundOptions: {
          color: DEFAULT_SETTINGS.backgroundColor,
        },
        imageOptions: { crossOrigin: "anonymous", margin: 10 },
      }),
  );

  const providerChoice = PROVIDERS[selectedProvider] || PROVIDERS.shortio;

  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }, [token]);

  useEffect(() => {
    if (!message) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setMessage(null);
    }, 2800);

    return () => window.clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    if (!copiedValue) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setCopiedValue("");
    }, 1400);

    return () => window.clearTimeout(timeout);
  }, [copiedValue]);

  useEffect(() => {
    qrCode.update({
      data: shortUrl || "https://example.com",
      dotsOptions: {
        type: settings.dotsType,
        color: settings.gradient ? undefined : settings.dotsColor,
        gradient: settings.gradient
          ? {
              type: "linear",
              colorStops: [
                { offset: 0, color: settings.dotsColor },
                { offset: 1, color: settings.gradientColor2 },
              ],
            }
          : undefined,
      },
      backgroundOptions: { color: settings.backgroundColor },
      cornersSquareOptions: {
        type: settings.cornersType,
        color: settings.dotsColor,
      },
      cornersDotOptions: {
        type: settings.cornersType === "dot" ? "dot" : "square",
        color: settings.dotsColor,
      },
      image: settings.logo,
      imageOptions: { imageSize: 0.22, margin: 6 },
    });

    if (qrRef.current) {
      if (qrRef.current.firstChild) {
        qrRef.current.removeChild(qrRef.current.firstChild);
      }
      qrCode.append(qrRef.current);
    }
  }, [qrCode, settings, shortUrl]);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setSessionLoading(false);
      return;
    }

    let ignore = false;

    async function bootstrapSession() {
      setSessionLoading(true);

      try {
        const { data } = await api.get("/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        let autoSyncError = null;

        if (data.user?.role === "admin") {
          try {
            await api.post(
              "/admin/shortio/import",
              {},
              {
                headers: { Authorization: `Bearer ${token}` },
              },
            );
          } catch (syncError) {
            console.error("Auto-sync failed:", syncError.message);
            autoSyncError = formatApiError(
              syncError,
              "Short.io auto-sync failed. Dashboard data may still be stale until you sync manually.",
            );
          }
        }

        if (!ignore) {
          setUser(data.user);

          if (autoSyncError) {
            setMessage({
              type: "error",
              text: autoSyncError,
            });
          }
        }
      } catch (error) {
        if (!ignore) {
          setToken("");
          setUser(null);
          setAuthError("Your session expired. Please login again.");
        }
      } finally {
        if (!ignore) {
          setSessionLoading(false);
        }
      }
    }

    bootstrapSession();

    return () => {
      ignore = true;
    };
  }, [token]);

  async function fetchDashboard() {
    if (!token || !user) {
      return;
    }

    setDashboardLoading(true);

    try {
      const { data } = await api.get("/dashboard", {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          search: deferredSearch,
          provider: filters.provider,
          status: filters.status,
          page,
          limit,
        },
      });

      setSummary(data.summary || EMPTY_SUMMARY);
      setClicksSeries(data.clicksSeries || []);
      setTopLinks(data.topLinks || []);
      setTrafficInsights(data.trafficInsights || EMPTY_TRAFFIC_INSIGHTS);
      setAuditLogs(data.auditLogs || []);
      setLinks(data.links || []);
      setTotalLinks(data.totalLinks || 0);
    } catch (error) {
      const messageText = formatApiError(
        error,
        "Failed to load dashboard data",
      );

      if (error?.response?.status === 401) {
        setToken("");
        setUser(null);
        setAuthError(messageText);
      } else {
        setMessage({ type: "error", text: messageText });
      }
    } finally {
      setDashboardLoading(false);
    }
  }

  async function fetchShortIoHistory() {
    if (!token || !user) {
      return;
    }

    setShortIoHistoryLoading(true);

    try {
      const { data } = await api.get("/history", {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          provider: "shortio",
          search: deferredShortIoHistorySearch,
          status: shortIoHistoryFilters.status,
          page: shortIoHistoryPage,
          limit: shortIoHistoryLimit,
        },
      });

      setShortIoHistory(data.history || []);
      setShortIoHistoryTotal(data.total || 0);
    } catch (error) {
      const messageText = formatApiError(
        error,
        "Failed to load Short.io history",
      );

      if (error?.response?.status === 401) {
        setToken("");
        setUser(null);
        setAuthError(messageText);
      } else {
        setMessage({ type: "error", text: messageText });
      }
    } finally {
      setShortIoHistoryLoading(false);
    }
  }

  async function fetchProviderDiagnostics() {
    if (!token || !user || !isAdmin) {
      return;
    }

    setProviderDiagnosticsLoading(true);

    try {
      const { data } = await api.get("/admin/shortio/diagnostics", {
        headers: { Authorization: `Bearer ${token}` },
      });

      setSyncHealth(data.syncHealth || EMPTY_SYNC_HEALTH);
      setReconcileReport(data.reconcile || EMPTY_RECONCILE);
    } catch (error) {
      const messageText = formatApiError(
        error,
        "Failed to load provider diagnostics",
      );

      if (error?.response?.status === 401) {
        setToken("");
        setUser(null);
        setAuthError(messageText);
      } else {
        setMessage({ type: "error", text: messageText });
      }
    } finally {
      setProviderDiagnosticsLoading(false);
    }
  }

  async function fetchUsers() {
    if (!token || !user || !isAdmin) {
      return;
    }

    setUsersLoading(true);

    try {
      const { data } = await api.get("/admin/users", {
        headers: { Authorization: `Bearer ${token}` },
      });

      setUsers(data.users || []);
    } catch (error) {
      const messageText = formatApiError(error, "Failed to load users");

      if (error?.response?.status === 401) {
        setToken("");
        setUser(null);
        setAuthError(messageText);
      } else {
        setMessage({ type: "error", text: messageText });
      }
    } finally {
      setUsersLoading(false);
    }
  }

  async function refreshWorkspaceData() {
    await Promise.all([
      fetchDashboard(),
      fetchShortIoHistory(),
      ...(isAdmin ? [fetchProviderDiagnostics()] : []),
      ...(isAdmin ? [fetchUsers()] : []),
    ]);
  }

  async function handleImportShortIo() {
    setImportingShortIo(true);

    try {
      const { data } = await api.post(
        "/admin/shortio/import",
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      setShortIoHistoryPage(1);
      await refreshWorkspaceData();
      setMessage({
        type: "success",
        text: `Short.io import complete. Added ${data.imported}, updated ${data.updated}, skipped ${data.skipped}. Analytics synced for ${data.analyticsSync?.updated || 0} links.`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: formatApiError(error, "Failed to import Short.io links"),
      });
    } finally {
      setImportingShortIo(false);
    }
  }

  async function handleImportSingleLink(linkItem) {
    setImportingSingleLinkId(linkItem.providerLinkId);
    try {
      const { data } = await api.post(
        "/admin/shortio/import-single",
        linkItem,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      await fetchProviderDiagnostics(); // Refresh table
      
      setMessage({
        type: "success",
        text: `Successfully imported "${linkItem.title || linkItem.shortCode}"!`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: formatApiError(error, "Failed to import Short.io link"),
      });
    } finally {
      setImportingSingleLinkId(null);
    }
  }

  useEffect(() => {
    fetchDashboard();
  }, [user, token, deferredSearch, filters.provider, filters.status, page]);

  useEffect(() => {
    fetchShortIoHistory();
  }, [
    user,
    token,
    deferredShortIoHistorySearch,
    shortIoHistoryFilters.status,
    shortIoHistoryPage,
  ]);

  useEffect(() => {
    if (currentTab === "providers" && isAdmin) {
      fetchProviderDiagnostics();
    }
  }, [currentTab, isAdmin, token, user]);

  useEffect(() => {
    if (currentTab === "audit" && isAdmin) {
      fetchUsers();
    }
  }, [currentTab, isAdmin, token, user]);

  function updateAuthField(field, value) {
    setAuthForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateFormField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateSettingsField(field, value) {
    setSettings((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateNewUserField(field, value) {
    setNewUserForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");

    try {
      const endpoint = authMode === "login" ? "/auth/login" : "/auth/register";
      const payload =
        authMode === "login"
          ? {
              email: authForm.email,
              password: authForm.password,
            }
          : authForm;
      const { data } = await api.post(endpoint, payload);

      setToken(data.token);
      setUser(data.user);
      setAuthForm({ name: "", email: "", password: "" });
      setMessage({
        type: "success",
        text:
          authMode === "login"
            ? "Authenticated successfully."
            : "Account created. You are now signed in.",
      });
    } catch (error) {
      setAuthError(
        formatApiError(error, "Authentication failed. Please try again."),
      );
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleCreateUser(event) {
    event.preventDefault();

    if (!isAdmin) {
      return;
    }

    setCreatingUser(true);

    try {
      const payload = {
        name: newUserForm.name,
        email: newUserForm.email,
        password: newUserForm.password,
        role: newUserForm.role,
      };

      const { data } = await api.post("/admin/users", payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setNewUserForm(EMPTY_NEW_USER_FORM);
      await Promise.all([fetchDashboard(), fetchUsers()]);
      setMessage({
        type: "success",
        text: `User ${data.user?.email || payload.email} created successfully.`,
      });
    } catch (error) {
      const messageText = formatApiError(error, "Failed to create user");

      if (isUnauthorizedError(error)) {
        setToken("");
        setUser(null);
        setAuthError(messageText);
      } else {
        setMessage({ type: "error", text: messageText });
      }
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleLogout() {
    try {
      if (token) {
        await api.post(
          "/auth/logout",
          {},
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
      }
    } catch (error) {
      // Ignore logout network issues and clear local session anyway.
    }

    setToken("");
    setUser(null);
    setLinks([]);
    setShortIoHistory([]);
    setShortIoHistoryTotal(0);
    setShortIoHistoryPage(1);
    setSummary(EMPTY_SUMMARY);
    setTrafficInsights(EMPTY_TRAFFIC_INSIGHTS);
    setSyncHealth(EMPTY_SYNC_HEALTH);
    setReconcileReport(EMPTY_RECONCILE);
    setUsers([]);
    setNewUserForm(EMPTY_NEW_USER_FORM);
    setMessage({ type: "success", text: "You have been signed out." });
  }

  async function handleCreateLink(event) {
    event.preventDefault();
    setSubmittingLink(true);

    try {
      const { data } = await api.post(
        "/links",
        {
          url: form.url,
          title: form.title,
          provider: selectedProvider,
          customSlug: form.customSlug,
          expiresAt: form.expiresAt || null,
          qrConfig: settings,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      setShortUrl(data.shortURL);
      setProviderUsed(data.providerUsed || selectedProvider);
      setMessage({
        type: "success",
        text:
          data.providerUsed !== selectedProvider
            ? "Link created with fallback provider."
            : "Link created successfully.",
      });
      await refreshWorkspaceData();
    } catch (error) {
      setMessage({
        type: "error",
        text: formatApiError(error, "Failed to create link"),
      });
    } finally {
      setSubmittingLink(false);
    }
  }

  function handleLogoUpload(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setMessage({ type: "error", text: "Only image files are allowed." });
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      updateSettingsField("logo", loadEvent.target?.result || null);
    };
    reader.readAsDataURL(file);
  }

  async function handleCopy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedValue(text);
      setMessage({ type: "success", text: "Copied to clipboard." });
    } catch (error) {
      setMessage({ type: "error", text: "Copy failed." });
    }
  }

  function loadLinkIntoWorkspace(link) {
    setShortUrl(link.short);
    setProviderUsed(link.provider);
    setForm({
      url: link.original,
      title: link.title || "",
      provider: link.requestedProvider || link.provider,
      customSlug: link.customSlug || link.shortCode || "",
      expiresAt: formatDateTimeInput(link.expiresAt),
    });
    setSettings((current) => ({
      ...current,
      ...link.qrConfig,
    }));
    setMessage({
      type: "success",
      text: "Link loaded back into the workspace.",
    });
  }

  function startEditingLink(link) {
    setEditingLinkId(link.id);
    setEditDraft({
      title: link.title || "",
      customSlug: link.customSlug || link.shortCode || "",
      expiresAt: formatDateTimeInput(link.expiresAt),
      isActive: link.isActive,
    });
  }

  async function saveLinkEdits(link) {
    setSavingLinkId(link.id);

    try {
      const payload = {
        title: editDraft.title,
        expiresAt: editDraft.expiresAt || null,
        isActive: editDraft.isActive,
      };

      if (link.provider === "internal" || link.provider === "shortio") {
        payload.customSlug = editDraft.customSlug;
      }

      await api.patch(`/links/${link.id}`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setEditingLinkId(null);
      setMessage({ type: "success", text: "Link updated." });
      await refreshWorkspaceData();
    } catch (error) {
      setMessage({
        type: "error",
        text: formatApiError(error, "Failed to update link"),
      });
    } finally {
      setSavingLinkId(null);
    }
  }

  async function toggleLinkState(link) {
    setSavingLinkId(link.id);

    try {
      await api.patch(
        `/links/${link.id}`,
        { isActive: !link.isActive },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      setMessage({
        type: "success",
        text: !link.isActive ? "Link reactivated." : "Link disabled.",
      });
      await refreshWorkspaceData();
    } catch (error) {
      setMessage({
        type: "error",
        text: formatApiError(error, "Failed to update status"),
      });
    } finally {
      setSavingLinkId(null);
    }
  }

  async function removeLink(link) {
    let deleteMode = "internal";

    if (link.provider === "shortio") {
      const choice = window.prompt(
        `Delete ${link.short}\n\nType "both" to delete from dashboard and Short.io.\nType "internal" to delete only from the internal dashboard record.`,
        "both",
      );

      if (!choice) {
        return;
      }

      const normalizedChoice = String(choice).trim().toLowerCase();

      if (normalizedChoice !== "both" && normalizedChoice !== "internal") {
        setMessage({
          type: "error",
          text: 'Delete cancelled. Type "both" or "internal".',
        });
        return;
      }

      deleteMode = normalizedChoice === "both" ? "provider" : "internal";
    } else {
      const confirmed = window.confirm(
        `Delete ${link.short}? This will remove analytics and redirect history for this link.`,
      );

      if (!confirmed) {
        return;
      }
    }

    setDeletingLinkId(link.id);

    try {
      await api.delete(`/links/${link.id}`, {
        params: { mode: deleteMode },
        headers: { Authorization: `Bearer ${token}` },
      });
      setMessage({
        type: "success",
        text:
          deleteMode === "provider"
            ? "Link deleted from dashboard and Short.io."
            : "Link deleted from dashboard.",
      });
      await refreshWorkspaceData();
    } catch (error) {
      setMessage({
        type: "error",
        text: formatApiError(error, "Failed to delete link"),
      });
    } finally {
      setDeletingLinkId(null);
    }
  }

  function downloadQr(extension) {
    const name = shortUrl
      ? shortUrl.replace(/^https?:\/\//, "").replace(/[^\w-]/g, "-")
      : `qr-${Date.now()}`;
    qrCode.download({ name, extension });
  }

  const renderOverview = () => (
    <div className="space-y-6 animate-fade-in">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total links" value={summary.totalLinks} helper="All stored short links" />
        <SummaryCard label="Active" value={summary.activeLinks} tone="sky" helper="Serving traffic now" />
        <SummaryCard label="Total clicks" value={summary.totalClicks} tone="emerald" helper="Redirects recorded" />
        <SummaryCard label={user.role === "admin" ? "Users" : "Short.io"} value={user.role === "admin" ? summary.usersCount : summary.shortIoLinks} tone="rose" helper={user.role === "admin" ? "Registered operators" : "External provider usage"} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel space-y-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="text-primary-500" />
            <h2 className="text-xl font-bold">Activity Overview</h2>
          </div>
          <MiniBarChart data={clicksSeries} />
        </section>

        <section className="panel space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <LinkIcon className="text-primary-500" />
              <h2 className="text-xl font-bold">Top Performing</h2>
            </div>
            <span className="badge badge-soft">Ranked by clicks</span>
          </div>

          <div className="space-y-4">
            {topLinks.length === 0 ? (
              <div className="empty-state">No rankings yet</div>
            ) : (
              topLinks.map((link) => (
                <div key={link.id} className="panel-inset flex items-center justify-between p-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{link.title || link.shortCode}</p>
                    <p className="text-xs text-slate-500 truncate">{link.short}</p>
                  </div>
                  <div className="text-right ml-4">
                    <p className="text-lg font-bold text-slate-900">{link.clickCount}</p>
                    <p className="text-[10px] uppercase text-slate-400">clicks</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="panel space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Globe className="text-primary-500" />
            <div>
              <h2 className="text-xl font-bold">Synced Traffic Insights</h2>
              <p className="text-sm text-slate-500">
                Short.io analytics processed into internal reporting
              </p>
            </div>
          </div>

          <div className="badge badge-soft flex items-center gap-2">
            <Clock3 size={14} />
            <span>
              {trafficInsights.lastSyncedAt
                ? `Last sync ${formatReadableDate(trafficInsights.lastSyncedAt)}`
                : "Waiting for analytics sync"}
            </span>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <SyncMetricCard
            label="Lifetime Clicks"
            value={trafficInsights.summary?.lifetimeClicks || 0}
            helper="Provider total retained internally"
            tone="emerald"
          />
          <SyncMetricCard
            label={(trafficInsights.summary?.periodKey || "last30").toUpperCase()}
            value={trafficInsights.summary?.periodClicks || 0}
            helper="Period analytics for insight panels"
            tone="sky"
          />
          <SyncMetricCard
            label="Synced Links"
            value={trafficInsights.summary?.syncedLinks || 0}
            helper="Short.io links with provider metadata"
            tone="rose"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <InsightList title="Top Countries" items={trafficInsights.country || []} />
          <InsightList title="Top Browsers" items={trafficInsights.browser || []} />
          <InsightList title="Top OS" items={trafficInsights.os || []} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <InsightList title="Top Cities" items={trafficInsights.city || []} />
          <InsightList title="Top Referrers" items={trafficInsights.referer || []} />
        </div>
      </section>
    </div>
  );

  const renderCreate = () => (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px] animate-fade-in">
      <section className="panel space-y-6">
        <h2 className="text-2xl font-bold">New shortened destination</h2>
        <form onSubmit={handleCreateLink} className="space-y-6">
          <div className="space-y-2">
            <label className="label-text">Destination URL</label>
            <input className="input-field h-12 text-base" type="url" value={form.url} onChange={(e) => updateFormField("url", e.target.value)} placeholder="https://your-site.com/path" required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="label-text">Title</label>
              <input className="input-field" value={form.title} onChange={(e) => updateFormField("title", e.target.value)} placeholder="Campaign Label" />
            </div>
            <div className="space-y-2">
              <label className="label-text">Custom Slug (Optional)</label>
              <input className="input-field" value={form.customSlug} onChange={(e) => updateFormField("customSlug", e.target.value)} placeholder="promo2024" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="label-text">Active Provider</label>
            <div className="panel-inset flex items-center justify-between p-4 bg-slate-50 border-slate-100">
               <div className="flex items-center gap-3">
                 <div className={cn("p-2.5 rounded-lg", selectedProvider === 'shortio' ? "bg-sky-100 text-sky-600" : "bg-emerald-100 text-emerald-600")}>
                    {selectedProvider === 'shortio' ? <Globe size={18} /> : <Zap size={18} />}
                 </div>
                 <div>
                    <p className="text-sm font-bold text-slate-900">{PROVIDERS[selectedProvider]?.label}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tight">Active for new links</p>
                 </div>
               </div>
               <button type="button" onClick={() => setCurrentTab('providers')} className="text-xs text-primary-600 font-bold hover:underline">Change</button>
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-4">
              <Palette size={18} className="text-slate-500" />
              <h3 className="font-bold">QR Appearance</h3>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <label className="label-text">QR Color</label>
                <div className="color-field h-11"><input type="color" value={settings.dotsColor} onChange={(e) => updateSettingsField("dotsColor", e.target.value)} /><span>{settings.dotsColor}</span></div>
              </div>
              <div className="space-y-2">
                <label className="label-text">Background</label>
                <div className="color-field h-11"><input type="color" value={settings.backgroundColor} onChange={(e) => updateSettingsField("backgroundColor", e.target.value)} /><span>{settings.backgroundColor}</span></div>
              </div>
              <div className="space-y-2">
                <label className="label-text">Dot Pattern</label>
                <select className="input-field" value={settings.dotsType} onChange={(e) => updateSettingsField("dotsType", e.target.value)}>{QR_STYLES.map(s => <option key={s}>{s}</option>)}</select>
              </div>
              <div className="space-y-2">
                <label className="label-text">Corner Style</label>
                <select className="input-field" value={settings.cornersType} onChange={(e) => updateSettingsField("cornersType", e.target.value)}>{CORNER_STYLES.map(s => <option key={s}>{s}</option>)}</select>
              </div>
            </div>
          </div>

          <button className="btn-primary w-full h-14 text-lg" disabled={submittingLink}>
            {submittingLink ? <Loader2 className="animate-spin" /> : <>Generate Short Link<ArrowRight size={20} /></>}
          </button>
        </form>
      </section>

      <aside className="space-y-6">
        <section className="panel sticky top-24 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg">QR Preview</h3>
            <span className="badge badge-soft-green">Realtime</span>
          </div>
          <div ref={qrRef} className="preview-shell scale-95 origin-center" />
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-secondary" onClick={() => downloadQr("png")}><Download size={16} /> PNG</button>
            <button className="btn-secondary" onClick={() => downloadQr("svg")}><Download size={16} /> SVG</button>
          </div>
          <div className="space-y-4 pt-4 border-t border-slate-100">
             <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Link Preview</span>
                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", selectedProvider === 'shortio' ? "bg-sky-50 text-sky-600 border-sky-100" : "bg-emerald-50 text-emerald-600 border-emerald-100")}>
                  {PROVIDERS[selectedProvider]?.label}
                </span>
             </div>
             <div className="panel-inset p-4 bg-slate-50/50 border-slate-100 overflow-hidden">
                <p className="text-sm font-bold text-slate-900 break-all truncate">
                  {selectedProvider === 'shortio' ? 's.pmkitera.com' : 'localhost:5000'}/{form.customSlug || '______'}
                </p>
                <p className="text-[10px] text-slate-400 mt-1 font-medium">Estimated generated link format</p>
             </div>
          </div>

          {shortUrl && (
            <div className="panel-inset p-4 space-y-2 bg-primary-50/50 border-primary-100 animate-slide-up">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-primary-600 font-bold">Latest Result</span>
                <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              </div>
              <p className="text-sm font-bold text-slate-900 break-all">{shortUrl}</p>
              <button className="btn-secondary w-full h-10 text-xs font-bold" onClick={() => handleCopy(shortUrl)}>Copy Link</button>
            </div>
          )}
        </section>
      </aside>
    </div>
  );

  const renderLinks = () => (
    <div className="space-y-6 animate-fade-in">
      <section className="panel space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Manage Links</h2>
          <div className="badge badge-dark">{totalLinks} Total</div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <label className="search-shell min-w-[300px]">
            <Search size={16} />
            <input value={filters.search} onChange={(e) => setFilters(c => ({...c, search: e.target.value}))} placeholder="Search destination, slug, or title..." />
          </label>
          <select className="input-field" value={filters.provider} onChange={(e) => setFilters(c => ({...c, provider: e.target.value}))}>
            <option value="all">All Providers</option>
            <option value="internal">Internal</option>
            <option value="shortio">Short.io</option>
          </select>
          <select className="input-field" value={filters.status} onChange={(e) => setFilters(c => ({...c, status: e.target.value}))}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button className="btn-secondary" onClick={() => setFilters({search: "", provider: "all", status: "all"})}>Reset</button>
        </div>

        <div className="space-y-4">
          {links.map((link) => (
            <article key={link.id} className="link-card p-6 border border-slate-100 hover:border-primary-200 transition-colors">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="badge badge-soft">{PROVIDERS[link.provider]?.label || link.provider}</span>
                    <span className={cn("badge badge-soft", link.isActive ? "badge-soft-green" : "badge-soft-amber")}>{link.isActive ? "Active" : "Inactive"}</span>
                    {link.provider === "shortio" && (
                      <span
                        className={cn(
                          "badge badge-soft",
                          link.providerSyncStatus === "error"
                            ? "text-rose-600 bg-rose-50 border border-rose-100"
                            : link.providerSyncStatus === "pending"
                              ? "text-amber-600 bg-amber-50 border border-amber-100"
                              : "text-sky-600 bg-sky-50 border border-sky-100",
                        )}
                      >
                        {link.providerSyncStatus}
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 truncate">{link.title || link.shortCode}</h3>
                  <p className="text-sm text-primary-600 font-medium truncate">{link.short}</p>
                  <p className="text-xs text-slate-400 truncate">{link.original}</p>
                  {link.provider === "shortio" && (
                    <p className="text-[11px] text-slate-500 truncate">
                      Lifetime {link.lastProviderTotalClicks || link.clickCount} • {link.lastProviderPeriodKey || "last30"} {link.lastProviderPeriodHumanClicks || 0}
                      {link.lastProviderSyncAt ? ` • synced ${formatReadableDate(link.lastProviderSyncAt)}` : ""}
                      {link.providerSyncError ? ` • ${link.providerSyncError}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 h-fit">
                  <div className="px-4 py-2 bg-slate-50 rounded-xl text-center min-w-[80px]">
                    <p className="text-xs text-slate-400 uppercase font-bold tracking-tight">Clicks</p>
                    <p className="text-lg font-bold text-slate-900">{link.clickCount}</p>
                  </div>
                  <button className="btn-secondary p-3" onClick={() => handleCopy(link.short)}><Copy size={16} /></button>
                  <button className="btn-secondary p-3" onClick={() => loadLinkIntoWorkspace(link)}><QrCode size={16} /></button>
                  <button className="btn-secondary p-3 text-red-500 hover:bg-red-50" onClick={() => removeLink(link)} disabled={deletingLinkId === link.id}>
                    {deletingLinkId === link.id ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );

  const renderAudit = () => (
    <div className="space-y-6 animate-fade-in">
      <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
        <div className="panel space-y-6">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              User Provisioning
            </p>
            <h2 className="text-2xl font-bold text-slate-900">
              Create a new operator
            </h2>
            <p className="text-sm text-slate-500">
              Admins can create team accounts directly from the internal dashboard.
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleCreateUser}>
            <div className="space-y-2">
              <label className="label-text">Full name</label>
              <input
                className="input-field"
                value={newUserForm.name}
                onChange={(event) => updateNewUserField("name", event.target.value)}
                placeholder="Nama operator"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="label-text">Email</label>
              <input
                className="input-field"
                type="email"
                value={newUserForm.email}
                onChange={(event) => updateNewUserField("email", event.target.value)}
                placeholder="operator@pmklynk.com"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="label-text">Password</label>
              <input
                className="input-field"
                type="password"
                value={newUserForm.password}
                onChange={(event) => updateNewUserField("password", event.target.value)}
                placeholder="At least 8 chars with upper/lower/number"
                required
              />
              <p className="text-xs text-slate-400">
                Gunakan kombinasi huruf besar, huruf kecil, dan angka.
              </p>
            </div>

            <div className="space-y-2">
              <label className="label-text">Role</label>
              <select
                className="input-field"
                value={newUserForm.role}
                onChange={(event) => updateNewUserField("role", event.target.value)}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <button className="btn-primary w-full h-12" disabled={creatingUser}>
              {creatingUser ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Creating user...
                </>
              ) : (
                <>
                  <Shield size={16} />
                  Create new user
                </>
              )}
            </button>
          </form>
        </div>

        <div className="panel space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Team Directory
              </p>
              <h2 className="text-2xl font-bold text-slate-900">
                Registered users
              </h2>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-slate-900">{users.length} accounts</p>
              <p className="text-xs text-slate-400">
                {usersLoading ? "Refreshing..." : "Latest internal roster"}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {usersLoading ? (
              <div className="empty-state py-10">
                <Loader2 className="animate-spin" size={22} />
                <p>Loading users...</p>
              </div>
            ) : users.length === 0 ? (
              <div className="empty-state py-10">
                <UserRound size={24} />
                <p>No users created yet.</p>
              </div>
            ) : (
              users.map((account) => (
                <div
                  key={account.id}
                  className="panel-inset p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                >
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                      <UserRound size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-slate-900 truncate">
                          {account.name || account.email}
                        </p>
                        <span
                          className={cn(
                            "badge border",
                            account.role === "admin"
                              ? "bg-sky-50 text-sky-700 border-sky-200"
                              : "bg-slate-100 text-slate-600 border-slate-200",
                          )}
                        >
                          {account.role}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 truncate">
                        {account.email}
                      </p>
                      <p className="text-xs text-slate-400">
                        Created {formatReadableDate(account.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="px-4 py-2 rounded-2xl bg-slate-50 text-center min-w-[88px]">
                      <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                        Links
                      </p>
                      <p className="text-lg font-black text-slate-900">
                        {account.linksCount || 0}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel space-y-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Security Trail
          </p>
          <h2 className="text-2xl font-bold">Admin Audit History</h2>
        </div>
        <div className="space-y-2">
          {auditLogs.map((log) => (
            <div key={log.id} className="panel-inset flex flex-col sm:flex-row justify-between p-4 gap-4">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-slate-100 rounded-lg"><Shield size={20} className="text-slate-600" /></div>
                <div>
                  <p className="font-bold text-slate-900">{log.action}</p>
                  <p className="text-xs text-slate-500">{log.actorName || log.actorEmail}</p>
                </div>
              </div>
              <div className="text-right border-t sm:border-t-0 pt-2 sm:pt-0">
                <p className="text-sm text-slate-600">{new Date(log.createdAt).toLocaleString()}</p>
                <p className="text-[10px] uppercase text-slate-400 font-bold">{log.entityType}: {log.entityId}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  const renderProviders = () => (
    <div className="space-y-6 animate-fade-in">
      <section className="panel space-y-8">
        <div>
          <h2 className="text-2xl font-bold">Provider Configuration</h2>
          <p className="text-sm text-slate-500">Manage how your short links are routed and generated</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {Object.entries(PROVIDERS).map(([key, info]) => {
            const isActive = selectedProvider === key;
            return (
              <div key={key} className={cn("panel-inset p-8 space-y-6 flex flex-col justify-between transition-all duration-300", isActive ? "border-primary-200 bg-primary-50/30 ring-1 ring-primary-100 shadow-xl shadow-primary-500/10" : "opacity-50 grayscale hover:opacity-80 hover:grayscale-0")}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className={cn("p-3 rounded-2xl", key === 'shortio' ? "bg-sky-100 text-sky-600 shadow-sm" : "bg-emerald-100 text-emerald-600 shadow-sm")}>
                      {key === 'shortio' ? <Globe size={24} /> : <Zap size={24} />}
                    </div>
                    {isActive ? (
                      <span className="badge badge-soft-green animate-pulse">Active & Enabled</span>
                    ) : (
                      <span className="badge badge-soft">Standby Mode</span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">{info.label}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">{info.description}</p>
                  </div>
                </div>

                <div className="space-y-4 pt-6 border-t border-slate-100">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 font-medium">Provider Status</span>
                    <span className={cn("flex items-center gap-1.5 font-bold", isActive ? "text-emerald-600" : "text-slate-400")}>
                      <div className={cn("w-2 h-2 rounded-full", isActive ? "bg-emerald-500 animate-pulse" : "bg-slate-300")} />
                      {isActive ? "Operational" : "Inactive"}
                    </span>
                  </div>
                  <button 
                    onClick={() => updateFormField("provider", key)} 
                    disabled={isActive}
                    className={cn("btn-secondary w-full justify-center h-12 text-sm font-bold transition-all", isActive ? "bg-emerald-50 text-emerald-600 border-emerald-200 cursor-default" : "hover:border-primary-200 hover:bg-white")}
                  >
                    {isActive ? "Currently in Use" : `Switch to ${info.label}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="panel bg-slate-900 text-white overflow-hidden relative group">
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
            <Shield size={120} />
          </div>
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
            <div className="space-y-4 max-w-2xl">
              <div className="flex items-center gap-3">
                 <div className="p-2 bg-primary-500/20 rounded-lg">
                  <Shield className="text-primary-400" size={20} />
                 </div>
                 <h3 className="font-bold text-lg text-white">Full Integration Sync</h3>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                Force a full synchronize with Short.io to import missing redirects and refresh link status.
                Click counts now refresh automatically when you open the dashboard or link lists.
              </p>
            </div>
            
            <button 
              onClick={handleImportShortIo} 
              disabled={importingShortIo || !isAdmin}
              className="flex items-center gap-3 bg-white text-slate-950 px-6 py-4 rounded-2xl font-black text-sm shadow-xl hover:bg-primary-50 transition-all disabled:opacity-50 flex-shrink-0"
            >
              {importingShortIo ? <Loader2 className="animate-spin" size={18} /> : <RefreshCcw size={18} />}
              {importingShortIo ? "Syncing..." : "Sync All Short.io Data"}
            </button>
          </div>
        </div>

        {isAdmin && (
          <section className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Sync Health</h3>
                <p className="text-sm text-slate-500">
                  Monitor provider sync freshness, failures, and reconciliation gaps
                </p>
              </div>
              <button
                onClick={fetchProviderDiagnostics}
                disabled={providerDiagnosticsLoading}
                className="btn-secondary h-11 px-4 text-sm font-bold"
              >
                {providerDiagnosticsLoading ? "Loading..." : "Refresh Diagnostics"}
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <SyncMetricCard label="Tracked" value={syncHealth.totalLinks} helper="Internal Short.io links" />
              <SyncMetricCard label="Healthy" value={syncHealth.syncedOk} helper="Recently synced" tone="emerald" />
              <SyncMetricCard label="Stale" value={syncHealth.stale} helper="Needs refresh" tone="amber" />
              <SyncMetricCard label="Pending" value={syncHealth.pending} helper="Never synced yet" tone="sky" />
              <SyncMetricCard label="Failed" value={syncHealth.failed} helper="Sync error stored" tone="rose" />
              <SyncMetricCard
                label="Last Sync"
                value={syncHealth.lastSyncedAt ? new Date(syncHealth.lastSyncedAt).toLocaleDateString() : "-"}
                helper={syncHealth.lastSyncedAt ? formatReadableDate(syncHealth.lastSyncedAt) : "No provider sync yet"}
              />
            </div>

            <div className="panel-inset p-6 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-lg font-bold text-slate-900">Reconciliation</h4>
                  <p className="text-sm text-slate-500">
                    Compare live provider links with the internal database state
                  </p>
                </div>
                <div className="badge badge-soft">
                  Provider {reconcileReport.summary?.providerCount || 0} • Internal {reconcileReport.summary?.databaseCount || 0}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SyncMetricCard label="Missing Internal" value={reconcileReport.summary?.missingInDatabase || 0} helper="Exists in Short.io only" tone="amber" />
                <SyncMetricCard label="Missing Provider" value={reconcileReport.summary?.missingInProvider || 0} helper="Exists in DB only" tone="rose" />
                <SyncMetricCard label="Click Drift" value={reconcileReport.summary?.clickMismatches || 0} helper="Lifetime click mismatch" tone="sky" />
                <SyncMetricCard label="Stale/Error" value={reconcileReport.summary?.staleSyncs || 0} helper="Links needing intervention" tone="slate" />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <h5 className="font-bold text-slate-900">Missing In Internal</h5>
                  {reconcileReport.missingInDatabase?.length ? (
                    reconcileReport.missingInDatabase.slice(0, 5).map((item) => (
                      <div key={item.providerLinkId} className="panel bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{item.title || item.shortCode || item.shortUrl}</p>
                          <p className="text-xs text-primary-600 truncate">{item.shortUrl}</p>
                          <p className="text-[11px] text-slate-500 truncate">{item.originalUrl}</p>
                        </div>
                        <button
                          onClick={() => handleImportSingleLink(item)}
                          disabled={importingSingleLinkId === item.providerLinkId}
                          className="btn-secondary whitespace-nowrap text-[11px] h-8 px-3 ml-auto hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200"
                        >
                          {importingSingleLinkId === item.providerLinkId ? <Loader2 size={12} className="animate-spin" /> : "Import Internally"}
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">No missing provider links</div>
                  )}
                </div>

                <div className="space-y-3">
                  <h5 className="font-bold text-slate-900">Click Mismatches</h5>
                  {reconcileReport.clickMismatches?.length ? (
                    reconcileReport.clickMismatches.slice(0, 5).map((item) => (
                      <div key={item.providerLinkId} className="panel bg-white p-4 space-y-1">
                        <p className="font-semibold text-slate-900 truncate">{item.title || item.shortUrl}</p>
                        <p className="text-xs text-primary-600 truncate">{item.shortUrl}</p>
                        <p className="text-[11px] text-slate-500">
                          Internal {item.storedClicks} • Provider {item.providerClicks} • Delta {item.delta}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">No click drift detected</div>
                  )}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <h5 className="font-bold text-slate-900">Missing In Provider</h5>
                  {reconcileReport.missingInProvider?.length ? (
                    reconcileReport.missingInProvider.slice(0, 5).map((item) => (
                      <div key={item.providerLinkId} className="panel bg-white p-4 space-y-1">
                        <p className="font-semibold text-slate-900 truncate">{item.title || item.shortCode || item.shortUrl}</p>
                        <p className="text-xs text-primary-600 truncate">{item.shortUrl}</p>
                        <p className="text-[11px] text-slate-500">Stored clicks {item.clickCount}</p>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">No orphaned internal links</div>
                  )}
                </div>

                <div className="space-y-3">
                  <h5 className="font-bold text-slate-900">Stale Or Failed Syncs</h5>
                  {reconcileReport.staleSyncs?.length ? (
                    reconcileReport.staleSyncs.slice(0, 5).map((item) => (
                      <div key={item.providerLinkId} className="panel bg-white p-4 space-y-1">
                        <p className="font-semibold text-slate-900 truncate">{item.title || item.shortUrl}</p>
                        <p className="text-xs text-primary-600 truncate">{item.shortUrl}</p>
                        <p className="text-[11px] text-slate-500">
                          {item.syncStatus} {item.lastProviderSyncAt ? `• ${formatReadableDate(item.lastProviderSyncAt)}` : ""}
                        </p>
                        {item.providerSyncError && (
                          <p className="text-[11px] text-rose-500 truncate">{item.providerSyncError}</p>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">No stale syncs detected</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </section>
    </div>
  );

  if (!token || !user) {
    return (
      <AuthScreen
        authMode={authMode}
        authForm={authForm}
        authLoading={authLoading || sessionLoading}
        error={authError}
        onChange={updateAuthField}
        onSubmit={handleAuthSubmit}
        onToggleMode={() =>
          setAuthMode((current) => (current === "login" ? "register" : "login"))
        }
      />
    );
  }

  return (
    <div className="main-grid dashboard-shell">
      <div className="dashboard-backdrop" />

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <QrCode className="text-white" size={18} />
          </div>
          <h1 className="text-base font-black tracking-tight text-slate-900">
            PMK<span className="text-primary-500"> LYNK</span>
          </h1>
        </div>

        <nav className="flex-1 space-y-1">
          {[
            { tab: "overview", icon: <BarChart3 size={18} />, label: "Dashboard" },
            { tab: "create",   icon: <Palette size={18} />,   label: "Create Link" },
            { tab: "links",    icon: <LinkIcon size={18} />,   label: "My Links" },
            { tab: "providers",icon: <Zap size={18} />,        label: "Providers" },
            ...(isAdmin ? [{ tab: "audit", icon: <Shield size={18} />, label: "Audit Logs" }] : []),
          ].map(({ tab, icon, label }) => (
            <button
              key={tab}
              onClick={() => setCurrentTab(tab)}
              className={cn(currentTab === tab ? "nav-active" : "nav-inactive")}
            >
              {icon} {label}
            </button>
          ))}
        </nav>

        <div className="pt-4 border-t border-slate-100 space-y-1">
          <div className="flex items-center gap-2.5 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
              <UserRound size={14} className="text-primary-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 truncate">{user.name}</p>
              <p className="text-[10px] text-slate-400 truncate">{user.role}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="nav-inactive text-red-500 hover:bg-red-50 hover:text-red-600">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* ── Content ── */}
      <main className="content-area">
        <header className="top-bar">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">PMK LYNK</p>
            <h2 className="text-sm font-bold text-slate-900 capitalize">{currentTab === "overview" ? "Dashboard" : currentTab === "create" ? "Create Link" : currentTab === "providers" ? "Provider Config" : currentTab === "links" ? "Manage Links" : "Audit Logs"}</h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="p-2 rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700"
              onClick={refreshWorkspaceData}
              title="Refresh"
            >
              <RefreshCcw size={16} className={cn(dashboardLoading && "animate-spin")} />
            </button>
          </div>
        </header>

        <div className="p-4 md:p-6 max-w-7xl mx-auto w-full space-y-6">
          {message && (
            <div className={cn("feedback", message.type === "error" ? "feedback-error" : "feedback-success")}>
              <AlertCircle size={15} />
              <span>{message.text}</span>
            </div>
          )}

          {currentTab === "overview"   && renderOverview()}
          {currentTab === "create"     && renderCreate()}
          {currentTab === "links"      && renderLinks()}
          {currentTab === "providers"  && renderProviders()}
          {currentTab === "audit" && user.role === "admin" && renderAudit()}
        </div>
      </main>

      {/* ── Mobile bottom nav ── */}
      <nav className="sidebar-mobile">
        {[
          { tab: "overview",   icon: <BarChart3 size={22} /> },
          { tab: "create",     icon: <Palette size={22} /> },
          { tab: "links",      icon: <LinkIcon size={22} /> },
          { tab: "providers",  icon: <Zap size={22} /> },
          ...(isAdmin ? [{ tab: "audit", icon: <Shield size={22} /> }] : []),
        ].map(({ tab, icon }) => (
          <button
            key={tab}
            onClick={() => setCurrentTab(tab)}
            className={cn("transition-colors", currentTab === tab ? "text-primary-600" : "text-slate-400")}
          >
            {icon}
          </button>
        ))}
      </nav>
    </div>
  );
}

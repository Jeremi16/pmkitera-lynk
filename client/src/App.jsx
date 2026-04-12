import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import QRCodeStyling from "qr-code-styling";
import {
  AlertCircle,
  BarChart3,
  Download,
  Link as LinkIcon,
  LogOut,
  Palette,
  QrCode,
  RefreshCcw,
  Shield,
  UserRound,
  Zap,
} from "lucide-react";
import {
  DEFAULT_SETTINGS,
  EMPTY_NEW_USER_FORM,
  EMPTY_RECONCILE,
  EMPTY_SUMMARY,
  EMPTY_SYNC_HEALTH,
  EMPTY_TRAFFIC_INSIGHTS,
  QR_DEFAULT_SIZE,
  TOKEN_STORAGE_KEY,
} from "./lib/constants";
import { api } from "./lib/api";
import {
  applyQrSettings,
  cn,
  formatApiError,
  formatDateTimeInput,
  isUnauthorizedError,
} from "./lib/utils";
import AuthScreen from "./components/AuthScreen";
import OverviewTab from "./views/OverviewTab";
import CreateTab from "./views/CreateTab";
import LinksTab from "./views/LinksTab";
import ProvidersTab from "./views/ProvidersTab";
import AuditTab from "./views/AuditTab";

// ── Route config ──
const TAB_ROUTES = [
  { path: "/",          tab: "overview",  icon: BarChart3, label: "Dashboard",   size: 18 },
  { path: "/create",    tab: "create",    icon: Palette,   label: "Create Link", size: 18 },
  { path: "/links",     tab: "links",     icon: LinkIcon,  label: "My Links",    size: 18 },
  { path: "/providers", tab: "providers", icon: Zap,       label: "Providers",   size: 18 },
];
const ADMIN_ROUTE = { path: "/audit", tab: "audit", icon: Shield, label: "Audit Logs", size: 18 };

const TAB_TITLES = {
  overview: "Dashboard",
  create: "Create Link",
  links: "Manage Links",
  providers: "Provider Config",
  audit: "Audit Logs",
};

function pathToTab(pathname) {
  const cleaned = pathname.replace(/\/$/, "") || "/";
  const match = [...TAB_ROUTES, ADMIN_ROUTE].find((r) => r.path === cleaned);
  return match?.tab || "overview";
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentTab = pathToTab(location.pathname);

  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_STORAGE_KEY) || "",
  );
  const [user, setUser] = useState(null);
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
    qrConfig: { ...DEFAULT_SETTINGS },
  });
  const [form, setForm] = useState({
    url: "",
    title: "",
    provider: "shortio",
    customSlug: "",
    expiresAt: "",
  });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [activeQrLink, setActiveQrLink] = useState(null);

  const qrRef = useRef(null);
  const qrModalRef = useRef(null);
  const editQrRef = useRef(null);
  const isAdmin = user?.role === "admin";
  const selectedProvider = isAdmin ? form.provider : "shortio";
  const totalPages = Math.max(1, Math.ceil(totalLinks / limit));

  const [qrCode] = useState(
    () =>
      new QRCodeStyling({
        width: QR_DEFAULT_SIZE,
        height: QR_DEFAULT_SIZE,
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
  const [qrModalCode] = useState(
    () =>
      new QRCodeStyling({
        width: QR_DEFAULT_SIZE,
        height: QR_DEFAULT_SIZE,
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
  const [editQrCode] = useState(
    () =>
      new QRCodeStyling({
        width: QR_DEFAULT_SIZE,
        height: QR_DEFAULT_SIZE,
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

  const createQrData = shortUrl || form.url.trim();

  // ── Navigation helper ──
  const navigateToTab = useCallback((tab) => {
    const route = [...TAB_ROUTES, ADMIN_ROUTE].find((r) => r.tab === tab);
    if (route) navigate(route.path);
  }, [navigate]);

  // ── Persistence & timers ──
  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }, [token]);

  useEffect(() => {
    if (!message) return undefined;
    const timeout = window.setTimeout(() => setMessage(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    if (!copiedValue) return undefined;
    const timeout = window.setTimeout(() => setCopiedValue(""), 1400);
    return () => window.clearTimeout(timeout);
  }, [copiedValue]);

  // ── QR rendering effects ──
  useEffect(() => {
    applyQrSettings(qrCode, createQrData, settings);
    if (qrRef.current) {
      if (qrRef.current.firstChild) qrRef.current.removeChild(qrRef.current.firstChild);
      qrCode.append(qrRef.current);
    }
  }, [createQrData, qrCode, settings]);

  useEffect(() => {
    if (!activeQrLink) return;
    const qrSettings = { ...DEFAULT_SETTINGS, ...(activeQrLink.qrConfig || {}) };
    applyQrSettings(qrModalCode, activeQrLink.short, qrSettings);
    if (qrModalRef.current) {
      if (qrModalRef.current.firstChild) qrModalRef.current.removeChild(qrModalRef.current.firstChild);
      qrModalCode.append(qrModalRef.current);
    }
  }, [activeQrLink, qrModalCode]);

  useEffect(() => {
    if (!activeQrLink) return undefined;
    function handleKeydown(event) {
      if (event.key === "Escape") setActiveQrLink(null);
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeQrLink]);

  useEffect(() => {
    if (!editingLinkId) return;
    const editingLink = links.find((item) => item.id === editingLinkId);
    if (!editingLink) return;
    const qrSettings = { ...DEFAULT_SETTINGS, ...(editDraft.qrConfig || {}) };
    applyQrSettings(editQrCode, editingLink.short, qrSettings);
    if (editQrRef.current) {
      if (editQrRef.current.firstChild) editQrRef.current.removeChild(editQrRef.current.firstChild);
      editQrCode.append(editQrRef.current);
    }
  }, [editDraft.qrConfig, editQrCode, editingLinkId, links]);

  // ── Session bootstrap ──
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
            await api.post("/admin/shortio/import", {}, {
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch (syncError) {
            console.error("Auto-sync failed:", syncError.message);
            autoSyncError = formatApiError(syncError, "Short.io auto-sync failed. Dashboard data may still be stale until you sync manually.");
          }
        }
        if (!ignore) {
          setUser(data.user);
          if (autoSyncError) setMessage({ type: "error", text: autoSyncError });
        }
      } catch (error) {
        if (!ignore) {
          setToken("");
          setUser(null);
          setAuthError("Your session expired. Please login again.");
        }
      } finally {
        if (!ignore) setSessionLoading(false);
      }
    }

    bootstrapSession();
    return () => { ignore = true; };
  }, [token]);

  // ── Data fetching ──
  async function fetchDashboard() {
    if (!token || !user) return;
    setDashboardLoading(true);
    try {
      const { data } = await api.get("/dashboard", {
        headers: { Authorization: `Bearer ${token}` },
        params: { search: deferredSearch, provider: filters.provider, status: filters.status, page, limit },
      });
      setSummary(data.summary || EMPTY_SUMMARY);
      setClicksSeries(data.clicksSeries || []);
      setTopLinks(data.topLinks || []);
      setTrafficInsights(data.trafficInsights || EMPTY_TRAFFIC_INSIGHTS);
      setAuditLogs(data.auditLogs || []);
      setLinks(data.links || []);
      setTotalLinks(data.totalLinks || 0);
    } catch (error) {
      const messageText = formatApiError(error, "Failed to load dashboard data");
      if (error?.response?.status === 401) { setToken(""); setUser(null); setAuthError(messageText); }
      else { setMessage({ type: "error", text: messageText }); }
    } finally { setDashboardLoading(false); }
  }

  async function fetchShortIoHistory() {
    if (!token || !user) return;
    setShortIoHistoryLoading(true);
    try {
      const { data } = await api.get("/history", {
        headers: { Authorization: `Bearer ${token}` },
        params: { provider: "shortio", search: deferredShortIoHistorySearch, status: shortIoHistoryFilters.status, page: shortIoHistoryPage, limit: shortIoHistoryLimit },
      });
      setShortIoHistory(data.history || []);
      setShortIoHistoryTotal(data.total || 0);
    } catch (error) {
      const messageText = formatApiError(error, "Failed to load Short.io history");
      if (error?.response?.status === 401) { setToken(""); setUser(null); setAuthError(messageText); }
      else { setMessage({ type: "error", text: messageText }); }
    } finally { setShortIoHistoryLoading(false); }
  }

  async function fetchProviderDiagnostics() {
    if (!token || !user || !isAdmin) return;
    setProviderDiagnosticsLoading(true);
    try {
      const { data } = await api.get("/admin/shortio/diagnostics", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSyncHealth(data.syncHealth || EMPTY_SYNC_HEALTH);
      setReconcileReport(data.reconcile || EMPTY_RECONCILE);
    } catch (error) {
      const messageText = formatApiError(error, "Failed to load provider diagnostics");
      if (error?.response?.status === 401) { setToken(""); setUser(null); setAuthError(messageText); }
      else { setMessage({ type: "error", text: messageText }); }
    } finally { setProviderDiagnosticsLoading(false); }
  }

  async function fetchUsers() {
    if (!token || !user || !isAdmin) return;
    setUsersLoading(true);
    try {
      const { data } = await api.get("/admin/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUsers(data.users || []);
    } catch (error) {
      const messageText = formatApiError(error, "Failed to load users");
      if (error?.response?.status === 401) { setToken(""); setUser(null); setAuthError(messageText); }
      else { setMessage({ type: "error", text: messageText }); }
    } finally { setUsersLoading(false); }
  }

  async function refreshWorkspaceData() {
    await Promise.all([
      fetchDashboard(),
      fetchShortIoHistory(),
      ...(isAdmin ? [fetchProviderDiagnostics()] : []),
      ...(isAdmin ? [fetchUsers()] : []),
    ]);
  }

  // ── Data fetch effects ──
  useEffect(() => { fetchDashboard(); }, [user, token, deferredSearch, filters.provider, filters.status, page]);
  useEffect(() => { fetchShortIoHistory(); }, [user, token, deferredShortIoHistorySearch, shortIoHistoryFilters.status, shortIoHistoryPage]);
  useEffect(() => { if (currentTab === "providers" && isAdmin) fetchProviderDiagnostics(); }, [currentTab, isAdmin, token, user]);
  useEffect(() => { if (currentTab === "audit" && isAdmin) fetchUsers(); }, [currentTab, isAdmin, token, user]);

  // ── Field updaters ──
  function updateAuthField(field, value) { setAuthForm((c) => ({ ...c, [field]: value })); }
  function updateFormField(field, value) { setForm((c) => ({ ...c, [field]: value })); }
  function updateSettingsField(field, value) { setSettings((c) => ({ ...c, [field]: value })); }
  function updateEditDraftField(field, value) { setEditDraft((c) => ({ ...c, [field]: value })); }
  function updateEditQrConfigField(field, value) {
    setEditDraft((c) => ({ ...c, qrConfig: { ...DEFAULT_SETTINGS, ...(c.qrConfig || {}), [field]: value } }));
  }
  function updateNewUserField(field, value) { setNewUserForm((c) => ({ ...c, [field]: value })); }

  // ── Pagination handlers ──
  function goToPage(newPage) {
    const clamped = Math.max(1, Math.min(newPage, totalPages));
    setPage(clamped);
  }

  // ── Action handlers ──
  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const endpoint = authMode === "login" ? "/auth/login" : "/auth/register";
      const payload = authMode === "login" ? { email: authForm.email, password: authForm.password } : authForm;
      const { data } = await api.post(endpoint, payload);
      setToken(data.token);
      setUser(data.user);
      setAuthForm({ name: "", email: "", password: "" });
      setMessage({ type: "success", text: authMode === "login" ? "Authenticated successfully." : "Account created. You are now signed in." });
      navigate("/");
    } catch (error) {
      setAuthError(formatApiError(error, "Authentication failed. Please try again."));
    } finally { setAuthLoading(false); }
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    if (!isAdmin) return;
    setCreatingUser(true);
    try {
      const payload = { name: newUserForm.name, email: newUserForm.email, password: newUserForm.password, role: newUserForm.role };
      const { data } = await api.post("/admin/users", payload, { headers: { Authorization: `Bearer ${token}` } });
      setNewUserForm(EMPTY_NEW_USER_FORM);
      await Promise.all([fetchDashboard(), fetchUsers()]);
      setMessage({ type: "success", text: `User ${data.user?.email || payload.email} created successfully.` });
    } catch (error) {
      const messageText = formatApiError(error, "Failed to create user");
      if (isUnauthorizedError(error)) { setToken(""); setUser(null); setAuthError(messageText); }
      else { setMessage({ type: "error", text: messageText }); }
    } finally { setCreatingUser(false); }
  }

  async function handleLogout() {
    try {
      if (token) await api.post("/auth/logout", {}, { headers: { Authorization: `Bearer ${token}` } });
    } catch (error) { /* Ignore */ }
    setToken(""); setUser(null); setLinks([]); setShortIoHistory([]); setShortIoHistoryTotal(0); setShortIoHistoryPage(1);
    setSummary(EMPTY_SUMMARY); setTrafficInsights(EMPTY_TRAFFIC_INSIGHTS); setSyncHealth(EMPTY_SYNC_HEALTH);
    setReconcileReport(EMPTY_RECONCILE); setUsers([]); setNewUserForm(EMPTY_NEW_USER_FORM);
    setMessage({ type: "success", text: "You have been signed out." });
    navigate("/");
  }

  async function handleCreateLink(event) {
    event.preventDefault();
    setSubmittingLink(true);
    try {
      const { data } = await api.post("/links", {
        url: form.url, title: form.title, provider: selectedProvider, customSlug: form.customSlug, expiresAt: form.expiresAt || null, qrConfig: settings,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setShortUrl(data.shortURL);
      setProviderUsed(data.providerUsed || selectedProvider);
      setMessage({ type: "success", text: data.providerUsed !== selectedProvider ? "Link created with fallback provider." : "Link created successfully." });
      await refreshWorkspaceData();
    } catch (error) { setMessage({ type: "error", text: formatApiError(error, "Failed to create link") }); }
    finally { setSubmittingLink(false); }
  }

  async function handleImportShortIo() {
    setImportingShortIo(true);
    try {
      const { data } = await api.post("/admin/shortio/import", {}, { headers: { Authorization: `Bearer ${token}` } });
      setShortIoHistoryPage(1);
      await refreshWorkspaceData();
      setMessage({ type: "success", text: `Short.io import complete. Added ${data.imported}, updated ${data.updated}, skipped ${data.skipped}. Analytics synced for ${data.analyticsSync?.updated || 0} links.` });
    } catch (error) { setMessage({ type: "error", text: formatApiError(error, "Failed to import Short.io links") }); }
    finally { setImportingShortIo(false); }
  }

  async function handleImportSingleLink(linkItem) {
    setImportingSingleLinkId(linkItem.providerLinkId);
    try {
      await api.post("/admin/shortio/import-single", linkItem, { headers: { Authorization: `Bearer ${token}` } });
      await fetchProviderDiagnostics();
      setMessage({ type: "success", text: `Successfully imported "${linkItem.title || linkItem.shortCode}"!` });
    } catch (error) { setMessage({ type: "error", text: formatApiError(error, "Failed to import Short.io link") }); }
    finally { setImportingSingleLinkId(null); }
  }

  function handleLogoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage({ type: "error", text: "Only image files are allowed." }); return; }
    const reader = new FileReader();
    reader.onload = (loadEvent) => { updateSettingsField("logo", loadEvent.target?.result || null); };
    reader.readAsDataURL(file);
  }

  async function handleCopy(text) {
    try { await navigator.clipboard.writeText(text); setCopiedValue(text); setMessage({ type: "success", text: "Copied to clipboard." }); }
    catch (error) { setMessage({ type: "error", text: "Copy failed." }); }
  }

  function startEditingLink(link) {
    setEditingLinkId(link.id);
    setEditDraft({
      title: link.title || "",
      customSlug: link.customSlug || link.shortCode || "",
      expiresAt: formatDateTimeInput(link.expiresAt),
      isActive: link.isActive,
      qrConfig: { ...DEFAULT_SETTINGS, ...(link.qrConfig || {}) },
    });
  }

  async function saveLinkEdits(link) {
    setSavingLinkId(link.id);
    try {
      const payload = { title: editDraft.title, expiresAt: editDraft.expiresAt || null, isActive: editDraft.isActive, qrConfig: editDraft.qrConfig || { ...DEFAULT_SETTINGS } };
      if (link.provider === "internal" || link.provider === "shortio") payload.customSlug = editDraft.customSlug;
      await api.patch(`/links/${link.id}`, payload, { headers: { Authorization: `Bearer ${token}` } });
      setEditingLinkId(null);
      setMessage({ type: "success", text: "Link updated." });
      await refreshWorkspaceData();
    } catch (error) { setMessage({ type: "error", text: formatApiError(error, "Failed to update link") }); }
    finally { setSavingLinkId(null); }
  }

  async function toggleLinkState(link) {
    setSavingLinkId(link.id);
    try {
      await api.patch(`/links/${link.id}`, { isActive: !link.isActive }, { headers: { Authorization: `Bearer ${token}` } });
      setMessage({ type: "success", text: !link.isActive ? "Link reactivated." : "Link disabled." });
      await refreshWorkspaceData();
    } catch (error) { setMessage({ type: "error", text: formatApiError(error, "Failed to update status") }); }
    finally { setSavingLinkId(null); }
  }

  async function removeLink(link) {
    let deleteMode = "internal";
    if (link.provider === "shortio") {
      const choice = window.prompt(`Delete ${link.short}\n\nType "both" to delete from dashboard and Short.io.\nType "internal" to delete only from the internal dashboard record.`, "both");
      if (!choice) return;
      const normalizedChoice = String(choice).trim().toLowerCase();
      if (normalizedChoice !== "both" && normalizedChoice !== "internal") { setMessage({ type: "error", text: 'Delete cancelled. Type "both" or "internal".' }); return; }
      deleteMode = normalizedChoice === "both" ? "provider" : "internal";
    } else {
      const confirmed = window.confirm(`Delete ${link.short}? This will remove analytics and redirect history for this link.`);
      if (!confirmed) return;
    }
    setDeletingLinkId(link.id);
    try {
      await api.delete(`/links/${link.id}`, { params: { mode: deleteMode }, headers: { Authorization: `Bearer ${token}` } });
      setMessage({ type: "success", text: deleteMode === "provider" ? "Link deleted from dashboard and Short.io." : "Link deleted from dashboard." });
      await refreshWorkspaceData();
    } catch (error) { setMessage({ type: "error", text: formatApiError(error, "Failed to delete link") }); }
    finally { setDeletingLinkId(null); }
  }

  function downloadQr(extension) {
    if (!createQrData) { setMessage({ type: "error", text: "Isi URL dulu atau generate short link sebelum download QR." }); return; }
    const name = createQrData.replace(/^https?:\/\//, "").replace(/[^\w-]/g, "-") || `qr-${Date.now()}`;
    qrCode.download({ name, extension });
  }

  function downloadLinkQr(extension) {
    if (!activeQrLink?.short) { setMessage({ type: "error", text: "QR data is not available yet." }); return; }
    const name = activeQrLink.short.replace(/^https?:\/\//, "").replace(/[^\w-]/g, "-");
    qrModalCode.download({ name, extension });
  }

  // ── Build nav items (memoized) ──
  const navItems = useMemo(() => {
    const items = TAB_ROUTES.map((r) => ({ ...r }));
    if (isAdmin) items.push({ ...ADMIN_ROUTE });
    return items;
  }, [isAdmin]);

  // ── Auth gate ──
  if (!token || !user) {
    return (
      <AuthScreen
        authMode={authMode}
        authForm={authForm}
        authLoading={authLoading || sessionLoading}
        error={authError}
        onChange={updateAuthField}
        onSubmit={handleAuthSubmit}
        onToggleMode={() => setAuthMode((c) => (c === "login" ? "register" : "login"))}
      />
    );
  }

  // ── Dashboard shell ──
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
          {navItems.map(({ path, tab, icon: Icon, label, size }) => (
            <button
              key={tab}
              onClick={() => navigate(path)}
              className={cn(currentTab === tab ? "nav-active" : "nav-inactive")}
            >
              <Icon size={size} /> {label}
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
            <h2 className="text-sm font-bold text-slate-900 capitalize">{TAB_TITLES[currentTab] || "Dashboard"}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700" onClick={refreshWorkspaceData} title="Refresh">
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

          <Routes>
            <Route
              path="/"
              element={
                <OverviewTab user={user} summary={summary} clicksSeries={clicksSeries} topLinks={topLinks} trafficInsights={trafficInsights} />
              }
            />
            <Route
              path="/create"
              element={
                <CreateTab
                  form={form} settings={settings} shortUrl={shortUrl} selectedProvider={selectedProvider} submittingLink={submittingLink} qrRef={qrRef}
                  onUpdateFormField={updateFormField} onUpdateSettingsField={updateSettingsField} onCreateLink={handleCreateLink} onDownloadQr={downloadQr} onCopy={handleCopy} onSwitchToProviders={() => navigate("/providers")}
                />
              }
            />
            <Route
              path="/links"
              element={
                <LinksTab
                  links={links} totalLinks={totalLinks} filters={filters} editingLinkId={editingLinkId} editDraft={editDraft} savingLinkId={savingLinkId} deletingLinkId={deletingLinkId} editQrRef={editQrRef}
                  page={page} totalPages={totalPages} onGoToPage={goToPage}
                  onSetFilters={setFilters} onCopy={handleCopy} onOpenQrModal={setActiveQrLink} onStartEditing={startEditingLink} onCancelEditing={() => setEditingLinkId(null)} onUpdateEditDraft={updateEditDraftField} onUpdateEditQrConfig={updateEditQrConfigField} onSaveEdits={saveLinkEdits} onToggleLinkState={toggleLinkState} onRemoveLink={removeLink}
                />
              }
            />
            <Route
              path="/providers"
              element={
                <ProvidersTab
                  isAdmin={isAdmin} selectedProvider={selectedProvider} importingShortIo={importingShortIo} importingSingleLinkId={importingSingleLinkId} providerDiagnosticsLoading={providerDiagnosticsLoading} syncHealth={syncHealth} reconcileReport={reconcileReport}
                  onSelectProvider={(key) => updateFormField("provider", key)} onImportShortIo={handleImportShortIo} onImportSingleLink={handleImportSingleLink} onRefreshDiagnostics={fetchProviderDiagnostics}
                />
              }
            />
            {isAdmin && (
              <Route
                path="/audit"
                element={
                  <AuditTab
                    users={users} usersLoading={usersLoading} auditLogs={auditLogs} creatingUser={creatingUser} newUserForm={newUserForm}
                    onUpdateNewUserField={updateNewUserField} onCreateUser={handleCreateUser}
                  />
                }
              />
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>

      {/* ── QR Modal ── */}
      {activeQrLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-slate-950/50" onClick={() => setActiveQrLink(null)} aria-label="Close QR popup" />
          <section className="panel relative z-10 w-full max-w-md space-y-4 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">QR Preview</p>
                <h3 className="text-lg font-bold text-slate-900">{activeQrLink.title || activeQrLink.shortCode || "Short Link"}</h3>
                <p className="text-xs text-primary-600 break-all mt-1">{activeQrLink.short}</p>
              </div>
              <button type="button" className="btn-secondary h-9 px-3 text-xs" onClick={() => setActiveQrLink(null)}>Close</button>
            </div>
            <div ref={qrModalRef} className="preview-shell" />
            <div className="grid grid-cols-2 gap-3">
              <button type="button" className="btn-secondary" onClick={() => downloadLinkQr("png")}><Download size={16} /> PNG</button>
              <button type="button" className="btn-secondary" onClick={() => downloadLinkQr("svg")}><Download size={16} /> SVG</button>
            </div>
          </section>
        </div>
      )}

      {/* ── Mobile bottom nav ── */}
      <nav className="sidebar-mobile">
        {navItems.map(({ path, tab, icon: Icon }) => (
          <button
            key={tab}
            onClick={() => navigate(path)}
            className={cn("transition-colors", currentTab === tab ? "text-primary-600" : "text-slate-400")}
          >
            <Icon size={22} />
          </button>
        ))}
      </nav>
    </div>
  );
}

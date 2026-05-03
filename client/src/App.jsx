import React, { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle, BarChart3, Link as LinkIcon, Palette, QrCode, Shield, Zap,
} from "lucide-react";
import {
  DEFAULT_SETTINGS, EMPTY_NEW_USER_FORM, EMPTY_RECONCILE, EMPTY_SUMMARY,
  EMPTY_SYNC_HEALTH, EMPTY_TRAFFIC_INSIGHTS, INTERNAL_PREVIEW_DOMAIN,
  SHORT_IO_PREVIEW_DOMAIN, TOKEN_STORAGE_KEY,
} from "./lib/constants";
import { api } from "./lib/api";
import { cn, formatApiError, formatDateTimeInput, isUnauthorizedError } from "./lib/utils";
import useAuth from "./hooks/useAuth";
import useQrCode from "./hooks/useQrCode";
import AuthScreen from "./components/AuthScreen";
import Sidebar from "./components/layout/Sidebar";
import TopBar from "./components/layout/TopBar";
import QRModal from "./components/layout/QRModal";
import MobileNav from "./components/layout/MobileNav";

// ── Lazy-loaded views (code splitting) ──
const OverviewTab = lazy(() => import("./views/OverviewTab"));
const CreateTab = lazy(() => import("./views/CreateTab"));
const LinksTab = lazy(() => import("./views/LinksTab"));
const ProvidersTab = lazy(() => import("./views/ProvidersTab"));
const AuditTab = lazy(() => import("./views/AuditTab"));

// ── Route config ──
const TAB_ROUTES = [
  { path: "/",          tab: "overview",  icon: BarChart3, label: "Dashboard",   size: 18 },
  { path: "/create",    tab: "create",    icon: Palette,   label: "Create Link", size: 18 },
  { path: "/links",     tab: "links",     icon: LinkIcon,  label: "My Links",    size: 18 },
  { path: "/providers", tab: "providers", icon: Zap,       label: "Providers",   size: 18 },
];
const ADMIN_ROUTE = { path: "/audit", tab: "audit", icon: Shield, label: "Audit Logs", size: 18 };

const TAB_TITLES = {
  overview: "Dashboard", create: "Create Link", links: "Manage Links",
  providers: "Provider Config", audit: "Audit Logs",
};

function pathToTab(pathname) {
  const cleaned = pathname.replace(/\/$/, "") || "/";
  const match = [...TAB_ROUTES, ADMIN_ROUTE].find((r) => r.path === cleaned);
  return match?.tab || "overview";
}

// ── Suspense fallback ──
function TabLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <QrCode size={28} className="animate-spin text-primary-400" />
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentTab = pathToTab(location.pathname);

  // Auth hook
  const auth = useAuth();
  const { token, user, isAdmin, sessionLoading } = auth;

  // QR hook
  const qr = useQrCode();

  // ── App-level state ──
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
  const [shortIoHistoryFilters, setShortIoHistoryFilters] = useState({ search: "", status: "all" });
  const [auditLogs, setAuditLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUserForm, setNewUserForm] = useState(EMPTY_NEW_USER_FORM);
  const [filters, setFilters] = useState({ search: "", provider: "all", status: "all" });
  const deferredSearch = useDeferredValue(filters.search);
  const deferredShortIoHistorySearch = useDeferredValue(shortIoHistoryFilters.search);
  const [shortUrl, setShortUrl] = useState("");
  const [providerUsed, setProviderUsed] = useState("shortio");
  const [copiedValue, setCopiedValue] = useState("");
  const [editingLinkId, setEditingLinkId] = useState(null);
  const [editDraft, setEditDraft] = useState({ title: "", customSlug: "", expiresAt: "", isActive: true, qrConfig: { ...DEFAULT_SETTINGS } });
  const [form, setForm] = useState({ url: "", title: "", provider: "shortio", customSlug: "", expiresAt: "" });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const selectedProvider = isAdmin ? form.provider : "shortio";
  const totalPages = Math.max(1, Math.ceil(totalLinks / limit));
  const previewDomain = selectedProvider === "shortio" ? SHORT_IO_PREVIEW_DOMAIN : INTERNAL_PREVIEW_DOMAIN;
  const slugPreview = form.customSlug.trim() ? `${previewDomain}/${form.customSlug.trim()}` : "";
  const createQrData = shortUrl || slugPreview || form.url.trim();

  // ── Timers ──
  useEffect(() => { if (!message) return; const t = setTimeout(() => setMessage(null), 2800); return () => clearTimeout(t); }, [message]);
  useEffect(() => { if (!copiedValue) return; const t = setTimeout(() => setCopiedValue(""), 1400); return () => clearTimeout(t); }, [copiedValue]);

  // ── QR rendering ──
  useEffect(() => { qr.renderCreateQr(createQrData, settings); }, [createQrData, settings, qr.renderCreateQr]);
  useEffect(() => {
    if (!editingLinkId) return;
    const editingLink = links.find((item) => item.id === editingLinkId);
    if (editingLink) qr.renderEditQr(editingLink, editDraft.qrConfig);
  }, [editDraft.qrConfig, editingLinkId, links, qr.renderEditQr]);

  // ── Field updaters ──
  const updateFormField = useCallback((field, value) => setForm((c) => ({ ...c, [field]: value })), []);
  const updateSettingsField = useCallback((field, value) => setSettings((c) => ({ ...c, [field]: value })), []);
  const updateEditDraftField = useCallback((field, value) => setEditDraft((c) => ({ ...c, [field]: value })), []);
  const updateEditQrConfigField = useCallback((field, value) => setEditDraft((c) => ({ ...c, qrConfig: { ...DEFAULT_SETTINGS, ...(c.qrConfig || {}), [field]: value } })), []);
  const updateNewUserField = useCallback((field, value) => setNewUserForm((c) => ({ ...c, [field]: value })), []);

  // ── Helpers ──
  function handleAuthError(error, fallbackMsg) {
    const msg = formatApiError(error, fallbackMsg);
    if (error?.response?.status === 401) { auth.clearAuth(msg); }
    else { setMessage({ type: "error", text: msg }); }
  }

  // ── Data fetching ──
  async function fetchDashboard() {
    if (!token || !user) return;
    setDashboardLoading(true);
    try {
      const { data } = await api.get("/dashboard", { headers: { Authorization: `Bearer ${token}` }, params: { search: deferredSearch, provider: filters.provider, status: filters.status, page, limit } });
      setSummary(data.summary || EMPTY_SUMMARY); setClicksSeries(data.clicksSeries || []); setTopLinks(data.topLinks || []); setTrafficInsights(data.trafficInsights || EMPTY_TRAFFIC_INSIGHTS); setAuditLogs(data.auditLogs || []); setLinks(data.links || []); setTotalLinks(data.totalLinks || 0);
    } catch (error) { handleAuthError(error, "Failed to load dashboard data"); }
    finally { setDashboardLoading(false); }
  }

  async function fetchShortIoHistory() {
    if (!token || !user) return;
    setShortIoHistoryLoading(true);
    try {
      const { data } = await api.get("/history", { headers: { Authorization: `Bearer ${token}` }, params: { provider: "shortio", search: deferredShortIoHistorySearch, status: shortIoHistoryFilters.status, page: shortIoHistoryPage, limit: shortIoHistoryLimit } });
      setShortIoHistory(data.history || []); setShortIoHistoryTotal(data.total || 0);
    } catch (error) { handleAuthError(error, "Failed to load Short.io history"); }
    finally { setShortIoHistoryLoading(false); }
  }

  async function fetchProviderDiagnostics() {
    if (!token || !user || !isAdmin) return;
    setProviderDiagnosticsLoading(true);
    try {
      const { data } = await api.get("/admin/shortio/diagnostics", { headers: { Authorization: `Bearer ${token}` } });
      setSyncHealth(data.syncHealth || EMPTY_SYNC_HEALTH); setReconcileReport(data.reconcile || EMPTY_RECONCILE);
    } catch (error) { handleAuthError(error, "Failed to load provider diagnostics"); }
    finally { setProviderDiagnosticsLoading(false); }
  }

  async function fetchUsers() {
    if (!token || !user || !isAdmin) return;
    setUsersLoading(true);
    try {
      const { data } = await api.get("/admin/users", { headers: { Authorization: `Bearer ${token}` } });
      setUsers(data.users || []);
    } catch (error) { handleAuthError(error, "Failed to load users"); }
    finally { setUsersLoading(false); }
  }

  async function refreshWorkspaceData() {
    await Promise.all([fetchDashboard(), fetchShortIoHistory(), ...(isAdmin ? [fetchProviderDiagnostics(), fetchUsers()] : [])]);
  }

  // ── Data fetch effects ──
  useEffect(() => { fetchDashboard(); }, [user, token, deferredSearch, filters.provider, filters.status, page]);
  useEffect(() => { fetchShortIoHistory(); }, [user, token, deferredShortIoHistorySearch, shortIoHistoryFilters.status, shortIoHistoryPage]);
  useEffect(() => { if (currentTab === "providers" && isAdmin) fetchProviderDiagnostics(); }, [currentTab, isAdmin, token, user]);
  useEffect(() => { if (currentTab === "audit" && isAdmin) fetchUsers(); }, [currentTab, isAdmin, token, user]);

  // ── Action handlers ──
  async function handleCreateUser(event) {
    event.preventDefault();
    if (!isAdmin) return;
    setCreatingUser(true);
    try {
      const { data } = await api.post("/admin/users", { name: newUserForm.name, email: newUserForm.email, password: newUserForm.password, role: newUserForm.role }, { headers: { Authorization: `Bearer ${token}` } });
      setNewUserForm(EMPTY_NEW_USER_FORM);
      await Promise.all([fetchDashboard(), fetchUsers()]);
      setMessage({ type: "success", text: `User ${data.user?.email || newUserForm.email} created successfully.` });
    } catch (error) { if (isUnauthorizedError(error)) auth.clearAuth(formatApiError(error, "Failed to create user")); else setMessage({ type: "error", text: formatApiError(error, "Failed to create user") }); }
    finally { setCreatingUser(false); }
  }

  function handleLogout() {
    auth.handleLogout();
    setLinks([]); setShortIoHistory([]); setShortIoHistoryTotal(0); setShortIoHistoryPage(1);
    setSummary(EMPTY_SUMMARY); setTrafficInsights(EMPTY_TRAFFIC_INSIGHTS); setSyncHealth(EMPTY_SYNC_HEALTH);
    setReconcileReport(EMPTY_RECONCILE); setUsers([]); setNewUserForm(EMPTY_NEW_USER_FORM);
    setMessage({ type: "success", text: "You have been signed out." });
  }

  async function handleCreateLink(event) {
    event.preventDefault();
    setSubmittingLink(true);
    try {
      const { data } = await api.post("/links", { url: form.url, title: form.title, provider: selectedProvider, customSlug: form.customSlug, expiresAt: form.expiresAt || null, qrConfig: settings }, { headers: { Authorization: `Bearer ${token}` } });
      setShortUrl(data.shortURL); setProviderUsed(data.providerUsed || selectedProvider);
      setMessage({ type: "success", text: data.providerUsed !== selectedProvider ? "Link created with fallback provider." : "Link created successfully." });
      await refreshWorkspaceData();
    } catch (error) { setMessage({ type: "error", text: formatApiError(error, "Failed to create link") }); }
    finally { setSubmittingLink(false); }
  }

  async function handleImportShortIo() {
    setImportingShortIo(true);
    try {
      const { data } = await api.post("/admin/shortio/import", {}, { headers: { Authorization: `Bearer ${token}` } });
      setShortIoHistoryPage(1); await refreshWorkspaceData();
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

  async function handleCopy(text) {
    try { await navigator.clipboard.writeText(text); setCopiedValue(text); setMessage({ type: "success", text: "Copied to clipboard." }); }
    catch { setMessage({ type: "error", text: "Copy failed." }); }
  }

  function startEditingLink(link) {
    setEditingLinkId(link.id);
    setEditDraft({ title: link.title || "", customSlug: link.customSlug || link.shortCode || "", expiresAt: formatDateTimeInput(link.expiresAt), isActive: link.isActive, qrConfig: { ...DEFAULT_SETTINGS, ...(link.qrConfig || {}) } });
  }

  async function saveLinkEdits(link) {
    setSavingLinkId(link.id);
    try {
      const payload = { title: editDraft.title, expiresAt: editDraft.expiresAt || null, isActive: editDraft.isActive, qrConfig: editDraft.qrConfig || { ...DEFAULT_SETTINGS } };
      if (link.provider === "internal" || link.provider === "shortio") payload.customSlug = editDraft.customSlug;
      await api.patch(`/links/${link.id}`, payload, { headers: { Authorization: `Bearer ${token}` } });
      setEditingLinkId(null); setMessage({ type: "success", text: "Link updated." }); await refreshWorkspaceData();
    } catch (error) { setMessage({ type: "error", text: formatApiError(error, "Failed to update link") }); }
    finally { setSavingLinkId(null); }
  }

  async function toggleLinkState(link) {
    setSavingLinkId(link.id);
    try {
      await api.patch(`/links/${link.id}`, { isActive: !link.isActive }, { headers: { Authorization: `Bearer ${token}` } });
      setMessage({ type: "success", text: !link.isActive ? "Link reactivated." : "Link disabled." }); await refreshWorkspaceData();
    } catch (error) { setMessage({ type: "error", text: formatApiError(error, "Failed to update status") }); }
    finally { setSavingLinkId(null); }
  }

  async function removeLink(link) {
    let deleteMode = "internal";
    if (link.provider === "shortio") {
      const choice = window.prompt(`Delete ${link.short}\n\nType "both" to delete from dashboard and Short.io.\nType "internal" to delete only from the internal dashboard record.`, "both");
      if (!choice) return;
      const nc = String(choice).trim().toLowerCase();
      if (nc !== "both" && nc !== "internal") { setMessage({ type: "error", text: 'Delete cancelled. Type "both" or "internal".' }); return; }
      deleteMode = nc === "both" ? "provider" : "internal";
    } else {
      if (!window.confirm(`Delete ${link.short}? This will remove analytics and redirect history for this link.`)) return;
    }
    setDeletingLinkId(link.id);
    try {
      await api.delete(`/links/${link.id}`, { params: { mode: deleteMode }, headers: { Authorization: `Bearer ${token}` } });
      setMessage({ type: "success", text: deleteMode === "provider" ? "Link deleted from dashboard and Short.io." : "Link deleted from dashboard." }); await refreshWorkspaceData();
    } catch (error) { setMessage({ type: "error", text: formatApiError(error, "Failed to delete link") }); }
    finally { setDeletingLinkId(null); }
  }

  // ── Nav items (memoized) ──
  const navItems = useMemo(() => {
    const items = TAB_ROUTES.map((r) => ({ ...r }));
    if (isAdmin) items.push({ ...ADMIN_ROUTE });
    return items;
  }, [isAdmin]);

  // ── Auth gate ──
  if (!token || !user) {
    return (
      <AuthScreen
        authMode={auth.authMode} authForm={auth.authForm}
        authLoading={auth.authLoading || sessionLoading}
        error={auth.authError} onChange={auth.updateAuthField}
        onSubmit={auth.handleAuthSubmit} onToggleMode={auth.toggleAuthMode}
      />
    );
  }

  // ── Dashboard shell ──
  return (
    <div className="main-grid dashboard-shell">
      <div className="dashboard-backdrop" />

      <Sidebar navItems={navItems} currentTab={currentTab} user={user} onNavigate={navigate} onLogout={handleLogout} />

      <main className="content-area">
        <TopBar title={TAB_TITLES[currentTab] || "Dashboard"} loading={dashboardLoading} onRefresh={refreshWorkspaceData} />

        <div className="p-4 md:p-6 max-w-7xl mx-auto w-full space-y-6">
          {message && (
            <div className={cn("feedback", message.type === "error" ? "feedback-error" : "feedback-success")}>
              <AlertCircle size={15} />
              <span>{message.text}</span>
            </div>
          )}

          <Suspense fallback={<TabLoader />}>
            <Routes>
              <Route path="/" element={<OverviewTab user={user} summary={summary} clicksSeries={clicksSeries} topLinks={topLinks} trafficInsights={trafficInsights} />} />
              <Route path="/create" element={
                <CreateTab form={form} settings={settings} shortUrl={shortUrl} selectedProvider={selectedProvider} submittingLink={submittingLink} qrRef={qr.qrRef} createQrData={createQrData}
                  onUpdateFormField={updateFormField} onUpdateSettingsField={updateSettingsField} onCreateLink={handleCreateLink} onDownloadQr={(ext) => qr.downloadCreateQr(ext, createQrData, setMessage)} onCopy={handleCopy} onSwitchToProviders={() => navigate("/providers")} />
              } />
              <Route path="/links" element={
                <LinksTab links={links} totalLinks={totalLinks} filters={filters} editingLinkId={editingLinkId} editDraft={editDraft} savingLinkId={savingLinkId} deletingLinkId={deletingLinkId} editQrRef={qr.editQrRef}
                  page={page} totalPages={totalPages} onGoToPage={(p) => setPage(Math.max(1, Math.min(p, totalPages)))}
                  onSetFilters={setFilters} onCopy={handleCopy} onOpenQrModal={qr.setActiveQrLink} onStartEditing={startEditingLink} onCancelEditing={() => setEditingLinkId(null)} onUpdateEditDraft={updateEditDraftField} onUpdateEditQrConfig={updateEditQrConfigField} onSaveEdits={saveLinkEdits} onToggleLinkState={toggleLinkState} onRemoveLink={removeLink} />
              } />
              <Route path="/providers" element={
                <ProvidersTab isAdmin={isAdmin} selectedProvider={selectedProvider} importingShortIo={importingShortIo} importingSingleLinkId={importingSingleLinkId} providerDiagnosticsLoading={providerDiagnosticsLoading} syncHealth={syncHealth} reconcileReport={reconcileReport}
                  onSelectProvider={(key) => updateFormField("provider", key)} onImportShortIo={handleImportShortIo} onImportSingleLink={handleImportSingleLink} onRefreshDiagnostics={fetchProviderDiagnostics} />
              } />
              {isAdmin && (
                <Route path="/audit" element={
                  <AuditTab users={users} usersLoading={usersLoading} auditLogs={auditLogs} creatingUser={creatingUser} newUserForm={newUserForm}
                    onUpdateNewUserField={updateNewUserField} onCreateUser={handleCreateUser} />
                } />
              )}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </main>

      <QRModal activeQrLink={qr.activeQrLink} qrModalRef={qr.qrModalRef} onClose={() => qr.setActiveQrLink(null)} onDownload={(ext) => qr.downloadLinkQr(ext, setMessage)} />
      <MobileNav navItems={navItems} currentTab={currentTab} onNavigate={navigate} />
    </div>
  );
}

import React from "react";
import { Globe, Loader2, RefreshCcw, Shield, Zap } from "lucide-react";
import { PROVIDERS } from "../lib/constants";
import { cn, formatReadableDate } from "../lib/utils";
import { SyncMetricCard } from "../components/Cards";

export default function ProvidersTab({
  isAdmin,
  selectedProvider,
  importingShortIo,
  importingSingleLinkId,
  providerDiagnosticsLoading,
  syncHealth,
  reconcileReport,
  onSelectProvider,
  onImportShortIo,
  onImportSingleLink,
  onRefreshDiagnostics,
}) {
  return (
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
                    onClick={() => onSelectProvider(key)} 
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
              onClick={onImportShortIo} 
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
                onClick={onRefreshDiagnostics}
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
                          onClick={() => onImportSingleLink(item)}
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
}

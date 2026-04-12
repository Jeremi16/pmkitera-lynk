import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Palette,
  QrCode,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { CORNER_STYLES, DEFAULT_SETTINGS, PROVIDERS, QR_STYLES } from "../lib/constants";
import { cn, formatReadableDate } from "../lib/utils";

export default function LinksTab({
  links,
  totalLinks,
  filters,
  editingLinkId,
  editDraft,
  savingLinkId,
  deletingLinkId,
  editQrRef,
  page,
  totalPages,
  onGoToPage,
  onSetFilters,
  onCopy,
  onOpenQrModal,
  onStartEditing,
  onCancelEditing,
  onUpdateEditDraft,
  onUpdateEditQrConfig,
  onSaveEdits,
  onToggleLinkState,
  onRemoveLink,
}) {
  return (
    <div className="space-y-6 animate-fade-in">
      <section className="panel space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Manage Links</h2>
          <div className="badge badge-dark">{totalLinks} Total</div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <label className="search-shell min-w-[300px]">
            <Search size={16} />
            <input value={filters.search} onChange={(e) => onSetFilters(c => ({...c, search: e.target.value}))} placeholder="Search destination, slug, or title..." />
          </label>
          <select className="input-field" value={filters.provider} onChange={(e) => onSetFilters(c => ({...c, provider: e.target.value}))}>
            <option value="all">All Providers</option>
            <option value="internal">Internal</option>
            <option value="shortio">Short.io</option>
          </select>
          <select className="input-field" value={filters.status} onChange={(e) => onSetFilters(c => ({...c, status: e.target.value}))}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button className="btn-secondary" onClick={() => onSetFilters({search: "", provider: "all", status: "all"})}>Reset</button>
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
                  <button type="button" className="btn-secondary p-3" onClick={() => onCopy(link.short)}><Copy size={16} /></button>
                  <button type="button" className="btn-secondary p-3" onClick={() => onOpenQrModal(link)}><QrCode size={16} /></button>
                  <button
                    type="button"
                    className={cn(
                      "btn-secondary p-3",
                      editingLinkId === link.id && "border-primary-300 text-primary-600 bg-primary-50",
                    )}
                    onClick={() =>
                      editingLinkId === link.id
                        ? onCancelEditing()
                        : onStartEditing(link)
                    }
                  >
                    <Settings2 size={16} />
                  </button>
                  <button type="button" className="btn-secondary p-3 text-red-500 hover:bg-red-50" onClick={() => onRemoveLink(link)} disabled={deletingLinkId === link.id}>
                    {deletingLinkId === link.id ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                  </button>
                </div>
              </div>

              {editingLinkId === link.id && (
                <div className="mt-6 border-t border-slate-100 pt-6 space-y-6">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="label-text">Title</label>
                        <input className="input-field" value={editDraft.title} onChange={(event) => onUpdateEditDraft("title", event.target.value)} placeholder="Campaign label" />
                      </div>
                      <div className="space-y-2">
                        <label className="label-text">Custom Slug</label>
                        <input className="input-field" value={editDraft.customSlug} onChange={(event) => onUpdateEditDraft("customSlug", event.target.value)} placeholder="promo2026" />
                      </div>
                      <div className="space-y-2">
                        <label className="label-text">Expiry</label>
                        <input className="input-field" type="datetime-local" value={editDraft.expiresAt} onChange={(event) => onUpdateEditDraft("expiresAt", event.target.value)} />
                      </div>
                      <label className="toggle-shell">
                        <input type="checkbox" checked={editDraft.isActive} onChange={(event) => onUpdateEditDraft("isActive", event.target.checked)} />
                        Link aktif
                      </label>
                    </div>
                    <div className="space-y-4">
                      <div className="panel-inset p-4">
                        <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">QR Preview</p>
                        <div ref={editQrRef} className="preview-shell mt-3" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Palette size={16} className="text-slate-500" />
                      <p className="text-sm font-bold text-slate-900">QR Design</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-2">
                        <label className="label-text">QR Color</label>
                        <div className="color-field h-11">
                          <input type="color" value={editDraft.qrConfig?.dotsColor || DEFAULT_SETTINGS.dotsColor} onChange={(event) => onUpdateEditQrConfig("dotsColor", event.target.value)} />
                          <span>{editDraft.qrConfig?.dotsColor || DEFAULT_SETTINGS.dotsColor}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="label-text">Background</label>
                        <div className="color-field h-11">
                          <input type="color" value={editDraft.qrConfig?.backgroundColor || DEFAULT_SETTINGS.backgroundColor} onChange={(event) => onUpdateEditQrConfig("backgroundColor", event.target.value)} />
                          <span>{editDraft.qrConfig?.backgroundColor || DEFAULT_SETTINGS.backgroundColor}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="label-text">Dot Pattern</label>
                        <select className="input-field" value={editDraft.qrConfig?.dotsType || DEFAULT_SETTINGS.dotsType} onChange={(event) => onUpdateEditQrConfig("dotsType", event.target.value)}>
                          {QR_STYLES.map((style) => (<option key={style} value={style}>{style}</option>))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="label-text">Corner Style</label>
                        <select className="input-field" value={editDraft.qrConfig?.cornersType || DEFAULT_SETTINGS.cornersType} onChange={(event) => onUpdateEditQrConfig("cornersType", event.target.value)}>
                          {CORNER_STYLES.map((style) => (<option key={style} value={style}>{style}</option>))}
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="toggle-shell">
                        <input type="checkbox" checked={Boolean(editDraft.qrConfig?.gradient)} onChange={(event) => onUpdateEditQrConfig("gradient", event.target.checked)} />
                        Aktifkan gradient
                      </label>
                      <div className="space-y-2">
                        <label className="label-text">Gradient Color 2</label>
                        <div className="color-field h-11">
                          <input type="color" value={editDraft.qrConfig?.gradientColor2 || DEFAULT_SETTINGS.gradientColor2} onChange={(event) => onUpdateEditQrConfig("gradientColor2", event.target.value)} />
                          <span>{editDraft.qrConfig?.gradientColor2 || DEFAULT_SETTINGS.gradientColor2}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:justify-end gap-3">
                    <button type="button" className="btn-secondary" onClick={onCancelEditing}>Cancel</button>
                    <button type="button" className="btn-primary" disabled={savingLinkId === link.id} onClick={() => onSaveEdits(link)}>
                      {savingLinkId === link.id ? (<><Loader2 className="animate-spin" size={16} />Saving...</>) : "Save Changes"}
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}

          {links.length === 0 && (
            <div className="empty-state py-12">
              <Search size={28} className="text-slate-300" />
              <p className="text-sm text-slate-500 mt-2">No links found matching your filters.</p>
            </div>
          )}
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              Page <span className="font-bold text-slate-900">{page}</span> of <span className="font-bold text-slate-900">{totalPages}</span>
              <span className="ml-2 text-slate-400">({totalLinks} links)</span>
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="btn-secondary h-9 px-3 text-xs"
                disabled={page <= 1}
                onClick={() => onGoToPage(page - 1)}
              >
                <ChevronLeft size={14} /> Prev
              </button>

              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum;
                if (totalPages <= 7) {
                  pageNum = i + 1;
                } else if (page <= 4) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 3) {
                  pageNum = totalPages - 6 + i;
                } else {
                  pageNum = page - 3 + i;
                }
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => onGoToPage(pageNum)}
                    className={cn(
                      "h-9 w-9 rounded-xl text-xs font-bold transition-all",
                      page === pageNum
                        ? "bg-primary-500 text-white shadow-md shadow-primary-500/25"
                        : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50",
                    )}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                type="button"
                className="btn-secondary h-9 px-3 text-xs"
                disabled={page >= totalPages}
                onClick={() => onGoToPage(page + 1)}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

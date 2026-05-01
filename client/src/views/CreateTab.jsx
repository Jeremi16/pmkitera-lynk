import React from "react";
import {
  ArrowRight,
  Download,
  Globe,
  Loader2,
  Palette,
  Zap,
} from "lucide-react";
import { CORNER_STYLES, INTERNAL_PREVIEW_DOMAIN, PROVIDERS, QR_STYLES, SHORT_IO_PREVIEW_DOMAIN } from "../lib/constants";
import { cn } from "../lib/utils";
import ColorPicker from "../components/ColorPicker";
import Select from "../components/Select";

export default function CreateTab({
  form,
  settings,
  shortUrl,
  selectedProvider,
  submittingLink,
  qrRef,
  createQrData,
  onUpdateFormField,
  onUpdateSettingsField,
  onCreateLink,
  onDownloadQr,
  onCopy,
  onSwitchToProviders,
}) {
  const previewDomain = selectedProvider === "shortio" ? SHORT_IO_PREVIEW_DOMAIN : INTERNAL_PREVIEW_DOMAIN;
  const previewSlug = form.customSlug.trim() || "______";
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px] animate-fade-in">
      <section className="panel space-y-6">
        <h2 className="text-2xl font-bold">New shortened destination</h2>
        <form onSubmit={onCreateLink} className="space-y-6">
          <div className="space-y-2">
            <label className="label-text">Destination URL</label>
            <input className="input-field h-12 text-base" type="url" value={form.url} onChange={(e) => onUpdateFormField("url", e.target.value)} placeholder="https://your-site.com/path" required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="label-text">Title</label>
              <input className="input-field" value={form.title} onChange={(e) => onUpdateFormField("title", e.target.value)} placeholder="Campaign Label" />
            </div>
            <div className="space-y-2">
              <label className="label-text">Custom Slug (Optional)</label>
              <input className="input-field" value={form.customSlug} onChange={(e) => onUpdateFormField("customSlug", e.target.value)} placeholder="promo2024" />
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
                <ColorPicker label="QR" color={settings.dotsColor} onChange={(val) => onUpdateSettingsField("dotsColor", val)} />
              </div>
              <div className="space-y-2">
                <label className="label-text">Background</label>
                <ColorPicker label="Background" color={settings.backgroundColor} onChange={(val) => onUpdateSettingsField("backgroundColor", val)} />
              </div>
              <div className="space-y-2">
                <label className="label-text">Dot Pattern</label>
                <Select value={settings.dotsType} onChange={(val) => onUpdateSettingsField("dotsType", val)} options={QR_STYLES} />
              </div>
              <div className="space-y-2">
                <label className="label-text">Corner Style</label>
                <Select value={settings.cornersType} onChange={(val) => onUpdateSettingsField("cornersType", val)} options={CORNER_STYLES} />
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
            <button type="button" className="btn-secondary" onClick={() => onDownloadQr("png")}><Download size={16} /> PNG</button>
            <button type="button" className="btn-secondary" onClick={() => onDownloadQr("svg")}><Download size={16} /> SVG</button>
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
                  {previewDomain.replace(/^https?:\/\//, '')}/{previewSlug}
                </p>
                <p className="text-[10px] text-slate-400 mt-1 font-medium">Estimated generated link format</p>
             </div>
             {createQrData && (
               <div className="panel-inset p-3 bg-primary-50/30 border-primary-100 overflow-hidden mt-2">
                 <p className="text-[10px] uppercase tracking-widest text-primary-500 font-bold">QR Encodes</p>
                 <p className="text-xs font-medium text-slate-700 break-all mt-0.5">{createQrData}</p>
               </div>
             )}
          </div>

          {shortUrl && (
            <div className="panel-inset p-4 space-y-2 bg-primary-50/50 border-primary-100 animate-slide-up">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-primary-600 font-bold">Latest Result</span>
                <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              </div>
              <p className="text-sm font-bold text-slate-900 break-all">{shortUrl}</p>
              <button className="btn-secondary w-full h-10 text-xs font-bold" onClick={() => onCopy(shortUrl)}>Copy Link</button>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

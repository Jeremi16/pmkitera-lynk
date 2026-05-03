import React from "react";
import { Download } from "lucide-react";

export default function QRModal({ activeQrLink, qrModalRef, onClose, onDownload }) {
  if (!activeQrLink) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-slate-950/50" onClick={onClose} aria-label="Close QR popup" />
      <section className="panel relative z-10 w-full max-w-md space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">QR Preview</p>
            <h3 className="text-lg font-bold text-slate-900">{activeQrLink.title || activeQrLink.shortCode || "Short Link"}</h3>
            <p className="text-xs text-primary-600 break-all mt-1">{activeQrLink.short}</p>
          </div>
          <button type="button" className="btn-secondary h-9 px-3 text-xs" onClick={onClose}>Close</button>
        </div>
        <div ref={qrModalRef} className="preview-shell" />
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn-secondary" onClick={() => onDownload("png")}><Download size={16} /> PNG</button>
          <button type="button" className="btn-secondary" onClick={() => onDownload("svg")}><Download size={16} /> SVG</button>
        </div>
      </section>
    </div>
  );
}

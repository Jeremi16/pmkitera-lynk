import React from "react";
import { RefreshCcw } from "lucide-react";
import { cn } from "../../lib/utils";

export default function TopBar({ title, loading, onRefresh }) {
  return (
    <header className="top-bar">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">PMK LYNK</p>
        <h2 className="text-sm font-bold text-slate-900 capitalize">{title}</h2>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="p-2 rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700"
          onClick={onRefresh}
          title="Refresh"
        >
          <RefreshCcw size={16} className={cn(loading && "animate-spin")} />
        </button>
      </div>
    </header>
  );
}

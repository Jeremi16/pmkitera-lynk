import React from "react";
import { BarChart3 } from "lucide-react";
import { cn } from "../lib/utils";

export function SummaryCard({ label, value, tone = "slate", helper }) {
  return (
    <div className={cn("stat-card", `stat-card-${tone}`)}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {helper && <span className="stat-helper">{helper}</span>}
    </div>
  );
}

export function MiniBarChart({ data }) {
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

export function InsightList({ title, items }) {
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

export function SyncMetricCard({ label, value, helper, tone = "slate" }) {
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

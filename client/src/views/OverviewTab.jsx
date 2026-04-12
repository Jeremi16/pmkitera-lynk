import React from "react";
import {
  BarChart3,
  Clock3,
  Globe,
  Link as LinkIcon,
} from "lucide-react";
import { PROVIDERS } from "../lib/constants";
import { formatReadableDate } from "../lib/utils";
import { SummaryCard, MiniBarChart, InsightList, SyncMetricCard } from "../components/Cards";

export default function OverviewTab({
  user,
  summary,
  clicksSeries,
  topLinks,
  trafficInsights,
}) {
  return (
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
}

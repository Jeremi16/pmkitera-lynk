import React from "react";
import { Loader2, Shield, UserRound } from "lucide-react";
import { cn, formatReadableDate } from "../lib/utils";

export default function AuditTab({
  users,
  usersLoading,
  auditLogs,
  creatingUser,
  newUserForm,
  onUpdateNewUserField,
  onCreateUser,
}) {
  return (
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

          <form className="space-y-4" onSubmit={onCreateUser}>
            <div className="space-y-2">
              <label className="label-text">Full name</label>
              <input className="input-field" value={newUserForm.name} onChange={(event) => onUpdateNewUserField("name", event.target.value)} placeholder="Nama operator" required />
            </div>
            <div className="space-y-2">
              <label className="label-text">Email</label>
              <input className="input-field" type="email" value={newUserForm.email} onChange={(event) => onUpdateNewUserField("email", event.target.value)} placeholder="operator@pmklynk.com" required />
            </div>
            <div className="space-y-2">
              <label className="label-text">Password</label>
              <input className="input-field" type="password" value={newUserForm.password} onChange={(event) => onUpdateNewUserField("password", event.target.value)} placeholder="At least 8 chars with upper/lower/number" required />
              <p className="text-xs text-slate-400">
                Gunakan kombinasi huruf besar, huruf kecil, dan angka.
              </p>
            </div>
            <div className="space-y-2">
              <label className="label-text">Role</label>
              <select className="input-field" value={newUserForm.role} onChange={(event) => onUpdateNewUserField("role", event.target.value)}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button className="btn-primary w-full h-12" disabled={creatingUser}>
              {creatingUser ? (<><Loader2 className="animate-spin" size={16} />Creating user...</>) : (<><Shield size={16} />Create new user</>)}
            </button>
          </form>
        </div>

        <div className="panel space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Team Directory</p>
              <h2 className="text-2xl font-bold text-slate-900">Registered users</h2>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-slate-900">{users.length} accounts</p>
              <p className="text-xs text-slate-400">{usersLoading ? "Refreshing..." : "Latest internal roster"}</p>
            </div>
          </div>

          <div className="space-y-3">
            {usersLoading ? (
              <div className="empty-state py-10"><Loader2 className="animate-spin" size={22} /><p>Loading users...</p></div>
            ) : users.length === 0 ? (
              <div className="empty-state py-10"><UserRound size={24} /><p>No users created yet.</p></div>
            ) : (
              users.map((account) => (
                <div key={account.id} className="panel-inset p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"><UserRound size={18} /></div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-slate-900 truncate">{account.name || account.email}</p>
                        <span className={cn("badge border", account.role === "admin" ? "bg-sky-50 text-sky-700 border-sky-200" : "bg-slate-100 text-slate-600 border-slate-200")}>{account.role}</span>
                      </div>
                      <p className="text-sm text-slate-500 truncate">{account.email}</p>
                      <p className="text-xs text-slate-400">Created {formatReadableDate(account.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="px-4 py-2 rounded-2xl bg-slate-50 text-center min-w-[88px]">
                      <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Links</p>
                      <p className="text-lg font-black text-slate-900">{account.linksCount || 0}</p>
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
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Security Trail</p>
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
}

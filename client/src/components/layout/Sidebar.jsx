import React from "react";
import { QrCode, LogOut, UserRound } from "lucide-react";
import { cn } from "../../lib/utils";

export default function Sidebar({ navItems, currentTab, user, onNavigate, onLogout }) {
  return (
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
            onClick={() => onNavigate(path)}
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
        <button onClick={onLogout} className="nav-inactive text-red-500 hover:bg-red-50 hover:text-red-600">
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </aside>
  );
}

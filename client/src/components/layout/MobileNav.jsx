import React from "react";
import { cn } from "../../lib/utils";

export default function MobileNav({ navItems, currentTab, onNavigate }) {
  return (
    <nav className="sidebar-mobile">
      {navItems.map(({ path, tab, icon: Icon }) => (
        <button
          key={tab}
          onClick={() => onNavigate(path)}
          className={cn("transition-colors", currentTab === tab ? "text-primary-600" : "text-slate-400")}
        >
          <Icon size={22} />
        </button>
      ))}
    </nav>
  );
}

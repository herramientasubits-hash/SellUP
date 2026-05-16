"use client";

import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { mainNavItems } from "@/config/navigation";
import { NavLink, MobileNavLink } from "@/components/navigation/nav-link";
import { useSidebar } from "@/components/layout/sidebar-context";

export { MobileNavLink };

interface AppSidebarProps {
  className?: string;
}

export function AppSidebar({ className }: AppSidebarProps) {
  const { collapsed, toggle } = useSidebar();

  return (
    <div className={cn("flex flex-1 flex-col justify-between overflow-hidden", className)}>
      {/* Nav items */}
      <nav className="flex flex-col gap-0.5 p-2 pt-4">
        {!collapsed && (
          <p className="mb-2.5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/40">
            Navegación
          </p>
        )}
        {mainNavItems.map((item, i) => (
          <div
            key={item.href}
            style={{ animationDelay: `${i * 40}ms` }}
            className="animate-su-slide-in"
          >
            <NavLink item={item} />
          </div>
        ))}
      </nav>

      {/* Toggle — sidebar footer */}
      <div className="p-2">
        <button
          onClick={toggle}
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium",
            "text-muted-foreground/40 transition-all duration-200",
            "hover:bg-accent hover:text-muted-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          <ChevronLeft
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-300 ease-[var(--ease-spring)]",
              collapsed && "rotate-180",
            )}
          />
          {!collapsed && <span>Colapsar</span>}
        </button>
      </div>
    </div>
  );
}

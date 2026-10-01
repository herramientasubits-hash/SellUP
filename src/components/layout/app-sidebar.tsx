"use client";

import * as React from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "@/icons";
import { cn } from "@/lib/utils";
import {
  mainNavItems,
  getVisibleNavItems,
  type NavAccessContext,
} from "@/config/navigation";
import { NavLink, MobileNavLink } from "@/components/navigation/nav-link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSidebar } from "@/components/layout/sidebar-context";

export { MobileNavLink };

interface AppSidebarProps {
  className?: string;
  navAccess: NavAccessContext;
}

/** La marca del producto: el chip con el degradado del tema y, desplegado, el nombre. */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-sm font-bold text-primary-foreground shadow-card"
      >
        S
      </span>
      {!compact && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-bold tracking-tight text-foreground">
            Sell<span className="text-primary">Up</span>
          </span>
          <span className="truncate text-xs text-text-muted">
            Inteligencia comercial
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * Menú lateral — anatomía de Thema (`app-shell/AppSidebar` + `SidebarIconRail`).
 *
 * Desplegado (240px): marca arriba, navegación con nombre y, al pie, nada que
 * compita con ella — la cuenta, los avisos y el tema viven en la cabecera.
 * Contraído (64px): el mismo menú como riel de iconos con tooltip.
 */
export function AppSidebar({ className, navAccess }: AppSidebarProps) {
  const { collapsed, toggle } = useSidebar();
  const visibleNavItems = getVisibleNavItems(mainNavItems, navAccess);
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? "Desplegar menú" : "Contraer menú";

  return (
    <div
      className={cn(
        "flex h-full flex-col",
        collapsed ? "items-center px-2 py-4" : "p-3 pt-4",
        className,
      )}
    >
      {/* Marca + contraer */}
      <div
        className={cn(
          "mb-4 flex shrink-0 items-center",
          collapsed ? "flex-col gap-2" : "justify-between gap-2 px-2",
        )}
      >
        <Link
          href="/pipeline"
          aria-label="SellUp"
          className="min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <BrandMark compact={collapsed} />
        </Link>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={toggle}
                aria-label={toggleLabel}
                aria-expanded={!collapsed}
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <ToggleIcon className="size-4" />
              </button>
            }
          />
          <TooltipContent side="right">{toggleLabel}</TooltipContent>
        </Tooltip>
      </div>

      {/* Navegación */}
      <nav
        aria-label="Navegación principal"
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto",
          collapsed && "items-center",
        )}
      >
        {!collapsed && (
          <p className="px-2 pb-1 text-xs font-semibold text-text-muted">
            Navegación
          </p>
        )}
        {visibleNavItems.map((item) => (
          <NavLink key={item.href} item={item} mode={collapsed ? "rail" : "full"} />
        ))}
      </nav>
    </div>
  );
}

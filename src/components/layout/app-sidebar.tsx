"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  LogOut,
  Settings,
  ChevronsUpDown,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { mainNavItems } from "@/config/navigation";
import { NavLink } from "@/components/navigation/nav-link";
import { useSidebar } from "@/components/layout/sidebar-context";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

export { MobileNavLink } from "@/components/navigation/nav-link";

interface AppSidebarProps {
  className?: string;
  user: User;
}

export function AppSidebar({ className, user }: AppSidebarProps) {
  const { collapsed, toggle } = useSidebar();
  const router = useRouter();

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email ??
    "Usuario";
  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Brand / logo — top */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border/40",
          collapsed ? "justify-center px-3" : "px-5",
        )}
      >
        <Link
          href="/pipeline"
          aria-label="SellUp"
          className={cn(
            "group flex min-w-0 items-center gap-2.5 select-none transition-opacity hover:opacity-90",
            collapsed && "justify-center",
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-su-brand to-su-accent-cool text-[15px] font-extrabold text-white shadow-sm shadow-su-brand/30 ring-1 ring-white/10">
            S
          </span>
          {!collapsed && (
            <div className="flex min-w-0 flex-col leading-none">
              <span className="text-[15px] font-bold tracking-tight">
                <span className="text-sidebar-foreground">Sell</span>
                <span className="su-gradient-text">Up</span>
              </span>
              <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/45">
                Inteligencia Comercial
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* Nav — middle, scrollable */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-5">
        {!collapsed && (
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40">
            Navegación
          </p>
        )}
        <div className="flex flex-col gap-0.5">
          {mainNavItems.map((item, i) => (
            <div
              key={item.href}
              style={{ animationDelay: `${i * 40}ms` }}
              className="animate-su-slide-in"
            >
              <NavLink item={item} />
            </div>
          ))}
        </div>
      </nav>

      {/* User card — bottom */}
      <div className="shrink-0 border-t border-sidebar-border/40 p-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "group flex w-full items-center rounded-xl p-2 text-left transition-all",
              "hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50",
              "data-[popup-open]:bg-sidebar-accent",
              collapsed ? "justify-center" : "gap-2.5",
            )}
          >
            <Avatar
              size={collapsed ? "default" : "lg"}
              className={cn(
                "shrink-0 border-2 border-sidebar-border/40 transition-colors group-hover:border-su-brand/40",
              )}
            >
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="bg-gradient-to-br from-su-brand to-su-accent-cool text-[11px] font-bold text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <>
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="w-full truncate text-[13px] font-semibold text-sidebar-foreground">
                    {displayName}
                  </span>
                  <span className="w-full truncate text-[11px] text-sidebar-foreground/50">
                    {user.email}
                  </span>
                </div>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/30 transition-colors group-hover:text-sidebar-foreground/60" />
              </>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="right"
            sideOffset={10}
            className="w-64"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0">
                <div className="flex items-center gap-3 px-1 py-1.5">
                  <Avatar size="lg" className="shrink-0">
                    <AvatarImage src={avatarUrl} alt={displayName} />
                    <AvatarFallback className="bg-gradient-to-br from-su-brand to-su-accent-cool text-[11px] font-bold text-white">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-foreground leading-tight">
                      {displayName}
                    </span>
                    <span className="truncate text-xs text-muted-foreground font-normal">
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => router.push("/settings")}
            >
              <Settings className="h-4 w-4" />
              Configuración
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              variant="destructive"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Collapse toggle — always visible, anchored to bottom */}
        <TooltipProvider delay={0}>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={toggle}
                  aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
                  className={cn(
                    "mt-1.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5",
                    "text-[11px] font-medium text-sidebar-foreground/40",
                    "transition-all hover:bg-sidebar-accent hover:text-sidebar-foreground/70",
                    collapsed && "justify-center",
                  )}
                >
                  <ChevronLeft
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 transition-transform duration-300 ease-[var(--ease-spring)]",
                      collapsed && "rotate-180",
                    )}
                  />
                  {!collapsed && <span>Colapsar menú</span>}
                </button>
              }
            />
            {collapsed && (
              <TooltipContent side="right" sideOffset={10}>
                Expandir menú
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

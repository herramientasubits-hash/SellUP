"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { mainNavItems } from "@/config/navigation";
import { NavLink, MobileNavLink } from "@/components/navigation/nav-link";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { createClient } from "@/lib/supabase/client";

export { MobileNavLink };

interface AppSidebarProps {
  className?: string;
  user: User;
  initialUnreadCount?: number;
}

/**
 * Icon-rail sidebar — 80px fixed width.
 * Pattern from plantilla-proyectos-shadcn (SidebarRail.tsx).
 * Only icons visible; labels appear in tooltip on hover (NavLink).
 * Layout (top → bottom): brand · nav · notifications · theme · user.
 */
export function AppSidebar({
  className,
  user,
  initialUnreadCount = 0,
}: AppSidebarProps) {
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
      {/* Brand / logo — top, icon-only */}
      <div className="flex h-20 shrink-0 items-center justify-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href="/pipeline"
                aria-label="SellUp"
                className="group flex items-center justify-center transition-opacity hover:opacity-90"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-su-brand to-su-accent-cool text-[15px] font-extrabold text-white shadow-sm shadow-su-brand/30 ring-1 ring-white/10">
                  S
                </span>
              </Link>
            }
          />
          <TooltipContent side="right">Inicio</TooltipContent>
        </Tooltip>
      </div>

      {/* Nav — middle, icon-rail with hover tooltips */}
      <nav className="flex flex-1 flex-col items-center gap-0.5 overflow-y-auto px-2 pt-4 pb-2">
        {mainNavItems.map((item, i) => (
          <div
            key={item.href}
            style={{ animationDelay: `${i * 40}ms` }}
            className="animate-su-slide-in w-full"
          >
            <NavLink item={item} mode="rail" />
          </div>
        ))}
      </nav>

      {/* Bottom dock — utilities then user avatar, separated */}
      <div className="shrink-0 border-t border-sidebar-border/30 px-2 pt-2 pb-3 flex flex-col items-center gap-1">
        {/* Utility icons */}
        <NotificationBell
          initialUnreadCount={initialUnreadCount}
          variant="sidebar"
        />
        <ThemeToggle variant="sidebar" />

        {/* Separator line */}
        <div className="my-1.5 h-px w-7 bg-sidebar-border/40" />

        {/* User avatar — opens dropdown */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  className={cn(
                    "group flex items-center justify-center rounded-full p-0.5 transition-all",
                    "hover:ring-2 hover:ring-su-brand/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-su-brand/50",
                    "data-[popup-open]:ring-2 data-[popup-open]:ring-su-brand/30",
                  )}
                  aria-label={`Cuenta de ${displayName}`}
                >
                  <Avatar className="h-9 w-9 ring-2 ring-sidebar-border/50 transition-all group-hover:ring-su-brand/40">
                    <AvatarImage src={avatarUrl} alt={displayName} />
                    <AvatarFallback className="bg-gradient-to-br from-su-brand to-su-accent-cool text-[11px] font-bold text-white">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
              }
            />
            <TooltipContent side="right">Mi cuenta</TooltipContent>
          </Tooltip>
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
      </div>
    </div>
  );
}

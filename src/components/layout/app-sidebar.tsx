"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import {
  mainNavItems,
  getVisibleNavItems,
  type NavAccessContext,
} from "@/config/navigation";
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
  navAccess: NavAccessContext;
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
  navAccess,
}: AppSidebarProps) {
  const router = useRouter();

  const visibleNavItems = getVisibleNavItems(mainNavItems, navAccess);

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
      {/* Top zone — user avatar only */}
      <div className="flex shrink-0 flex-col items-center border-b border-sidebar-border/30 pt-4 pb-3">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  className={cn(
                    "group flex items-center justify-center rounded-full p-0.5 transition-all",
                    "hover:ring-2 hover:ring-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25",
                    "data-[popup-open]:ring-2 data-[popup-open]:ring-white/20",
                  )}
                  aria-label={`Cuenta de ${displayName}`}
                >
                  <Avatar className="h-8 w-8 ring-2 ring-sidebar-border/60 transition-all group-hover:ring-white/25">
                    <AvatarImage src={avatarUrl} alt={displayName} />
                    <AvatarFallback className="bg-gradient-to-br from-su-brand to-su-accent-cool text-[10px] font-bold text-white">
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

      {/* Nav — middle, icon-rail with hover tooltips */}
      <nav className="flex flex-1 flex-col items-center gap-0.5 overflow-y-auto px-2 py-4">
        {visibleNavItems.map((item, i) => (
            <div
              key={item.href}
              style={{ animationDelay: `${i * 40}ms` }}
              className="animate-su-slide-in flex w-full justify-center"
            >
              <NavLink item={item} mode="rail" />
            </div>
        ))}
      </nav>

      {/* Bottom dock — notifications + theme toggle only */}
      <div className="shrink-0 border-t border-sidebar-border/30 px-2 pt-2 pb-3 flex flex-col items-center gap-1">
        <NotificationBell
          initialUnreadCount={initialUnreadCount}
          variant="sidebar"
        />
        <ThemeToggle variant="sidebar" />
      </div>
    </div>
  );
}

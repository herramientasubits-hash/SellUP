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
import { createClient } from "@/lib/supabase/client";

export { MobileNavLink };

interface AppSidebarProps {
  className?: string;
  user: User;
}

/**
 * Icon-rail sidebar — 80px fixed width.
 * Pattern from plantilla-proyectos-shadcn (SidebarRail.tsx).
 * Only icons visible; labels appear in tooltip on hover (NavLink).
 * Brand and user card collapse to icons.
 */
export function AppSidebar({ className, user }: AppSidebarProps) {
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
      <div className="flex h-20 shrink-0 items-center justify-center border-b border-sidebar-border/40">
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
      <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto px-2 py-5">
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

      {/* User avatar — bottom, click to open full dropdown */}
      <div className="shrink-0 border-t border-sidebar-border/40 p-2 flex justify-center">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  className={cn(
                    "group flex items-center justify-center rounded-full p-0.5 transition-all",
                    "hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50",
                    "data-[popup-open]:bg-white/[0.06]",
                  )}
                  aria-label={`Cuenta de ${displayName}`}
                >
                  <Avatar className="h-9 w-9 border-2 border-sidebar-border/40 transition-colors group-hover:border-su-brand/40">
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

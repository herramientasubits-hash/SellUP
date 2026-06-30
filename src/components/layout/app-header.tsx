"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, LogOut, Settings, Sparkles } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NotificationBell } from "@/components/notifications/notification-bell";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { MobileNavLink } from "@/components/layout/app-sidebar";
import {
  mainNavItems,
  getVisibleNavItems,
  type NavAccessContext,
} from "@/config/navigation";
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
import { createClient } from "@/lib/supabase/client";

interface AppHeaderProps {
  user: User;
  initialUnreadCount?: number;
  navAccess: NavAccessContext;
}

export function AppHeader({ user, initialUnreadCount = 0, navAccess }: AppHeaderProps) {
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
    <header className="sticky top-0 z-40 flex h-20 w-full items-center justify-between border-b border-border/40 bg-background/75 su-glass px-4 md:px-8">
      {/* Mobile brand — visible only on small screens (sidebar is hidden on mobile) */}
      <Link
        href="/pipeline"
        className="flex items-center gap-2 select-none md:hidden"
        aria-label="SellUp"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-su-brand to-su-accent-cool text-[12px] font-extrabold text-white shadow-sm shadow-su-brand/30">
          S
        </span>
        <span className="text-[15px] font-bold tracking-tight">
          <span className="text-foreground">Sell</span>
          <span className="su-gradient-text">Up</span>
        </span>
      </Link>

      {/* Desktop context — eyebrow label that bridges brand and content */}
      <div className="hidden items-center gap-2.5 md:flex">
        <span className="flex h-6 items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70 backdrop-blur-sm">
          <Sparkles className="h-3 w-3 text-su-brand" />
          Workspace
        </span>
        <div className="hidden h-4 w-px bg-border lg:block" />
        <span className="hidden text-xs text-muted-foreground/60 lg:inline">
          Sesión activa
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        {/* Mobile menu */}
        <Sheet>
          <Tooltip>
            <TooltipTrigger
              render={
                <SheetTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="md:hidden"
                      aria-label="Abrir menú"
                    >
                      <Menu className="h-4 w-4" />
                    </Button>
                  }
                />
              }
            />
            <TooltipContent side="bottom">Abrir menú</TooltipContent>
          </Tooltip>
          <SheetContent
            side="left"
            className="flex w-72 flex-col gap-0 bg-sidebar p-0 text-sidebar-foreground"
          >
            {/* Brand */}
            <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border/40 px-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-su-brand to-su-accent-cool text-[15px] font-extrabold text-white shadow-sm shadow-su-brand/30 ring-1 ring-white/10">
                S
              </span>
              <div className="flex min-w-0 flex-col leading-none">
                <span className="text-[15px] font-bold tracking-tight">
                  <span className="text-sidebar-foreground">Sell</span>
                  <span className="su-gradient-text">Up</span>
                </span>
                <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/45">
                  Inteligencia Comercial
                </span>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 overflow-y-auto px-2.5 py-5">
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40">
                Navegación
              </p>
              <div className="flex flex-col gap-0.5">
                {visibleNavItems.map((item) => (
                  <MobileNavLink key={item.href} item={item} />
                ))}
              </div>
            </nav>

            {/* User card — bottom of mobile menu */}
            <div className="shrink-0 border-t border-sidebar-border/40 p-2.5">
              <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] p-2">
                <Avatar
                  size="lg"
                  className="shrink-0 border-2 border-sidebar-border/40"
                >
                  <AvatarImage src={avatarUrl} alt={displayName} />
                  <AvatarFallback className="bg-gradient-to-br from-su-brand to-su-accent-cool text-[11px] font-bold text-white">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="w-full truncate text-[13px] font-semibold text-sidebar-foreground">
                    {displayName}
                  </span>
                  <span className="w-full truncate text-[11px] text-sidebar-foreground/50">
                    {user.email}
                  </span>
                </div>
              </div>
              <div className="mt-1.5 flex gap-1">
                <button
                  onClick={() => router.push("/settings")}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-sidebar-foreground/55 transition-all hover:bg-sidebar-accent hover:text-sidebar-foreground/80"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Configuración
                </button>
                <button
                  onClick={handleSignOut}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-destructive/80 transition-all hover:bg-destructive/10 hover:text-destructive"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Salir
                </button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <NotificationBell initialUnreadCount={initialUnreadCount} />

        <ThemeToggle />

        {/* Mobile-only avatar — quick access to dropdown menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="ml-0.5 inline-flex cursor-pointer rounded-full p-0 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden">
            <Avatar className="h-8 w-8 border-2 border-su-brand/20">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="bg-gradient-to-br from-su-brand to-su-accent-cool text-[11px] font-bold text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-foreground leading-tight">
                    {displayName}
                  </span>
                  <span className="text-xs text-muted-foreground font-normal">
                    {user.email}
                  </span>
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
    </header>
  );
}

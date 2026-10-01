"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, LogOut, Settings } from "lucide-react";
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
    <header className="sticky top-0 z-40 flex h-14 w-full items-center justify-between border-b border-border/60 bg-background/80 su-glass px-4 sm:px-6">
      {/* Mobile brand — visible only on small screens (sidebar is hidden on mobile) */}
      <Link
        href="/pipeline"
        className="flex items-center gap-2 select-none md:hidden"
        aria-label="SellUp"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-gradient text-xs font-bold text-primary-foreground shadow-card">
          S
        </span>
        <span className="text-base font-bold tracking-tight">
          <span className="text-foreground">Sell</span>
          <span className="text-primary">Up</span>
        </span>
      </Link>

      {/* El header solo existe en móvil (en escritorio el riel lo reemplaza):
          marca a la izquierda, acciones transversales a la derecha. */}
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
            <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-base font-bold text-primary-foreground shadow-card">
                S
              </span>
              <div className="flex min-w-0 flex-col leading-none">
                <span className="text-base font-bold tracking-tight">
                  <span className="text-sidebar-foreground">Sell</span>
                  <span className="text-primary">Up</span>
                </span>
                <span className="mt-1 text-xs font-medium text-muted-foreground">
                  Inteligencia Comercial
                </span>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 overflow-y-auto px-2.5 py-5">
              <p className="mb-2 px-3 text-xs font-semibold text-muted-foreground">
                Navegación
              </p>
              <div className="flex flex-col gap-0.5">
                {visibleNavItems.map((item) => (
                  <MobileNavLink key={item.href} item={item} />
                ))}
              </div>
            </nav>

            {/* User card — bottom of mobile menu */}
            <div className="shrink-0 border-t border-sidebar-border p-2.5">
              <div className="flex items-center gap-2.5 rounded-xl bg-surface-muted p-2">
                <Avatar
                  size="lg"
                  className="shrink-0"
                >
                  <AvatarImage src={avatarUrl} alt={displayName} />
                  <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="w-full truncate text-sm font-semibold text-sidebar-foreground">
                    {displayName}
                  </span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                </div>
              </div>
              <div className="mt-1.5 flex gap-1">
                <button
                  onClick={() => router.push("/settings")}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Configuración
                </button>
                <button
                  onClick={handleSignOut}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
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
            <Avatar className="h-8 w-8">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
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

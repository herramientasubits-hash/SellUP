"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, LogOut, PanelLeft, Settings } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { BrandMark, MobileNavLink } from "@/components/layout/app-sidebar";
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

/** Cómo se nombra el rol en el chip de la cuenta. */
function roleLabel({ isAdmin, roleKey }: NavAccessContext): string {
  if (isAdmin) return "Administrador";
  if (!roleKey) return "Miembro";
  return roleKey.charAt(0).toUpperCase() + roleKey.slice(1).replace(/_/g, " ");
}

/**
 * Cabecera del shell — anatomía de Thema (`app-shell/AppHeader`).
 *
 * Esta franja es para lo transversal: dónde estás (migas), los avisos, el tema
 * y la cuenta. No repite el título de la pantalla: ese es el `PageHeader`.
 */
export function AppHeader({ user, initialUnreadCount = 0, navAccess }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();

  const visibleNavItems = getVisibleNavItems(mainNavItems, navAccess);
  const current = mainNavItems.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
  );

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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-4 sm:gap-3 sm:px-6">
      {/* Menú en móvil: ahí el lateral es un cajón */}
      <Sheet>
        <SheetTrigger
          render={
            <button
              type="button"
              aria-label="Abrir menú"
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-card text-text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:hidden"
            >
              <PanelLeft className="size-4" />
            </button>
          }
        />
        <SheetContent side="left" className="flex w-64 flex-col gap-0 bg-sidebar p-3 pt-4">
          <div className="mb-4 px-2">
            <BrandMark />
          </div>
          <nav aria-label="Navegación principal" className="flex flex-1 flex-col gap-1 overflow-y-auto">
            <p className="px-2 pb-1 text-xs font-semibold text-text-muted">Navegación</p>
            {visibleNavItems.map((item) => (
              <MobileNavLink key={item.href} item={item} />
            ))}
          </nav>
        </SheetContent>
      </Sheet>

      {/* Migas: ubican, y ubicar es transversal */}
      <nav aria-label="Ruta" className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm">
        <Link
          href="/pipeline"
          className="shrink-0 rounded-sm text-text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          SellUp
        </Link>
        {current && (
          <>
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-text-muted" />
            <span aria-current="page" className="truncate font-semibold text-foreground">
              {current.title}
            </span>
          </>
        )}
      </nav>

      {/* Acciones transversales */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <NotificationBell initialUnreadCount={initialUnreadCount} />
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Cuenta de ${displayName}`}
            className="group flex items-center gap-2 rounded-full border border-border/70 bg-card py-1 pl-1 pr-1 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 data-[popup-open]:bg-surface-muted sm:pr-2.5"
          >
            <Avatar className="size-7">
              <AvatarImage src={avatarUrl} alt="" />
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
              <span className="max-w-40 truncate text-xs font-semibold leading-tight text-foreground">
                {displayName}
              </span>
              <span className="inline-flex h-4 w-fit items-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold leading-none text-primary">
                {roleLabel(navAccess)}
              </span>
            </span>
            <ChevronDown aria-hidden className="hidden size-3.5 shrink-0 text-text-muted sm:block" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={10} className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0">
                <div className="flex items-center gap-2.5 rounded-lg bg-surface-muted px-2.5 py-2.5">
                  <Avatar size="lg" className="shrink-0">
                    <AvatarImage src={avatarUrl} alt="" />
                    <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold leading-tight text-foreground">
                      {displayName}
                    </span>
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {navAccess.isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer" onClick={() => router.push("/settings")}>
                  <Settings className="h-4 w-4" />
                  Configuración
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" variant="destructive" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

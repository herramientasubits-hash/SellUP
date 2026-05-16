"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, LogOut, Settings, Sparkles } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MobileNavLink } from "@/components/layout/app-sidebar";
import { mainNavItems } from "@/config/navigation";
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
}

export function AppHeader({ user }: AppHeaderProps) {
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
    <header className="sticky top-0 z-50 flex h-14 w-full items-center justify-between border-b border-border/40 bg-background/80 su-glass px-4 md:px-6">
      {/* Logo + tagline */}
      <div className="flex items-center gap-3">
        <Link
          href="/pipeline"
          className="group flex items-center gap-2 select-none"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-su-brand text-white shadow-sm shadow-su-brand/25 transition-transform duration-200 group-hover:scale-105">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="text-lg font-bold tracking-tight font-heading">
            <span className="text-foreground">Sell</span>
            <span className="su-gradient-text">Up</span>
          </span>
        </Link>

        <div className="hidden h-4 w-px bg-border md:block" />

        <span className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60 md:block">
          Inteligencia Comercial
        </span>
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-1.5">
        {/* Mobile menu */}
        <Sheet>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden">
                <Menu className="h-4 w-4" />
                <span className="sr-only">Abrir menú</span>
              </Button>
            }
          />
          <SheetContent side="left" className="w-64 bg-sidebar p-0">
            <div className="flex h-14 items-center border-b border-sidebar-border/40 px-5">
              <span className="text-lg font-bold tracking-tight font-heading">
                <span className="text-foreground">Sell</span>
                <span className="su-gradient-text">Up</span>
              </span>
            </div>
            <nav className="flex flex-col gap-0.5 p-3 pt-4">
              {mainNavItems.map((item) => (
                <MobileNavLink key={item.href} item={item} />
              ))}
            </nav>
          </SheetContent>
        </Sheet>

        <ThemeToggle />

        {/* Avatar + dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="ml-0.5 inline-flex cursor-pointer rounded-full p-0 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar className="h-8 w-8 border-2 border-su-brand/20 transition-all duration-200 hover:border-su-brand/40">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="bg-su-brand text-[11px] font-bold text-white">
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

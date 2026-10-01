"use client";

import * as React from "react";
import { ChevronDown, LogOut } from "@/icons";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface AccountMenuUser {
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface AccountMenuProps {
  /** La persona conectada. */
  user: AccountMenuUser;
  /** Cómo se nombra su rol: la píldora bajo el nombre. */
  roleLabel?: string;
  /** Cierre de sesión. Sin él, el menú no ofrece salir. */
  onLogout?: () => void;
}

/** Hasta dos iniciales del nombre, para cuando no hay foto. */
export function userInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function UserAvatar({ user, size }: { user: AccountMenuUser; size: "sm" | "default" }) {
  return (
    <Avatar size={size} className="shrink-0 border border-border/70">
      <AvatarImage src={user.avatarUrl ?? undefined} alt="" />
      <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
        {userInitials(user.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * AccountMenu — port de Thema `app-shell/AccountMenu.tsx`.
 *
 * Quién eres y como quién miras: una sola puerta en la esquina de la cabecera.
 * El chip enseña la cara, el nombre y el rol; el menú que abre es identidad y
 * salida, nada más. Thema también cambia aquí de empresa y de rol: en SellUp
 * no hay ni varias empresas ni rol que asumir, así que esas filas no existen.
 *
 * Lo que NO vive aquí: el tema y la configuración. Son de la plataforma, no de
 * la cuenta, y cuelgan del menú de la marca (`WorkspaceMenu`).
 */
export function AccountMenu({ user, roleLabel, onLogout }: AccountMenuProps) {
  const [open, setOpen] = React.useState(false);
  const srLabel = [
    `Cuenta de ${user.name}`,
    user.email ?? null,
    roleLabel ? `Rol: ${roleLabel}` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={srLabel}
        className={cn(
          // El borde es lo que dice «esto se pulsa».
          "flex h-10 max-w-56 shrink-0 items-center gap-2 rounded-full border border-border/70 bg-card py-1 pl-1 pr-2.5 text-left transition-colors",
          "hover:border-border hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          "max-md:max-w-[40vw] max-md:pr-2",
          open && "border-border bg-surface-muted",
        )}
      >
        <UserAvatar user={user} size="sm" />
        <span className="hidden min-w-0 flex-1 flex-col gap-0.5 sm:flex">
          <span className="truncate text-xs font-semibold leading-tight text-foreground">
            {user.name}
          </span>
          {roleLabel && (
            <span className="flex min-w-0">
              <span className="inline-flex h-4 min-w-0 items-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold leading-none text-primary">
                <span className="truncate">{roleLabel}</span>
              </span>
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-text-muted transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={10} className="w-72">
        {/* La persona, en su propia tarjeta: no es una opción del menú, es de
            quién es este menú. */}
        <div className="mb-1 flex items-center gap-2.5 rounded-lg bg-surface-muted px-2.5 py-2.5">
          <UserAvatar user={user} size="default" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-tight text-foreground">
              {user.name}
            </span>
            {user.email && (
              <span className="block truncate text-xs leading-tight text-text-muted">
                {user.email}
              </span>
            )}
          </span>
        </div>

        {onLogout && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" className="font-semibold" onClick={onLogout}>
              <LogOut className="size-4 shrink-0" />
              Cerrar sesión
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

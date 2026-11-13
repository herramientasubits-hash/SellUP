"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, RotateCcw, UserCog } from "@/icons";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RolePreviewDialog } from "@/components/layout/role-preview-dialog";
import { stopRolePreview } from "@/modules/access/role-preview-actions";
import type { RolePreviewState } from "@/modules/access/role-preview";

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
  /** «Ver como…» otro rol: sólo para la persona autorizada. */
  rolePreview?: RolePreviewState;
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

function UserAvatar({
  user,
  size,
}: {
  user: AccountMenuUser;
  size: "sm" | "default";
}) {
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
export function AccountMenu({
  user,
  roleLabel,
  onLogout,
  rolePreview,
}: AccountMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const router = useRouter();
  const previewActive = rolePreview?.active ?? null;
  const pillLabel =
    previewActive && roleLabel
      ? `${roleLabel} · como ${previewActive.asName}`
      : roleLabel;
  const srLabel = [
    `Cuenta de ${user.name}`,
    user.email ?? null,
    roleLabel ? `Rol: ${roleLabel}` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        {/* Como el perfil del playground de UX: solo el avatar redondo; el nombre
          y el rol se leen en la tarjeta del menú (y en la etiqueta accesible). */}
        <DropdownMenuTrigger
          aria-label={srLabel}
          className={cn(
            "flex size-8.5 shrink-0 items-center justify-center rounded-full transition-shadow",
            "hover:ring-2 hover:ring-border focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            open && "ring-2 ring-primary hover:ring-primary",
          )}
        >
          <UserAvatar user={user} size="default" />
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
              {pillLabel && (
                <span className="mt-1.5 flex min-w-0">
                  <span className="inline-flex h-4 min-w-0 items-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold leading-none text-primary">
                    <span className="truncate">{pillLabel}</span>
                  </span>
                </span>
              )}
            </span>
          </div>

          {rolePreview?.allowed && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPreviewOpen(true)}>
                <UserCog className="size-4 shrink-0" />
                Ver como otro rol…
              </DropdownMenuItem>
              {previewActive && (
                <DropdownMenuItem
                  onClick={async () => {
                    await stopRolePreview();
                    router.refresh();
                  }}
                >
                  <RotateCcw className="size-4 shrink-0" />
                  Volver a Administrador
                </DropdownMenuItem>
              )}
            </>
          )}

          {onLogout && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="font-semibold"
                onClick={onLogout}
              >
                <LogOut className="size-4 shrink-0" />
                Cerrar sesión
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {rolePreview?.allowed && (
        <RolePreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} />
      )}
    </>
  );
}

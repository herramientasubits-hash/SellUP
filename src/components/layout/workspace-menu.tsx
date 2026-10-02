"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "@/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WorkspaceSettingsGroup } from "@/components/layout/sidebar-nav";
import { CloseWorkspaceMenuContext } from "@/components/layout/workspace-menu-context";

export interface WorkspaceMenuProps {
  /** El elemento que lo abre: la fila de marca del panel, o su icono en el riel. */
  trigger: React.ReactElement;
  /** Nombre del producto, para encabezar el menú. */
  productName: string;
  tagline?: string;
  /** Los ajustes, agrupados: un grupo es una fila que abre su submenú. */
  groups: readonly WorkspaceSettingsGroup[];
  /** La puerta a toda la configuración, al pie. */
  all?: { label: string; href: string };
  /** Lo que añade la app entre la identidad y los ajustes: «Personalización». */
  extra?: React.ReactNode;
  side?: "bottom" | "right";
  align?: "start" | "end";
  /** Tras elegir un destino (p. ej. cerrar el cajón del móvil). */
  onNavigate?: () => void;
}

/**
 * WorkspaceMenu — port de Thema `app-shell/WorkspaceMenu.tsx`.
 *
 * El menú que cuelga de la marca del producto, y la ÚNICA puerta a la
 * configuración (ya no es un módulo del menú lateral). De arriba abajo:
 *
 * 1. la identidad del producto;
 * 2. `extra`: cómo se ve y se usa la plataforma (`PersonalizationMenu`);
 * 3. los ajustes agrupados —un grupo, una fila que abre su submenú—;
 * 4. «Toda la configuración», al pie.
 *
 * El shell no sabe qué hay dentro de `extra`; solo le da un sitio y la manera
 * de cerrar el menú (`useCloseWorkspaceMenu`).
 */
export function WorkspaceMenu({
  trigger,
  productName,
  tagline,
  groups,
  all,
  extra,
  side = "bottom",
  align = "start",
  onNavigate,
}: WorkspaceMenuProps) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        side={side}
        align={align}
        sideOffset={8}
        className="max-h-[75vh] w-72 overflow-y-auto"
      >
        <div className="px-1.5 pb-2 pt-1">
          <span className="block truncate text-sm font-semibold text-foreground">{productName}</span>
          {tagline && <span className="block truncate text-xs text-text-muted">{tagline}</span>}
        </div>

        {extra && (
          <>
            <DropdownMenuSeparator />
            <div data-slot="workspace-menu-extra" className="flex flex-col gap-0.5">
              <CloseWorkspaceMenuContext.Provider value={close}>{extra}</CloseWorkspaceMenuContext.Provider>
            </div>
          </>
        )}

        {groups.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {/* Un grupo, una fila: desplegar las ocho secciones de golpe daba
                una lista que había que recorrer con la vista. */}
            <DropdownMenuGroup aria-label="Configuración">
              {groups.map((group) => (
                <DropdownMenuSub key={group.id}>
                  <DropdownMenuSubTrigger>
                    <group.icon className="size-4 shrink-0 text-text-muted" />
                    {group.label}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-60">
                    {group.items.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        render={<Link href={item.href} />}
                        onClick={onNavigate}
                      >
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
            </DropdownMenuGroup>
          </>
        )}

        {all && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href={all.href} />} onClick={onNavigate}>
              <ArrowRight className="size-4 shrink-0 text-text-muted" />
              {all.label}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

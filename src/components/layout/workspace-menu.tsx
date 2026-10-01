"use client";

import * as React from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { ArrowRight, Monitor, Moon, Sun, type LucideIcon } from "@/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WorkspaceSettingsGroup } from "@/components/layout/sidebar-nav";

const THEME_OPTIONS: readonly { value: string; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Como el sistema", icon: Monitor },
];

/**
 * El tema de la plataforma, dentro del menú de la marca. No es de la cuenta ni
 * de la pantalla: se elige una vez, así que no ocupa un botón de la cabecera.
 */
export function ThemeMenuItems() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Apariencia</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        aria-label="Tema"
        value={theme ?? "system"}
        onValueChange={(value) => setTheme(String(value))}
      >
        {THEME_OPTIONS.map((option) => (
          <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick={false}>
            <option.icon className="size-4 shrink-0 text-text-muted" />
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

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
  /** Controles de la plataforma —el tema— entre la identidad y los ajustes. */
  extra?: React.ReactNode;
  side?: "bottom" | "right";
  align?: "start" | "end";
  /** Tras elegir un destino (p. ej. cerrar el cajón del móvil). */
  onNavigate?: () => void;
}

/**
 * WorkspaceMenu — port de Thema `app-shell/WorkspaceMenu.tsx`.
 *
 * El menú que cuelga de la marca del producto. Antes el tema era un botón
 * suelto en la cabecera y la configuración un ítem del menú de la cuenta;
 * aquí es una sola puerta: la identidad, cómo se ve la plataforma (`extra`) y
 * los ajustes agrupados. Cada grupo guarda sus secciones en un submenú hasta
 * que se sabe por dónde se va.
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
  return (
    <DropdownMenu>
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
            {extra}
          </>
        )}

        {groups.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Configuración</DropdownMenuLabel>
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

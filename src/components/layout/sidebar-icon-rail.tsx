"use client";

import * as React from "react";
import Link from "next/link";
import { PanelLeftOpen } from "@/icons";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActiveSidebarNode, SidebarNavRoot } from "@/components/layout/sidebar-nav";

/** El respiro al salir del icono: sin él, el menú se cierra al cruzar el hueco. */
const HOVER_CLOSE_DELAY_MS = 160;

const railButtonClass = (active?: boolean) =>
  cn(
    "relative flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    active
      ? "bg-sidebar-accent text-primary"
      : "text-text-muted hover:bg-background hover:text-foreground data-[popup-open]:bg-background data-[popup-open]:text-foreground",
  );

/** Clases del ítem del desplegable que corresponde a donde estás. */
const MENU_ITEM_CURRENT = "bg-surface-muted font-semibold text-primary";

/** Sección sin vistas: su icono navega, con el nombre como tooltip. */
function RailLink({ item, active }: { item: SidebarNavRoot; active: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={item.href}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            className={railButtonClass(active)}
          >
            <item.icon className="size-4.5 shrink-0" />
          </Link>
        }
      />
      <TooltipContent side="right" sideOffset={12}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Una sección con vistas no cabe en 64px, así que su icono abre el árbol a la
 * derecha al pasar el puntero (y con clic o teclado, que sigue siendo un
 * menú). Sin esto, contraído, esas secciones eran un callejón sin salida.
 */
function RailSectionMenu({
  item,
  active,
  activeChildId,
}: {
  item: SidebarNavRoot;
  active: boolean;
  activeChildId: string | null;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        openOnHover
        delay={0}
        closeDelay={HOVER_CLOSE_DELAY_MS}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={railButtonClass(active)}
      >
        <item.icon className="size-4.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" sideOffset={10} className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
          {/* El menú también dice dónde estás: contraído, esta lista es la
              única navegación que se ve. */}
          {(item.children ?? []).map((child) => {
            const isCurrent = child.id === activeChildId;
            return (
              <DropdownMenuItem
                key={child.id}
                render={<Link href={child.href} />}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(isCurrent && MENU_ITEM_CURRENT)}
              >
                {child.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RailDivider() {
  return <span aria-hidden className="my-1 w-8 shrink-0 border-t border-border/60" />;
}

export interface SidebarIconRailProps {
  navigation: readonly SidebarNavRoot[];
  active: ActiveSidebarNode;
  onExpand: () => void;
  /** La marca: el disparador del menú de la marca, ya montado por el sidebar. */
  brand: React.ReactNode;
  className?: string;
}

/**
 * SidebarIconRail — port de Thema `app-shell/SidebarIconRail.tsx`.
 *
 * El menú contraído: 64px de iconos. Una sección sin vistas navega con su
 * icono (tooltip con el nombre); una con vistas las despliega a la derecha al
 * pasar el puntero, marcando en cuál estás.
 */
export function SidebarIconRail({ navigation, active, onExpand, brand, className }: SidebarIconRailProps) {
  return (
    <nav
      aria-label="Navegación compacta"
      className={cn("flex h-full w-full flex-col items-center gap-1 overflow-y-auto px-2 py-4", className)}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onExpand}
              aria-label="Desplegar menú"
              aria-expanded={false}
              className="mb-2 flex size-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          }
        />
        <TooltipContent side="right">Desplegar menú</TooltipContent>
      </Tooltip>

      {brand}

      <RailDivider />

      {navigation.map((item) =>
        item.children?.length ? (
          <RailSectionMenu
            key={item.id}
            item={item}
            active={active.rootId === item.id}
            activeChildId={active.rootId === item.id ? active.childId : null}
          />
        ) : (
          <RailLink key={item.id} item={item} active={active.rootId === item.id} />
        ),
      )}
    </nav>
  );
}

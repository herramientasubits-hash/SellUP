"use client";

import * as React from "react";
import Link from "next/link";
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

/** Como en el playground: abre casi al pasar y da respiro para cruzar el hueco. */
const HOVER_OPEN_DELAY_MS = 60;
const HOVER_CLOSE_DELAY_MS = 220;

const railButtonClass = (active?: boolean) =>
  cn(
    "relative flex size-10 shrink-0 items-center justify-center rounded-md transition-colors",
    "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
    active
      ? "bg-primary/10 text-primary hover:bg-primary/15"
      : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-foreground",
  );

/** Clases del ítem del desplegable que corresponde a donde estás. */
const MENU_ITEM_CURRENT = "bg-primary/10 font-medium text-primary data-highlighted:bg-primary/15";

/** La marca azul del activo, pegada al borde del riel como en el menú completo. */
function RailMark({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span aria-hidden className="absolute top-1/2 left-0 h-5 w-0.75 -translate-y-1/2 rounded-r-full bg-primary" />
  );
}

/** Sección sin vistas: su icono navega, con el nombre como tooltip. */
function RailLink({ item, active }: { item: SidebarNavRoot; active: boolean }) {
  return (
    <div className="relative flex w-full justify-center">
      <RailMark active={active} />
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={railButtonClass(active)}
            >
              <item.icon className="size-5 shrink-0" />
            </Link>
          }
        />
        <TooltipContent side="right" sideOffset={10}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * Una sección con vistas no cabe en 72px, así que su icono abre el árbol a la
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
    <div className="relative flex w-full justify-center">
      <RailMark active={active} />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          openOnHover
          delay={HOVER_OPEN_DELAY_MS}
          closeDelay={HOVER_CLOSE_DELAY_MS}
          aria-label={item.label}
          aria-current={active ? "page" : undefined}
          className={railButtonClass(active)}
        >
          <item.icon className="size-5 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" sideOffset={10} className="w-60">
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
    </div>
  );
}

function RailDivider() {
  return <span aria-hidden className="w-8 shrink-0 border-t border-sidebar-border" />;
}

export interface SidebarIconRailProps {
  navigation: readonly SidebarNavRoot[];
  active: ActiveSidebarNode;
  /** La marca: el disparador del menú de la marca, ya montado por el sidebar. */
  brand: React.ReactNode;
  className?: string;
}

/**
 * SidebarIconRail — el riel del playground de UX (`SidebarRail.tsx`).
 *
 * El menú contraído: 72px de iconos de 20px. Una sección sin vistas navega
 * con su icono (tooltip con el nombre); una con vistas las despliega a la
 * derecha al pasar el puntero, marcando en cuál estás. El botón de desplegar
 * vive en la cabecera.
 */
export function SidebarIconRail({ navigation, active, brand, className }: SidebarIconRailProps) {
  return (
    <nav
      aria-label="Navegación compacta"
      className={cn(
        "flex h-full w-full flex-col items-center gap-2.5 overflow-y-auto border-r border-sidebar-border bg-sidebar py-3.5",
        className,
      )}
    >
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

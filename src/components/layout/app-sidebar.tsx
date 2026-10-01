"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronsUpDown, PanelLeftClose } from "@/icons";
import { cn } from "@/lib/utils";
import type { NavAccessContext } from "@/config/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebar } from "@/components/layout/sidebar-context";
import { SidebarIconRail } from "@/components/layout/sidebar-icon-rail";
import { PersonalizationMenu } from "@/components/layout/personalization-menu";
import { WorkspaceMenu } from "@/components/layout/workspace-menu";
import {
  buildSidebarNav,
  buildWorkspaceSettingsGroups,
  resolveActiveSidebarNode,
  type SidebarNavChild,
  type SidebarNavRoot,
} from "@/components/layout/sidebar-nav";

const PRODUCT_NAME = "SellUp";
const PRODUCT_TAGLINE = "Inteligencia comercial";
const SETTINGS_ALL = { label: "Toda la configuración", href: "/settings" } as const;
const BRAND_MENU_LABEL = `${PRODUCT_NAME}: personalización y configuración`;

interface AppSidebarProps {
  className?: string;
  navAccess: NavAccessContext;
  /**
   * Siempre desplegado y sin botón de contraer: el menú dentro del cajón del
   * móvil, donde contraerlo no tiene sentido.
   */
  forceExpanded?: boolean;
  /** Tras elegir un destino (el cajón del móvil se cierra). */
  onNavigate?: () => void;
}

/** La marca del producto: el chip con el degradado del tema y, desplegado, el nombre. */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-sm font-bold text-primary-foreground shadow-card"
      >
        S
      </span>
      {!compact && (
        <span className="flex min-w-0 flex-col text-left leading-tight">
          <span className="truncate text-sm font-bold tracking-tight text-foreground">
            Sell<span className="text-primary">Up</span>
          </span>
          <span className="truncate text-xs text-text-muted">{PRODUCT_TAGLINE}</span>
        </span>
      )}
    </span>
  );
}

const ROW_CLASSES =
  "relative flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

/** Sección sin vistas: una fila que navega. */
function RootLeaf({
  item,
  isCurrent,
  onNavigate,
}: {
  item: SidebarNavRoot;
  isCurrent: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={isCurrent ? "page" : undefined}
      className={cn(
        ROW_CLASSES,
        isCurrent &&
          "bg-sidebar-accent font-semibold text-primary hover:bg-sidebar-accent hover:text-primary",
      )}
    >
      <item.icon className={cn("size-4 shrink-0", isCurrent ? "text-primary" : "text-text-muted")} />
      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
    </Link>
  );
}

function ChildRow({
  child,
  isCurrent,
  onNavigate,
}: {
  child: SidebarNavChild;
  isCurrent: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={child.href}
      onClick={onNavigate}
      aria-current={isCurrent ? "page" : undefined}
      className={cn(
        "relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        isCurrent && "font-semibold text-primary hover:text-primary",
      )}
    >
      {isCurrent && (
        <span aria-hidden className="absolute -left-2.5 bottom-0.5 top-0.5 w-0.5 rounded-full bg-primary" />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{child.label}</span>
    </Link>
  );
}

/** Sección con vistas: la cabecera pliega y despliega; las vistas navegan. */
function Accordion({
  item,
  isOpen,
  activeChildId,
  onToggle,
  onNavigate,
}: {
  item: SidebarNavRoot;
  isOpen: boolean;
  activeChildId: string | null;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const panelId = React.useId();
  return (
    <div data-slot="sidebar-section">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className={cn(
          ROW_CLASSES,
          // Abierta, la sección es el rótulo de su grupo: pesa por tipografía,
          // no por color de marca (que es de la vista activa).
          isOpen && "font-semibold text-foreground",
          // Plegada, su icono es lo único que dice «estás aquí dentro».
          !isOpen && activeChildId && "text-primary",
        )}
      >
        <item.icon
          className={cn(
            "size-4 shrink-0",
            !isOpen && activeChildId ? "text-primary" : "text-text-muted",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-text-muted transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>
      {isOpen && (
        <div
          id={panelId}
          role="group"
          aria-label={item.label}
          className="mb-2 ml-4 mt-1 flex flex-col gap-1 border-l border-border pl-2"
        >
          {(item.children ?? []).map((child) => (
            <ChildRow
              key={child.id}
              child={child}
              isCurrent={child.id === activeChildId}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Menú lateral — port de Thema (`app-shell/AppSidebar` + `SidebarIconRail`).
 *
 * Desplegado (240px): la marca abre el menú de la plataforma —Personalización
 * y TODA la configuración, agrupada— y debajo va la navegación de módulos, con
 * secciones plegables: Empresas y Contactos despliegan las vistas que hoy
 * también están en las pestañas de cada pantalla. La sección en la que estás
 * llega abierta. Configuración no es un módulo de esta lista: se entra por la
 * marca.
 *
 * Contraído (64px): el mismo menú como riel de iconos; cada sección con vistas
 * las muestra al pasar el puntero.
 *
 * Solo lista lo que puede ver quien mira (`navAccess`).
 */
export function AppSidebar({ className, navAccess, forceExpanded = false, onNavigate }: AppSidebarProps) {
  const { collapsed: storedCollapsed, toggle } = useSidebar();
  const collapsed = forceExpanded ? false : storedCollapsed;
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();

  const { isAdmin, roleKey } = navAccess;
  const navigation = React.useMemo(() => buildSidebarNav({ isAdmin, roleKey }), [isAdmin, roleKey]);
  const settingsGroups = React.useMemo(
    () => buildWorkspaceSettingsGroups({ isAdmin, roleKey }),
    [isAdmin, roleKey],
  );
  const active = resolveActiveSidebarNode(
    navigation,
    pathname,
    new URLSearchParams(searchParams?.toString() ?? ""),
  );

  // La sección en la que estás llega abierta; al cambiar de sección se abre la
  // nueva sin cerrar lo que la persona abrió a mano.
  const [openSections, setOpenSections] = React.useState<Readonly<Record<string, boolean>>>(() =>
    active.rootId ? { [active.rootId]: true } : {},
  );
  const [adoptedRootId, setAdoptedRootId] = React.useState(active.rootId);
  if (adoptedRootId !== active.rootId) {
    setAdoptedRootId(active.rootId);
    if (active.rootId) setOpenSections({ ...openSections, [active.rootId]: true });
  }

  const toggleSection = (id: string) =>
    setOpenSections((sections) => ({ ...sections, [id]: !sections[id] }));

  const workspaceMenu = (trigger: React.ReactElement, side: "bottom" | "right") => (
    <WorkspaceMenu
      trigger={trigger}
      side={side}
      productName={PRODUCT_NAME}
      tagline={PRODUCT_TAGLINE}
      groups={settingsGroups}
      all={isAdmin ? SETTINGS_ALL : undefined}
      extra={<PersonalizationMenu />}
      onNavigate={onNavigate}
    />
  );

  if (collapsed) {
    return (
      <SidebarIconRail
        className={className}
        navigation={navigation}
        active={active}
        onExpand={toggle}
        brand={workspaceMenu(
          <button
            type="button"
            aria-label={BRAND_MENU_LABEL}
            className="mb-2 flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <BrandMark compact />
          </button>,
          "right",
        )}
      />
    );
  }

  return (
    <div className={cn("flex h-full flex-col p-3 pt-4", className)}>
      {/* Contraer: deja el riel de iconos a la vista. */}
      {!forceExpanded && (
        <div className="mb-2 flex shrink-0 justify-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="Contraer menú"
                  aria-expanded
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <PanelLeftClose className="size-4" />
                </button>
              }
            />
            <TooltipContent side="right">Contraer menú</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* La marca: de ella cuelga lo que se ajusta una vez (personalización, configuración). */}
      {workspaceMenu(
        <button
          type="button"
          aria-label={BRAND_MENU_LABEL}
          className="mb-4 flex w-full shrink-0 items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className="min-w-0 flex-1">
            <BrandMark />
          </span>
          <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-text-muted" />
        </button>,
        "bottom",
      )}

      <nav aria-label="Navegación principal" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {navigation.map((item) =>
          item.children ? (
            <Accordion
              key={item.id}
              item={item}
              isOpen={Boolean(openSections[item.id])}
              activeChildId={active.rootId === item.id ? active.childId : null}
              onToggle={() => toggleSection(item.id)}
              onNavigate={onNavigate}
            />
          ) : (
            <RootLeaf
              key={item.id}
              item={item}
              isCurrent={active.rootId === item.id}
              onNavigate={onNavigate}
            />
          ),
        )}
      </nav>
    </div>
  );
}

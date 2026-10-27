"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronsUpDown } from "@/icons";
import { cn } from "@/lib/utils";
import type { NavAccessContext } from "@/config/navigation";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
   * Siempre desplegado y sin riel: el menú dentro del cajón del móvil, donde
   * contraerlo no tiene sentido.
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

/** El logo en baldosa de 28px, como el de la tarjeta de empresa del playground. */
export function BrandTile({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-gradient text-xs font-bold text-primary-foreground",
        className,
      )}
    >
      S
    </span>
  );
}

// Anatomía del menú del playground de UX (`AppSidebar.tsx` y `sidebar-styles.ts`).
// Fila de 36px en gris medio; activa, azul al 10% con texto azul.
const ROW =
  "relative flex h-9 w-full min-w-0 items-center gap-3 rounded-lg px-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
const ROW_ACTIVE = "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary";
/** Marca de la fila activa, pegada al borde de la barra (la fila está a 14px). */
const ROW_MARK =
  "before:absolute before:top-2 before:-left-3.5 before:h-5 before:w-0.75 before:rounded-r-full before:bg-primary";

const SUB_ROW =
  "relative flex h-8 w-full min-w-0 items-center rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
const SUB_ROW_ACTIVE = "bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary";
/** Marca del hijo activo, centrada sobre la línea guía del submenú. */
const GUIDE_MARK =
  "before:absolute before:top-1/2 before:-left-[13.5px] before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary";

/**
 * Icono en baldosa: borde fino en reposo, se aviva al pasar el cursor y,
 * activo, se tiñe del primario con un halo suave y el trazo en duotono.
 */
function NavIcon({ icon: Icon, active }: { icon: SidebarNavRoot["icon"]; active: boolean }) {
  return (
    <span
      className={cn(
        "flex size-6.5 shrink-0 items-center justify-center rounded-md border transition-all duration-200",
        active
          ? "border-primary/30 bg-primary/10 text-primary ring-3 ring-primary/8"
          : "border-sidebar-border bg-background/70 text-muted-foreground group-hover/row:border-foreground/20 group-hover/row:text-sidebar-foreground dark:bg-sidebar-accent/40",
      )}
    >
      <Icon className={cn("size-3.75 shrink-0", active && "[&_path]:fill-primary/20")} />
    </span>
  );
}

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
      className={cn("group/row", ROW, isCurrent && cn(ROW_ACTIVE, ROW_MARK))}
    >
      <NavIcon icon={item.icon} active={isCurrent} />
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
      className={cn(SUB_ROW, isCurrent && cn(SUB_ROW_ACTIVE, GUIDE_MARK))}
    >
      <span className="min-w-0 flex-1 truncate text-left">{child.label}</span>
    </Link>
  );
}

/**
 * Sección con vistas: la cabecera pliega y despliega con la altura animada
 * (Collapsible), y el submenú cuelga de una guía alineada al centro del icono.
 * Con una vista activa, la cabecera solo tiñe su icono: el fondo y la marca
 * los lleva la vista.
 */
function Section({
  item,
  isOpen,
  activeChildId,
  onOpenChange,
  onNavigate,
}: {
  item: SidebarNavRoot;
  isOpen: boolean;
  activeChildId: string | null;
  onOpenChange: (open: boolean) => void;
  onNavigate?: () => void;
}) {
  const hasActiveChild = Boolean(activeChildId);
  return (
    <Collapsible data-slot="sidebar-section" open={isOpen} onOpenChange={onOpenChange} className="min-w-0">
      <CollapsibleTrigger
        className={cn("group/row", ROW, hasActiveChild && "text-sidebar-foreground/75")}
      >
        <NavIcon icon={item.icon} active={hasActiveChild} />
        <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "ml-auto size-3.5 shrink-0 text-text-muted transition-transform duration-200 ease-out group-hover/row:text-sidebar-foreground",
            isOpen && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent role="group" aria-label={item.label} className="min-w-0">
        <div className="ml-[17.5px] flex min-w-0 flex-col gap-0.5 border-l border-sidebar-border py-1 pl-3">
          {(item.children ?? []).map((child) => (
            <ChildRow
              key={child.id}
              child={child}
              isCurrent={child.id === activeChildId}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Menú lateral — anatomía del playground de UX (flux-ui).
 *
 * Desplegado (288px): la tarjeta de la marca abre el menú de la plataforma
 * —Personalización y TODA la configuración, agrupada— y debajo va la
 * navegación de módulos, con secciones plegables: Empresas y Contactos
 * despliegan sus vistas. La sección en la que estás llega abierta.
 * Configuración no es un módulo de esta lista: se entra por la marca.
 *
 * Contraído: el panel queda escondido detrás del riel de 72px (el shell anima
 * el paso de uno a otro) y el riel muestra lo mismo en iconos. El botón de
 * plegar vive en la cabecera, junto a la ruta.
 *
 * Solo lista lo que puede ver quien mira (`navAccess`).
 */
export function AppSidebar({ className, navAccess, forceExpanded = false, onNavigate }: AppSidebarProps) {
  const { collapsed: storedCollapsed } = useSidebar();
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

  const setSectionOpen = (id: string, open: boolean) =>
    setOpenSections((sections) => ({ ...sections, [id]: open }));

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

  const panel = (
    // Plegado, el panel sigue montado (se desliza detrás del riel) pero `inert`
    // lo saca del teclado y del lector de pantalla: si no, se oían dos menús.
    <div inert={collapsed} className={cn("flex h-full min-h-0 flex-col", className)}>
      {/* La marca: de ella cuelga lo que se ajusta una vez (personalización, configuración). */}
      <div className="shrink-0 p-3.5">
        {workspaceMenu(
          <button
            type="button"
            aria-label={BRAND_MENU_LABEL}
            className="group/brand flex h-10 w-full items-center gap-2.5 rounded-md border border-border bg-background pr-2.5 pl-1.75 text-left shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:bg-muted"
          >
            <BrandTile />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {PRODUCT_NAME}
            </span>
            <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-text-muted" />
          </button>,
          "bottom",
        )}
      </div>

      <nav
        aria-label="Navegación principal"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-3.5 pb-3.5"
      >
        {navigation.map((item) =>
          item.children ? (
            <Section
              key={item.id}
              item={item}
              isOpen={Boolean(openSections[item.id])}
              activeChildId={active.rootId === item.id ? active.childId : null}
              onOpenChange={(open) => setSectionOpen(item.id, open)}
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

  if (forceExpanded) return panel;

  return (
    <>
      {panel}
      {/* Plegado queda el riel de iconos, fijo sobre el borde: el panel se
          esconde debajo de él al cerrar y sale desde ahí al abrir. */}
      {collapsed && (
        <div className="fixed inset-y-0 left-0 z-20 w-18">
          <SidebarIconRail
            navigation={navigation}
            active={active}
            brand={workspaceMenu(
              <button
                type="button"
                aria-label={BRAND_MENU_LABEL}
                className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:bg-muted"
              >
                <BrandTile className="size-6" />
              </button>,
              "right",
            )}
          />
        </div>
      )}
    </>
  );
}

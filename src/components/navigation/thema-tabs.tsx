"use client";

import * as React from "react";
import type { LucideIcon } from "@/icons";

import { cn } from "@/lib/utils";
import {
  Tabs,
  TabsBadge,
  TabsList,
  TabsTrigger,
  resolveTabsVariant,
  tabsIndicatorClassName,
  tabsListVariants,
  tabsTriggerClassName,
  type TabsBadgeTone,
} from "@/components/ui/tabs";

export interface TabItem {
  id: string;
  label: string;
  /** Icono a la izquierda del nombre. */
  icon?: LucideIcon;
  /**
   * Un número que cuelga de la pestaña: cuántos registros esperan dentro. Con
   * 0 se omite: un cero en un contador es ruido, no información.
   */
  badge?: number;
  /**
   * De qué color va el contador en una tira `view`. Por defecto, sólido en el
   * primario (una cantidad, no un estado); una tira cuyas pestañas SON estados
   * lee mejor si cada número lleva el tono del suyo.
   */
  badgeTone?: TabsBadgeTone;
}

export interface ThemaTabsProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "children"> {
  tabs: readonly TabItem[];
  activeTabId: string;
  onTabChange: (id: string) => void;
  /**
   * A cuál de los dos niveles pertenece la tira. `page` cambia lo que muestra
   * la pantalla entera (las vistas de un módulo) y lleva la pestaña rellena.
   * `view` (por defecto) cambia un panel dentro de la página: pista hundida y
   * superficie elevada en la activa.
   */
  variant?: "view" | "page";
  /**
   * Ajusta la tira a sus rótulos en vez de repartir todo el ancho. Con seis
   * pestañas, repartir el ancho se lee como una barra de navegación; con dos,
   * como dos botones enormes.
   */
  fitContent?: boolean;
  /**
   * La tira NAVEGA (cada pestaña es otra ruta) en vez de cambiar de panel. Se
   * pinta igual, pero son botones con `aria-current="page"` y no un `tablist`:
   * no hay panel que controlen.
   */
  navigation?: boolean;
  /** Cómo se anuncia el grupo de pestañas (el `tablist`). */
  listLabel?: string;
  listClassName?: string;
  /** Los paneles (`TabsContent`), cuando la tira cambia de panel. */
  children?: React.ReactNode;
}

function gridStyle(fitContent: boolean, count: number): React.CSSProperties | undefined {
  return fitContent ? undefined : { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` };
}

/**
 * El indicador de una tira que NAVEGA. Una tira de botones no tiene el
 * `Tabs.Indicator` de Base UI, así que aquí se mide la pestaña activa y se
 * escriben las mismas variables `--active-tab-*`: el indicador se ve y se
 * desliza igual que en una tira que cambia de panel.
 */
function useNavIndicator(activeId: string) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const [vars, setVars] = React.useState<React.CSSProperties | null>(null);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const medir = () => {
      const active = list.querySelector<HTMLElement>("[data-active]");
      if (!active) return setVars(null);
      setVars({
        "--active-tab-left": `${active.offsetLeft}px`,
        "--active-tab-top": `${active.offsetTop}px`,
        "--active-tab-width": `${active.offsetWidth}px`,
        "--active-tab-height": `${active.offsetHeight}px`,
      } as React.CSSProperties);
    };
    medir();
    // El ancho de una pestaña cambia con su contador o con la fuente al cargar.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(medir);
    observer.observe(list);
    for (const tab of Array.from(list.children)) observer.observe(tab);
    return () => observer.disconnect();
  }, [activeId]);

  return { listRef, vars };
}

function TabBody({ tab }: { tab: TabItem }) {
  const Icon = tab.icon;
  return (
    <>
      {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
      {tab.label}
      <TabsBadge count={tab.badge} tone={tab.badgeTone} />
    </>
  );
}

/**
 * ThemaTabs — port de Thema `navigation/ThemaTabs.tsx`.
 *
 * La ÚNICA tira de pestañas del sistema. Sus dos niveles (`view` y `page`) son
 * los dos únicos tratamientos que existen; todo lo que cambia de vista se
 * construye sobre `ui/tabs`, así que una tira declarada aquí y una declarada a
 * mano con `TabsList` salen idénticas. `TabsNav` y `UrlTabs` son envoltorios finos de esta pieza.
 *
 * @example
 * // Cambia de panel
 * <ThemaTabs tabs={tabs} activeTabId={tab} onTabChange={setTab} fitContent>
 *   <TabsContent value="resumen">…</TabsContent>
 * </ThemaTabs>
 *
 * // Navega entre las vistas de un módulo
 * <ThemaTabs navigation variant="page" fitContent tabs={tabs} activeTabId="empresas" onTabChange={go} />
 */
export const ThemaTabs = React.forwardRef<HTMLDivElement, ThemaTabsProps>(
  (
    {
      tabs,
      activeTabId,
      onTabChange,
      variant = "view",
      fitContent = false,
      navigation = false,
      listLabel,
      listClassName,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const listLayout = cn(fitContent ? "w-fit" : "grid w-full", listClassName);

    // Una tira que navega espera a la nueva ruta para recibir su `activeTabId`.
    // La marca se mueve YA, al pulsar, y se reconcilia cuando llega la ruta.
    const [optimisticId, setOptimisticId] = React.useState(activeTabId);
    const [lastActiveTabId, setLastActiveTabId] = React.useState(activeTabId);
    if (lastActiveTabId !== activeTabId) {
      setLastActiveTabId(activeTabId);
      setOptimisticId(activeTabId);
    }
    const navActiveId = navigation ? optimisticId : activeTabId;
    const { listRef, vars } = useNavIndicator(navActiveId);

    if (navigation) {
      const style = resolveTabsVariant(variant);
      return (
        <div
          ref={ref}
          data-slot="tabs"
          data-orientation="horizontal"
          data-horizontal=""
          className={cn("group/tabs flex min-w-0 max-w-full flex-col gap-2", className)}
          {...props}
        >
          <div
            ref={listRef}
            data-slot="tabs-list"
            data-variant={style}
            aria-label={listLabel}
            className={cn(tabsListVariants({ variant: style }), listLayout)}
            style={{ ...gridStyle(fitContent, tabs.length), ...vars }}
          >
            {tabs.map((tab) => {
              const isActive = tab.id === navActiveId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-slot="tabs-trigger"
                  data-active={isActive ? "" : undefined}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => {
                    setOptimisticId(tab.id);
                    onTabChange(tab.id);
                  }}
                  className={tabsTriggerClassName}
                >
                  <TabBody tab={tab} />
                </button>
              );
            })}
            <span
              aria-hidden
              data-slot="tabs-indicator"
              hidden={vars === null}
              className={tabsIndicatorClassName}
            />
          </div>
        </div>
      );
    }

    return (
      <Tabs
        ref={ref}
        value={activeTabId}
        onValueChange={(value) => onTabChange(String(value))}
        className={className}
        {...props}
      >
        <TabsList
          variant={variant}
          aria-label={listLabel}
          className={listLayout}
          style={gridStyle(fitContent, tabs.length)}
        >
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              <TabBody tab={tab} />
            </TabsTrigger>
          ))}
        </TabsList>
        {children}
      </Tabs>
    );
  },
);

ThemaTabs.displayName = "ThemaTabs";

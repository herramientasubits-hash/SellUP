"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex min-w-0 gap-2 data-horizontal:flex-col",
        className,
      )}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list relative inline-flex w-fit max-w-full items-center justify-start overflow-x-auto rounded-lg p-1 [scrollbar-width:none] text-muted-foreground group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        // Thema "view": pista tenue y pestaña activa como superficie elevada.
        default: "bg-tab-track",
        line: "gap-1 bg-transparent",
        // segmented: pill activo azul sin "track" (antes tenía fondo muted/30 +
        // borde que rodeaba los tabs y se veía como un contorno/halo alrededor
        // del pill). Ahora el activo flota limpio y los inactivos son texto.
        // Thema "page": misma pista, pestaña activa rellena con el primario.
        segmented: "gap-1 rounded-md bg-tab-track p-1 group-data-horizontal/tabs:h-10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

/**
 * Los dos niveles de pestañas de Thema, y solo dos:
 *
 * - `view` (por defecto): cambia un panel DENTRO de la página. Pista tenue y
 *   la pestaña activa como superficie elevada con el texto en el primario.
 * - `page`: cambia lo que muestra la pantalla entera (las vistas de un
 *   módulo). La activa va rellena con el primario.
 *
 * `default` y `segmented` son los nombres anteriores de `view` y `page` y
 * siguen funcionando; `line` es la variante subrayada de shadcn.
 */
export type TabsVariant = "view" | "page" | "default" | "segmented" | "line";

type TabsListStyle = NonNullable<VariantProps<typeof tabsListVariants>["variant"]>;

/** El estilo que pinta cada variante: `view` y `page` son alias de Thema. */
export function resolveTabsVariant(variant: TabsVariant | null | undefined): TabsListStyle {
  if (variant === "page") return "segmented";
  if (variant === "view" || !variant) return "default";
  return variant;
}

/**
 * La marca de la pestaña activa: una sola pieza que se DESLIZA hasta la nueva
 * en vez de que una se apague y otra se encienda. Lee la posición de las
 * variables `--active-tab-*` (las escribe `Tabs.Indicator` de Base UI, o
 * `useNavIndicator` en una tira que navega) y toma su forma de la variante de
 * la lista: superficie elevada en `view`, pastilla primaria en `page`, filete
 * en `line`. Va por debajo de las pestañas (`z-0`); su texto queda encima.
 */
export const tabsIndicatorClassName = cn(
  "pointer-events-none absolute z-0 transition-[left,top,width,height] duration-250 ease-(--ease-spring) motion-reduce:transition-none",
  // view y page: una caja con el tamaño de la pestaña activa.
  "group-data-[variant=default]/tabs-list:top-(--active-tab-top) group-data-[variant=default]/tabs-list:left-(--active-tab-left) group-data-[variant=default]/tabs-list:h-(--active-tab-height) group-data-[variant=default]/tabs-list:w-(--active-tab-width) group-data-[variant=default]/tabs-list:rounded-md group-data-[variant=default]/tabs-list:bg-card group-data-[variant=default]/tabs-list:shadow-card dark:group-data-[variant=default]/tabs-list:bg-secondary",
  "group-data-[variant=segmented]/tabs-list:top-(--active-tab-top) group-data-[variant=segmented]/tabs-list:left-(--active-tab-left) group-data-[variant=segmented]/tabs-list:h-(--active-tab-height) group-data-[variant=segmented]/tabs-list:w-(--active-tab-width) group-data-[variant=segmented]/tabs-list:rounded-sm group-data-[variant=segmented]/tabs-list:bg-primary",
  // line: un filete de 2 px bajo la pestaña (o a su derecha, en vertical).
  "group-data-[variant=line]/tabs-list:bg-primary group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:bottom-0 group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:left-(--active-tab-left) group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:h-0.5 group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:w-(--active-tab-width) group-data-vertical/tabs:group-data-[variant=line]/tabs-list:right-0 group-data-vertical/tabs:group-data-[variant=line]/tabs-list:top-(--active-tab-top) group-data-vertical/tabs:group-data-[variant=line]/tabs-list:h-(--active-tab-height) group-data-vertical/tabs:group-data-[variant=line]/tabs-list:w-0.5",
);

function TabsList({
  className,
  variant = "view",
  children,
  ...props
}: TabsPrimitive.List.Props & { variant?: TabsVariant | null }) {
  const style = resolveTabsVariant(variant);
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={style}
      className={cn(tabsListVariants({ variant: style }), className)}
      {...props}
    >
      {children}
      {/* `renderBeforeHydration`: se coloca antes de hidratar, así la pestaña
          activa no sale un instante sin marca al cargar la página. */}
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        renderBeforeHydration
        className={tabsIndicatorClassName}
      />
    </TabsPrimitive.List>
  );
}

/**
 * Las clases de una pestaña. Se exportan para que una tira que NAVEGA
 * (`ThemaTabs navigation`: botones con `aria-current`, no un `tablist`) salga
 * idéntica a una que cambia de panel: dependen de `data-variant` en la lista y
 * de `data-active` en la pestaña, no de la primitiva.
 */
export const tabsTriggerClassName = cn(
        "group/tabs-trigger relative z-10 inline-flex h-[calc(100%-1px)] flex-1 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-0.5 text-[0.8125rem] font-medium whitespace-nowrap text-muted-foreground transition-colors data-active:font-semibold group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        // El fondo y el filete de la activa los pone el indicador que se
        // desliza (`tabsIndicatorClassName`); la pestaña solo cambia su texto.
        "data-active:bg-transparent",
        "group-data-[variant=default]/tabs-list:data-active:text-primary dark:group-data-[variant=default]/tabs-list:data-active:text-foreground",
        "group-data-[variant=line]/tabs-list:data-active:text-foreground",
        "group-data-[variant=segmented]/tabs-list:h-full group-data-[variant=segmented]/tabs-list:rounded-sm group-data-[variant=segmented]/tabs-list:px-4 group-data-[variant=segmented]/tabs-list:gap-2 group-data-[variant=segmented]/tabs-list:data-active:text-primary-foreground group-data-[variant=segmented]/tabs-list:data-active:shadow-none group-data-[variant=segmented]/tabs-list:data-active:border-transparent group-data-[variant=segmented]/tabs-list:data-active:hover:text-primary-foreground group-data-[variant=segmented]/tabs-list:hover:text-foreground",
);

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(tabsTriggerClassName, className)}
      {...props}
    />
  );
}

export type TabsBadgeTone = "primary" | "neutral" | "positive" | "warning" | "negative" | "info";

const TABS_BADGE_TONE: Record<TabsBadgeTone, string> = {
  primary: "bg-primary text-primary-foreground",
  neutral: "bg-surface-muted text-muted-foreground",
  positive: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning",
  negative: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
};

/** Por encima de esto el contador se queda en «99+»: en una pestaña no cabe más. */
const TABS_BADGE_MAX = 99;

/**
 * El contador que cuelga de una pestaña: cuántos registros hay dentro. Con 0
 * no se pinta — un cero en un contador es ruido. Por defecto va sólido en el
 * primario (un contador es una cantidad, no un estado); con `tone`, lleva el
 * tinte de ese estado. En una tira `page` el tono no aplica: el contador se
 * integra en la pestaña (claro sobre la activa, neutro sobre las demás).
 */
function TabsBadge({
  count,
  tone = "primary",
  className,
}: {
  count: number | undefined;
  tone?: TabsBadgeTone;
  className?: string;
}) {
  if (count === undefined || count <= 0) return null;
  return (
    <span
      data-slot="tabs-badge"
      data-tone={tone}
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
        TABS_BADGE_TONE[tone],
        "group-data-[variant=segmented]/tabs-list:bg-card group-data-[variant=segmented]/tabs-list:text-muted-foreground",
        "group-data-[variant=segmented]/tabs-list:group-data-active/tabs-trigger:bg-primary-foreground/20 group-data-[variant=segmented]/tabs-list:group-data-active/tabs-trigger:text-primary-foreground",
        className,
      )}
    >
      {count > TABS_BADGE_MAX ? `${TABS_BADGE_MAX}+` : count}
    </span>
  );
}

/**
 * El panel de una pestaña. Se monta de nuevo en cada cambio, así que entra con
 * `animate-su-tab-in` (fundido corto) sin estado ni JavaScript; con «menos
 * movimiento» aparece directamente.
 */
function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none animate-su-tab-in", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsBadge, tabsListVariants };

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
  "group/tabs-list inline-flex w-fit max-w-full items-center justify-start overflow-x-auto rounded-lg p-1 [scrollbar-width:none] text-muted-foreground group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
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

function TabsList({
  className,
  variant = "view",
  ...props
}: TabsPrimitive.List.Props & { variant?: TabsVariant | null }) {
  const style = resolveTabsVariant(variant);
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={style}
      className={cn(tabsListVariants({ variant: style }), className)}
      {...props}
    />
  );
}

/**
 * Las clases de una pestaña. Se exportan para que una tira que NAVEGA
 * (`ThemaTabs navigation`: botones con `aria-current`, no un `tablist`) salga
 * idéntica a una que cambia de panel: dependen de `data-variant` en la lista y
 * de `data-active` en la pestaña, no de la primitiva.
 */
export const tabsTriggerClassName = cn(
        "group/tabs-trigger relative inline-flex h-[calc(100%-1px)] flex-1 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-0.5 text-[0.8125rem] font-medium whitespace-nowrap text-muted-foreground transition-all data-active:font-semibold group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-card group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        // Estado activo del variant 'default' — scopeado para que NO pise el
        // relleno su-brand del variant 'segmented' en dark mode (antes el tab
        // activo segmented salía como caja delineada en vez de azul).
        "group-data-[variant=default]/tabs-list:data-active:bg-card group-data-[variant=default]/tabs-list:data-active:text-primary dark:group-data-[variant=default]/tabs-list:data-active:bg-secondary dark:group-data-[variant=default]/tabs-list:data-active:text-foreground",
        "after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        "group-data-[variant=segmented]/tabs-list:h-full group-data-[variant=segmented]/tabs-list:rounded-sm group-data-[variant=segmented]/tabs-list:px-4 group-data-[variant=segmented]/tabs-list:gap-2 group-data-[variant=segmented]/tabs-list:data-active:bg-primary group-data-[variant=segmented]/tabs-list:data-active:text-primary-foreground group-data-[variant=segmented]/tabs-list:data-active:shadow-none group-data-[variant=segmented]/tabs-list:data-active:border-transparent group-data-[variant=segmented]/tabs-list:data-active:hover:text-primary-foreground group-data-[variant=segmented]/tabs-list:hover:text-foreground",
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

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsBadge, tabsListVariants };

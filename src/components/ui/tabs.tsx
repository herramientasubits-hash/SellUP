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

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-0.5 text-[0.8125rem] font-medium whitespace-nowrap text-muted-foreground transition-all data-active:font-semibold group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-card group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        // Estado activo del variant 'default' — scopeado para que NO pise el
        // relleno su-brand del variant 'segmented' en dark mode (antes el tab
        // activo segmented salía como caja delineada en vez de azul).
        "group-data-[variant=default]/tabs-list:data-active:bg-card group-data-[variant=default]/tabs-list:data-active:text-primary dark:group-data-[variant=default]/tabs-list:data-active:bg-secondary dark:group-data-[variant=default]/tabs-list:data-active:text-foreground",
        "after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        "group-data-[variant=segmented]/tabs-list:h-full group-data-[variant=segmented]/tabs-list:rounded-sm group-data-[variant=segmented]/tabs-list:px-4 group-data-[variant=segmented]/tabs-list:gap-2 group-data-[variant=segmented]/tabs-list:data-active:bg-primary group-data-[variant=segmented]/tabs-list:data-active:text-primary-foreground group-data-[variant=segmented]/tabs-list:data-active:shadow-none group-data-[variant=segmented]/tabs-list:data-active:border-transparent group-data-[variant=segmented]/tabs-list:data-active:hover:text-primary-foreground group-data-[variant=segmented]/tabs-list:hover:text-foreground",
        className,
      )}
      {...props}
    />
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

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };

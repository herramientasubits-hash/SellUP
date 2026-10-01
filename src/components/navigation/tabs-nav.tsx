import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Tab {
  id: string;
  label: string;
  /** Icono a la izquierda del nombre. */
  icon?: LucideIcon;
  count?: number;
}

interface TabsNavProps extends React.HTMLAttributes<HTMLDivElement> {
  tabs: Tab[];
  activeTabId: string;
  onTabChange: (id: string) => void;
}

/**
 * TabsNav — pestañas de módulo (anatomía de Thema, pestañas «page»): una pista
 * tenue con las pestañas dentro; la activa va rellena con el primario. Cada
 * pestaña puede llevar su icono y su contador, en línea con el nombre.
 *
 * Cambia de vista dentro de un mismo módulo (navega por query params), por eso
 * son botones con `aria-current` y no un `tablist`.
 */
const TabsNav = React.forwardRef<HTMLDivElement, TabsNavProps>(
  ({ tabs, activeTabId, onTabChange, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex h-10 w-fit max-w-full items-center gap-1 overflow-x-auto rounded-md bg-tab-track p-1 [scrollbar-width:none]",
          className,
        )}
        {...props}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "inline-flex h-full shrink-0 items-center gap-2 whitespace-nowrap rounded-sm px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                isActive
                  ? "bg-primary font-semibold text-primary-foreground shadow-card"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                    isActive
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-card text-muted-foreground",
                  )}
                >
                  {tab.count > 99 ? "99+" : tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  },
);

TabsNav.displayName = "TabsNav";

export { TabsNav };

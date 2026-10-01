import * as React from "react";
import { cn } from "@/lib/utils";

export interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsNavProps extends React.HTMLAttributes<HTMLDivElement> {
  tabs: Tab[];
  activeTabId: string;
  onTabChange: (id: string) => void;
}

const TabsNav = React.forwardRef<HTMLDivElement, TabsNavProps>(
  ({ tabs, activeTabId, onTabChange, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex w-full flex-wrap items-center gap-2 bg-card px-4 py-2",
          className
        )}
        {...props}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;

          return (
            <button
              key={tab.id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative rounded-md px-4 py-1.5 text-sm font-medium transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                isActive
                  ? "bg-primary text-primary-foreground shadow-card"
                  : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              )}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className={cn(
                    "absolute -top-1 -right-1 h-5 min-w-5 rounded-full bg-primary/15 px-1.5 text-center text-xs font-semibold tabular-nums text-primary",
                    isActive && "bg-primary-foreground/20 text-primary-foreground"
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
  }
);

TabsNav.displayName = "TabsNav";

export { TabsNav };
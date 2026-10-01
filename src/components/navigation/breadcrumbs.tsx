import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  active?: boolean;
}

interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[];
}

const Breadcrumbs = React.forwardRef<HTMLElement, BreadcrumbsProps>(
  ({ items, className, ...props }, ref) => {
    return (
      <nav
        ref={ref}
        aria-label="Breadcrumb"
        className={cn("flex flex-wrap items-center gap-1 text-xs", className)}
        {...props}
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isActive = item.active ?? isLast;

          return (
            <React.Fragment key={index}>
              {item.href && !isActive ? (
                <a
                  href={item.href}
                  className={cn(
                    "rounded-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                    "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {item.label}
                </a>
              ) : (
                <span
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "transition-colors",
                    isActive
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
              )}
            </React.Fragment>
          );
        })}
      </nav>
    );
  }
);

Breadcrumbs.displayName = "Breadcrumbs";

export { Breadcrumbs };
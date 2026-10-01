import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
  backHref?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  meta,
  className,
  backHref,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3 pb-6", className)}>
      {breadcrumbs && <div>{breadcrumbs}</div>}
      
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            {backHref && (
              <Link
                href={backHref}
                aria-label="Volver"
                className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
            )}
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {title}
            </h1>
          </div>
          {description && (
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>

      {meta && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {meta}
        </div>
      )}
    </header>
  );
}

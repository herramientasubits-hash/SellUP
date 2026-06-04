import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  backHref?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
  backHref,
}: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 pb-2", className)}>
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          {backHref && (
            <Link
              href={backHref}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          )}
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
            {title}
          </h1>
        </div>
        {description && (
          <p className="text-sm text-muted-foreground leading-snug max-w-3xl">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

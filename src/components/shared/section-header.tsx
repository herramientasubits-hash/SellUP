import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
  className?: string;
}

export function SectionHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn("flex items-end justify-between gap-4 border-b border-border/60 pb-4", className)}>
      <div className="space-y-1">
        {eyebrow && (
          <p className="text-xs font-semibold text-primary">
            {eyebrow}
          </p>
        )}
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </h3>
        {description && (
          <p className="text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
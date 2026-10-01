import type { ReactNode, ElementType } from "react";
import { cn } from "@/lib/utils";

interface FeatureItem {
  label: string;
}

interface ModulePlaceholderProps {
  icon: ElementType;
  module: string;
  description: string;
  features?: FeatureItem[];
  children?: ReactNode;
  className?: string;
}

export function ModulePlaceholder({
  icon: Icon,
  module,
  description,
  features,
  children,
  className,
}: ModulePlaceholderProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-start gap-6 overflow-hidden rounded-2xl border border-dashed border-border bg-surface-subtle p-8",
        className,
      )}
    >
      {/* Decorative glow — top right */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/[0.06] blur-[60px] animate-su-glow"
      />
      {/* Decorative glow — bottom left */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-20 h-40 w-40 rounded-full bg-su-accent-cool/[0.05] blur-[50px]"
      />

      {/* Icon + badge */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-inset ring-primary/15">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <span className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-su-pulse" />
          En construcción
        </span>
      </div>

      {/* Text */}
      <div className="max-w-lg space-y-2.5">
        <h3 className="text-base font-semibold tracking-tight text-foreground">{module}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      {/* Features */}
      {features && features.length > 0 && (
        <div className="w-full space-y-3">
          <p className="text-xs font-semibold text-muted-foreground">
            Capacidades previstas
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {features.map((f, i) => (
              <div
                key={i}
                className="group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors duration-200 hover:bg-card hover:text-foreground"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/[0.08] transition-colors group-hover:bg-primary/[0.14]">
                  <span className="h-1 w-1 rounded-full bg-primary/70" />
                </span>
                {f.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {children}
    </div>
  );
}

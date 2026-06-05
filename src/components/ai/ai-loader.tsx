import { Loader2, Sparkles } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * AILoader — loading affordance for AI flows.
 *
 * Three variants:
 *  - inline: spinner + label, single-line (for buttons, headers, inline status)
 *  - block : full-width panel with animated skeleton lines (default, for empty AI areas)
 *  - card  : bordered card with gradient icon + optional progress bar
 *
 * Five statuses map to Spanish default labels (override via `label` prop):
 *  - thinking   → "Procesando información..."
 *  - generating → "Generando respuesta..."
 *  - analyzing  → "Analizando datos..."
 *  - complete   → "Proceso finalizado"
 *  - error      → "Error en la generación"
 *
 * Accessibility: role="status" + aria-live="polite" on all variants so screen
 * readers announce state changes.
 */
export type AILoaderVariant = "inline" | "block" | "card";
export type AILoaderStatus =
  | "thinking"
  | "generating"
  | "analyzing"
  | "complete"
  | "error";

interface AILoaderProps {
  variant?: AILoaderVariant;
  label?: string;
  description?: string;
  /** 0-100 — when provided, shows a progress bar (card variant) */
  progress?: number;
  status?: AILoaderStatus;
  className?: string;
}

const STATUS_LABELS: Record<AILoaderStatus, string> = {
  thinking: "Procesando información...",
  generating: "Generando respuesta...",
  analyzing: "Analizando datos...",
  complete: "Proceso finalizado",
  error: "Error en la generación",
};

function AILoader({
  variant = "block",
  label,
  description,
  progress,
  status = "thinking",
  className,
}: AILoaderProps) {
  const currentLabel = label ?? STATUS_LABELS[status];

  if (variant === "inline") {
    return (
      <div
        className={cn("inline-flex items-center gap-2 text-sm", className)}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="su-ai-gradient-text size-4 animate-spin" />
        <span className="text-muted-foreground font-medium">
          {currentLabel}
        </span>
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div
        className={cn(
          "flex flex-col gap-4 rounded-2xl su-ai-border bg-card/50 p-6",
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="su-ai-glow flex h-10 w-10 items-center justify-center rounded-xl su-ai-gradient text-primary-foreground shadow-lg">
              <Sparkles className="size-4" />
            </div>
            <div>
              <p className="text-sm font-bold">{currentLabel}</p>
              {description && (
                <p className="text-xs text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
          {status === "thinking" && (
            <Loader2 className="su-ai-gradient-text size-4 animate-spin" />
          )}
        </div>

        {typeof progress === "number" ? (
          <div className="space-y-2">
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full su-ai-gradient transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-end text-[10px] font-black su-ai-gradient-text uppercase tracking-widest">
              {Math.round(progress)}%
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <Skeleton className="h-2.5 w-full rounded-full opacity-30" />
            <Skeleton className="h-2.5 w-4/5 rounded-full opacity-20" />
          </div>
        )}
      </div>
    );
  }

  // Default: block
  return (
    <div
      className={cn(
        "flex flex-col gap-4 p-4 rounded-xl border border-dashed border-ai-soft su-ai-surface",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="su-ai-gradient-text size-4 animate-su-pulse" />
        <span className="text-sm font-bold su-ai-gradient-text uppercase tracking-tight">
          {currentLabel}
        </span>
      </div>
      <div className="space-y-2.5">
        <Skeleton className="h-2 w-full rounded-full bg-ai-soft" />
        <Skeleton className="h-2 w-11/12 rounded-full bg-ai-soft/50" />
        <Skeleton className="h-2 w-4/5 rounded-full bg-ai-soft/50 opacity-50" />
      </div>
    </div>
  );
}

export { AILoader };

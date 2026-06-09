"use client";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Loader2 } from "lucide-react";
import type { AILoaderProps } from "./aiInteractionTypes";

export function AILoader({
  variant = "block",
  label,
  description,
  progress,
  status = "thinking",
  className,
}: AILoaderProps) {
  const statusLabels: Record<string, string> = {
    thinking: "Procesando información...",
    generating: "Generando respuesta...",
    analyzing: "Analizando datos...",
    complete: "Proceso finalizado",
    error: "Error en la generación",
  };

  const currentLabel = label || statusLabels[status];

  if (variant === "inline") {
    return (
      <div className={cn("inline-flex items-center gap-2 text-sm", className)} role="status" aria-live="polite">
        <svg className="animate-spin h-4 w-4 su-ai-gradient-text" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-muted-foreground font-medium">{currentLabel}</span>
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div className={cn("flex flex-col gap-4 rounded-2xl border su-ai-border bg-card/50 p-6 su-ai-glow", className)} role="status" aria-live="polite">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl su-ai-gradient text-su-brand-foreground shadow-lg">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold">{currentLabel}</p>
              {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </div>
          </div>
          {status === "thinking" && (
            <svg className="animate-spin h-4 w-4 su-ai-gradient-text" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
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
    <div className={cn("flex flex-col gap-4 p-4 rounded-xl border border-dashed border-ai-soft/30 bg-su-ai-surface", className)} role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 animate-pulse su-ai-gradient-text" />
        <span className="text-sm font-bold su-ai-gradient-text uppercase tracking-tight">{currentLabel}</span>
      </div>
      <div className="space-y-2.5">
        <Skeleton className="h-2 w-full rounded-full bg-su-ai-surface" />
        <Skeleton className="h-2 w-11/12 rounded-full bg-su-ai-surface" />
        <Skeleton className="h-2 w-4/5 rounded-full bg-su-ai-surface opacity-50" />
      </div>
    </div>
  );
}
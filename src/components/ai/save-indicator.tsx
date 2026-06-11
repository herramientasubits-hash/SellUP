"use client";

import { cn } from "@/lib/utils";
import { Save, Loader2, CheckCircle, AlertCircle, WifiOff, Layers } from "lucide-react";
import type { SaveIndicatorProps } from "./aiInteractionTypes";

export function SaveIndicator({
  status,
  label,
  timestamp,
  compact = false,
  className,
}: SaveIndicatorProps) {
  const config: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
    idle: {
      icon: Layers,
      color: "text-muted-foreground",
      label: "En la nube",
    },
    saving: {
      icon: Loader2,
      color: "text-su-brand",
      label: "Guardando...",
    },
    saved: {
      icon: CheckCircle,
      color: "text-emerald-500",
      label: "Guardado",
    },
    error: {
      icon: AlertCircle,
      color: "text-destructive",
      label: "Error al guardar",
    },
    offline: {
      icon: WifiOff,
      color: "text-muted-foreground",
      label: "Sin conexión",
    },
  };

  const { icon: Icon, color, label: defaultLabel } = config[status];
  const displayLabel = label || defaultLabel;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 transition-all duration-300",
        color,
        className
      )}
      role="status"
      aria-live="polite"
    >
      <Icon className={cn("h-3.5 w-3.5", status === "saving" && "animate-spin")} />
      {!compact && (
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-medium leading-none">{displayLabel}</span>
          {timestamp && status === "saved" && (
            <span className="text-[10px] opacity-60 leading-none">
              {timestamp}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
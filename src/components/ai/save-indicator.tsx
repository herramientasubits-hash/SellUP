import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SaveIndicator — status pill for auto-save / sync state.
 *
 * Five statuses:
 *  - idle    : "En la nube"     (Cloud icon, muted-foreground)
 *  - saving  : "Guardando..."   (Loader2 spinning, primary)
 *  - saved   : "Guardado"       (CheckCircle2, emerald-500)
 *  - error   : "Error al guardar" (AlertTriangle, destructive)
 *  - offline : "Sin conexión"   (CloudOff, muted-foreground)
 *
 * Compact mode hides the label and timestamp, keeping only the icon
 * (useful in tight headers / toolbars).
 */
type SaveStatus = "idle" | "saving" | "saved" | "error" | "offline";

interface SaveIndicatorProps {
  status: SaveStatus;
  label?: string;
  timestamp?: string;
  compact?: boolean;
  className?: string;
}

interface StatusConfig {
  icon: LucideIcon;
  color: string;
  label: string;
}

const STATUS_CONFIG: Record<SaveStatus, StatusConfig> = {
  idle: {
    icon: Cloud,
    color: "text-muted-foreground",
    label: "En la nube",
  },
  saving: {
    icon: Loader2,
    color: "text-primary",
    label: "Guardando...",
  },
  saved: {
    icon: CheckCircle2,
    color: "text-emerald-500",
    label: "Guardado",
  },
  error: {
    icon: AlertTriangle,
    color: "text-destructive",
    label: "Error al guardar",
  },
  offline: {
    icon: CloudOff,
    color: "text-muted-foreground",
    label: "Sin conexión",
  },
};

function SaveIndicator({
  status,
  label,
  timestamp,
  compact = false,
  className,
}: SaveIndicatorProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const displayLabel = label ?? config.label;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 transition-all duration-300",
        config.color,
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Icon
        className={cn("size-3.5", status === "saving" && "animate-spin")}
      />
      {!compact && (
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-medium leading-none">
            {displayLabel}
          </span>
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

export { SaveIndicator };
export type { SaveIndicatorProps, SaveStatus };

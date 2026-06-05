import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export type DeltaTone = "positive" | "negative" | "neutral";
export type DeltaDirection = "up" | "down" | "flat";

interface DeltaPillProps {
  value?: number;
  label?: string;
  tone?: DeltaTone;
  direction?: DeltaDirection;
  showIcon?: boolean;
  size?: "sm" | "md";
  className?: string;
}

const TONE_CLASSES: Record<DeltaTone, string> = {
  positive: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  negative: "bg-destructive/10 text-destructive border-destructive/20",
  neutral: "bg-muted/40 text-muted-foreground border-border/40",
};

const ICON_CLASS: Record<"sm" | "md", string> = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
};

const SIZE_CLASSES: Record<"sm" | "md", string> = {
  sm: "px-1.5 py-0.5 text-[10px] gap-1",
  md: "px-2 py-1 text-[11px] gap-1.5",
};

function resolveTone(value: number | undefined, tone?: DeltaTone): DeltaTone {
  if (tone) return tone;
  if (value === undefined) return "neutral";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function resolveDirection(value: number | undefined, direction?: DeltaDirection): DeltaDirection {
  if (direction) return direction;
  if (value === undefined) return "flat";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function formatValue(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}%`;
}

export function DeltaPill({
  value,
  label,
  tone,
  direction,
  showIcon = true,
  size = "md",
  className,
}: DeltaPillProps) {
  const resolvedTone = resolveTone(value, tone);
  const resolvedDirection = resolveDirection(value, direction);
  const Icon = {
    up: TrendingUp,
    down: TrendingDown,
    flat: Minus,
  }[resolvedDirection];

  return (
    <span
      className={cn(
        "inline-flex items-center font-bold rounded-full border whitespace-nowrap",
        TONE_CLASSES[resolvedTone],
        SIZE_CLASSES[size],
        className,
      )}
    >
      {showIcon && <Icon className={ICON_CLASS[size]} />}
      <span>{label ?? (value !== undefined ? formatValue(value) : "")}</span>
    </span>
  );
}

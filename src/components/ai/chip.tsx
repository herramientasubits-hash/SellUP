import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Chip — compact token-like element with selection, removal, and counter.
 *
 * Distinct from Badge: Chips are interactive (clickable, removable, selectable)
 * and support a count badge. Badges are passive status indicators.
 *
 * Eight tones (mapped to semantic tokens, no hardcoded colors):
 *  - default  → border + bg-card
 *  - muted    → bg-muted
 *  - primary  → bg-primary/10
 *  - positive → bg-emerald-500/10 (text-emerald-500)
 *  - negative → bg-destructive/10
 *  - warning  → bg-amber-500/10
 *  - info     → bg-info/10
 *  - ai       → su-ai-surface + su-ai-border (uses --ai-soft)
 *
 * Two sizes (sm h-6, md h-8).
 *
 * Renders as <button> if onClick is provided (and not disabled), else <div>.
 * Removable mode appends a X button (does not trigger onClick).
 */

const chipVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-full border transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      tone: {
        default: "border-border bg-background text-foreground hover:bg-accent",
        muted:
          "border-transparent bg-muted text-muted-foreground hover:bg-muted/80",
        primary:
          "border-transparent bg-primary/10 text-primary hover:bg-primary/20",
        positive:
          "border-transparent bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400",
        negative:
          "border-transparent bg-destructive/10 text-destructive hover:bg-destructive/20",
        warning:
          "border-transparent bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400",
        info: "border-transparent bg-info/10 text-info hover:bg-info/20",
        ai: "su-ai-border su-ai-surface hover:brightness-105",
      },
      size: {
        sm: "h-6 px-2 text-xs",
        md: "h-8 px-3 text-sm",
      },
      selected: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      {
        tone: "primary",
        selected: true,
        className:
          "bg-primary text-primary-foreground hover:bg-primary/90 border-transparent",
      },
      {
        tone: "default",
        selected: true,
        className: "border-primary bg-primary/5 text-primary",
      },
      {
        tone: "positive",
        selected: true,
        className:
          "bg-emerald-500 text-white hover:bg-emerald-500/90 border-transparent dark:bg-emerald-500",
      },
    ],
    defaultVariants: {
      tone: "default",
      size: "md",
      selected: false,
    },
  },
);

type ChipTone = NonNullable<VariantProps<typeof chipVariants>["tone"]>;
type ChipSize = NonNullable<VariantProps<typeof chipVariants>["size"]>;

interface ChipProps {
  label: string;
  selected?: boolean;
  removable?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  count?: number;
  tone?: ChipTone;
  size?: ChipSize;
  onClick?: () => void;
  onRemove?: () => void;
  className?: string;
}

function Chip({
  label,
  selected = false,
  removable = false,
  disabled = false,
  icon,
  count,
  tone = "default",
  size = "md",
  onClick,
  onRemove,
  className,
}: ChipProps) {
  const isClickable = !!onClick && !disabled;
  const isAI = tone === "ai";

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.();
  };

  const content = (
    <>
      {icon && (
        <span
          className={cn(
            "shrink-0",
            selected ? "opacity-100" : "opacity-70",
            isAI && "su-ai-gradient-text",
          )}
        >
          {icon}
        </span>
      )}
      <span className={cn("truncate font-medium", isAI && "su-ai-gradient-text")}>
        {label}
      </span>
      {typeof count === "number" && (
        <span
          className={cn(
            "ml-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold",
            selected
              ? "bg-white/20 text-current"
              : "bg-muted-foreground/10 text-muted-foreground",
            isAI && !selected && "bg-ai-soft/10 text-ai-soft",
          )}
        >
          {count}
        </span>
      )}
      {removable && (
        <button
          type="button"
          onClick={handleRemove}
          className={cn(
            "ml-1 -mr-1 flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10",
            disabled && "pointer-events-none",
          )}
          aria-label={`Remove ${label}`}
        >
          <X className={cn("size-3", isAI && "su-ai-gradient-text")} />
        </button>
      )}
    </>
  );

  if (isClickable) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          chipVariants({ tone, size, selected }),
          "cursor-pointer",
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(chipVariants({ tone, size, selected }), className)}
      aria-pressed={selected}
    >
      {content}
    </div>
  );
}

export { Chip, chipVariants };
export type { ChipProps, ChipTone, ChipSize };

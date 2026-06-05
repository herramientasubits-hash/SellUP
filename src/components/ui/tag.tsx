import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tag — compact label for metadata, light categorization, filter chips.
 *
 * Distinct from:
 *  - Badge: pill-shaped, used for status/counts
 *  - Chip : interactive (clickable, selectable, count badge)
 *  - Tag  : static label, square corners, optional X to remove
 *
 * Five tones (using existing semantic tokens + Tailwind palette):
 *  - neutral → bg-secondary
 *  - info    → bg-info/10 text-info border-info/20
 *  - success → bg-emerald-500/10 text-emerald-600 dark:text-emerald-400
 *  - warning → bg-amber-500/10 text-amber-600 dark:text-amber-400
 *  - danger  → bg-destructive/10 text-destructive
 */
type TagTone = "neutral" | "info" | "success" | "warning" | "danger";

interface TagProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  tone?: TagTone;
  removable?: boolean;
  onRemove?: () => void;
}

const TONE_CLASSES: Record<TagTone, string> = {
  neutral: "bg-secondary text-secondary-foreground border-transparent",
  info: "bg-info/10 text-info border-info/20",
  success:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  warning:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
};

function Tag({
  label,
  tone = "neutral",
  removable = false,
  onRemove,
  className,
  ...props
}: TagProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border transition-colors",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      <span>{label}</span>
      {removable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="hover:opacity-70 transition-opacity"
          aria-label={`Eliminar ${label}`}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

export { Tag };
export type { TagProps, TagTone };

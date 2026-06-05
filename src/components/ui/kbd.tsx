import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Kbd — keyboard shortcut indicator.
 *
 * Visual: monospace-ish label inside a small bordered surface that mimics
 * a physical keyboard key. Used inside tooltips, command menus, and
 * shortcut hints.
 *
 * Variants:
 *  - default: subtle border + bg-muted
 *  - solid  : bg-foreground text-background (for high contrast)
 *
 * Use KbdGroup for composite shortcuts like ⌘K, ⇧Tab, etc.
 */
interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  variant?: "default" | "solid";
}

function Kbd({ className, variant = "default", ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center rounded-sm border px-1.5 font-mono text-[10px] font-medium",
        variant === "solid"
          ? "border-foreground/20 bg-foreground text-background"
          : "border-border bg-muted text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * KbdGroup — composite shortcut display, e.g. <KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>
 * Renders children separated by a small plus sign.
 */
function KbdGroup({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
export type { KbdProps };

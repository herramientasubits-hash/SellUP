"use client";

import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TooltipIconButtonProps
  extends Omit<ButtonProps, "children" | "title"> {
  /** Visible icon (lucide-react icon, etc). */
  icon: React.ReactNode;
  /** Tooltip text shown on hover. */
  label: string;
  /** Tooltip placement. Defaults to "bottom". */
  side?: "top" | "right" | "bottom" | "left";
  /** Tooltip alignment. Defaults to "center". */
  align?: "start" | "center" | "end";
  /** Optional explicit override for `aria-label` (defaults to `label`). */
  ariaLabel?: string;
  /** Optional keyboard shortcut hint appended to the tooltip, e.g. "⌘K". */
  shortcut?: string;
}

/**
 * Icon-only button with a shadcn-style Tooltip on hover.
 *
 * Use this anywhere a button has only an icon and no visible label
 * — the tooltip explains the action on hover. Renders as a single
 * tabbable button with `aria-label` for screen readers.
 *
 * Example:
 *   <TooltipIconButton
 *     icon={<Search className="h-3.5 w-3.5" />}
 *     label="Buscar"
 *     onClick={() => setSearchOpen(true)}
 *   />
 */
export const TooltipIconButton = React.forwardRef<
  HTMLButtonElement,
  TooltipIconButtonProps
>(
  (
    {
      icon,
      label,
      side = "bottom",
      align = "center",
      ariaLabel,
      shortcut,
      variant = "ghost",
      size = "icon-sm",
      type = "button",
      ...buttonProps
    },
    ref,
  ) => {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={ref}
              type={type}
              variant={variant}
              size={size}
              aria-label={ariaLabel ?? label}
              {...buttonProps}
            >
              {icon}
            </Button>
          }
        />
        <TooltipContent side={side} align={align}>
          {label}
          {shortcut && (
            <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded border border-background/20 bg-background/10 px-1 text-[10px] font-medium text-background/80">
              {shortcut}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  },
);
TooltipIconButton.displayName = "TooltipIconButton";

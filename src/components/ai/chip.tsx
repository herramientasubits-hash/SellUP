"use client";

import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { X } from "@/icons";
import type { ChipProps } from "./aiInteractionTypes";

const chipVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-full border transition-all focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      tone: {
        default: "border-border bg-background text-foreground hover:bg-surface-muted",
        muted: "border-transparent bg-muted text-muted-foreground hover:bg-surface-muted",
        primary: "border-transparent bg-primary/10 text-primary hover:bg-primary/20",
        positive: "border-transparent bg-success/10 text-success hover:bg-success/20",
        negative: "border-transparent bg-destructive/10 text-destructive hover:bg-destructive/20",
        warning: "border-transparent bg-warning/10 text-warning hover:bg-warning/20",
        info: "border-transparent bg-info/10 text-info hover:bg-info/20",
        ai: "border-ai-soft/30 bg-su-ai-surface hover:bg-su-ai-surface/80",
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
        className: "bg-primary text-primary-foreground hover:bg-brand-hover",
      },
      {
        tone: "default",
        selected: true,
        className: "border-primary bg-primary/5 text-primary",
      },
      {
        tone: "positive",
        selected: true,
        className: "bg-success text-primary-foreground hover:bg-success/90",
      },
    ],
    defaultVariants: {
      tone: "default",
      size: "md",
      selected: false,
    },
  }
);

export function Chip({
  label,
  selected = false,
  removable = false,
  disabled = false,
  icon: Icon,
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
    if (onRemove) onRemove();
  };

  const Content = (
    <>
      {Icon && (
        <Icon
          className={cn(
            "shrink-0",
            size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
            selected ? "opacity-100" : "opacity-70",
            isAI && "su-ai-gradient-text"
          )}
        />
      )}
      <span className={cn("truncate font-medium", isAI && "text-su-ai-gradient-text")}>
        {label}
      </span>
      {typeof count === "number" && (
        <span className={cn(
          "ml-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-xs font-bold",
          selected ? "bg-primary-foreground/20 text-current" : "bg-muted-foreground/10 text-muted-foreground",
          isAI && !selected && "bg-su-ai-surface su-ai-gradient-text"
        )}>
          {count}
        </span>
      )}
      {removable && (
        <button
          type="button"
          onClick={handleRemove}
          className={cn(
            "ml-1 -mr-1 flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
            disabled && "pointer-events-none"
          )}
          aria-label={`Remove ${label}`}
        >
          <X className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5", isAI && "text-su-ai-gradient-text")} />
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
        className={cn(chipVariants({ tone, size, selected, className }), "cursor-pointer")}
      >
        {Content}
      </button>
    );
  }

  return (
    <div className={cn(chipVariants({ tone, size, selected, className }))}>
      {Content}
    </div>
  );
}
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Progress — horizontal progress bar.
 *
 * Pure div implementation (no headless lib). Use for:
 *   - File uploads / imports
 *   - AI generation progress
 *   - Form completion indicators
 *   - Long-running operation status
 *
 * Color variants use the same semantic tokens as Alert so the visual
 * language stays consistent across the platform.
 */
const progressIndicatorVariants = cva(
  "h-full w-full flex-1 rounded-full transition-all duration-500 ease-out",
  {
    variants: {
      color: {
        primary: "bg-primary",
        success: "bg-success",
        warning: "bg-warning",
        destructive: "bg-destructive",
      },
    },
    defaultVariants: {
      color: "primary",
    },
  },
);

export type ProgressColor = NonNullable<
  VariantProps<typeof progressIndicatorVariants>["color"]
>;

export interface ProgressProps extends React.ComponentProps<"div"> {
  /** Progress value 0-100. Values outside the range are clamped. */
  value?: number;
  /** Fill color (semantic). Defaults to primary. */
  color?: ProgressColor;
}

function Progress({
  className,
  value = 0,
  color = "primary",
  ...props
}: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "relative flex h-2 w-full items-center overflow-hidden rounded-full bg-muted dark:bg-white/10",
        className,
      )}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn(progressIndicatorVariants({ color }))}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </div>
  );
}

export { Progress };

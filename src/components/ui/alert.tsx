import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Alert — contextual feedback message.
 *
 * Variants convey semantic intent:
 *   - default    : neutral notice (no semantic color)
 *   - destructive: error / failed action
 *   - info       : informational hint
 *   - warning    : caution / attention needed
 *   - success    : confirmation
 *
 * Slots:
 *   - Alert             : root container, role="alert"
 *   - AlertTitle        : headline (medium weight, tracking-tight)
 *   - AlertDescription  : body text (muted)
 *   - AlertAction       : absolutely positioned top-right (e.g. close button)
 *
 * The root is a `div` with grid layout. When an SVG icon is the first child
 * it spans the first column automatically (`has-[>svg]:grid-cols-[auto_1fr]`).
 */
const alertVariants = cva(
  [
    "group/alert relative grid w-full gap-0.5 rounded-lg border p-4 text-left text-sm",
    "has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18",
    "has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3",
    "*:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: "bg-card text-foreground",
        destructive:
          "border-destructive/40 text-destructive [&>svg]:text-destructive bg-destructive/5 dark:border-destructive/50 dark:bg-destructive/10",
        info: "border-info/40 text-info [&>svg]:text-info bg-info/5 dark:border-info/50 dark:bg-info/10",
        warning:
          "border-warning/40 text-warning [&>svg]:text-warning bg-warning/5 dark:border-warning/50 dark:bg-warning/10",
        success:
          "border-success/40 text-success [&>svg]:text-success bg-success/5 dark:border-success/50 dark:bg-success/10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type AlertVariant = NonNullable<VariantProps<typeof alertVariants>["variant"]>;

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium leading-none tracking-tight group-has-[>svg]/alert:col-start-2",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-muted-foreground group-has-[>svg]/alert:col-start-2 [&_p]:leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-4 right-4", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };

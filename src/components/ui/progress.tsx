"use client";

import * as React from "react";
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "@/lib/utils";

type ProgressColor = "primary" | "success" | "warning" | "destructive";

const colorMap: Record<ProgressColor, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

function Progress({
  className,
  value,
  color = "primary",
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  color?: ProgressColor;
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative flex h-2 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        // Sin `flex-1`: estiraba el indicador a todo el ancho y pisaba el `width: N%` que
        // pone Base UI, así que toda barra se veía llena (desde junio de 2026).
        className={cn("h-full rounded-full transition-all", colorMap[color])}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
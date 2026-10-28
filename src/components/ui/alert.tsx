"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "@/icons";

// Un aviso que aparece por algo que acaba de pasar entra con un fade corto en
// vez de saltar (reducir movimiento lo apaga desde globals.css).
const alertVariants = cva(
  "relative w-full rounded-lg border px-3 py-2.5 text-sm grid gap-0.5 animate-in fade-in-0 duration-200 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        // El Alert de reui que usa UBITS: el color va en el borde (30 %), un velo
        // al 4 % y el ícono; título y texto siguen en el color normal.
        destructive: "border-destructive/30 bg-destructive/4 text-card-foreground [&>svg]:text-destructive",
        info: "border-info/30 bg-info/4 text-card-foreground [&>svg]:text-info",
        warning: "border-warning/30 bg-warning/4 text-card-foreground [&>svg]:text-warning",
        success: "border-success/30 bg-success/4 text-card-foreground [&>svg]:text-success",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const iconMap = {
  default: AlertCircle,
  destructive: AlertCircle,
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle,
};

function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const Icon = iconMap[variant || "default"];

  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon className="shrink-0" />
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("font-medium tracking-tight", className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-sm text-muted-foreground [&_p]:leading-relaxed", className)}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2.5 right-3", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
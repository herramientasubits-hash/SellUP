"use client";

import {
  CheckCircle2,
  Info,
  Loader2,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toaster — global toast surface mounted once in the root layout.
 *
 * Wires Sonner to SellUp's design tokens:
 * - auto-syncs with `next-themes` (light / dark / system)
 * - uses semantic status classes (text-success, text-warning, text-info, text-destructive)
 *   matching Alert primitive from @/components/ui/alert
 * - background, text, border, radius map to existing popover/border/radius tokens
 *
 * Usage:
 *   import { toast } from "sonner";
 *   toast.success("Saved");
 *   toast.error("Could not save");
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CheckCircle2 className="size-4 text-emerald-500" />,
        info: <Info className="size-4 text-info" />,
        warning: <TriangleAlert className="size-4 text-amber-500" />,
        error: <OctagonAlert className="size-4 text-destructive" />,
        loading: <Loader2 className="size-4 animate-spin text-primary" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:border-emerald-500/20",
          error: "group-[.toaster]:border-destructive/20",
          warning: "group-[.toaster]:border-amber-500/20",
          info: "group-[.toaster]:border-info/20",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CircleCheck, Info, TriangleAlert, OctagonX, Loader2 } from "lucide-react";

type ToasterTheme = "light" | "dark" | "system";

const Toaster = ({ theme = "system", ...props }: ToasterProps & { theme?: ToasterTheme }) => {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: (
          <CircleCheck className="size-4 text-emerald-500" />
        ),
        info: (
          <Info className="size-4 text-sky-500" />
        ),
        warning: (
          <TriangleAlert className="size-4 text-amber-500" />
        ),
        error: (
          <OctagonX className="size-4 text-destructive" />
        ),
        loading: (
          <Loader2 className="size-4 animate-spin text-su-brand" />
        ),
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
          toast: "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-su-brand group-[.toast]:text-su-brand-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:border-emerald-500/20",
          error: "group-[.toaster]:border-destructive/20",
          warning: "group-[.toaster]:border-amber-500/20",
          info: "group-[.toaster]:border-sky-500/20",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
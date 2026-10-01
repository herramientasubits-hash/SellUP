"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CircleCheck, Info, TriangleAlert, OctagonX, Loader2 } from "@/icons";

type ToasterTheme = "light" | "dark" | "system";

const Toaster = ({ theme = "system", ...props }: ToasterProps & { theme?: ToasterTheme }) => {
  return (
    <Sonner
      theme={theme}
      className={`toaster group ${props.className ?? ""}`}
      icons={{
        success: (
          <CircleCheck className="size-4 text-success" />
        ),
        info: (
          <Info className="size-4 text-info" />
        ),
        warning: (
          <TriangleAlert className="size-4 text-warning" />
        ),
        error: (
          <OctagonX className="size-4 text-destructive" />
        ),
        loading: (
          <Loader2 className="size-4 animate-spin text-primary" />
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
          toast: "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border/60 group-[.toaster]:shadow-drawer group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:border-success/20",
          error: "group-[.toaster]:border-destructive/20",
          warning: "group-[.toaster]:border-warning/25",
          info: "group-[.toaster]:border-info/20",
          // Como en Thema: el cierre no cuelga de la esquina (círculo de 20px
          // medio fuera de la tarjeta) sino que va al final de la fila, dentro
          // de la tarjeta y con un área de 28px.
          closeButton:
            "group-[.toast]:!static group-[.toast]:!order-last group-[.toast]:!left-auto group-[.toast]:!right-auto group-[.toast]:!top-auto group-[.toast]:!ml-2 group-[.toast]:!size-7 group-[.toast]:![transform:none] group-[.toast]:!rounded-md group-[.toast]:!border-transparent group-[.toast]:!bg-transparent group-[.toast]:!text-muted-foreground [&_svg]:!size-4 hover:group-[.toast]:!bg-muted hover:group-[.toast]:!text-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

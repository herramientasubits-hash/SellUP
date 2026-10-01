"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/15 transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-[2px] dark:bg-black/45",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          // Thema: el panel no va pegado a la ventana. Flota a 12px de los
          // tres bordes que toca, con las cuatro esquinas redondeadas y borde
          // completo. Recorre su ancho entero al entrar (un desplazamiento
          // corto se lee como un salto) con curva expo-out; sale más rápido.
          "fixed z-50 flex flex-col gap-4 overflow-hidden rounded-2xl border border-border/70 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-drawer transition duration-500 ease-out-expo will-change-transform data-ending-style:opacity-0 data-ending-style:duration-300 data-starting-style:opacity-0",
          "data-[side=right]:inset-y-3 data-[side=right]:right-3 data-[side=right]:w-[calc(100%-1.5rem)] data-[side=right]:data-ending-style:translate-x-full data-[side=right]:data-starting-style:translate-x-full data-[side=right]:sm:max-w-sm",
          "data-[side=left]:inset-y-3 data-[side=left]:left-3 data-[side=left]:w-[calc(100%-1.5rem)] data-[side=left]:data-ending-style:-translate-x-full data-[side=left]:data-starting-style:-translate-x-full data-[side=left]:sm:max-w-sm",
          "data-[side=top]:inset-x-3 data-[side=top]:top-3 data-[side=top]:h-auto data-[side=top]:max-h-[calc(100dvh-1.5rem)] data-[side=top]:data-ending-style:-translate-y-full data-[side=top]:data-starting-style:-translate-y-full",
          "data-[side=bottom]:inset-x-3 data-[side=bottom]:bottom-3 data-[side=bottom]:h-auto data-[side=bottom]:max-h-[calc(100dvh-1.5rem)] data-[side=bottom]:data-ending-style:translate-y-full data-[side=bottom]:data-starting-style:translate-y-full",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-3 right-3"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Cerrar</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "text-base font-semibold tracking-tight text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};

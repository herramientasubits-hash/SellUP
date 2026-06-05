"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Popover — anchored floating content.
 *
 * Migrated from @radix-ui/react-popover → @base-ui/react/popover.
 *
 * Key differences:
 *  - Uses `render` prop instead of `asChild` (Base UI convention).
 *    <PopoverTrigger render={<Button>...</Button>}> instead of
 *    <PopoverTrigger asChild><Button>...</Button></PopoverTrigger>
 *  - data-state: open/closed → data-open/data-closed + transitionStatus
 *  - 3-layer structure: Portal > Positioner > Popup (vs Radix's Portal+Content).
 *    align and sideOffset live on Positioner, not Popup.
 *  - No Anchor primitive (use the trigger's positioning instead).
 */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

interface PopoverContentProps extends React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Popup> {
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Popup>,
  PopoverContentProps
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Positioner sideOffset={sideOffset} align={align}>
      <PopoverPrimitive.Popup
        ref={ref}
        className={cn(
          "z-50 w-72 rounded-xl border border-border/30 bg-popover p-4 text-popover-foreground shadow-md outline-none",
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
          "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Positioner>
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Popup.displayName;

export { Popover, PopoverTrigger, PopoverContent };

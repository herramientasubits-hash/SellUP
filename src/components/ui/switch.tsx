"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Switch — toggle control for boolean settings.
 *
 * Migrated from @radix-ui/react-switch → @base-ui/react/switch.
 *
 * Key differences:
 *  - Root renders a <span> with hidden <input> (vs Radix's <button>).
 *    The hidden input handles form submission; clicks are wired by
 *    Base UI's useButton.
 *  - data-checked / data-unchecked (Base UI) replace
 *    data-[state=checked] / data-[state=unchecked] (Radix).
 *  - onCheckedChange signature is identical: (checked: boolean) => void.
 *
 * Used by data-table-settings-drawer.tsx for column visibility toggles.
 */
const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-[1.15rem] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-card transition-colors",
      "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform dark:data-unchecked:bg-foreground dark:data-checked:bg-primary-foreground",
        "data-checked:translate-x-[calc(100%-2px)] data-unchecked:translate-x-0",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };

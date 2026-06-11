"use client";

import * as React from "react";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "@/lib/utils";

function RadioGroup({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive>) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid w-full gap-2", className)}
      {...props}
    >
      {children}
    </RadioGroupPrimitive>
  );
}

interface RadioGroupItemProps
  extends React.ComponentProps<"input"> {
  value: string;
  children?: React.ReactNode;
}

function RadioGroupItem({
  className,
  value,
  children,
  disabled,
  ...props
}: RadioGroupItemProps) {
  return (
    <label
      className={cn(
        "group/radio-group-item peer relative flex items-center gap-2 rounded-lg border border-input p-3 text-sm font-medium transition-all outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-[state=checked]:border-primary data-[state=checked]:bg-primary/5 data-[state=checked]:text-primary",
        className
      )}
    >
      <input
        type="radio"
        value={value}
        disabled={disabled}
        className="sr-only peer"
        {...props}
      />
      <span className="flex-1">{children}</span>
      <span
        data-slot="radio-group-indicator"
        className="relative flex size-4 items-center justify-center"
      >
        <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground opacity-0 peer-data-[state=checked]:opacity-100 transition-opacity" />
      </span>
    </label>
  );
}

export { RadioGroup, RadioGroupItem };
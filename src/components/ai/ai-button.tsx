"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import type { AIButtonProps } from "./aiInteractionTypes";

export function AIButton({
  label,
  children,
  loading = false,
  disabled = false,
  variant = "primary",
  size = "md",
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  helperText,
  onClick,
  type = "button",
  form,
  className,
}: AIButtonProps) {
  const variantMap: Record<string, "default" | "secondary" | "ghost" | "outline"> = {
    primary: "default",
    secondary: "outline",
    subtle: "ghost",
    outline: "outline",
  };

  const sizeMap: Record<string, "default" | "sm" | "lg"> = {
    xs: "sm",
    sm: "sm",
    md: "default",
    lg: "lg",
  };

  const isPrimary = variant === "primary";
  const isOutline = variant === "secondary" || variant === "outline";

  return (
    <div className={cn("inline-flex flex-col gap-1.5", className)}>
      <Button
        type={type}
        form={form}
        variant={variantMap[variant]}
        size={sizeMap[size]}
        disabled={disabled || loading}
        onClick={onClick}
        aria-busy={loading}
        className={cn(
          "relative overflow-hidden transition-all duration-300 font-bold rounded-full",
          isPrimary && !disabled && "su-ai-gradient text-su-brand-foreground border-transparent hover:opacity-90 active:scale-95",
          isOutline && !disabled && "su-ai-border hover:opacity-80 active:scale-95",
          size === "xs" && "h-7 px-3 text-[10px] gap-1",
          size === "sm" && "h-8 px-4 text-xs gap-1.5",
          size === "md" && "h-10 px-6 text-sm gap-2",
          size === "lg" && "h-12 px-8 text-base gap-2.5"
        )}
      >
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{label || children || "Generando..."}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className={cn(
              isPrimary ? "text-su-brand-foreground" : "su-ai-gradient-text",
            )}>
              {LeftIcon ? (
                <LeftIcon className={cn(
                  size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4",
                  !isPrimary && "su-ai-gradient-text"
                )} />
              ) : (
                <Sparkles className={cn(
                  size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4",
                  !isPrimary && "su-ai-gradient-text"
                )} />
              )}
            </span>
            <span className={cn(isPrimary && "text-su-brand-foreground")}>
              {label || children}
            </span>
            {RightIcon && (
              <RightIcon className={cn(
                size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4",
                !isPrimary && "su-ai-gradient-text"
              )} />
            )}
          </div>
        )}
      </Button>
      {helperText && (
        <p className="px-1 text-[11px] text-muted-foreground opacity-80 italic">
          {helperText}
        </p>
      )}
    </div>
  );
}
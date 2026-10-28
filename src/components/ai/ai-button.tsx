"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2 } from "@/icons";
import { AIOrb } from "./ai-orb";
import type { AIButtonProps } from "./aiInteractionTypes";

export function AIButton({
  label,
  children,
  loading = false,
  disabled = false,
  variant = "primary",
  size = "md",
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

  const sizeMap: Record<string, "default" | "xs" | "sm" | "lg"> = {
    xs: "xs",
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
          // Como el BotonIa de UBITS: pastilla con más aire a los lados, peso medio, sin sombra.
          "relative overflow-hidden rounded-full",
          size === "sm" || size === "xs" ? "px-4" : "px-5",
          isPrimary && !disabled && "su-ai-gradient border-0 shadow-none ring-0",
          isOutline && "border-border bg-background shadow-xs hover:bg-muted dark:border-input dark:bg-input/30"
        )}
      >
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span>{label || children || "Generando..."}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {/* Como en UBITS: el primario de IA va sin ícono (el degradado ya es la
                marca); el secundario lleva el orbe al inicio. */}
            {!isPrimary && <AIOrb className={size === "xs" ? "size-4" : "size-4.5"} />}
            <span>
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
        <p className="px-1 text-xs text-muted-foreground">
          {helperText}
        </p>
      )}
    </div>
  );
}
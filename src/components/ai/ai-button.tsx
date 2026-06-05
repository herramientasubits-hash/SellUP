import { Loader2, Sparkles, type LucideIcon } from "lucide-react";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * AIButton — primary action button for AI invocations.
 *
 * Replaces a plain <Button> whenever the action triggers an AI workflow
 * (generate, enrich, classify, summarize, etc). Uses the SellUp AI gradient
 * tokens defined in globals.css (--su-ai-stop-1..5) and the `su-ai-*` utility
 * classes for fill, text, surface, border and glow.
 *
 * Variants:
 *   - primary  : solid gradient fill, white text, premium glow (default)
 *   - secondary: card surface, gradient text, gradient border
 *   - subtle   : transparent surface, gradient text
 *   - outline  : transparent fill, gradient border
 *
 * Sizes: xs (28), sm (32), md (40), lg (48). All use rounded-full.
 *
 * Loading state: shows spinning Loader2, sets aria-busy, applies the
 * animated gradient (`su-ai-gradient-animate`) on primary/secondary.
 */
const aiButtonVariants = cva(
  // base
  "group relative inline-flex items-center justify-center font-semibold rounded-full border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-su-ai-from/30 disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: [
          "text-white",
          "su-ai-gradient",
          "border-transparent",
          "su-ai-glow",
          "hover:opacity-90",
          "active:scale-[0.98]",
        ],
        secondary: [
          "bg-card",
          "text-foreground",
          "su-ai-border",
          "hover:bg-card/80",
          "active:scale-[0.98]",
        ],
        subtle: [
          "bg-transparent",
          "border-transparent",
          "su-ai-gradient-text",
          "hover:bg-muted/40",
          "active:scale-[0.98]",
        ],
        outline: [
          "bg-transparent",
          "text-foreground",
          "su-ai-border",
          "hover:bg-muted/30",
          "active:scale-[0.98]",
        ],
      },
      size: {
        xs: "h-7 px-3 text-[10px] gap-1.5",
        sm: "h-8 px-4 text-xs gap-1.5",
        md: "h-10 px-5 text-sm gap-2",
        lg: "h-12 px-6 text-base gap-2.5",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type AIButtonVariant = NonNullable<
  VariantProps<typeof aiButtonVariants>["variant"]
>;
export type AIButtonSize = NonNullable<
  VariantProps<typeof aiButtonVariants>["size"]
>;

export interface AIButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: React.ReactNode;
  loading?: boolean;
  variant?: AIButtonVariant;
  size?: AIButtonSize;
  /** Optional icon before the label. Hidden while loading. */
  leftIcon?: LucideIcon;
  /** Optional icon after the label. Hidden while loading. */
  rightIcon?: LucideIcon;
  /** Muted helper line rendered below the button. */
  helperText?: string;
}

const iconSizeMap: Record<AIButtonSize, string> = {
  xs: "h-3 w-3",
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-4 w-4",
};

export const AIButton = React.forwardRef<HTMLButtonElement, AIButtonProps>(
  (
    {
      children,
      loading = false,
      disabled = false,
      variant = "primary",
      size = "md",
      leftIcon: LeftIcon,
      rightIcon: RightIcon,
      helperText,
      className,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const isPrimary = variant === "primary";
    const iconClass = iconSizeMap[size];

    // Gradient text applies to non-primary variants (subtle, secondary, outline).
    const useGradientIconColor = !isPrimary;
    const useGradientText = !isPrimary;

    return (
      <div className={cn("inline-flex flex-col gap-1.5", className)}>
        <button
          ref={ref}
          type={type}
          disabled={disabled || loading}
          {...props}
          aria-busy={loading || undefined}
          className={cn(
            aiButtonVariants({ variant, size }),
            // Animated gradient while loading for primary/secondary
            loading && isPrimary && "su-ai-gradient-animate",
          )}
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className={cn(iconClass, "animate-spin")} />
              <span>{children}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              {LeftIcon ? (
                <LeftIcon
                  className={cn(
                    iconClass,
                    useGradientIconColor && "su-ai-gradient-text",
                  )}
                />
              ) : (
                <Sparkles
                  className={cn(
                    iconClass,
                    useGradientIconColor && "su-ai-gradient-text",
                  )}
                />
              )}
              <span
                className={cn(
                  useGradientText && variant === "subtle" && "su-ai-gradient-text",
                )}
              >
                {children}
              </span>
              {RightIcon && (
                <RightIcon
                  className={cn(
                    iconClass,
                    useGradientIconColor && "su-ai-gradient-text",
                  )}
                />
              )}
            </span>
          )}
        </button>
        {helperText && (
          <p className="px-1 text-[11px] text-muted-foreground opacity-80 italic">
            {helperText}
          </p>
        )}
      </div>
    );
  },
);
AIButton.displayName = "AIButton";

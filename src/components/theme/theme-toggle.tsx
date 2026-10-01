"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ThemeToggleProps {
  /**
   * Color scheme context. "default" uses muted-foreground on background
   * (header/main). "sidebar" uses sidebar-foreground/55 on the dark rail.
   */
  variant?: "default" | "sidebar";
}

export function ThemeToggle({ variant = "default" }: ThemeToggleProps) {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const baseClass =
    variant === "sidebar"
      ? "rounded-md text-text-muted hover:bg-surface-muted hover:text-foreground"
      : "rounded-full border border-border/70 bg-card text-text-muted hover:bg-surface-muted hover:text-foreground";

  if (!mounted) {
    return (
      <button
        type="button"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md",
          baseClass,
        )}
        aria-label="Cambiar tema"
      >
        <span className="h-4 w-4" />
      </button>
    );
  }

  const isLight = theme === "light";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => setTheme(isLight ? "dark" : "light")}
            className={cn(
              "group flex h-8 w-8 items-center justify-center rounded-md transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
              baseClass,
            )}
            aria-label="Cambiar tema"
          >
            {isLight ? (
              <Moon className="h-4 w-4 transition-transform duration-300 group-hover:rotate-[-15deg]" />
            ) : (
              <Sun className="h-4 w-4 transition-transform duration-300 group-hover:rotate-45" />
            )}
          </button>
        }
      />
      <TooltipContent side={variant === "sidebar" ? "right" : "bottom"}>
        {isLight ? "Cambiar a tema oscuro" : "Cambiar a tema claro"}
      </TooltipContent>
    </Tooltip>
  );
}

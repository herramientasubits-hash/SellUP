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
      ? "text-sidebar-foreground/55 hover:bg-white/[0.06] hover:text-sidebar-foreground"
      : "text-muted-foreground/60 hover:bg-accent hover:text-foreground";

  if (!mounted) {
    return (
      <button
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-xl",
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
            onClick={() => setTheme(isLight ? "dark" : "light")}
            className={cn(
              "group flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              baseClass,
            )}
            aria-label="Cambiar tema"
          >
            {isLight ? (
              <Moon className="h-[15px] w-[15px] transition-transform duration-300 group-hover:rotate-[-15deg]" />
            ) : (
              <Sun className="h-[15px] w-[15px] transition-transform duration-300 group-hover:rotate-45" />
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

"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        className="flex h-8 w-8 items-center justify-center rounded-xl"
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
            className="group flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground/60 transition-all duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
      <TooltipContent side="bottom">
        {isLight ? "Cambiar a tema oscuro" : "Cambiar a tema claro"}
      </TooltipContent>
    </Tooltip>
  );
}

"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button className="flex h-8 w-8 items-center justify-center rounded-xl">
        <span className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      className="group flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground/60 transition-all duration-200 hover:bg-accent hover:text-foreground"
      aria-label="Cambiar tema"
    >
      {theme === "light" ? (
        <Moon className="h-[15px] w-[15px] transition-transform duration-300 group-hover:rotate-[-15deg]" />
      ) : (
        <Sun className="h-[15px] w-[15px] transition-transform duration-300 group-hover:rotate-45" />
      )}
    </button>
  );
}

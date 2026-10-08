"use client";

import { ThemeProvider } from "@/components/theme/theme-provider";
import { EllipsisTooltip } from "@/components/ui/ellipsis-tooltip";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider>
        {children}
        <EllipsisTooltip />
      </TooltipProvider>
    </ThemeProvider>
  );
}

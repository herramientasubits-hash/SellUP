"use client";

import * as React from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import type { DataTableDensity } from "./data-table";

interface DataTableDensityToggleProps {
  value: DataTableDensity;
  onChange: (next: DataTableDensity) => void;
  className?: string;
}

/**
 * Compact density toggle. Switches between "comfortable" and "compact"
 * row height. Renders as a single icon button.
 */
export function DataTableDensityToggle({
  value,
  onChange,
  className,
}: DataTableDensityToggleProps) {
  const isCompact = value === "compact";
  return (
    <TooltipIconButton
      variant="outline"
      icon={
        isCompact ? (
          <Maximize2 className="h-3.5 w-3.5" />
        ) : (
          <Minimize2 className="h-3.5 w-3.5" />
        )
      }
      label={isCompact ? "Vista amplia" : "Vista compacta"}
      onClick={() => onChange(isCompact ? "comfortable" : "compact")}
      className={className}
    />
  );
}

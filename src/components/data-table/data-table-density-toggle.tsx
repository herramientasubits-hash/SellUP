"use client";

import * as React from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
    <Button
      variant="outline"
      size="icon-sm"
      className={className}
      onClick={() => onChange(isCompact ? "comfortable" : "compact")}
      title={isCompact ? "Vista amplia" : "Vista compacta"}
      aria-label={isCompact ? "Cambiar a vista amplia" : "Cambiar a vista compacta"}
    >
      {isCompact ? (
        <Maximize2 className="h-3.5 w-3.5" />
      ) : (
        <Minimize2 className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

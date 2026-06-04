"use client";

import * as React from "react";
import { Rows3, Rows4 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type DataTableDensity } from "./data-table";

interface DataTableDensityToggleProps {
  density: DataTableDensity;
  onChange?: (density: DataTableDensity) => void;
}

/**
 * Two-state density toggle (compact / comfortable).
 * Stateless — the parent owns the density state. If `onChange` is not
 * provided, the toggle just shows the current state.
 */
export function DataTableDensityToggle({ density, onChange }: DataTableDensityToggleProps) {
  const next: DataTableDensity = density === "comfortable" ? "compact" : "comfortable";
  const Icon = density === "comfortable" ? Rows4 : Rows3;
  const label = density === "comfortable" ? "Cómoda" : "Compacta";

  return (
    <Button
      variant="outline"
      size="icon-sm"
      onClick={() => onChange?.(next)}
      aria-label={`Densidad: ${label}. Click para cambiar a ${next === "comfortable" ? "cómoda" : "compacta"}.`}
      title={`Densidad ${label} — click para ${next === "comfortable" ? "expandir" : "compactar"} filas`}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}

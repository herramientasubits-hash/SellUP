"use client";

import * as React from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface DataTableLoadMoreProps {
  /** Total rows available in the underlying dataset. */
  totalRows: number;
  /** How many rows are currently rendered. */
  shownRows: number;
  /** Increment per click. */
  step: number;
  /** Callback invoked when the user clicks "Cargar más". */
  onLoadMore: () => void;
  /** Show a pending state. */
  loading?: boolean;
  className?: string;
}

/**
 * Lazy-load footer for the data table. Replaces the standard pagination bar
 * when the user has switched the table to "Carga perezosa (Lazy)" mode.
 *
 * Shows a running counter ("Mostrando X de Y") and a "Cargar más" button that
 * reveals `step` additional rows per click until the full dataset is visible.
 */
export function DataTableLoadMore({
  totalRows,
  shownRows,
  step,
  onLoadMore,
  loading = false,
  className,
}: DataTableLoadMoreProps) {
  const remaining = Math.max(totalRows - shownRows, 0);
  const canLoadMore = remaining > 0;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs text-muted-foreground border-t border-border/40",
        className,
      )}
    >
      <p className="tabular-nums">
        Mostrando {shownRows} de {totalRows} resultados
        {canLoadMore ? ` · ${remaining} más disponibles` : ""}
      </p>

      <Button
        variant="outline"
        size="sm"
        className="h-7 px-3 text-xs font-medium rounded-full"
        onClick={onLoadMore}
        disabled={!canLoadMore || loading}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        Cargar {Math.min(step, remaining)} más
      </Button>
    </div>
  );
}

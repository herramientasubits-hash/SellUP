"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DataTableLoadMoreProps {
  /** Total rows available in the underlying dataset. */
  totalRows: number;
  /** How many rows are currently rendered. */
  shownRows: number;
  /** Callback invoked when the sentinel scrolls into view. */
  onLoadMore: () => void;
  /** Pending state. */
  loading?: boolean;
  className?: string;
}

/**
 * Lazy-load footer for the data table. Renders a status line plus a hidden
 * sentinel `<div>` that the parent uses as the scroll target.
 *
 * Watches the sentinel with an IntersectionObserver; every time it scrolls
 * into view, the parent is told to reveal more rows automatically — no button
 * click required. When the full dataset is visible, the sentinel is removed.
 */
export function DataTableLoadMore({
  totalRows,
  shownRows,
  onLoadMore,
  loading = false,
  className,
}: DataTableLoadMoreProps) {
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const remaining = Math.max(totalRows - shownRows, 0);
  const canLoadMore = remaining > 0;

  React.useEffect(() => {
    if (!canLoadMore) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          onLoadMore();
        }
      },
      { rootMargin: "120px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadMore, onLoadMore]);

  return (
    <div
      className={cn(
        "shrink-0 flex flex-wrap items-center justify-center gap-3 px-5 py-3 text-xs text-muted-foreground border-t border-border/40",
        className,
      )}
    >
      {canLoadMore ? (
        <>
          <Loader2
            className={cn(
              "h-3 w-3",
              loading ? "animate-spin" : "opacity-0",
            )}
          />
          <p className="tabular-nums">
            Mostrando {shownRows} de {totalRows} · {remaining} más disponibles
          </p>
        </>
      ) : (
        <p className="tabular-nums">Mostrando {shownRows} de {totalRows} resultados</p>
      )}

      {canLoadMore && (
        <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
      )}
    </div>
  );
}

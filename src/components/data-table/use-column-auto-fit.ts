"use client";

import * as React from "react";
import type { Table } from "@tanstack/react-table";

import { sameOffsets } from "./data-table-utils";

/** Cuánto puede estrecharse una columna ancha, como mucho, para evitar el scroll lateral. */
const MAX_SHRINK_RATIO = 0.15;
/** A partir de qué ancho una columna tiene margen para ceder. */
const MIN_SHRINKABLE_SIZE = 160;

/**
 * Reparte el ancho sobrante entre las columnas visibles y mide dónde se queda
 * cada columna fijada.
 *
 * @param stickyIds Las columnas que se quedan quietas a la izquierda, en orden.
 * @param layoutDeps Lo que, al cambiar, obliga a volver a medir (visibilidad,
 *   orden, vista).
 * @returns A cuántos píxeles del borde izquierdo se queda cada columna fijada.
 */
export function useColumnAutoFit<TData>(
  tableWrapperRef: React.RefObject<HTMLDivElement | null>,
  table: Table<TData>,
  stickyIds: readonly string[],
  layoutDeps: React.DependencyList,
): Record<string, number> {
  const [stickyOffsets, setStickyOffsets] = React.useState<Record<string, number>>({});

  // ── Auto-fit columns to wrapper width ──────────────────────────────────
  // `table-layout: fixed` + explicit pixel widths leaves the extra space as
  // a blank gap on the right when the sum of visible column `size` values is
  // less than the wrapper. This effect distributes that extra space
  // proportionally across visible columns so the table always fills its
  // container, and re-runs when the wrapper resizes or columns toggle.
  //
  // De paso mide dónde se queda cada columna fijada: la suma de lo que miden
  // las que van antes, para que se apilen en vez de taparse.
  //
  // We defer the first measurement with `requestAnimationFrame` because the
  // wrapper sits inside a flex column that may not have laid out yet when
  // useLayoutEffect runs synchronously, so `clientWidth` would be 0/wrong.
  const stickyKey = stickyIds.join("|");
  React.useLayoutEffect(() => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) return;

    const apply = () => {
      const visible = table.getVisibleLeafColumns();
      if (visible.length === 0) return;

      // Use the rendered wrapper width (excluding scrollbar).
      const wrapperWidth = wrapper.clientWidth;

      // Sum the requested widths; fall back to 150 per missing value.
      const sizes = visible.map((c) => {
        const s = c.columnDef.size;
        return typeof s === "number" && s > 0 ? s : 150;
      });
      const totalRequested = sizes.reduce((a, b) => a + b, 0);
      const extra = Math.max(0, wrapperWidth - totalRequested);

      // Si faltan unos pocos píxeles, antes de obligar a desplazar de lado las
      // columnas anchas ceden un poco: nunca por debajo de su `minSize` ni más
      // de un 15 % de su ancho. Las estrechas no ceden: su etiqueta y su
      // embudo ya van justos.
      const slack = visible.map((c, i) => {
        if (sizes[i] < MIN_SHRINKABLE_SIZE) return 0;
        const min = c.columnDef.minSize;
        const room = typeof min === "number" && min > 0 && min < sizes[i] ? sizes[i] - min : 0;
        return Math.min(room, sizes[i] * MAX_SHRINK_RATIO);
      });
      const totalSlack = slack.reduce((a, b) => a + b, 0);
      const deficit = wrapperWidth > 0 ? Math.max(0, totalRequested - wrapperWidth) : 0;
      const shrink = totalSlack > 0 ? Math.min(1, deficit / totalSlack) : 0;

      const sticky = stickyKey ? stickyKey.split("|") : [];
      const offsets: Record<string, number> = {};
      let left = 0;

      visible.forEach((col, i) => {
        const proportion = sizes[i] / totalRequested;
        const width = sizes[i] + extra * proportion - slack[i] * shrink;
        if (wrapperWidth > 0) {
          const th = wrapper.querySelector<HTMLElement>(`[data-column-id="${col.id}"]`);
          if (th) th.style.width = `${width}px`;
        }
        if (sticky.includes(col.id)) {
          offsets[col.id] = left;
          left += width;
        }
      });

      setStickyOffsets((current) => (sameOffsets(current, offsets) ? current : offsets));
    };

    const rafId = requestAnimationFrame(apply);
    const ro = new ResizeObserver(apply);
    ro.observe(wrapper);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, tableWrapperRef, stickyKey, ...layoutDeps]);

  return stickyOffsets;
}

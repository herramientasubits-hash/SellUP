"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const COUNT_FORMAT = new Intl.NumberFormat("es-CO");

/** Cuántas filas fantasma como mucho: las justas para decir «sigue». */
const MAX_GHOST_ROWS = 3;

/**
 * El primer antepasado que de verdad hace scroll vertical, o `null` para la
 * ventana. Hay que dárselo al observador como raíz: con la raíz en la ventana,
 * un centinela recortado por la caja de la tabla nunca «entra» y la carga se
 * queda quieta (o, al revés, entra siempre y lo carga todo de un tirón).
 */
function findScroller(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement;
  while (parent) {
    const { overflowY } = getComputedStyle(parent);
    if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

/** Observa un nodo y avisa cuando entra en la caja que hace scroll. */
function useLoadMoreSentinel(onLoadMore: () => void) {
  const callbackRef = React.useRef(onLoadMore);
  React.useEffect(() => {
    callbackRef.current = onLoadMore;
  }, [onLoadMore]);

  return React.useCallback((node: HTMLElement | null) => {
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callbackRef.current();
      },
      // Un margen por delante: el siguiente tramo ya está puesto cuando el
      // centinela llega al borde.
      { root: findScroller(node), rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
}

const LOAD_MORE_BUTTON =
  "sr-only focus:not-sr-only focus:block focus:w-full focus:py-3 focus:text-center focus:text-xs focus:font-semibold focus:text-primary";

interface DataTableLazySentinelProps {
  /** Cuántas filas hay ya puestas: al crecer, el centinela se vuelve a montar. */
  shownRows: number;
  /** Cuántas quedan por cargar. */
  remaining: number;
  colSpan: number;
  noun: string;
  onLoadMore: () => void;
}

/**
 * El final de una tabla que carga al bajar (Thema · `LazyRowsSentinel`): unas
 * filas fantasma que anuncian lo que viene y que, al asomar, piden el
 * siguiente tramo. Va como últimas filas del `<tbody>`, dentro de la caja que
 * hace scroll. Con teclado, «Cargar más» hace lo mismo.
 */
export function DataTableLazySentinel({
  shownRows,
  remaining,
  colSpan,
  noun,
  onLoadMore,
}: DataTableLazySentinelProps) {
  const attach = useLoadMoreSentinel(onLoadMore);
  if (remaining <= 0) return null;

  const ghosts = Math.min(remaining, MAX_GHOST_ROWS);

  return (
    <>
      {Array.from({ length: ghosts }, (_, row) => (
        <tr
          // La `key` con el tramo cargado monta filas nuevas cada vez que
          // crece: el observador se rehace y vuelve a preguntar aunque el
          // centinela siguiera a la vista.
          key={`${shownRows}:${row}`}
          aria-hidden
          data-slot="lazy-ghost-row"
          ref={row === 0 ? (attach as React.RefCallback<HTMLTableRowElement>) : undefined}
        >
          <td colSpan={colSpan}>
            <Skeleton className={cn("h-3.5", row % 2 === 0 ? "w-2/3" : "w-1/2")} />
          </td>
        </tr>
      ))}
      <tr>
        <td colSpan={colSpan} className="p-0">
          <button type="button" onClick={onLoadMore} className={LOAD_MORE_BUTTON}>
            Cargar más {noun}
          </button>
        </td>
      </tr>
    </>
  );
}

/** El mismo centinela para la vista de lista, donde no hay `<tbody>`. */
export function DataTableLazyListSentinel({
  remaining,
  noun,
  onLoadMore,
}: Omit<DataTableLazySentinelProps, "colSpan" | "shownRows">) {
  const attach = useLoadMoreSentinel(onLoadMore);
  if (remaining <= 0) return null;

  return (
    <div ref={attach as React.RefCallback<HTMLDivElement>} className="flex flex-col gap-2">
      <Skeleton aria-hidden className="h-14 w-full rounded-xl" />
      <button type="button" onClick={onLoadMore} className={LOAD_MORE_BUTTON}>
        Cargar más {noun}
      </button>
    </div>
  );
}

interface DataTableLoadMoreProps {
  /** Filas que cumplen la búsqueda y los filtros. */
  totalRows: number;
  /** Cuántas hay cargadas a la vista. */
  shownRows: number;
  /** Sustantivo en plural: «empresas», «contactos». */
  noun?: string;
  className?: string;
}

/**
 * El pie de una tabla en scroll infinito (Thema · `LazyRowsSummary`): el
 * recuento «Mostrando n de N <sustantivo>» en lugar del paginador.
 */
export function DataTableLoadMore({
  totalRows,
  shownRows,
  noun = "resultados",
  className,
}: DataTableLoadMoreProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground sm:px-5",
        className,
      )}
    >
      <p className="tabular-nums" aria-live="polite">
        {totalRows === 0
          ? `0 ${noun}`
          : `Mostrando ${COUNT_FORMAT.format(shownRows)} de ${COUNT_FORMAT.format(totalRows)} ${noun}`}
      </p>
    </div>
  );
}

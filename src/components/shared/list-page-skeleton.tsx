import type { ReactNode } from "react";

import { DataTablePage } from "@/components/shared/data-table-page";
import { Skeleton } from "@/components/ui/skeleton";

interface ListPageSkeletonProps {
  title: string;
  description?: string;
  /** Las pestañas reales del módulo: la activa responde al instante. */
  tabs?: ReactNode;
  /** Qué se está cargando, para el lector de pantalla: «empresas». */
  noun: string;
  /** Cuántas columnas y filas fantasma pintar. */
  columns?: number;
  rows?: number;
  /** Cierto para pintar además la franja de indicadores (pantallas estrechas). */
  withIndicators?: boolean;
  /**
   * Reserva abajo el hueco de la barra flotante de acciones, igual que
   * `ListActionRailProvider`: sin él, la tabla daría un salto al llegar los
   * datos. Falso en las pantallas que no tienen barra.
   */
  reserveActionRail?: boolean;
}

/** Anchos alternos para que las barras no parezcan una reja. */
const BAR_WIDTHS = ["w-4/5", "w-3/5", "w-2/3", "w-1/2", "w-3/4"] as const;

/**
 * ListPageSkeleton — el estado de carga de una pantalla de lista, con la forma
 * de lo que va a llegar: la banda de cabecera (título y pestañas reales), la
 * franja de indicadores y una tabla fantasma con su barra, su cabecera y sus
 * filas. Así nada salta cuando llegan los datos.
 *
 * Es el `fallback` del `<Suspense>` que envuelve el panel de servidor de la
 * pantalla.
 */
export function ListPageSkeleton({
  title,
  description,
  tabs,
  noun,
  columns = 6,
  rows = 8,
  withIndicators = false,
  reserveActionRail = true,
}: ListPageSkeletonProps) {
  const columnIndexes = Array.from({ length: columns }, (_, index) => index);

  const page = (
    <DataTablePage compact title={title} description={description} tabs={tabs}>
      <div
        role="status"
        aria-busy="true"
        aria-label={`Cargando ${noun}`}
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        {withIndicators && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border/60 bg-card py-2.5 pl-5 pr-3.5 shadow-card">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="mr-auto flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-8 w-32" />
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
            <Skeleton className="h-5 w-44" />
            <div className="flex items-center gap-1.5">
              {/* En pantalla ancha los indicadores viven aquí, en la barra. */}
              <Skeleton className="hidden h-8 w-28 xl:block" />
              <Skeleton className="hidden h-8 w-32 xl:block" />
              <Skeleton className="hidden h-8 w-28 xl:block" />
              <Skeleton className="size-8" />
              <Skeleton className="size-8" />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-4 border-b border-border/60 bg-surface-subtle px-4 py-3.5 sm:px-5">
            <Skeleton className="size-4 shrink-0" />
            {columnIndexes.map((column) => (
              <Skeleton key={column} className="h-3 flex-1" />
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {Array.from({ length: rows }, (_, row) => (
              <div
                key={row}
                data-slot="skeleton-row"
                className="flex items-center gap-4 border-b border-border/40 px-4 py-4 last:border-b-0 sm:px-5"
              >
                <Skeleton className="size-4 shrink-0" />
                {columnIndexes.map((column) => (
                  <div key={column} className="flex-1">
                    <Skeleton className={`h-3.5 ${BAR_WIDTHS[(row + column) % BAR_WIDTHS.length]}`} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </DataTablePage>
  );

  return reserveActionRail ? <div className="flex min-h-0 flex-1 flex-col pb-20">{page}</div> : page;
}

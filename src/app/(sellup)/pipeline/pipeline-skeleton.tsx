import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard } from "@/components/shared/surface-card";
import type { PipelineView } from "./pipeline-copy";
import { PipelineFrame } from "./pipeline-frame";

const STAGE_COUNT = 8;
const LIST_ROWS = 7;
const CARD_ROWS = 3;

/** El recorrido mientras llega: cabecera, pista de etapas y tarjetas. */
export function PipelineJourneySkeleton() {
  return (
    <div role="status" aria-label="Cargando el recorrido de la empresa" aria-busy="true" className="flex min-w-0 flex-col gap-3">
      <SurfaceCard className="flex flex-col gap-3 p-5">
        <Skeleton className="h-6 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-5 w-40" />
      </SurfaceCard>
      <SurfaceCard className="flex gap-3 overflow-hidden p-5">
        {Array.from({ length: STAGE_COUNT }, (_, index) => (
          <div key={index} className="flex flex-1 flex-col gap-2">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-3 w-16 max-w-full" />
          </div>
        ))}
      </SurfaceCard>
      {Array.from({ length: CARD_ROWS }, (_, index) => (
        <SurfaceCard key={index} className="flex flex-col gap-3 p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </SurfaceCard>
      ))}
    </div>
  );
}

/** Las 8 columnas del tablero: llenas las que admiten mover, estrechas las demás (como el tablero). */
const BOARD_SKELETON_COLUMNS: readonly boolean[] = [false, true, true, true, false, false, false, false];

/** El tablero mientras llega: sus 8 etapas, con tarjetas fantasma en las que admiten mover. */
function BoardSkeleton() {
  return (
    <div role="status" aria-label="Cargando el tablero" aria-busy="true" className="flex min-w-0 gap-4 overflow-hidden">
      {BOARD_SKELETON_COLUMNS.map((isFull, index) =>
        isFull ? (
          <div key={index} className="flex w-72 shrink-0 flex-col gap-2 rounded-2xl border border-border/60 bg-surface-subtle p-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <div key={index} className="flex w-42 shrink-0 flex-col gap-2 rounded-2xl border border-dashed border-border/60 p-2">
            <Skeleton className="h-5 w-24" />
          </div>
        ),
      )}
    </div>
  );
}

interface PipelineSkeletonProps {
  view: PipelineView;
  accountId: string | null;
}

/** La pantalla entera mientras llega: cabecera real, lista a la izquierda y recorrido a la derecha. */
export function PipelineSkeleton({ view, accountId }: PipelineSkeletonProps) {
  return (
    <PipelineFrame view={view} accountId={accountId}>
      {view === "tablero" ? (
        <BoardSkeleton />
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[21.25rem_minmax(0,1fr)] lg:items-start">
          <div aria-hidden className="flex min-h-0 flex-col gap-2 overflow-hidden lg:sticky lg:top-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-8 w-40" />
            {Array.from({ length: LIST_ROWS }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full shrink-0" />
            ))}
          </div>
          <div className="hidden min-h-0 lg:block">
            <PipelineJourneySkeleton />
          </div>
        </div>
      )}
    </PipelineFrame>
  );
}

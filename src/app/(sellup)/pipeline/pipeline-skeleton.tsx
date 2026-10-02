import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard } from "@/components/shared/surface-card";

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

/** La pantalla entera mientras llega: lista a la izquierda, recorrido a la derecha. */
export function PipelineSkeleton() {
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[21.25rem_minmax(0,1fr)] lg:items-start">
      <div aria-hidden className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: LIST_ROWS }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
      <div className="hidden lg:block">
        <PipelineJourneySkeleton />
      </div>
    </div>
  );
}

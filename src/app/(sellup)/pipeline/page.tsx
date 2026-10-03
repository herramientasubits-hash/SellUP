import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isNextControlFlowSignal } from "@/modules/contact-enrichment/next-control-flow-signal";
import { parsePipelineFilters, type PipelineFilters } from "@/modules/pipeline/pipeline-filters";
import { getAccountJourney, getPipelineOverview } from "@/modules/pipeline/actions";
import { resolvePipelineView, type PipelineView } from "./pipeline-copy";
import { PipelineFrame } from "./pipeline-frame";
import { PipelineScreen } from "./pipeline-screen";
import { PipelineSkeleton } from "./pipeline-skeleton";

interface PipelinePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Carga el resumen y, si hay empresa elegida, su recorrido, en paralelo. */
async function PipelineData({
  view,
  accountId,
  filters,
}: {
  view: PipelineView;
  accountId: string | null;
  filters: PipelineFilters;
}) {
  const [overview, journey] = await Promise.allSettled([
    getPipelineOverview(),
    accountId ? getAccountJourney(accountId) : Promise.resolve(null),
  ]);

  // `redirect()` (sesión caducada) señaliza LANZANDO: no es un fallo de carga y debe seguir su camino.
  for (const result of [overview, journey]) {
    if (result.status === "rejected" && isNextControlFlowSignal(result.reason)) throw result.reason;
  }

  if (overview.status === "rejected") {
    return (
      <PipelineFrame view={view} accountId={accountId}>
        <Alert variant="destructive">
          <AlertTitle>No se pudo cargar el pipeline</AlertTitle>
          <AlertDescription>Vuelve a intentarlo en un momento. Si sigue fallando, avisa al equipo.</AlertDescription>
        </Alert>
      </PipelineFrame>
    );
  }

  return (
    <PipelineScreen
      overview={overview.value}
      view={view}
      selectedAccountId={journey.status === "rejected" ? null : accountId}
      journey={journey.status === "fulfilled" ? journey.value : null}
      journeyError={journey.status === "rejected"}
      initialFilters={filters}
    />
  );
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const params = await searchParams;
  const view = resolvePipelineView(first(params.view));
  const accountId = view === "recorrido" ? first(params.account)?.trim() || null : null;

  // Mientras llegan los datos se ve la pantalla con su forma (cabecera real, lista y recorrido
  // fantasma). La `key` hace que el esqueleto vuelva a salir al cambiar de vista.
  return (
    <Suspense key={view} fallback={<PipelineSkeleton view={view} accountId={accountId} />}>
      <PipelineData view={view} accountId={accountId} filters={parsePipelineFilters(params)} />
    </Suspense>
  );
}

import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isNextControlFlowSignal } from "@/modules/contact-enrichment/next-control-flow-signal";
import { getAccountJourney, getPipelineOverview } from "@/modules/pipeline/actions";
import { PIPELINE_DESCRIPTION, PIPELINE_TITLE, resolvePipelineView, type PipelineView } from "./pipeline-copy";
import { PipelineScreen } from "./pipeline-screen";
import { PipelineSkeleton } from "./pipeline-skeleton";

interface PipelinePageProps {
  searchParams: Promise<{ view?: string | string[]; account?: string | string[] }>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Carga el resumen y, si hay empresa elegida, su recorrido, en paralelo. */
async function PipelineData({ view, accountId }: { view: PipelineView; accountId: string | null }) {
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
      <Alert variant="destructive">
        <AlertTitle>No se pudo cargar el pipeline</AlertTitle>
        <AlertDescription>Vuelve a intentarlo en un momento. Si sigue fallando, avisa al equipo.</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      {journey.status === "rejected" && (
        <Alert variant="destructive">
          <AlertTitle>No se pudo cargar el recorrido de esa empresa</AlertTitle>
          <AlertDescription>La lista sigue disponible; vuelve a elegir la empresa en un momento.</AlertDescription>
        </Alert>
      )}
      <PipelineScreen
        overview={overview.value}
        view={view}
        selectedAccountId={journey.status === "rejected" ? null : accountId}
        journey={journey.status === "fulfilled" ? journey.value : null}
      />
    </>
  );
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const params = await searchParams;
  const view = resolvePipelineView(first(params.view));
  const accountId = view === "recorrido" ? first(params.account)?.trim() || null : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        className="pb-0"
        title={PIPELINE_TITLE}
        description={PIPELINE_DESCRIPTION}
        breadcrumbs={<Breadcrumbs items={["Pipeline"]} />}
      />
      <Suspense fallback={<PipelineSkeleton />}>
        <PipelineData view={view} accountId={accountId} />
      </Suspense>
    </div>
  );
}

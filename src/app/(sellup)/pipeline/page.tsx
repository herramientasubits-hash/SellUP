import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isNextControlFlowSignal } from "@/modules/contact-enrichment/next-control-flow-signal";
import { parsePipelineFilters, type PipelineFilters } from "@/modules/pipeline/pipeline-filters";
import { getAccountJourney, getPipelineOverview } from "@/modules/pipeline/actions";
import { isAgent3FirstCallEnabled } from "@/lib/feature-flags.server";
import { getContactsByAccount } from "@/modules/contacts/actions";
import { getFirstCallState } from "@/modules/speech/actions";
import { buildFirstCallEvents } from "@/modules/speech/first-call-activity";
import { toFirstCallContactOptions } from "@/modules/speech/first-call-contacts";
import { applyFirstCallToJourney, toJourneyFirstCall } from "@/modules/pipeline/journey-first-call";
import type { AccountJourney } from "@/modules/pipeline/types";
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
/**
 * Con el Agente 3 encendido, suma al recorrido lo que investigó y preparó. Es
 * complementario: si no se puede leer, el recorrido sigue sin él (nunca se cae).
 */
async function withFirstCall(journey: AccountJourney | null): Promise<AccountJourney | null> {
  if (!journey || !isAgent3FirstCallEnabled()) return journey;
  try {
    const [state, contacts] = await Promise.all([
      getFirstCallState(journey.account.id),
      getContactsByAccount(journey.account.id),
    ]);
    return applyFirstCallToJourney(
      journey,
      toJourneyFirstCall(state, toFirstCallContactOptions(contacts), Date.now()),
      buildFirstCallEvents(state.brief, state.packs),
    );
  } catch (error) {
    if (isNextControlFlowSignal(error)) throw error;
    return journey;
  }
}

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

  const journeyWithAgent = journey.status === "fulfilled" ? await withFirstCall(journey.value) : null;

  return (
    <PipelineScreen
      overview={overview.value}
      view={view}
      selectedAccountId={journey.status === "rejected" ? null : accountId}
      journey={journeyWithAgent}
      firstCallEnabled={isAgent3FirstCallEnabled()}
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

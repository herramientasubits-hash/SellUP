"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListActionRailProvider } from "@/components/action-rail";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ContactEnrichmentDrawer } from "@/components/contact-enrichment/contact-enrichment-drawer";
import { countryName } from "@/components/shared/table-cells";
import { updateAccount } from "@/modules/accounts/actions";
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from "@/modules/accounts/types";
import type { PipelineFilters } from "@/modules/pipeline/pipeline-filters";
import type { AccountJourney, PipelineOverview } from "@/modules/pipeline/types";
import { usePipelineUrlFilters } from "./pipeline-filter-state";
import { pipelineHref, type PipelineView } from "./pipeline-copy";
import { PipelineFrame } from "./pipeline-frame";
import { PipelineBoard } from "./pipeline-board";
import { PipelineJourney, type ChangeStageResult } from "./pipeline-journey";
import { PipelineRailGap, PipelineScreenActions, usePipelineRailAtBottom } from "./pipeline-screen-actions";

interface PipelineScreenProps {
  overview: PipelineOverview;
  view: PipelineView;
  selectedAccountId: string | null;
  journey: AccountJourney | null;
  /** Aviso cuando el recorrido de la empresa elegida no se pudo cargar (la lista sigue disponible). */
  journeyError?: boolean;
  /** Los filtros que venían en la URL. */
  initialFilters: PipelineFilters;
}

/**
 * La pantalla Pipeline en el cliente: lleva la vista y la empresa elegida a la
 * URL (`?view=` y `?account=`), y conecta la ÚNICA escritura de la pantalla
 * —mover una empresa de etapa con `updateAccount`—, que siempre nace de una
 * confirmación de la persona.
 */
export function PipelineScreen({ overview, view, selectedAccountId, journey, journeyError = false, initialFilters }: PipelineScreenProps) {
  const router = useRouter();
  const [isNavigating, startNavigation] = React.useTransition();
  const [targetAccountId, setTargetAccountId] = React.useState<string | null>(null);
  const [enrichmentOpen, setEnrichmentOpen] = React.useState(false);
  const [filters, setFilters] = usePipelineUrlFilters(initialFilters);
  const [stageDetailOpen, setStageDetailOpen] = React.useState(false);

  const navigate = React.useCallback(
    (nextView: PipelineView, accountId: string | null) => {
      setTargetAccountId(accountId);
      startNavigation(() => {
        router.push(pipelineHref(nextView, accountId, filters), { scroll: false });
      });
    },
    [router, filters],
  );

  const changeStage = React.useCallback(
    async (accountId: string, status: PipelineStatus): Promise<ChangeStageResult> => {
      const result = await updateAccount(accountId, { pipeline_status: status });
      if (result.success) {
        toast.success(`Etapa cambiada a «${PIPELINE_STATUS_LABELS[status]}»`);
        router.refresh();
      }
      return result;
    },
    [router],
  );

  const openEnrichment = React.useCallback(() => setEnrichmentOpen(true), []);
  const viewAccount = React.useCallback((accountId: string) => router.push(`/accounts/${accountId}`), [router]);

  const pendingAccountId = isNavigating && targetAccountId !== selectedAccountId ? targetAccountId : null;

  // Las acciones son de la empresa elegida en el recorrido: sin ella (resumen, tablero) no hay barra.
  const actionJourney = view === "recorrido" && pendingAccountId === null ? journey : null;
  const railAtBottom = usePipelineRailAtBottom(actionJourney !== null);

  return (
    <ListActionRailProvider label="Acciones del pipeline" gender="f">
    <PipelineFrame
      view={view}
      accountId={selectedAccountId}
      accountName={journey?.account.name}
      onViewChange={(next) => navigate(next, next === "recorrido" ? selectedAccountId : null)}
      actions={
        <PipelineScreenActions
          journey={actionJourney}
          onChangeStage={changeStage}
          onSearchContacts={openEnrichment}
          onViewAccount={viewAccount}
          isBlocked={enrichmentOpen || stageDetailOpen}
        />
      }
    >
      {journeyError && (
        <Alert variant="destructive" className="mb-3">
          <AlertTitle>No se pudo cargar el recorrido de esa empresa</AlertTitle>
          <AlertDescription>La lista sigue disponible; vuelve a elegir la empresa en un momento.</AlertDescription>
        </Alert>
      )}

      {view === "tablero" ? (
        <PipelineBoard
          accounts={overview.accounts}
          onMoveAccount={changeStage}
          onOpenAccount={(accountId) => navigate("recorrido", accountId)}
          onMoveFailed={(message) => toast.error(message)}
          filters={filters}
          onFiltersChange={setFilters}
        />
      ) : (
        <PipelineJourney
          overview={overview}
          selectedAccountId={selectedAccountId}
          journey={journey}
          pendingAccountId={pendingAccountId}
          onSelectAccount={(accountId) => navigate("recorrido", accountId)}
          onSearchContacts={openEnrichment}
          railAtBottom={railAtBottom}
          onStageDetailOpenChange={setStageDetailOpen}
          filters={filters}
          onFiltersChange={setFilters}
        />
      )}

      <PipelineRailGap visible={railAtBottom} />

      {journey && (
        <ContactEnrichmentDrawer
          open={enrichmentOpen}
          onOpenChange={(open) => {
            setEnrichmentOpen(open);
            // Al cerrar, lo que el agente haya encontrado se refleja en la etapa.
            if (!open) router.refresh();
          }}
          preloadedCompany={{
            name: journey.account.name,
            domain: journey.account.domain,
            country: countryName(journey.account.countryCode),
            countryCode: journey.account.countryCode,
            sellupAccountId: journey.account.id,
            hubspotCompanyId: journey.account.hubspotCompanyId,
          }}
        />
      )}
    </PipelineFrame>
    </ListActionRailProvider>
  );
}

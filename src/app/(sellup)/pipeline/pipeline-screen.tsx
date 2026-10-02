"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ThemaTabs } from "@/components/navigation/thema-tabs";
import { ContactEnrichmentDrawer } from "@/components/contact-enrichment/contact-enrichment-drawer";
import { countryName } from "@/components/shared/table-cells";
import { updateAccount } from "@/modules/accounts/actions";
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from "@/modules/accounts/types";
import type { AccountJourney, PipelineOverview } from "@/modules/pipeline/types";
import { PIPELINE_VIEWS, pipelineHref, resolvePipelineView, type PipelineView } from "./pipeline-copy";
import { PipelineBoard } from "./pipeline-board";
import { PipelineJourney, type ChangeStageResult } from "./pipeline-journey";

interface PipelineScreenProps {
  overview: PipelineOverview;
  view: PipelineView;
  selectedAccountId: string | null;
  journey: AccountJourney | null;
}

/**
 * La pantalla Pipeline en el cliente: lleva la vista y la empresa elegida a la
 * URL (`?view=` y `?account=`), y conecta la ÚNICA escritura de la pantalla
 * —mover una empresa de etapa con `updateAccount`—, que siempre nace de una
 * confirmación de la persona.
 */
export function PipelineScreen({ overview, view, selectedAccountId, journey }: PipelineScreenProps) {
  const router = useRouter();
  const [isNavigating, startNavigation] = React.useTransition();
  const [targetAccountId, setTargetAccountId] = React.useState<string | null>(null);
  const [enrichmentOpen, setEnrichmentOpen] = React.useState(false);

  const navigate = React.useCallback(
    (nextView: PipelineView, accountId: string | null) => {
      setTargetAccountId(accountId);
      startNavigation(() => {
        router.push(pipelineHref(nextView, accountId), { scroll: false });
      });
    },
    [router],
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

  const pendingAccountId = isNavigating && targetAccountId !== selectedAccountId ? targetAccountId : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <ThemaTabs
        navigation
        fitContent
        listLabel="Vistas del pipeline"
        tabs={PIPELINE_VIEWS}
        activeTabId={view}
        onTabChange={(id) => navigate(resolvePipelineView(id), id === "recorrido" ? selectedAccountId : null)}
      />

      {view === "tablero" ? (
        <PipelineBoard
          accounts={overview.accounts}
          onMoveAccount={changeStage}
          onOpenAccount={(accountId) => navigate("recorrido", accountId)}
          onMoveFailed={(message) => toast.error(message)}
        />
      ) : (
        <PipelineJourney
          overview={overview}
          selectedAccountId={selectedAccountId}
          journey={journey}
          pendingAccountId={pendingAccountId}
          onSelectAccount={(accountId) => navigate("recorrido", accountId)}
          onChangeStage={changeStage}
          onSearchContacts={() => setEnrichmentOpen(true)}
        />
      )}

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
    </div>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListActionRailProvider } from "@/components/action-rail";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ContactEnrichmentDrawer } from "@/components/contact-enrichment/contact-enrichment-drawer";
import { countryName } from "@/components/shared/table-cells";
import { CreateContactDrawer } from "@/components/contacts/create-contact-drawer";
import { moveAccountStage } from "@/modules/pipeline/actions";
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from "@/modules/accounts/types";
import type { PipelineFilters } from "@/modules/pipeline/pipeline-filters";
import type { AccountJourney, PipelineOverview } from "@/modules/pipeline/types";
import { usePipelineUrlFilters } from "./pipeline-filter-state";
import { pipelineHref, type PipelineView } from "./pipeline-copy";
import { PipelineFrame } from "./pipeline-frame";
import { PipelineBoard } from "./pipeline-board";
import { PipelineJourney } from "./pipeline-journey";
import type { ChangeStageResult, StageMoveContext } from "./pipeline-stage-move";
import { PipelineRailGap, PipelineScreenActions, usePipelineRailAtBottom } from "./pipeline-screen-actions";

/** La empresa sobre la que se abre un panel lateral (agente o alta de contactos). */
interface PanelCompany {
  id: string;
  name: string;
  domain: string | null;
  countryCode: string | null;
  hubspotCompanyId: string | null;
}

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
 * —mover una empresa de etapa (`moveAccountStage`: estado + notas en una sola
 * `updateAccount`)—, que siempre nace del flujo «Mover de etapa» y nunca se
 * hace a ciegas.
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

  // La empresa sobre la que se abre el agente o el alta de contactos: la del recorrido o, desde el
  // tablero, la que se acaba de mover.
  const [panelCompany, setPanelCompany] = React.useState<PanelCompany | null>(null);
  const [contactsOpen, setContactsOpen] = React.useState(false);

  const companyFor = React.useCallback(
    (accountId: string): PanelCompany | null => {
      if (journey && journey.account.id === accountId) {
        return {
          id: journey.account.id,
          name: journey.account.name,
          domain: journey.account.domain,
          countryCode: journey.account.countryCode,
          hubspotCompanyId: journey.account.hubspotCompanyId,
        };
      }
      const account = overview.accounts.find((candidate) => candidate.id === accountId);
      return account
        ? { id: account.id, name: account.name, domain: account.domain, countryCode: account.countryCode, hubspotCompanyId: null }
        : null;
    },
    [journey, overview.accounts],
  );

  /**
   * Mueve de etapa con el contexto que eligió la persona (una sola escritura: estado + notas) y,
   * si eligió que lo haga la IA o subir los contactos, abre ese panel para esa empresa.
   */
  const changeStage = React.useCallback(
    async (accountId: string, status: PipelineStatus, context: StageMoveContext): Promise<ChangeStageResult> => {
      const note =
        context.kind === "paste"
          ? { kind: "paste" as const, text: context.text }
          : context.kind === "none"
            ? { kind: "none" as const, text: context.reason }
            : null;
      const result = await moveAccountStage(accountId, status, note);
      if (!result.success) {
        toast.error(result.error);
        return result;
      }
      toast.success(
        note
          ? `Etapa cambiada a «${PIPELINE_STATUS_LABELS[status]}». Guardamos el contexto en las notas.`
          : `Etapa cambiada a «${PIPELINE_STATUS_LABELS[status]}»`,
      );
      router.refresh();
      if (context.kind === "ai" || context.kind === "contacts") {
        setPanelCompany(companyFor(accountId));
        if (context.kind === "ai") setEnrichmentOpen(true);
        else setContactsOpen(true);
      }
      return result;
    },
    [router, companyFor],
  );

  const openEnrichment = React.useCallback(() => {
    setPanelCompany(null);
    setEnrichmentOpen(true);
  }, []);
  const enrichmentCompany: PanelCompany | null =
    panelCompany ??
    (journey
      ? {
          id: journey.account.id,
          name: journey.account.name,
          domain: journey.account.domain,
          countryCode: journey.account.countryCode,
          hubspotCompanyId: journey.account.hubspotCompanyId,
        }
      : null);
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
          isBlocked={enrichmentOpen || contactsOpen || stageDetailOpen}
          canUploadContacts
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
          archivedTotal={overview.archivedTotal}
          onMoveAccount={changeStage}
          onOpenAccount={(accountId) => navigate("recorrido", accountId)}
          canUseAi
          canUploadContacts
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

      {enrichmentCompany && (
        <ContactEnrichmentDrawer
          open={enrichmentOpen}
          onOpenChange={(open) => {
            setEnrichmentOpen(open);
            // Al cerrar, lo que el agente haya encontrado se refleja en la etapa.
            if (!open) {
              setPanelCompany(null);
              router.refresh();
            }
          }}
          preloadedCompany={{
            name: enrichmentCompany.name,
            domain: enrichmentCompany.domain,
            country: countryName(enrichmentCompany.countryCode),
            countryCode: enrichmentCompany.countryCode,
            sellupAccountId: enrichmentCompany.id,
            hubspotCompanyId: enrichmentCompany.hubspotCompanyId,
          }}
        />
      )}

      {/* «Ya lo hice por fuera → Subir los contactos»: el alta de contactos que ya existe, con la
          empresa puesta. No hay importación masiva de contactos: se suben de uno en uno. */}
      {panelCompany && (
        <CreateContactDrawer
          open={contactsOpen}
          onOpenChange={(open) => {
            setContactsOpen(open);
            if (!open) {
              setPanelCompany(null);
              router.refresh();
            }
          }}
          accountId={panelCompany.id}
          accountLabel={panelCompany.domain ? `${panelCompany.name} · ${panelCompany.domain}` : panelCompany.name}
          metadata={{ created_from: "pipeline_stage_move" }}
        />
      )}
    </PipelineFrame>
    </ListActionRailProvider>
  );
}

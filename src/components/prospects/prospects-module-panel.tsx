import { Upload } from "@/icons";
import { ListActionRailProvider } from "@/components/action-rail";
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { DataTablePage } from '@/components/shared/data-table-page';
import { Button } from '@/components/ui/button';
import { CreateCandidateDrawer } from '@/components/prospect-batches/create-candidate-drawer';
import { ImportCandidatesDrawer } from '@/components/prospect-batches/import-candidates-drawer';
import { GenerateAIBatchDrawer } from '@/components/prospect-batches/generate-ai-batch-drawer';
import {
  resolveGenerateProspectsExperience,
  resolveGenerateProspectsUnavailableKind,
} from '@/components/prospect-batches/generate-ai-batch-experience';
import { ProspectsDataTableClient } from '@/components/prospects/prospects-data-table-client';
import { ProspectsScreenActions } from '@/components/prospects/prospects-screen-actions';
import type { GenerateProspectsAgent } from '@/components/prospects/generate-prospects-agent';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { DiscardedProspectsPanel } from '@/components/prospects/discarded-prospects-panel';
import {
  EMPRESAS_TAB_DESCRIPTIONS,
  EMPRESAS_VIEW_TITLES,
  empresasViewCrumbs,
} from '@/components/prospects/empresas-module-copy';
import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';
import {
  getGlobalCandidatesList,
  requireActiveUser,
  getProspectBatchById,
} from '@/modules/prospect-batches/actions';
import {
  getCommercialScopeFilterOptions,
  resolveScopeOwnerFilter,
} from '@/modules/access/commercial-scope-filter-options';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';
import { resolveCatalogAvailability } from '@/modules/industry-catalog/catalog-availability';
import {
  isProspectChatWizardExecutionEnabled,
  isProspectChatWizardEnabled,
  isExploratorySearchFormV2Enabled,
  isLushaPreviewEnabled,
  isAgent1AutoProviderCascadeEnabled,
} from '@/lib/feature-flags.server';
// A1-APOLLO-WIZARD-1 — misma función que enruta la ejecución del wizard
// (`executeProspectWizardGeneration`, paso 5a). Resolver aquí, en el servidor, es
// lo que permite que la UI nombre el proveedor real sin deducirlo en el cliente.
import { resolveWizardDiscoveryProvider } from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-resolver';
// A1-APOLLO-QA-CONTROL-SURFACE-1 § 2/§ 5 — la capacidad de elegir proveedor por
// corrida y los topes que la superficie anuncia se resuelven AQUÍ, server-side.
// Al cliente sólo viajan dos booleanos, una lista de proveedores y cinco enteros:
// ni flags, ni sus valores, ni el rol del usuario.
import {
  resolveWizardProviderOverrideCapabilityForCurrentUser,
  resolveApolloRunModeLimitsForSurface,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability.server';
// AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 — lectura de sólo lectura del período
// de presupuesto vigente. No reserva y no puede autorizar nada: sólo permite que
// la pantalla avise antes de ofrecer un botón cuyo rechazo ya se conoce.
import { resolveWizardBudgetPreflightForSurface } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight.server';

/**
 * Query params understood by the Prospectos experience.
 *
 * These are the same params the legacy `/prospects` route accepted; they now
 * live under `/accounts?tab=prospectos&...`. `tab` is consumed by the Empresas
 * host page and is irrelevant here.
 */
export interface ProspectsPanelSearchParams {
  search?: string;
  country?: string;
  industry?: string;
  source?: string;
  status?: string;
  sourceId?: string;
  /** Scope refinement: filter by a specific user within the viewer's allowed set. */
  userId?: string;
  /** Scope refinement: filter by a specific group (and its descendants) within scope. */
  groupId?: string;
  /** Scope refinement: filter by role key. Applied client-side via ScopeFiltersClient. */
  roleKey?: string;
  /**
   * AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — sub-tab selector inside Prospectos
   * (issue #389). `'descartadas'` renders the discarded-dispositions panel
   * instead of the default "Por revisar" queue below. Any other value (or
   * absence) keeps the existing behaviour unchanged.
   */
  view?: string;
}

interface ProspectsModulePanelProps {
  params: ProspectsPanelSearchParams;
}

/**
 * Prospectos rendered as an internal tab of the "Empresas" module.
 *
 * Extracted verbatim from the former `/prospects` page so the data flow,
 * KPIs, filters, and Agente 1 deep links (`sourceId`) behave identically. Only
 * navigation targets changed: invalid `sourceId` now redirects to the
 * Prospectos tab inside Empresas instead of the standalone `/prospects` route.
 */
export async function ProspectsModulePanel({ params }: ProspectsModulePanelProps) {
  await requireActiveUser();

  // AGENT1-DISCARDED-PROSPECTS-REVIEW-1 (issue #389) — "Descartadas" is a
  // sibling sub-tab, not a variant of this queue. Branching here, before any
  // of the wizard/flag resolution below runs, keeps that panel independent
  // and guarantees zero change to the "Por revisar" behaviour that follows.
  if (params.view === 'descartadas') {
    // El agente de IA de la pestaña se resuelve en paralelo con sus datos; un
    // fallo ahí no tumba la lista (la pestaña sale sin agente).
    return <DiscardedProspectsPanel params={params} generateAgent={loadGenerateProspectsAgent()} />;
  }

  // El asistente «Generar con IA», con todo lo que el servidor resolvió para
  // él (flags, catálogo, proveedor, topes, presupuesto). Es la MISMA carga que
  // usan las otras dos pestañas del módulo para su agente de IA.
  const { generateDrawer, isGenerateAvailable } = await resolveGenerateProspectsAgent();

  const sourceId = params.sourceId ?? null;

  let sourceBatchType: string | null = null;
  if (sourceId) {
    const parsed = z.string().uuid().safeParse(sourceId);
    if (!parsed.success) {
      redirect(PROSPECTOS_TAB_ROUTE);
    }
    try {
      const sourceBatch = await getProspectBatchById(sourceId);
      if (!sourceBatch) {
        redirect(PROSPECTOS_TAB_ROUTE);
      }
      sourceBatchType = sourceBatch.source ?? null;
    } catch {
      redirect(PROSPECTOS_TAB_ROUTE);
    }
  }

  let statuses = ['needs_review', 'generated', 'normalized'];
  if (params.status) {
    if (params.status === 'pending') {
      statuses = ['needs_review', 'generated', 'normalized'];
    } else {
      statuses = [params.status];
    }
  }

  // Scope refinement: resolve ownerUserIds from userId/groupId URL params.
  // resolveScopeOwnerFilter enforces commercial scope — cannot widen visibility.
  const [scopeFilterOptions, ownerUserIds] = await Promise.all([
    getCommercialScopeFilterOptions(),
    resolveScopeOwnerFilter(params.userId, params.groupId),
  ]);

  // Los indicadores de la cabecera ya no se cuentan aparte en el servidor: la
  // tabla los calcula sobre estas mismas filas y los ofrece como filtros de un
  // toque, así el número de cada uno es exactamente lo que deja ver al pulsarlo.
  const listResult = await getGlobalCandidatesList({
    search: params.search,
    country: params.country,
    industry: params.industry,
    source: params.source,
    statuses,
    limit: 2000,
    offset: 0,
    ...(sourceId ? { batchId: sourceId } : {}),
    ...(ownerUserIds !== null ? { ownerUserIds } : {}),
  });

  const { candidates } = listResult;

  // La lista puede llegar ya filtrada por la URL: un vacío así no significa
  // que no haya prospectos, y la tabla lo explica de otra manera.
  const hasUrlFilters = Boolean(
    params.search ||
      params.country ||
      params.industry ||
      params.source ||
      params.status ||
      params.userId ||
      params.groupId,
  );

  return (
    <ListActionRailProvider label="Acciones de prospectos" gender="m">
    <DataTablePage
      compact
      title={EMPRESAS_VIEW_TITLES.prospectos}
      description={EMPRESAS_TAB_DESCRIPTIONS.prospectos}
      breadcrumbs={<Breadcrumbs items={empresasViewCrumbs('prospectos') ?? []} />}
      actions={
        // La IA está a un clic: es el agente de la barra. Importar y crear a
        // mano son las acciones de pantalla. El asistente va ya resuelto por
        // el servidor; si no puede ejecutarse, el agente lo dice en vez de
        // ofrecer «Generar con IA».
        <ProspectsScreenActions
          generateDrawer={generateDrawer}
          isGenerateAvailable={isGenerateAvailable}
        />
      }
    >
      <ProspectsDataTableClient
        candidates={candidates as ProspectCandidateWithReviewer[]}
        sourceId={sourceId ?? undefined}
        sourceBatchType={sourceBatchType ?? undefined}
        scopeFilterOptions={scopeFilterOptions}
        currentUserId={params.userId ?? ''}
        currentGroupId={params.groupId ?? ''}
        currentRoleKey={params.roleKey ?? ''}
        hasUrlFilters={hasUrlFilters}
        emptyActions={
          <div className="flex flex-wrap items-center justify-center gap-2">
            {generateDrawer}
            <ImportCandidatesDrawer>
              <Button type="button" variant="outline" size="sm">
                <Upload aria-hidden="true" />
                Importar un archivo
              </Button>
            </ImportCandidatesDrawer>
            <CreateCandidateDrawer triggerText="Crear prospecto" triggerVariant="outline" />
          </div>
        }
      />
    </DataTablePage>
    </ListActionRailProvider>
  );
}

/**
 * El agente de IA del módulo Empresas («Generar con IA»), resuelto en el
 * servidor: flags, catálogo, proveedor, topes y presupuesto, y el asistente
 * (`GenerateAIBatchDrawer`) con todo eso ya puesto. Es UNA sola carga para las
 * tres pestañas del módulo (Empresas, Por revisar, Descartadas): ninguna
 * resuelve la experiencia por su cuenta ni en el cliente.
 *
 * `isGenerateAvailable` es falso cuando la búsqueda no puede ejecutarse: quien
 * pinta el agente lo llama entonces «Búsqueda no disponible» (capa 4 del cerco
 * del camino heredado).
 */
export async function resolveGenerateProspectsAgent(): Promise<GenerateProspectsAgent> {
  // Feature flags: read server-side only — never NEXT_PUBLIC_
  // A1-LEGACY-PATH-FENCE-1 (P0-1): both flags are parsed through the canonical
  // server-only helpers (trim + toLowerCase). A strict `=== 'true'` here made
  // `"TRUE"`, `" true"` and `"true\n"` read as OFF, which — with the old resolver
  // — silently degraded the search to the legacy Apollo form. Both flags are
  // declared `sensitive` in Vercel, so their literal values cannot be read from
  // outside; the deployed code must interpret any value correctly.
  const enableChatWizard = isProspectChatWizardEnabled();
  const enableV2 = isExploratorySearchFormV2Enabled();
  // Q3F-5BB.3 / 5BB.3C — Lusha read-only preview lives INSIDE the "Generar con
  // IA" wizard (no standalone button). OFF por defecto (activar en QA/prod).
  // Q3F-5BB.10C3-FIX-1 (P0-1): parse the flag through the canonical server-only
  // helper (trim + toLowerCase) so the UI gate agrees exactly with the server
  // guard. A strict `=== 'true'` here made `"TRUE"`/`" true"`/`"true\n"` read as
  // OFF in the UI while the server read them as ON — the divergence that let a
  // Lusha-eligible search silently fall through to Agent 1 / Apollo.
  const enableLushaPreview = isLushaPreviewEnabled();
  // AGENT1-AUTO-PROVIDER-CASCADE-1 — sólo viaja el booleano, nunca el env.
  const autoProviderCascade = isAgent1AutoProviderCascadeEnabled();
  // Execution only active when wizard is also active — flag parsed by the
  // canonical server-only helper (normalized: trim + toLowerCase).
  const wizardExecutionEnabled =
    enableChatWizard && isProspectChatWizardExecutionEnabled();
  // A1-APOLLO-WIZARD-1 (hallazgo QA visual): el wizard no decía con qué proveedor
  // buscaba. Se resuelve aquí, server-side, con el mismo doble gate que usa la
  // ejecución; sólo viaja el nombre del proveedor — ni flags, ni env, ni roles.
  const wizardDiscoveryProvider = resolveWizardDiscoveryProvider();

  // A1-APOLLO-QA-CONTROL-SURFACE-1 § 2 — el proveedor global sigue siendo el que
  // resuelve la línea de arriba; esto sólo decide si un ADMIN puede apartarse de él
  // para UNA corrida. Con `ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE` apagado el
  // resolutor corta antes de consultar sesión o rol, así que esta ruta no gana ni
  // una query en el estado actual de Producción.
  // AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 — la instantánea del presupuesto se
  // resuelve AQUÍ, junto a los topes que la superficie ya anuncia, porque el
  // aviso «no alcanza para esta corrida» tiene que existir antes del primer clic
  // y no como resultado de una ejecución fallida. Sólo viajan enteros: saldo
  // disponible y coste del peor caso por proveedor. `null` ⇒ la UI no bloquea
  // nada y la reserva atómica sigue decidiendo, exactamente como hoy.
  //
  // El fallo de esta lectura no puede tumbar la página: `Promise.all` propaga un
  // rechazo, así que el resolutor ya devuelve `null` en vez de lanzar.
  const [wizardProviderOverrideCapability, apolloRunModeLimits, wizardBudgetPreflight] =
    await Promise.all([
      resolveWizardProviderOverrideCapabilityForCurrentUser(),
      resolveApolloRunModeLimitsForSurface(),
      resolveWizardBudgetPreflightForSurface(),
    ]);

  // Load catalog only when any enhanced experience is on — zero Supabase queries
  // otherwise (resolveCatalogAvailability returns `disabled` without querying).
  // A1-LEGACY-PATH-FENCE-1 (P0-2): a failure no longer collapses into `null`. The
  // old `catch { catalog = null }` made a transient Supabase error
  // indistinguishable from "no catalog requested", and the resolver turned that
  // into the legacy Apollo form — a config-read failure one click away from up to
  // 25 unbudgeted Apollo credits.
  const availability = await resolveCatalogAvailability(enableChatWizard || enableV2);
  const catalog = availability.status === 'ready' ? availability.catalog : null;

  const experience = resolveGenerateProspectsExperience(
    enableChatWizard,
    enableV2,
    availability,
  );
  const unavailableKind = resolveGenerateProspectsUnavailableKind(
    enableChatWizard,
    enableV2,
    availability,
  );

  // El asistente «Generar con IA», con todo lo que el servidor resolvió para
  // él. Es UN elemento que se monta en dos sitios: controlado por la barra
  // flotante (que lo abre sin pintar su botón) y, con su propio botón, en el
  // vacío inicial («no hay prospectos por revisar»), para que la acción esté
  // también donde se la echa en falta.
  const generateDrawer = (
    <GenerateAIBatchDrawer experience={experience} unavailableKind={unavailableKind} catalog={catalog} executionEnabled={wizardExecutionEnabled} lushaPreviewEnabled={enableLushaPreview} autoProviderCascade={autoProviderCascade} discoveryProvider={wizardDiscoveryProvider} providerOverrideCapability={wizardProviderOverrideCapability} apolloRunModeLimits={apolloRunModeLimits} budgetPreflight={wizardBudgetPreflight} />
  );

  return { generateDrawer, isGenerateAvailable: experience !== 'unavailable' };
}

/**
 * Lo mismo, para las pestañas donde el agente es un añadido (Empresas,
 * Descartadas): si su resolución falla, la pestaña sale sin agente en vez de
 * caerse. «Por revisar» usa `resolveGenerateProspectsAgent` tal cual, como
 * siempre.
 */
export async function loadGenerateProspectsAgent(): Promise<GenerateProspectsAgent | null> {
  try {
    return await resolveGenerateProspectsAgent();
  } catch (error) {
    console.error('[empresas] No se pudo resolver el agente «Generar con IA»', error);
    return null;
  }
}

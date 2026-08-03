import { Building2, CheckCircle2, GitMerge, Upload } from 'lucide-react';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { DataTablePage } from '@/components/shared/data-table-page';
import { MetricCard } from '@/components/shared/metric-card';
import { Button } from '@/components/ui/button';
import { CreateCandidateDrawer } from '@/components/prospect-batches/create-candidate-drawer';
import { ImportCandidatesDrawer } from '@/components/prospect-batches/import-candidates-drawer';
import { GenerateAIBatchDrawer } from '@/components/prospect-batches/generate-ai-batch-drawer';
import {
  resolveGenerateProspectsExperience,
  resolveGenerateProspectsUnavailableKind,
} from '@/components/prospect-batches/generate-ai-batch-experience';
import { ProspectsDataTableClient } from '@/components/prospects/prospects-data-table-client';
import { ModuleTabsNav } from '@/components/navigation/module-tabs-nav';
import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';
import {
  getGlobalCandidatesList,
  getGlobalProspectsKPIs,
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
  const [wizardProviderOverrideCapability, apolloRunModeLimits] = await Promise.all([
    resolveWizardProviderOverrideCapabilityForCurrentUser(),
    resolveApolloRunModeLimitsForSurface(),
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

  const [kpis, listResult] = await Promise.all([
    sourceId
      ? Promise.resolve({ needsReview: 0, readyForApproval: 0, possibleDuplicates: 0, importedRecently: 0 })
      : getGlobalProspectsKPIs(),
    getGlobalCandidatesList({
      search: params.search,
      country: params.country,
      industry: params.industry,
      source: params.source,
      statuses,
      limit: 2000,
      offset: 0,
      ...(sourceId ? { batchId: sourceId } : {}),
      ...(ownerUserIds !== null ? { ownerUserIds } : {}),
    }),
  ]);

  const { candidates } = listResult;

  return (
    <DataTablePage
      title="Prospectos"
      description="Genera, importa y revisa empresas candidatas antes de convertirlas en cuentas listas para trabajar."
      tabs={<ModuleTabsNav active="prospectos" />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <GenerateAIBatchDrawer experience={experience} unavailableKind={unavailableKind} catalog={catalog} executionEnabled={wizardExecutionEnabled} lushaPreviewEnabled={enableLushaPreview} discoveryProvider={wizardDiscoveryProvider} providerOverrideCapability={wizardProviderOverrideCapability} apolloRunModeLimits={apolloRunModeLimits} />
          <ImportCandidatesDrawer>
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <Upload className="h-3.5 w-3.5" />
              Importar prospectos
            </Button>
          </ImportCandidatesDrawer>
          <CreateCandidateDrawer
            triggerText="Crear prospecto"
            triggerVariant="outline"
          />
        </div>
      }
      metrics={
        !sourceId ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Pendientes de revisión"
              description="Esperando primera evaluación"
              value={kpis.needsReview}
              icon={
                <div className="rounded-lg p-1.5 bg-su-brand-soft">
                  <Building2 className="h-4 w-4 text-su-brand" />
                </div>
              }
            />
            <MetricCard
              title="Sin bloqueos detectados"
              description="Candidatos sin señales bloqueantes"
              value={kpis.readyForApproval}
              icon={
                <div className="rounded-lg p-1.5 bg-emerald-500/10">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
              }
            />
            <MetricCard
              title="Posibles duplicados"
              description="Coincidencias detectadas"
              value={kpis.possibleDuplicates}
              icon={
                <div className="rounded-lg p-1.5 bg-orange-500/10">
                  <GitMerge className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                </div>
              }
            />
            <MetricCard
              title="Importados recientemente"
              description="Últimos 7 días"
              value={kpis.importedRecently}
              icon={
                <div className="rounded-lg p-1.5 bg-blue-500/10">
                  <Upload className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
              }
            />
          </div>
        ) : null
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
      />
    </DataTablePage>
  );
}

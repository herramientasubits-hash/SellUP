import { ListActionRailProvider } from '@/components/action-rail';
import { DataTablePage } from '@/components/shared/data-table-page';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { DiscardedProspectsDataTableClient } from '@/components/prospects/discarded-prospects-data-table-client';
import { getDiscardedProspectsList } from '@/modules/prospect-discards/queries';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import {
  getCommercialScopeFilterOptions,
  resolveScopeOwnerFilter,
} from '@/modules/access/commercial-scope-filter-options';
import {
  EMPRESAS_TAB_DESCRIPTIONS,
  EMPRESAS_VIEW_TITLES,
  empresasViewCrumbs,
} from '@/components/prospects/empresas-module-copy';
import type { ProspectsPanelSearchParams } from '@/components/prospects/prospects-module-panel';
import {
  GenerateProspectsAgentActions,
  type GenerateProspectsAgent,
} from '@/components/prospects/generate-prospects-agent';

interface DiscardedProspectsPanelProps {
  params: ProspectsPanelSearchParams;
  /**
   * El agente «Generar con IA» del módulo, ya en marcha (lo resuelve
   * `loadGenerateProspectsAgent` en el servidor). `null` = sin agente.
   */
  generateAgent?: Promise<GenerateProspectsAgent | null>;
}

/**
 * AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — pestaña "Descartadas" (issue #389).
 * Lista disposiciones persistidas (auto-rechazos del pipeline y descartes
 * manuales) para revisarlas y, si procede, devolverlas a `needs_review` — sin
 * volver a consultar Apollo/Lusha/Tavily/HubSpot y sin consumir presupuesto.
 * Mismo alcance comercial que "Candidatos por revisar".
 *
 * AGENT1-DISCARDED-TAB-PARITY-1 — la pestaña dejó de ser una sub-pestaña
 * dentro de Prospectos y ahora es hermana de las otras dos en una sola fila
 * (hoy, una vista del menú lateral: Empresas → Descartadas). La superficie replica la de
 * "Candidatos por revisar": mismos indicadores que filtran, misma <DataTable>
 * con selección, barra de acciones masivas y filtros de alcance.
 *
 * La barra de la pantalla lleva el agente de IA del módulo («Generar con IA»),
 * el mismo asistente de las otras dos pestañas: aquí es donde más sentido
 * tiene volver a buscar tras revisar lo descartado.
 */
export async function DiscardedProspectsPanel({ params, generateAgent }: DiscardedProspectsPanelProps) {
  await requireActiveUser();

  const [scopeFilterOptions, ownerUserIds] = await Promise.all([
    getCommercialScopeFilterOptions(),
    resolveScopeOwnerFilter(params.userId, params.groupId),
  ]);

  const [{ items }, agent] = await Promise.all([
    getDiscardedProspectsList({
      search: params.search,
      country: params.country,
      industry: params.industry,
      batchId: params.sourceId,
      ...(ownerUserIds !== null ? { ownerUserIds } : {}),
      limit: 2000,
    }),
    generateAgent ?? null,
  ]);

  // Los indicadores de cabecera (nuevas hoy, descartadas por el pipeline,
  // descartes manuales) los calcula la tabla sobre estas mismas filas y los
  // ofrece como filtros de un toque — cero queries adicionales, cero llamadas a
  // proveedor.
  return (
    <ListActionRailProvider label="Acciones de empresas descartadas" gender="f">
    <DataTablePage
      compact
      title={EMPRESAS_VIEW_TITLES.descartadas}
      description={EMPRESAS_TAB_DESCRIPTIONS.descartadas}
      breadcrumbs={<Breadcrumbs items={empresasViewCrumbs('descartadas') ?? []} />}
      actions={agent ? <GenerateProspectsAgentActions {...agent} /> : undefined}
    >
      <DiscardedProspectsDataTableClient
        items={items}
        scopeFilterOptions={scopeFilterOptions}
        currentUserId={params.userId ?? ''}
        currentGroupId={params.groupId ?? ''}
        currentRoleKey={params.roleKey ?? ''}
        sourceId={params.sourceId ?? undefined}
        hasUrlFilters={Boolean(
          params.search || params.country || params.industry || params.userId || params.groupId,
        )}
      />
    </DataTablePage>
    </ListActionRailProvider>
  );
}

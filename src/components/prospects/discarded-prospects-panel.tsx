import { DataTablePage } from '@/components/shared/data-table-page';
import { ModuleTabsNav } from '@/components/navigation/module-tabs-nav';
import { DiscardedProspectsDataTableClient } from '@/components/prospects/discarded-prospects-data-table-client';
import { getDiscardedProspectsList } from '@/modules/prospect-discards/queries';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import {
  getCommercialScopeFilterOptions,
  resolveScopeOwnerFilter,
} from '@/modules/access/commercial-scope-filter-options';
import {
  EMPRESAS_MODULE_TITLE,
  EMPRESAS_TAB_DESCRIPTIONS,
} from '@/components/prospects/empresas-module-copy';
import type { ProspectsPanelSearchParams } from '@/components/prospects/prospects-module-panel';

interface DiscardedProspectsPanelProps {
  params: ProspectsPanelSearchParams;
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
 * (<ModuleTabsNav active="descartadas">). La superficie replica la de
 * "Candidatos por revisar": mismos indicadores que filtran, misma <DataTable>
 * con selección, barra de acciones masivas y filtros de alcance.
 */
export async function DiscardedProspectsPanel({ params }: DiscardedProspectsPanelProps) {
  await requireActiveUser();

  const [scopeFilterOptions, ownerUserIds] = await Promise.all([
    getCommercialScopeFilterOptions(),
    resolveScopeOwnerFilter(params.userId, params.groupId),
  ]);

  const { items, total } = await getDiscardedProspectsList({
    search: params.search,
    country: params.country,
    industry: params.industry,
    batchId: params.sourceId,
    ...(ownerUserIds !== null ? { ownerUserIds } : {}),
    limit: 2000,
  });

  // Los indicadores de cabecera (nuevas hoy, descartadas por el pipeline,
  // descartes manuales) los calcula la tabla sobre estas mismas filas y los
  // ofrece como filtros de un toque — cero queries adicionales, cero llamadas a
  // proveedor.
  return (
    <DataTablePage
      compact
      title={EMPRESAS_MODULE_TITLE}
      description={EMPRESAS_TAB_DESCRIPTIONS.descartadas}
      tabs={<ModuleTabsNav active="descartadas" discardedCount={total} />}
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
  );
}

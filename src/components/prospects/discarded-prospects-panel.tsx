import { Building2 } from 'lucide-react';
import { DataTablePage } from '@/components/shared/data-table-page';
import { ModuleTabsNav } from '@/components/navigation/module-tabs-nav';
import { ProspectsSubTabsNav } from '@/components/prospects/prospects-sub-tabs-nav';
import { DiscardedProspectsDataTableClient } from '@/components/prospects/discarded-prospects-data-table-client';
import { getDiscardedProspectsList } from '@/modules/prospect-discards/queries';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import { resolveScopeOwnerFilter } from '@/modules/access/commercial-scope-filter-options';
import type { ProspectsPanelSearchParams } from '@/components/prospects/prospects-module-panel';

interface DiscardedProspectsPanelProps {
  params: ProspectsPanelSearchParams;
}

/**
 * AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — "Descartadas" sub-tab of Prospectos
 * (issue #389). Lists disposiciones persistidas (pipeline auto-rejects and
 * manual discards) so they can be reviewed and, if warranted, sent back to
 * `needs_review` — without re-querying Apollo/Lusha/Tavily/HubSpot and
 * without consuming budget. Same commercial scope as "Por revisar".
 */
export async function DiscardedProspectsPanel({ params }: DiscardedProspectsPanelProps) {
  await requireActiveUser();

  const ownerUserIds = await resolveScopeOwnerFilter(params.userId, params.groupId);

  const { items, total } = await getDiscardedProspectsList({
    search: params.search,
    country: params.country,
    industry: params.industry,
    batchId: params.sourceId,
    ...(ownerUserIds !== null ? { ownerUserIds } : {}),
    limit: 2000,
  });

  return (
    <DataTablePage
      title="Prospectos"
      description="Empresas que el pipeline descartó automáticamente o que quedaron fuera de evaluación. Revísalas y envíalas de vuelta sin volver a buscar."
      tabs={
        <div className="flex flex-col gap-2">
          <ModuleTabsNav active="prospectos" />
          <ProspectsSubTabsNav active="descartadas" discardedCount={total} />
        </div>
      }
      metrics={
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4" />
          <span>{total} empresa{total === 1 ? '' : 's'} descartada{total === 1 ? '' : 's'} en tu alcance</span>
        </div>
      }
    >
      <DiscardedProspectsDataTableClient items={items} />
    </DataTablePage>
  );
}

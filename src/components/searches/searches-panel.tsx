import { ListActionRailProvider } from '@/components/action-rail';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { DataTablePage } from '@/components/shared/data-table-page';
import { ProspectsScreenActions } from '@/components/prospects/prospects-screen-actions';
import { resolveGenerateProspectsAgent } from '@/components/prospects/prospects-module-panel';
import {
  EMPRESAS_TAB_DESCRIPTIONS,
  EMPRESAS_VIEW_TITLES,
  empresasViewCrumbs,
} from '@/components/prospects/empresas-module-copy';
import { createClient } from '@/lib/supabase/server';
import { checkCapability } from '@/modules/access/capabilities.server';
import { getActiveUsers } from '@/modules/accounts/actions';
import { hasCandidateAssignmentColumn } from '@/modules/assignment/assignment.server';
import { getSearchesForViewer } from '@/modules/prospect-batches/actions';
import {
  listBulkSearchesForUser,
  resolveBulkSearchAccess,
} from '@/modules/prospect-batches/bulk-search/bulk-search-service.server';
import { toSearchRow } from '@/modules/prospect-batches/searches/search-rows';
import { SearchesTableClient } from './searches-table-client';

/**
 * Empresas › Búsquedas (dueña 28-10): todas las búsquedas que ve quien mira —las
 * cinco formas de Rumbo, los archivos y las fuentes— con lo que encontró cada una y
 * lo que falta por revisar. Las acciones de la pantalla son las de «Por revisar»:
 * Rumbo para todos e «Importar archivo» para quien trabaja en masa.
 */
export async function SearchesPanel({ focusSearchId = null }: { focusSearchId?: string | null }) {
  const [searches, agent, canProspectBulk, enrichBulk, bulkAccess, assignmentEnabled] = await Promise.all([
    getSearchesForViewer(),
    resolveGenerateProspectsAgent(),
    checkCapability('prospectarMasivo').then((check) => check.ok),
    checkCapability('enriquecerMasivo').then((check) => check.ok),
    resolveBulkSearchAccess(),
    createClient()
      .then((supabase) => hasCandidateAssignmentColumn(supabase))
      .catch(() => false),
  ]);
  const bulkSearches = bulkAccess.ok ? await listBulkSearchesForUser(bulkAccess.userId).catch(() => []) : [];
  const assignableUsers = assignmentEnabled ? await getActiveUsers().catch(() => []) : [];

  return (
    <ListActionRailProvider label="Acciones de búsquedas" gender="f">
      <DataTablePage
        compact
        title={EMPRESAS_VIEW_TITLES.busquedas}
        description={EMPRESAS_TAB_DESCRIPTIONS.busquedas}
        breadcrumbs={<Breadcrumbs items={empresasViewCrumbs('busquedas') ?? []} />}
        actions={
          <ProspectsScreenActions
            generateDrawer={agent.generateDrawer}
            isGenerateAvailable={agent.isGenerateAvailable}
            canProspectBulk={canProspectBulk}
          />
        }
      >
        <SearchesTableClient
          searches={searches.map(toSearchRow)}
          bulkSearches={bulkSearches}
          assignableUsers={assignableUsers}
          canEnrichBulk={enrichBulk}
          focusSearchId={focusSearchId}
          emptyActions={agent.generateDrawer}
        />
      </DataTablePage>
    </ListActionRailProvider>
  );
}

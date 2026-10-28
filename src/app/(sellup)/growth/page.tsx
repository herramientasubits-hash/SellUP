import { redirect } from 'next/navigation';
import { Upload } from '@/icons';
import { Button } from '@/components/ui/button';
import { GrowthWorkspace } from '@/components/growth/growth-workspace';
import { ImportCandidatesDrawer } from '@/components/prospect-batches/import-candidates-drawer';
import { loadGenerateProspectsAgent } from '@/components/prospects/prospects-module-panel';
import { checkCapability, getAccessSnapshot } from '@/modules/access/capabilities.server';
import { isGrowthRole } from '@/modules/access/capabilities';
import { getProspectBatchesList, getProspectBatchesSummary } from '@/modules/prospect-batches/actions';
import { toGrowthSearchRow, toGrowthSummary } from '@/modules/growth/growth-rows';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Prospección masiva',
};

/**
 * Prospección masiva — la vista del equipo de Growth.
 *
 * Solo Growth y administración (el menú ya la oculta al resto, y la URL
 * tampoco la abre). Reutiliza el asistente de búsqueda con IA y el importador
 * tal cual, con todas sus validaciones: nada entra a SellUp ni a HubSpot sin
 * pasar por «Por revisar».
 */
export default async function GrowthPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await getAccessSnapshot();
  if (!access.isAdmin && !isGrowthRole(access.roleKey)) redirect('/pipeline');

  const { tab } = await searchParams;
  const [summary, batches, generateAgent, bulkEnrich] = await Promise.all([
    getProspectBatchesSummary(),
    getProspectBatchesList(),
    // Solo aquí se pide la búsqueda masiva de Growth («hasta N» empresas).
    loadGenerateProspectsAgent({ bulkSearch: true }),
    checkCapability('enriquecerMasivo'),
  ]);
  const searches = batches.map(toGrowthSearchRow);

  return (
    <GrowthWorkspace
      initialTab={tab}
      summary={toGrowthSummary(summary, searches)}
      searches={searches}
      newSearchAction={generateAgent?.generateDrawer ?? null}
      canEnrichBulk={bulkEnrich.ok}
      importAction={
        <ImportCandidatesDrawer>
          <Button type="button" variant="outline">
            <Upload aria-hidden="true" />
            Importar archivo
          </Button>
        </ImportCandidatesDrawer>
      }
    />
  );
}

import { Building2, CheckCircle2, GitMerge, Upload } from 'lucide-react';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { DataTablePage } from '@/components/shared/data-table-page';
import { MetricCard } from '@/components/shared/metric-card';
import { Button } from '@/components/ui/button';
import { CreateCandidateDrawer } from '@/components/prospect-batches/create-candidate-drawer';
import { ImportCandidatesDrawer } from '@/components/prospect-batches/import-candidates-drawer';
import { GenerateAIBatchDrawer } from '@/components/prospect-batches/generate-ai-batch-drawer';
import { resolveGenerateProspectsExperience } from '@/components/prospect-batches/generate-ai-batch-experience';
import { ProspectsDataTableClient } from '@/components/prospects/prospects-data-table-client';
import {
  getGlobalCandidatesList,
  getGlobalProspectsKPIs,
  requireActiveUser,
  getProspectBatchById,
} from '@/modules/prospect-batches/actions';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';
import { loadActiveCatalog } from '@/modules/industry-catalog/loader';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';

interface PageProps {
  searchParams: Promise<{
    search?: string;
    country?: string;
    industry?: string;
    source?: string;
    status?: string;
    sourceId?: string;
  }>;
}

export default async function ProspectsPage({ searchParams }: PageProps) {
  await requireActiveUser();

  // Feature flags: read server-side only — never NEXT_PUBLIC_
  const enableChatWizard = process.env.ENABLE_PROSPECT_CHAT_WIZARD === 'true';
  const enableV2 = process.env.ENABLE_EXPLORATORY_SEARCH_FORM_V2 === 'true';

  // Load catalog only when any enhanced experience is on — zero Supabase queries otherwise
  let catalog: ActiveIndustryCatalog | null = null;
  if (enableChatWizard || enableV2) {
    try {
      catalog = await loadActiveCatalog();
    } catch {
      // If catalog fails to load, fall back to legacy form silently
      catalog = null;
    }
  }

  const experience = resolveGenerateProspectsExperience(enableChatWizard, enableV2, catalog);

  const params = await searchParams;

  const sourceId = params.sourceId ?? null;

  let sourceBatchType: string | null = null;
  if (sourceId) {
    const parsed = z.string().uuid().safeParse(sourceId);
    if (!parsed.success) {
      redirect('/prospects');
    }
    try {
      const sourceBatch = await getProspectBatchById(sourceId);
      if (!sourceBatch) {
        redirect('/prospects');
      }
      sourceBatchType = sourceBatch.source ?? null;
    } catch {
      redirect('/prospects');
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
    }),
  ]);

  const { candidates } = listResult;

  return (
    <DataTablePage
      title="Prospectos"
      description="Genera, importa y revisa empresas candidatas antes de convertirlas en cuentas listas para trabajar."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <GenerateAIBatchDrawer experience={experience} catalog={catalog} />
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
              title="Listos para aprobar"
              description="Candidatos validados"
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
      />
    </DataTablePage>
  );
}

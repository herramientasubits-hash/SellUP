import { Building2, CheckCircle2, GitMerge, Upload } from 'lucide-react';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { DataTablePage } from '@/components/shared/data-table-page';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Button } from '@/components/ui/button';
import { CreateCandidateDrawer } from '@/components/prospect-batches/create-candidate-drawer';
import { ImportCandidatesDrawer } from '@/components/prospect-batches/import-candidates-drawer';
import { GenerateAIBatchDrawer } from '@/components/prospect-batches/generate-ai-batch-drawer';
import { ProspectsTrayClient } from '@/components/prospects/prospects-tray-client';
import {
  getGlobalCandidatesList,
  getGlobalProspectsKPIs,
  requireActiveUser,
  getProspectBatchById,
} from '@/modules/prospect-batches/actions';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';

interface PageProps {
  searchParams: Promise<{
    search?: string;
    country?: string;
    industry?: string;
    source?: string;
    status?: string;
    page?: string;
    sourceId?: string;
  }>;
}

export default async function ProspectsPage({ searchParams }: PageProps) {
  // Enforce auth check and session retrieval
  await requireActiveUser();

  const params = await searchParams;
  const limit = 50;
  const page = Number(params.page ?? '1');
  const offset = (page - 1) * limit;

  // Soporte para ?sourceId= — filtra la bandeja por operación reciente
  const sourceId = params.sourceId ?? null;

  // Validar sourceId con Zod y verificar si existe y es accesible
  let sourceBatchType: string | null = null;
  if (sourceId) {
    const parsed = z.string().uuid().safeParse(sourceId);
    if (!parsed.success) {
      redirect('/prospects');
    }
    try {
      const sourceBatch = await getProspectBatchById(sourceId);
      if (!sourceBatch) {
        // UUID inexistente o no accesible por RLS
        redirect('/prospects');
      }
      sourceBatchType = sourceBatch.source ?? null;
    } catch {
      redirect('/prospects');
    }
  }

  // Map status filter
  let statuses = ['needs_review', 'generated', 'normalized'];
  if (params.status) {
    if (params.status === 'pending') {
      statuses = ['needs_review', 'generated', 'normalized'];
    } else {
      statuses = [params.status];
    }
  }

  // Fetch both the KPIs and candidate lists in parallel
  // Si sourceId está activo, evitamos consultar KPIs globales para ahorrar carga
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
      limit,
      offset,
      // Cuando sourceId está presente, filtrar por batchId
      ...(sourceId ? { batchId: sourceId } : {}),
    }),
  ]);

  const { candidates, total } = listResult;

  const summaryCards = [
    {
      label: 'Pendientes de revisión',
      value: kpis.needsReview,
      icon: Building2,
      color: 'text-su-brand',
      bg: 'bg-su-brand-soft',
    },
    {
      label: 'Listos para aprobar',
      value: kpis.readyForApproval,
      icon: CheckCircle2,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Posibles duplicados',
      value: kpis.possibleDuplicates,
      icon: GitMerge,
      color: 'text-orange-600 dark:text-orange-400',
      bg: 'bg-orange-500/10',
    },
    {
      label: 'Importados recientemente',
      value: kpis.importedRecently,
      icon: Upload,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-500/10',
    },
  ];

  return (
    <DataTablePage
      title="Prospectos"
      description="Genera, importa y revisa empresas candidatas antes de convertirlas en cuentas listas para trabajar."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {/* CTA principal — Generar con IA */}
          <GenerateAIBatchDrawer />
          {/* CTA secundario — Importar */}
          <ImportCandidatesDrawer>
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <Upload className="h-3.5 w-3.5" />
              Importar prospectos
            </Button>
          </ImportCandidatesDrawer>
          {/* CTA terciario — Crear manual */}
          <CreateCandidateDrawer
            triggerText="Crear prospecto"
            triggerVariant="outline"
          />
        </div>
      }
      metrics={
        !sourceId ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summaryCards.map((card) => (
              <SurfaceCard key={card.label} className="py-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      {card.label}
                    </p>
                    <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">
                      {card.value}
                    </p>
                  </div>
                  <div className={`rounded-lg p-1.5 ${card.bg}`}>
                    <card.icon className={`h-4 w-4 ${card.color}`} />
                  </div>
                </div>
              </SurfaceCard>
            ))}
          </div>
        ) : null
      }
    >
      <ProspectsTrayClient
        candidates={candidates as ProspectCandidateWithReviewer[]}
        total={total}
        limit={limit}
        page={page}
        sourceId={sourceId ?? undefined}
        sourceBatchType={sourceBatchType ?? undefined}
      />
    </DataTablePage>
  );
}

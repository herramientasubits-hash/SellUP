import { Layers, CheckCircle2, GitMerge, Trophy, ThumbsUp, Upload } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Button } from '@/components/ui/button';
import { CreateBatchDrawer } from '@/components/prospect-batches/create-batch-drawer';
import { GenerateMockBatchDrawer } from '@/components/prospect-batches/generate-mock-batch-drawer';
import { GenerateAIBatchDrawer } from '@/components/prospect-batches/generate-ai-batch-drawer';
import { ImportCandidatesDrawer } from '@/components/prospect-batches/import-candidates-drawer';
import { BatchesListClient } from '@/components/prospect-batches/batches-list-client';
import {
  getProspectBatchesSummary,
  getProspectBatchesList,
  getActiveUsers,
} from '@/modules/prospect-batches/actions';

export default async function ProspectBatchesPage() {
  const [summary, batches, users] = await Promise.all([
    getProspectBatchesSummary(),
    getProspectBatchesList(),
    getActiveUsers(),
  ]);

  const summaryCards = [
    {
      label: 'Total lotes',
      value: summary.total,
      icon: Layers,
      color: 'text-su-brand',
      bg: 'bg-su-brand-soft',
    },
    {
      label: 'Listos para revisión',
      value: summary.ready_for_review,
      icon: CheckCircle2,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500/10',
    },
    {
      label: 'En revisión',
      value: summary.in_review,
      icon: GitMerge,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-500/10',
    },
    {
      label: 'Completados',
      value: summary.completed,
      icon: Trophy,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Candidatos aprobados',
      value: summary.total_approved_candidates,
      icon: ThumbsUp,
      color: 'text-su-brand',
      bg: 'bg-su-brand-soft',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prospección"
        description="Genera, revisa y aprueba empresas candidatas antes de convertirlas en prospectos dentro de SellUp."
        actions={
          <div className="flex items-center gap-2">
            {process.env.NODE_ENV !== 'production' && <GenerateMockBatchDrawer />}
            <ImportCandidatesDrawer>
              <Button variant="outline" size="sm" className="gap-2 text-xs">
                <Upload className="h-3.5 w-3.5" />
                Importar candidatos
              </Button>
            </ImportCandidatesDrawer>
            <GenerateAIBatchDrawer />
            <CreateBatchDrawer users={users} />
          </div>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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

      {/* Info note */}
      <div className="rounded-xl border border-border/40 bg-muted/40 px-5 py-3.5 text-xs text-muted-foreground">
        Los lotes son una bandeja temporal de revisión. Las empresas candidatas aprobadas se convierten en empresas/prospectos con expediente propio en SellUp. Ningún candidato se envía a HubSpot ni se convierte en empresa definitiva sin revisión humana.
      </div>

      {/* Batches table */}
      <SurfaceCard noPadding>
        <div className="border-b border-border/40 px-5 py-3.5">
          <p className="text-sm font-semibold text-foreground">
            {batches.length === 0
              ? 'Todavía no hay lotes de prospección'
              : `Lotes para revisión · ${batches.length} lote${batches.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <BatchesListClient batches={batches} />
      </SurfaceCard>
    </div>
  );
}

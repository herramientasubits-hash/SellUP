import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  XCircle,
  GitMerge,
  ArrowRightCircle,
  AlertTriangle,
  Layers,
  FlaskConical,
  Globe,
  RefreshCw,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreateCandidateDrawer } from '@/components/prospect-batches/create-candidate-drawer';
import { CandidatesTableClient } from '@/components/prospect-batches/candidates-table-client';
import {
  getProspectBatchById,
  getCandidatesByBatch,
} from '@/modules/prospect-batches/actions';
import {
  BATCH_STATUS_LABELS,
  BATCH_SOURCE_LABELS,
  BATCH_SEARCH_DEPTH_LABELS,
} from '@/modules/prospect-batches/types';
import type { BatchStatus } from '@/modules/prospect-batches/types';

const STATUS_STYLES: Record<BatchStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  generating: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  ready_for_review: 'bg-su-brand-soft text-su-brand',
  in_review: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  cancelled: 'bg-muted/60 text-muted-foreground/60',
  failed: 'bg-destructive/10 text-destructive',
};

interface Props {
  params: Promise<{ batchId: string }>;
}

export default async function BatchDetailPage({ params }: Props) {
  const { batchId } = await params;

  const [batch, candidates] = await Promise.all([
    getProspectBatchById(batchId),
    getCandidatesByBatch(batchId),
  ]);

  if (!batch) notFound();

  const counts = {
    total: batch.total_candidates,
    needs_review: batch.needs_review_count,
    approved: batch.approved_count,
    discarded: batch.discarded_count,
    converted: batch.converted_count,
    duplicates: batch.duplicate_count,
  };

  const summaryCards = [
    {
      label: 'Total emp. candidatas',
      value: counts.total,
      icon: Building2,
      color: 'text-foreground',
      bg: 'bg-muted/60',
    },
    {
      label: 'Necesitan revisión',
      value: counts.needs_review,
      icon: AlertTriangle,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500/10',
    },
    {
      label: 'Aprobados',
      value: counts.approved,
      icon: CheckCircle2,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Descartados',
      value: counts.discarded,
      icon: XCircle,
      color: 'text-muted-foreground',
      bg: 'bg-muted/60',
    },
    {
      label: 'Convertidos',
      value: counts.converted,
      icon: ArrowRightCircle,
      color: 'text-su-brand',
      bg: 'bg-su-brand-soft',
    },
    {
      label: 'Posibles duplicados',
      value: counts.duplicates,
      icon: GitMerge,
      color: 'text-orange-600 dark:text-orange-400',
      bg: 'bg-orange-500/10',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/prospect-batches"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Prospección
        </Link>
      </div>

      {/* Header */}
      <PageHeader
        title={batch.name}
        description={batch.description ?? undefined}
        actions={<CreateCandidateDrawer batchId={batch.id} />}
      />

      {/* Alerta modo mock */}
      {batch.metadata?.generation_mode === 'mock' && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3.5">
          <div className="flex items-start gap-2.5">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                Lote generado en modo prueba
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Este lote fue generado con datos mock para validar el flujo del pipeline. No usar estos candidatos para convertirlos en empresas reales.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Alerta novelty: empresas omitidas por repetición reciente */}
      {(() => {
        const ns = batch.metadata?.novelty_summary as
          | { skipped_count?: number; skipped_items?: { name: string }[] }
          | undefined;
        const skippedCount = ns?.skipped_count ?? 0;
        if (skippedCount === 0) return null;
        const previewNames = (ns?.skipped_items ?? [])
          .slice(0, 3)
          .map((i) => i.name);
        return (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3.5">
            <div className="flex items-start gap-2.5">
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  SellUp omitió {skippedCount} empresa{skippedCount !== 1 ? 's' : ''} repetida{skippedCount !== 1 ? 's' : ''}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {skippedCount === 1
                    ? 'Esta empresa ya estaba pendiente de revisión en un lote reciente y fue omitida para evitar duplicados.'
                    : `Estas empresas ya estaban pendientes de revisión en lotes recientes y fueron omitidas para evitar duplicados.`}
                  {previewNames.length > 0 && (
                    <span className="ml-1">
                      Ej.: {previewNames.join(', ')}{(ns?.skipped_items?.length ?? 0) > 3 ? '…' : '.'}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Alerta modo prueba controlada con búsqueda real */}
      {batch.metadata?.generation_mode === 'controlled_real_test' && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 px-5 py-3.5">
          <div className="flex items-start gap-2.5">
            <Globe className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
            <div>
              <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
                Lote generado con búsqueda web real (prueba controlada)
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Este lote fue generado usando Tavily para búsquedas reales en modo de prueba controlada. Los datos son reales pero el lote se generó en un entorno de validación — revisar antes de convertir candidatos.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Batch meta */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={`${STATUS_STYLES[batch.status]} border-0 text-[10px] font-semibold`}>
          {BATCH_STATUS_LABELS[batch.status]}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {BATCH_SOURCE_LABELS[batch.source]}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          Profundidad: {BATCH_SEARCH_DEPTH_LABELS[batch.search_depth]}
        </Badge>
        {batch.country && (
          <Badge variant="outline" className="text-[10px]">
            {batch.country}
          </Badge>
        )}
        {batch.industry && (
          <Badge variant="outline" className="text-[10px]">
            {batch.industry}
          </Badge>
        )}
        {batch.estimated_cost_usd !== null && batch.estimated_cost_usd > 0 && (
          <Badge variant="outline" className="text-[10px]">
            Costo est.: ${Number(batch.estimated_cost_usd).toFixed(4)}
          </Badge>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {summaryCards.map((card) => (
          <SurfaceCard key={card.label} className="py-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {card.label}
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                  {card.value}
                </p>
              </div>
              <div className={`rounded-lg p-1 ${card.bg}`}>
                <card.icon className={`h-3.5 w-3.5 ${card.color}`} />
              </div>
            </div>
          </SurfaceCard>
        ))}
      </div>

      {/* Candidates table */}
      <SurfaceCard noPadding>
        <div className="flex items-center justify-between border-b border-border/40 px-5 py-3.5">
          <p className="text-sm font-semibold text-foreground">
            {candidates.length === 0
              ? 'Sin empresas candidatas'
              : `${candidates.length} empresa${candidates.length !== 1 ? 's' : ''} candidata${candidates.length !== 1 ? 's' : ''}`}
          </p>
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-xs text-muted-foreground/60">
              {batch.target_count ? `Objetivo: ${batch.target_count}` : ''}
            </span>
          </div>
        </div>
        <CandidatesTableClient candidates={candidates} />
      </SurfaceCard>
    </div>
  );
}

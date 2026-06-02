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
  ShieldCheck,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import { CreateCandidateDrawer } from '@/components/prospect-batches/create-candidate-drawer';
import { CandidatesTableClient } from '@/components/prospect-batches/candidates-table-client';
import { RollbackBatchDialog } from '@/components/prospect-batches/rollback-batch-dialog';
import { RehydrateBatchButton } from '@/components/prospect-batches/rehydrate-batch-button';
import {
  getProspectBatchById,
  getCandidatesByBatch,
} from '@/modules/prospect-batches/actions';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import {
  BATCH_STATUS_LABELS,
  BATCH_SOURCE_LABELS,
  BATCH_SEARCH_DEPTH_LABELS,
  isUsefulReviewCandidate,
} from '@/modules/prospect-batches/types';
import type { BatchStatus, BatchSource } from '@/modules/prospect-batches/types';

const BATCH_SOURCE_VENDOR_LABELS: Partial<Record<BatchSource, string>> = {
  socrata_colombia: 'Fuente oficial',
};

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

  const [batch, candidates, isAdmin] = await Promise.all([
    getProspectBatchById(batchId),
    getCandidatesByBatch(batchId),
    isCurrentUserAdmin(),
  ]);

  if (!batch) notFound();

  const isStructuredRues =
    batch.metadata?.batch_type === 'structured' &&
    (batch.metadata?.source_key === 'co_rues' ||
      batch.metadata?.source_provider === 'socrata_colombia' ||
      batch.source === 'socrata_colombia');

  const isApolloCandidateBatch =
    !isStructuredRues && batch.source === 'agent_1';

  const pageTitle =
    (isStructuredRues || isApolloCandidateBatch) && (batch.country || batch.industry)
      ? `Empresas candidatas${batch.country ? ` · ${batch.country}` : ''}${batch.industry ? ` · ${batch.industry}` : ''}`
      : batch.name;

  const pageSubtitle = (isStructuredRues || isApolloCandidateBatch) ? batch.name : (batch.description ?? undefined);

  const usefulCandidates = candidates.filter(isUsefulReviewCandidate);
  const omittedCandidates = candidates.filter((c) => !isUsefulReviewCandidate(c));

  const counts = {
    total: usefulCandidates.length,
    needs_review: usefulCandidates.filter(
      (c) => c.status === 'needs_review' || c.status === 'generated' || c.status === 'normalized'
    ).length,
    approved: usefulCandidates.filter((c) => c.status === 'approved').length,
    discarded: usefulCandidates.filter((c) => c.status === 'discarded').length,
    converted: usefulCandidates.filter((c) => c.status === 'converted_to_account').length,
    duplicates: usefulCandidates.filter(
      (c) =>
        c.duplicate_status === 'possible_duplicate' ||
        c.duplicate_status === 'exact_duplicate' ||
        c.status === 'duplicate'
    ).length,
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
        title={pageTitle}
        description={pageSubtitle}
        actions={
          <div className="flex items-center gap-2">
            {isAdmin &&
              batch.metadata?.batch_type === 'structured' &&
              (batch.metadata?.source_key === 'co_rues' ||
                batch.metadata?.source_provider === 'socrata_colombia' ||
                batch.source === 'socrata_colombia') && (
                <RehydrateBatchButton batchId={batch.id} />
              )}
            {batch.metadata?.batch_type === 'structured' &&
              batch.metadata?.initiated_by === 'agent_1' &&
              batch.metadata?.source_key === 'co_rues' &&
              ['ready_for_review', 'preview', 'draft', 'in_review'].includes(batch.status) &&
              batch.converted_count === 0 && (
                <RollbackBatchDialog batchId={batch.id} batchName={batch.name} />
              )}
            <CreateCandidateDrawer batchId={batch.id} />
          </div>
        }
      />

      {/* Alerta de rollback lógico aplicado */}
      {batch.status === 'cancelled' && batch.metadata?.rollback_logical === true && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-3.5 animate-in fade-in-0 duration-200">
          <div className="flex items-start gap-2.5">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive dark:text-red-400">
                Lote revertido
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Los datos permanecen para auditoría, pero el lote ya no está operativo.
                {typeof batch.metadata?.rollback_reason === 'string' && (
                  <span className="block mt-1 text-[10px] text-muted-foreground/80 font-mono">
                    Motivo: {batch.metadata.rollback_reason}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Banner revisión humana — lotes estructurados */}
      {batch.metadata?.batch_type === 'structured' &&
        batch.metadata?.human_review_required === true && (
          <div className="rounded-xl border border-su-brand/30 bg-su-brand-soft/40 px-5 py-3.5 animate-in fade-in-0 duration-200">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Empresas verificadas con fuente oficial
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Estas empresas fueron contrastadas con el registro oficial de Colombia. Requieren revisión humana antes de aprobarse o sincronizarse con HubSpot.
                </p>
              </div>
            </div>
          </div>
        )}

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

      {/* Información de búsqueda incremental */}
      {(() => {
        const topMeta = batch.metadata as Record<string, unknown> | undefined;
        // Grouped structure (16T.2+); fallback to top-level for batches generated before grouping.
        const meta = (topMeta?.incremental_search as Record<string, unknown> | undefined) ?? (
          topMeta?.rounds_executed !== undefined ? topMeta : undefined
        );
        const roundsExecuted = meta?.rounds_executed as number | undefined;
        if (!roundsExecuted) return null;
        const stoppedReason = meta?.stopped_reason as string | undefined;
        const totalRaw = meta?.total_raw_evaluated as number | undefined;
        const totalAcc = meta?.total_candidates_accumulated as number | undefined;
        const usefulCount = meta?.useful_candidates_count as number | undefined;
        const reasonLabels: Record<string, string> = {
          min_useful_reached: 'Mínimo útiles alcanzado',
          max_rounds_reached: 'Rondas máximas alcanzadas',
          max_raw_exceeded: 'Límite de resultados alcanzado',
          no_results_round_1: 'Sin resultados en ronda 1',
          cost_limit_exceeded: 'Límite de costo alcanzado',
          error: 'Error en búsqueda',
        };
        return (
          <div className="rounded-xl border border-su-brand/20 bg-su-brand-soft/40 px-5 py-3.5">
            <div className="flex items-start gap-2.5">
              <Layers className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  Búsqueda incremental · {roundsExecuted} ronda{roundsExecuted !== 1 ? 's' : ''}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {stoppedReason && (
                    <span>Detuvo por: <span className="font-medium text-foreground/80">{reasonLabels[stoppedReason] ?? stoppedReason}</span></span>
                  )}
                  {totalRaw !== undefined && (
                    <span>Resultados evaluados: <span className="font-medium text-foreground/80">{totalRaw}</span></span>
                  )}
                  {totalAcc !== undefined && (
                    <span>Candidatos acumulados: <span className="font-medium text-foreground/80">{totalAcc}</span></span>
                  )}
                  {usefulCount !== undefined && (
                    <span>Útiles: <span className="font-medium text-foreground/80">{usefulCount}</span></span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Batch meta */}
      <div className="flex flex-wrap items-center gap-2">
        {batch.metadata?.review_ready === false && batch.status === 'ready_for_review' ? (
          <Badge className="bg-muted text-muted-foreground border-0 text-[10px] font-semibold">
            Sin candidatas útiles
          </Badge>
        ) : (
          <Badge className={`${STATUS_STYLES[batch.status]} border-0 text-[10px] font-semibold`}>
            {BATCH_STATUS_LABELS[batch.status]}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px]">
          {isApolloCandidateBatch
            ? 'Fuente comercial'
            : (BATCH_SOURCE_VENDOR_LABELS[batch.source] ?? BATCH_SOURCE_LABELS[batch.source])}
        </Badge>
        {!isStructuredRues && !isApolloCandidateBatch && (
          <Badge variant="outline" className="text-[10px]">
            Profundidad: {BATCH_SEARCH_DEPTH_LABELS[batch.search_depth]}
          </Badge>
        )}
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
        {!isApolloCandidateBatch && batch.estimated_cost_usd !== null && batch.estimated_cost_usd > 0 && (
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
            {usefulCandidates.length === 0
              ? 'Sin empresas candidatas'
              : `${usefulCandidates.length} empresa${usefulCandidates.length !== 1 ? 's' : ''} candidata${usefulCandidates.length !== 1 ? 's' : ''}`}
          </p>
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-xs text-muted-foreground/60">
              {batch.target_count ? `Objetivo: ${batch.target_count}` : ''}
            </span>
          </div>
        </div>
        <CandidatesTableClient candidates={usefulCandidates} />
      </SurfaceCard>

      {/* Omitted candidates */}
      {omittedCandidates.length > 0 && (
        <details className="group rounded-xl border border-border/40 bg-card p-4">
          <summary className="flex cursor-pointer items-center justify-between font-semibold text-xs text-muted-foreground hover:text-foreground">
            <span className="flex items-center gap-2">
              <span>Empresas omitidas ({omittedCandidates.length})</span>
              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-normal text-amber-700 dark:text-amber-400">
                Inactivas, disueltas, duplicadas o sin NIT
              </span>
            </span>
          </summary>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2">Razón social / Identificador</th>
                  <th className="px-3 py-2">Ubicación</th>
                  <th className="px-3 py-2">Señal / Motivo</th>
                </tr>
              </thead>
              <tbody>
                {omittedCandidates.map((c) => {
                  const flags = c.review_flags ?? [];
                  const reasons: string[] = [];
                  if (flags.includes('liquidation_signal')) reasons.push('En liquidación');
                  if (flags.includes('inactive_company')) reasons.push('Inactiva');
                  if (flags.includes('possible_inactive')) {
                    const legalStatus = (c.legal_status || '').toLowerCase();
                    const inactiveKeywords = ['inactiva', 'cancelada', 'liquidada', 'disuelta', 'clausurada'];
                    if (inactiveKeywords.some((kw) => legalStatus.includes(kw))) {
                      reasons.push(`Posible inactiva (${c.legal_status})`);
                    }
                  }
                  if (c.duplicate_status === 'exact_duplicate') reasons.push('Duplicado exacto');
                  if (c.country_code === 'CO' && !c.tax_identifier) reasons.push('Sin NIT en CO');

                  const upperName = (c.name || '').toUpperCase();
                  const upperLegalName = (c.legal_name || '').toUpperCase();
                  const upperLegalStatus = (c.legal_status || '').toUpperCase();
                  const blacklistedKeywords = [
                    'EN LIQUIDACION',
                    'EN LIQUIDACIÓN',
                    'EN DISOLUCION',
                    'EN DISOLUCIÓN',
                    'LIQUIDADA',
                    'DISUELTA',
                    'CANCELADA',
                    'INACTIVA',
                  ];
                  blacklistedKeywords.forEach((kw) => {
                    if (upperName.includes(kw) || upperLegalName.includes(kw) || upperLegalStatus.includes(kw)) {
                      reasons.push(`Filtro nombre/estado: ${kw}`);
                    }
                  });

                  return (
                    <tr key={c.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium text-foreground">{c.name}</td>
                      <td className="px-3 py-2 font-mono">
                        {c.legal_name || '—'}
                        {c.tax_identifier && <span className="block text-[10px] text-muted-foreground">NIT/ID: {c.tax_identifier}</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{c.city || c.region || '—'}</td>
                      <td className="px-3 py-2">
                        <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400">
                          {reasons.length > 0 ? reasons.join(', ') : 'Omitida por calidad'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

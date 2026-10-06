import { formatInAppZone } from '@/lib/format-date';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Building2,
  CheckCircle2,
  XCircle,
  GitMerge,
  ArrowRightCircle,
  AlertTriangle,
  Layers,
  ChevronDown,
} from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { SurfaceCard } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CandidatesTableClient } from '@/components/prospect-batches/candidates-table-client';
import { RollbackBatchDialog } from '@/components/prospect-batches/rollback-batch-dialog';
import { RehydrateBatchButton } from '@/components/prospect-batches/rehydrate-batch-button';
import { ClaudeClassifyBatchButton } from '@/components/prospect-batches/claude-classify-batch-button';
import { isAgent1ClaudeClassifierEnabled, isAgent1ClaudeRescueEnabled } from '@/lib/feature-flags.server';
import { countClaudeClassificationEligible } from '@/server/agents/prospecting-toolkit/claude-classifier/classification-metadata';
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
import { resolveBatchCandidatesPanelState } from '@/components/prospect-batches/batch-candidates-panel-state';
import type { BatchStatus, BatchSource } from '@/modules/prospect-batches/types';
import { getIcpSizeGateSummaryUiState } from '@/components/prospect-batches/icp-size-gate-ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const BATCH_SOURCE_VENDOR_LABELS: Partial<Record<BatchSource, string>> = {
  socrata_colombia: 'Fuente oficial',
  datos_gob_cl: 'Fuente oficial Chile',
};

const STATUS_VARIANT: Record<
  BatchStatus,
  'neutral' | 'brand' | 'warning' | 'info' | 'positive' | 'negative'
> = {
  draft: 'neutral',
  generating: 'warning',
  ready_for_review: 'brand',
  in_review: 'info',
  completed: 'positive',
  cancelled: 'neutral',
  failed: 'negative',
};

interface Props {
  params: Promise<{ batchId: string }>;
}

// La acción «Sugerir sector y tamaño» (Claude) corre en esta ruta: necesita más
// que el tiempo por defecto. Su propio tope de tiempo la mantiene por debajo.
export const maxDuration = 300;

export default async function BatchDetailPage({ params }: Props) {
  const { batchId } = await params;

  const [batch, candidates, isAdmin] = await Promise.all([
    getProspectBatchById(batchId),
    getCandidatesByBatch(batchId),
    isCurrentUserAdmin(),
  ]);

  if (!batch) notFound();

  const claudeEligibleCount = isAgent1ClaudeClassifierEnabled()
    ? countClaudeClassificationEligible(candidates)
    : 0;

  const isStructuredRues =
    batch.country_code === 'CO' ||
    (batch.source as string) === 'socrata_colombia' ||
    batch.metadata?.source_provider === 'socrata_colombia' ||
    batch.metadata?.source_key === 'co_rues' ||
    (batch.metadata?.batch_type === 'structured' &&
      (batch.metadata?.source_key === 'co_rues' ||
        batch.metadata?.source_provider === 'socrata_colombia' ||
        (batch.source as string) === 'socrata_colombia'));

  const isStructuredChile =
    batch.country_code === 'CL' ||
    batch.source === 'datos_gob_cl' ||
    batch.metadata?.source_key === 'datos_gob_cl' ||
    batch.metadata?.source_key === 'cl_res' ||
    batch.metadata?.source_provider === 'datos_gob_cl' ||
    (batch.metadata?.batch_type === 'structured' &&
      (batch.metadata?.source_key === 'datos_gob_cl' ||
        batch.metadata?.source_key === 'cl_res' ||
        batch.metadata?.source_provider === 'datos_gob_cl'));

  const isStructuredOfficial = isStructuredRues || isStructuredChile;
  const isApolloCandidateBatch = !isStructuredOfficial && batch.source === 'agent_1';

  const pageTitle =
    (isStructuredOfficial || isApolloCandidateBatch) && (batch.country || batch.industry)
      ? isStructuredChile
        ? `Empresas candidatas${batch.country ? ` · ${batch.country}` : ''}`
        : `Empresas candidatas${batch.country ? ` · ${batch.country}` : ''}${batch.industry ? ` · ${batch.industry}` : ''}`
      : batch.name;

  const chileSubtitle = isStructuredChile
    ? `Fuente oficial Chile · RES · ${formatInAppZone(batch.created_at, { day: '2-digit', month: 'short', year: 'numeric' }, 'es-CL')}`
    : null;

  const pageSubtitle = (isStructuredOfficial || isApolloCandidateBatch)
    ? (chileSubtitle ?? batch.name)
    : (batch.description ?? undefined);

  // AGENT1-CUT4-C — `isUsefulReviewCandidate` YA NO es la puerta de VISIBILIDAD.
  // `getCandidatesByBatch` devuelve el universo durable del lote (contrato de
  // CUT-1, el mismo del que salen los conteos), y ese universo entero se monta.
  // Un candidato CO sin NIT —el disparador de CUT-4— se ve como cualquier otro.
  //
  // El clasificador conserva intacta su semántica y sigue siendo útil AQUÍ para
  // lo único que le corresponde: ANOTAR por qué una fila está señalada por
  // calidad. Anotar no es ocultar, y la tabla no lo consulta.
  const qualityFlaggedCandidates = candidates.filter((c) => !isUsefulReviewCandidate(c));

  const counts = {
    total: batch.total_candidates ?? 0,
    needs_review: batch.needs_review_count ?? 0,
    approved: batch.approved_count ?? 0,
    discarded: batch.discarded_count ?? 0,
    converted: batch.converted_count ?? 0,
    duplicates: batch.duplicate_count ?? 0,
  };

  // Lo LISTADO es ahora el universo durable recuperado, no un subconjunto de
  // calidad. Si `listedCount` quedara por debajo del total, sería por lectura
  // paginada, jamás por el clasificador — y el aviso lo dice sin negar filas.
  const candidatesPanel = resolveBatchCandidatesPanelState({
    batchId: batch.id,
    durableTotal: counts.total,
    listedCount: candidates.length,
  });

  const summaryCards = [
    {
      label: 'Total emp. candidatas',
      value: counts.total,
      icon: Building2,
      color: 'text-foreground',
      bg: 'bg-surface-muted',
    },
    {
      label: 'Necesitan revisión',
      value: counts.needs_review,
      icon: AlertTriangle,
      color: 'text-warning',
      bg: 'bg-warning/15',
    },
    {
      label: 'Aprobados',
      value: counts.approved,
      icon: CheckCircle2,
      color: 'text-success',
      bg: 'bg-success/10',
    },
    {
      label: 'Descartados',
      value: counts.discarded,
      icon: XCircle,
      color: 'text-muted-foreground',
      bg: 'bg-surface-muted',
    },
    {
      label: 'Convertidos',
      value: counts.converted,
      icon: ArrowRightCircle,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Posibles duplicados',
      value: counts.duplicates,
      icon: GitMerge,
      color: 'text-warning',
      bg: 'bg-warning/15',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        breadcrumbs={
          <Breadcrumbs items={[{ label: 'Prospectos', href: '/prospects' }, pageTitle]} />
        }
        backHref="/prospects"
        title={pageTitle}
        description={pageSubtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin &&
              batch.metadata?.batch_type === 'structured' &&
              (batch.metadata?.source_key === 'co_rues' ||
                batch.metadata?.source_provider === 'socrata_colombia' ||
                batch.source === 'socrata_colombia' ||
                batch.source === 'datos_gob_cl' ||
                batch.metadata?.source_key === 'datos_gob_cl' ||
                batch.metadata?.source_key === 'cl_res') && (
                <RehydrateBatchButton batchId={batch.id} />
              )}
            {/* Dueña 06-10: sin «Completar con Claude», «Buscar más con Claude» ni
                «Agregar empresa candidata» en el lote. El rescate con Claude corre
                solo al terminar la búsqueda y se relanza mientras quede trabajo. */}
            {isAdmin && !isAgent1ClaudeRescueEnabled() && claudeEligibleCount > 0 && (
              <ClaudeClassifyBatchButton batchId={batch.id} eligibleCount={claudeEligibleCount} />
            )}
            {batch.metadata?.batch_type === 'structured' &&
              batch.metadata?.initiated_by === 'agent_1' &&
              batch.metadata?.source_key === 'co_rues' &&
              ['ready_for_review', 'preview', 'draft', 'in_review'].includes(batch.status) &&
              batch.converted_count === 0 && (
                <RollbackBatchDialog batchId={batch.id} batchName={batch.name} />
              )}
          </div>
        }
      />

      {/* Banner importación externa */}
      {(batch.source as string) === 'external_import' && (() => {
        const hasImportValidation = !!(batch.metadata?.import_validation);
        const hsNotConfigured = candidates.some(
          (c) =>
            ((c.metadata?.validation as Record<string, unknown> | undefined)
              ?.hubspot_duplicate_check as Record<string, unknown> | undefined)
              ?.status === 'not_configured',
        );
        return (
          <Alert className="animate-su-fade-in motion-reduce:animate-none">
            {hasImportValidation ? (
              <>
                <AlertTitle className="flex flex-wrap items-center gap-2 text-sm">
                  Candidatos importados y validados automáticamente
                  {hsNotConfigured && <Badge variant="neutral">HubSpot no configurado</Badge>}
                </AlertTitle>
                <AlertDescription className="text-xs">
                  SellUp revisó duplicidad local y calidad básica. HubSpot se validará cuando la
                  integración esté configurada.
                </AlertDescription>
              </>
            ) : (
              <>
                <AlertTitle className="text-sm">Candidatos importados desde fuente externa</AlertTitle>
                <AlertDescription className="text-xs">
                  Estos candidatos fueron cargados manualmente o desde un archivo externo.
                  Requieren revisión humana antes de aprobarse o sincronizarse.
                </AlertDescription>
              </>
            )}
          </Alert>
        );
      })()}

      {/* Alerta de rollback lógico aplicado */}
      {batch.status === 'cancelled' && batch.metadata?.rollback_logical === true && (
        <Alert variant="destructive" className="animate-su-fade-in motion-reduce:animate-none">
          <AlertTitle className="text-sm">Lote revertido</AlertTitle>
          <AlertDescription className="text-xs">
            Los datos permanecen para auditoría, pero el lote ya no está operativo.
            {typeof batch.metadata?.rollback_reason === 'string' && (
              <span className="mt-1 block font-mono">Motivo: {batch.metadata.rollback_reason}</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Banner revisión humana — lotes estructurados */}
      {batch.metadata?.batch_type === 'structured' &&
        batch.metadata?.human_review_required === true && (
          <Alert variant="info" className="animate-su-fade-in motion-reduce:animate-none">
            <AlertTitle className="text-sm text-foreground">Empresas verificadas con fuente oficial</AlertTitle>
            <AlertDescription className="text-xs">
              {isStructuredChile
                ? 'Estas empresas fueron contrastadas con el Registro de Empresas y Sociedades de Chile. Requieren revisión humana antes de aprobarse o sincronizarse.'
                : 'Estas empresas fueron contrastadas con el registro oficial de Colombia. Requieren revisión humana antes de aprobarse o sincronizarse con HubSpot.'}
            </AlertDescription>
          </Alert>
        )}

      {/* Alerta modo mock */}
      {batch.metadata?.generation_mode === 'mock' && (
        <Alert variant="warning">
          <AlertTitle className="text-sm">Lote generado en modo prueba</AlertTitle>
          <AlertDescription className="text-xs">
            Este lote fue generado con datos mock para validar el flujo del pipeline. No usar estos candidatos para convertirlos en empresas reales.
          </AlertDescription>
        </Alert>
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
          <Alert variant="warning">
            <AlertTitle className="text-sm">
              SellUp omitió {skippedCount} empresa{skippedCount !== 1 ? 's' : ''} repetida{skippedCount !== 1 ? 's' : ''}
            </AlertTitle>
            <AlertDescription className="text-xs">
              {skippedCount === 1
                ? 'Esta empresa ya estaba pendiente de revisión en un lote reciente y fue omitida para evitar duplicados.'
                : `Estas empresas ya estaban pendientes de revisión en lotes recientes y fueron omitidas para evitar duplicados.`}
              {previewNames.length > 0 && (
                <span className="ml-1">
                  Ej.: {previewNames.join(', ')}{(ns?.skipped_items?.length ?? 0) > 3 ? '…' : '.'}
                </span>
              )}
            </AlertDescription>
          </Alert>
        );
      })()}

      {/* Alerta modo prueba controlada con búsqueda real */}
      {batch.metadata?.generation_mode === 'controlled_real_test' && (
        <Alert variant="info">
          <AlertTitle className="text-sm">Lote generado con búsqueda web real (prueba controlada)</AlertTitle>
          <AlertDescription className="text-xs">
            Este lote fue generado usando Tavily para búsquedas reales en modo de prueba controlada. Los datos son reales pero el lote se generó en un entorno de validación — revisar antes de convertir candidatos.
          </AlertDescription>
        </Alert>
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
          <Alert variant="info">
            <AlertTitle className="text-sm text-foreground">
              Búsqueda incremental · {roundsExecuted} ronda{roundsExecuted !== 1 ? 's' : ''}
            </AlertTitle>
            <AlertDescription className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {stoppedReason && (
                <span>Detuvo por: <span className="font-medium text-foreground">{reasonLabels[stoppedReason] ?? stoppedReason}</span></span>
              )}
              {totalRaw !== undefined && (
                <span>Resultados evaluados: <span className="font-medium text-foreground">{totalRaw}</span></span>
              )}
              {totalAcc !== undefined && (
                <span>Candidatos acumulados: <span className="font-medium text-foreground">{totalAcc}</span></span>
              )}
              {usefulCount !== undefined && (
                <span>Útiles: <span className="font-medium text-foreground">{usefulCount}</span></span>
              )}
            </AlertDescription>
          </Alert>
        );
      })()}

      {/* Batch meta */}
      <div className="flex flex-wrap items-center gap-2">
        {batch.metadata?.review_ready === false && batch.status === 'ready_for_review' ? (
          <Badge variant="neutral">
            Sin candidatas útiles
          </Badge>
        ) : (
          <Badge variant={STATUS_VARIANT[batch.status]}>
            {BATCH_STATUS_LABELS[batch.status]}
          </Badge>
        )}
        <Badge variant="outline">
          {isApolloCandidateBatch
            ? 'Fuente comercial'
            : isStructuredChile
            ? 'Fuente oficial Chile'
            : (BATCH_SOURCE_VENDOR_LABELS[batch.source] ?? BATCH_SOURCE_LABELS[batch.source])}
        </Badge>
        {!isStructuredOfficial && !isApolloCandidateBatch && (
          <Badge variant="outline">
            Profundidad: {BATCH_SEARCH_DEPTH_LABELS[batch.search_depth]}
          </Badge>
        )}
        {batch.country && (
          <Badge variant="outline">
            {batch.country}
          </Badge>
        )}
        {batch.industry && (
          <Badge variant="outline">
            {isStructuredChile ? `Criterio solicitado: ${batch.industry}` : batch.industry}
          </Badge>
        )}
        {!isApolloCandidateBatch && batch.estimated_cost_usd !== null && batch.estimated_cost_usd > 0 && (
          <Badge variant="outline">
            Costo est.: ${Number(batch.estimated_cost_usd).toFixed(4)}
          </Badge>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {summaryCards.map((card) => (
          <MetricCard
            key={card.label}
            title={card.label}
            value={card.value}
            compact
            icon={
              <div className={`rounded-xl p-2 ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} aria-hidden="true" />
              </div>
            }
          />
        ))}
      </div>

      {/* ICP Size Gate summary */}
      {(() => {
        const icpSummary = getIcpSizeGateSummaryUiState(
          batch.metadata as Record<string, unknown> | null | undefined
        );
        if (!icpSummary.hasSummary) return null;
        return (
          <SurfaceCard>
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-xs font-semibold text-muted-foreground">
                Tamaño ICP
              </p>
              <span className="text-xs text-muted-foreground">
                Umbral: {icpSummary.threshold}
              </span>
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">ICP &gt;200</p>
                <p className="text-xl font-semibold tabular-nums text-success">
                  {icpSummary.pass}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Pendiente</p>
                <p className="text-xl font-semibold tabular-nums text-warning">
                  {icpSummary.needs_validation}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Bloqueados</p>
                <p className="text-xl font-semibold tabular-nums text-destructive">
                  {icpSummary.blocked}
                </p>
              </div>
            </div>
            {icpSummary.topBlockedReasons.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/50 space-y-1">
                <p className="text-xs text-muted-foreground">
                  Razones de bloqueo
                </p>
                <ul className="space-y-0.5">
                  {icpSummary.topBlockedReasons.map((reason, i) => (
                    <li key={i} className="text-xs text-muted-foreground truncate">
                      · {reason}
                    </li>
                  ))}
                  {icpSummary.hiddenReasonCount > 0 && (
                    <li className="text-xs text-muted-foreground italic">
                      +{icpSummary.hiddenReasonCount} más
                    </li>
                  )}
                </ul>
              </div>
            )}
          </SurfaceCard>
        );
      })()}

      {/* Candidates table */}
      <SurfaceCard noPadding>
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
          <p className="min-w-0 truncate text-sm font-semibold text-foreground" title={candidatesPanel.headline}>
            {candidatesPanel.headline}
          </p>
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">
              {batch.target_count ? `Objetivo: ${batch.target_count}` : ''}
            </span>
          </div>
        </div>
        <CandidatesTableClient candidates={candidates} />
        {/*
          CUT4-C — el enlace a la cola oficial SOBREVIVE. Ya no compensa filas
          ocultas (no las hay): sigue siendo el acceso a la cola canónica de
          revisión acotada a este lote. El aviso de filas no listadas sólo
          aparece si la lectura paginada se quedó corta.
        */}
        {candidatesPanel.hasDurableCandidates && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
            <p className="text-xs text-muted-foreground">
              {candidatesPanel.showReviewCallout
                ? candidatesPanel.calloutMessage
                : 'Las acciones de revisión se autorizan con la misma política que la cola de Prospectos.'}
            </p>
            <Link
              href={candidatesPanel.prospectosHref}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              Revisar en Prospectos
              <ArrowRightCircle className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </SurfaceCard>

      {/*
        CUT4-C — estas filas YA NO están omitidas: se listan en la tabla de
        arriba como cualquier otra fila durable. Este bloque deja de ser una
        segunda tabla que las esconde y pasa a ser lo único que aporta de más:
        POR QUÉ el clasificador de calidad las señala.
      */}
      {qualityFlaggedCandidates.length > 0 && (
        <SurfaceCard className="p-4">
          <Collapsible>
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="group/quality h-auto w-full justify-between whitespace-normal px-2 py-1.5 text-left text-muted-foreground"
                />
              }
            >
              <span className="flex flex-wrap items-center gap-2">
                <span>Empresas señaladas por calidad ({qualityFlaggedCandidates.length})</span>
                <Badge variant="warning">Inactivas, disueltas, duplicadas o sin NIT</Badge>
              </span>
              <ChevronDown
                aria-hidden
                className="transition-transform group-aria-expanded/quality:rotate-180 motion-reduce:transition-none"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
          <p className="mt-2 px-2 text-xs text-muted-foreground">
            Estas empresas aparecen en la tabla de arriba. Aquí sólo se explica la
            señal de calidad; no cambia qué acciones autoriza la revisión.
          </p>
          <div className="mt-4 overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Razón social / Identificador</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Señal / Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {qualityFlaggedCandidates.map((c) => {
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
                  if (c.country_code === 'CO' && !c.tax_identifier && c.source_primary !== 'external_import') reasons.push('Sin NIT en CO');

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
                    <TableRow key={c.id}>
                      <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                      <TableCell className="whitespace-normal font-mono">
                        {c.legal_name || '—'}
                        {c.tax_identifier && <span className="block text-xs text-muted-foreground">NIT/ID: {c.tax_identifier}</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c.city || c.region || '—'}</TableCell>
                      <TableCell className="whitespace-normal">
                        <Badge variant="warning" className="h-auto whitespace-normal py-0.5 text-left">
                          {reasons.length > 0 ? reasons.join(', ') : 'Omitida por calidad'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
            </CollapsibleContent>
          </Collapsible>
        </SurfaceCard>
      )}
    </div>
  );
}

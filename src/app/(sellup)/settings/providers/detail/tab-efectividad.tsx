'use client';

/**
 * tab-efectividad.tsx — pestaña «Efectividad» del panel de un proveedor: cómo
 * le fue técnicamente en los registros recientes y, para los proveedores de
 * enriquecimiento, qué resultado dieron sus contactos. Solo lee.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, ArrowRight, CheckCircle, DollarSign, UserCheck, XCircle } from '@/icons';
import { CONTACTS_CANDIDATES_ROUTE } from '@/config/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/typography';
import { CostValue } from '@/components/shared/cost-value';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import type { ProviderSyncLogRow, ProviderUsageLogRow } from '@/modules/budgets/provider-detail-queries';
import type { ProviderEffectivenessProviderSummary } from '@/modules/provider-effectiveness/types';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';
import {
  isEffectivenessSupportedProvider,
  resolveContactEnrichmentEffectivenessUiState,
} from '../contact-enrichment-effectiveness-ui';
import { summarizeProviderEffectiveness } from '../provider-effectiveness-summary';
import { formatDateShort } from './detail-format';
import { LoadingBlock, ProgressiveNote, StatEmpty, StatSection, StatValue } from './detail-shared';

const formatUsd4 = (value: number) => `$${value.toFixed(4)}`;

// ── Resultado técnico ─────────────────────────────────────────────────────────

interface TechnicalStatsProps {
  row: AdminProviderBudgetRow;
  usageLogs: ProviderUsageLogRow[];
  latestSync: ProviderSyncLogRow | undefined;
  loading: boolean;
}

function AvailabilityValue({ row, latestSync }: Pick<TechnicalStatsProps, 'row' | 'latestSync'>) {
  if (latestSync) {
    const syncOk = latestSync.syncStatus === 'success';
    return (
      <div className="flex items-center gap-2">
        <Badge variant={syncOk ? 'positive' : 'negative'}>{syncOk ? 'OK' : 'Error'}</Badge>
        <span className="text-xs tabular-nums text-muted-foreground">{formatDateShort(latestSync.syncedAt)}</span>
      </div>
    );
  }
  if (row.quotaSyncedAt) return <Badge variant="positive">OK</Badge>;
  return <StatEmpty>Sin datos de sync</StatEmpty>;
}

function TechnicalStats({ row, usageLogs, latestSync, loading }: TechnicalStatsProps) {
  const {
    observedLogCount,
    technicalSuccessCount,
    technicalFailureCount,
    technicalSuccessRate,
    isCappedWindow,
    knownCostSubtotalUsd,
    hasUnknownCost,
    hasSufficientRecentEvidence,
  } = useMemo(() => summarizeProviderEffectiveness(usageLogs), [usageLogs]);

  const costMtd = row.usdCostMtd;
  const windowCaption = isCappedWindow
    ? `últimas ${observedLogCount} ops`
    : `${observedLogCount} ops registrada${observedLogCount === 1 ? '' : 's'}`;
  const windowSuffix = isCappedWindow ? 'últimas ops' : 'ops registradas';
  const hasFailures = hasSufficientRecentEvidence && technicalFailureCount > 0;
  const syncFailed = latestSync !== undefined && latestSync.syncStatus !== 'success';

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <StatSection
        title="Resultado técnico reciente"
        hint="Proporción de éxito técnico en los logs recientes registrados."
        icon={CheckCircle}
        tone="positive"
        loading={loading}
      >
        {technicalSuccessRate != null ? (
          <StatValue caption={`(${technicalSuccessCount} / ${observedLogCount} ${windowSuffix})`}>
            {technicalSuccessRate}%
          </StatValue>
        ) : (
          <StatEmpty />
        )}
      </StatSection>

      <StatSection
        title="Costo registrado"
        hint={costMtd != null
          ? 'Costo estimado del mes en curso, según catálogo del proveedor.'
          : 'Costo estimado de las operaciones recientes registradas.'}
        icon={DollarSign}
        tone="brand"
        loading={loading}
      >
        {costMtd != null ? (
          <StatValue>{formatUsd4(costMtd)} MTD (API)</StatValue>
        ) : knownCostSubtotalUsd > 0 || hasUnknownCost ? (
          <StatValue caption={windowCaption}>
            <CostValue
              display={resolveCostDisplay({
                valueUsd: knownCostSubtotalUsd,
                costTruth: toCostTruth(hasUnknownCost),
                formatUsd: formatUsd4,
              })}
            />
          </StatValue>
        ) : (
          <StatEmpty />
        )}
      </StatSection>

      <StatSection
        title="Fallos técnicos recientes"
        hint="Errores y límites de proveedor en los logs recientes registrados."
        icon={XCircle}
        tone={!loading && hasFailures ? 'negative' : 'neutral'}
        loading={loading}
      >
        {hasSufficientRecentEvidence ? (
          <StatValue caption={`fallo${technicalFailureCount !== 1 ? 's' : ''} en ${windowCaption}`}>
            {technicalFailureCount}
          </StatValue>
        ) : (
          <StatEmpty />
        )}
      </StatSection>

      <StatSection
        title="Disponibilidad del proveedor"
        hint="Estado basado en última sincronización."
        icon={Activity}
        tone={!loading && syncFailed ? 'negative' : 'neutral'}
        loading={loading}
      >
        <AvailabilityValue row={row} latestSync={latestSync} />
      </StatSection>
    </div>
  );
}

/** Los dos avisos bajo el resultado técnico: revisar los logs, o que aún no hay con qué resumir. */
function TechnicalFollowUp({ usageLogs, latestSync, onRevisarLogs }: {
  usageLogs: ProviderUsageLogRow[];
  latestSync: ProviderSyncLogRow | undefined;
  onRevisarLogs: () => void;
}) {
  const { technicalFailureCount, hasSufficientRecentEvidence } = useMemo(
    () => summarizeProviderEffectiveness(usageLogs),
    [usageLogs],
  );
  const syncOk = latestSync?.syncStatus === 'success';
  const needsReview = (hasSufficientRecentEvidence && technicalFailureCount > 0) || (latestSync && !syncOk);

  return (
    <>
      {needsReview && (
        <Alert variant="warning">
          <AlertTitle>Hay fallos recientes que conviene revisar</AlertTitle>
          <AlertDescription className="space-y-2 text-xs">
            <p>Los logs muestran qué operación falló y con qué error.</p>
            <Button type="button" size="xs" variant="outline" onClick={onRevisarLogs}>
              Revisar logs
              <ArrowRight aria-hidden="true" />
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!hasSufficientRecentEvidence && (
        <ProgressiveNote>
          Aún no hay operaciones registradas para resumir el comportamiento técnico reciente de este proveedor.
        </ProgressiveNote>
      )}
    </>
  );
}

// ── Enriquecimiento de contactos ──────────────────────────────────────────────

function ContactEnrichmentStats({ summary }: { summary: ProviderEffectivenessProviderSummary }) {
  const { coverage, comparable } = summary;
  const approvalDisplay = comparable.approvalRate != null ? `${Math.round(comparable.approvalRate * 100)}%` : null;
  const zeroReviewableDisplay =
    comparable.zeroReviewableRate != null ? `${Math.round(comparable.zeroReviewableRate * 100)}%` : null;
  const costTruth = toCostTruth(coverage.unknownCostRunCount > 0 || coverage.ambiguousCostRunCount > 0);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <StatSection
        title="Tasa de aprobación"
        hint="Candidatos aprobados sobre candidatos revisables en ejecuciones con resultado comparable."
        icon={UserCheck}
        tone="positive"
      >
        {approvalDisplay != null ? (
          <StatValue>{approvalDisplay}</StatValue>
        ) : (
          <StatEmpty>Sin candidatos revisables en ejecuciones maduras</StatEmpty>
        )}
      </StatSection>

      <StatSection
        title="Costo por contacto aprobado"
        hint="Costo conocido de las ejecuciones que produjeron un contacto aprobado."
        icon={DollarSign}
        tone="brand"
      >
        {comparable.costPerApprovedContactUsd != null ? (
          <StatValue>
            <CostValue
              display={resolveCostDisplay({
                valueUsd: comparable.costPerApprovedContactUsd,
                costTruth,
                formatUsd: formatUsd4,
              })}
            />
          </StatValue>
        ) : coverage.approvedCandidateCount === 0 ? (
          <StatEmpty>Aún no hay contactos aprobados</StatEmpty>
        ) : coverage.costEligibleRunCount === 0 ? (
          <StatEmpty>Costo desconocido para las ejecuciones disponibles</StatEmpty>
        ) : (
          <StatEmpty />
        )}
      </StatSection>

      <StatSection
        title="Ejecuciones sin candidatos revisables"
        hint="Ejecuciones técnicamente exitosas que no produjeron ningún candidato revisable."
        icon={AlertTriangle}
        tone="warning"
      >
        {zeroReviewableDisplay != null ? (
          <StatValue caption={`(${coverage.zeroReviewableRunCount} / ${coverage.zeroReviewableEligibleRunCount})`}>
            {zeroReviewableDisplay}
          </StatValue>
        ) : (
          <StatEmpty />
        )}
      </StatSection>
    </div>
  );
}

export function ContactEnrichmentOutcomeSection({ summary }: { summary: ProviderEffectivenessProviderSummary }) {
  const uiState = resolveContactEnrichmentEffectivenessUiState(summary);

  if (uiState === 'no_evidence') {
    return (
      <ProgressiveNote>
        Aún no hay enriquecimientos individuales de contactos con evidencia suficiente para evaluar este resultado.
      </ProgressiveNote>
    );
  }

  const { coverage } = summary;

  if (uiState === 'pending_review') {
    return (
      <div className="space-y-2">
        <ProgressiveNote>
          Hay {coverage.attributedRunCount} ejecución{coverage.attributedRunCount === 1 ? '' : 'es'} de enriquecimiento
          individual registrada{coverage.attributedRunCount === 1 ? '' : 's'}; ninguna cuenta todavía con resultado
          maduro (revisión de candidatos pendiente).
        </ProgressiveNote>
        <Button asChild size="xs" variant="outline">
          <Link href={CONTACTS_CANDIDATES_ROUTE}>
            Revisar candidatos
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ContactEnrichmentStats summary={summary} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        Lectura basada en {coverage.outcomeMatureRunCount} ejecución{coverage.outcomeMatureRunCount === 1 ? '' : 'es'} de
        enriquecimiento individual con resultado maduro
        {coverage.openReviewRunCount > 0
          ? `; ${coverage.openReviewRunCount} más continúan pendientes de revisión.`
          : '.'}
      </p>
    </div>
  );
}

// ── Pestaña ───────────────────────────────────────────────────────────────────

export interface TabEfectividadProps {
  row: AdminProviderBudgetRow;
  usageLogs: ProviderUsageLogRow[];
  syncLogs: ProviderSyncLogRow[];
  contactEnrichmentEffectiveness: ProviderEffectivenessProviderSummary | null;
  loading: boolean;
  /** Navigates to the Logs tab, URL-safe (Q3F-13S). */
  onRevisarLogs: () => void;
}

export function TabEfectividad({
  row,
  usageLogs,
  syncLogs,
  contactEnrichmentEffectiveness,
  loading,
  onRevisarLogs,
}: TabEfectividadProps) {
  const latestSync = syncLogs[0];

  return (
    <div className="space-y-4">
      <TechnicalStats row={row} usageLogs={usageLogs} latestSync={latestSync} loading={loading} />

      {!loading && <TechnicalFollowUp usageLogs={usageLogs} latestSync={latestSync} onRevisarLogs={onRevisarLogs} />}

      {isEffectivenessSupportedProvider(row.providerKey) && (
        <section className="space-y-3 border-t border-border/50 pt-4">
          <div className="space-y-1">
            <Heading level={6} as="h3">Resultado en enriquecimiento de contactos</Heading>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Enriquecimientos individuales de contactos con evidencia suficiente para evaluar resultado — no es un puntaje general del proveedor.
            </p>
          </div>
          {loading ? (
            <LoadingBlock label="Cargando resultado de enriquecimiento..." />
          ) : contactEnrichmentEffectiveness == null ? (
            <ProgressiveNote>
              No fue posible cargar el resultado de enriquecimiento de contactos para este proveedor en este momento.
            </ProgressiveNote>
          ) : (
            <ContactEnrichmentOutcomeSection summary={contactEnrichmentEffectiveness} />
          )}
        </section>
      )}
    </div>
  );
}

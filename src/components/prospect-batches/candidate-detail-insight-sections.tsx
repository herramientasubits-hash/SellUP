'use client';

import * as React from 'react';
import { ArrowRightCircle, CheckCircle2, ClipboardCheck, Lightbulb, Search, Sparkles, Target } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import { DrawerSection } from '@/components/shared/drawer-section';
import { InfoHint } from '@/components/shared/info-hint';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';
import { sanitizeTextForChile, type HubSpotSyncAudit } from './candidate-detail-helpers';

interface CandidateFoundReasonSectionProps {
  searchTrace: Record<string, unknown> | undefined;
  sourceTitle: string | undefined;
  sourceSnippet: string | undefined;
}

/** «Por qué fue encontrado»: la consulta, el título y el fragmento que lo trajeron. */
export function CandidateFoundReasonSection({
  searchTrace,
  sourceTitle,
  sourceSnippet,
}: CandidateFoundReasonSectionProps) {
  return (
    <DrawerSection title="Por qué fue encontrado" icon={Search}>
      <div className="space-y-3">
        <DetailList className="sm:grid-cols-1">
          {!!searchTrace?.query_text && (
            <DetailItem label="Consulta de búsqueda">
              <span className="text-xs leading-snug font-mono bg-surface-subtle rounded-md px-2.5 py-1.5">
                {String(searchTrace.query_text)}
              </span>
            </DetailItem>
          )}
          {sourceTitle && (
            <DetailItem label="Título encontrado">
              <span className="leading-snug">{sourceTitle}</span>
            </DetailItem>
          )}
          {sourceSnippet && (
            <DetailItem label="Fragmento">
              <span className="text-muted-foreground leading-relaxed italic">
                &ldquo;{sourceSnippet}&rdquo;
              </span>
            </DetailItem>
          )}
        </DetailList>
        {!!searchTrace && (
          <DetailList columns={3} className="border-t border-border/50 pt-3">
            {searchTrace.round_number !== undefined && (
              <DetailItem label="Ronda">
                <span className="tabular-nums">#{String(searchTrace.round_number)}</span>
              </DetailItem>
            )}
            {searchTrace.provider_rank !== undefined && (
              <DetailItem label="Ranking">
                <span className="tabular-nums">#{String(searchTrace.provider_rank)}</span>
              </DetailItem>
            )}
            {!!searchTrace.query_type && (
              <DetailItem label="Tipo">
                <span className="capitalize">{String(searchTrace.query_type)}</span>
              </DetailItem>
            )}
          </DetailList>
        )}
      </div>
    </DrawerSection>
  );
}

interface CandidateRecommendedDecisionSectionProps {
  candidate: ProspectCandidateWithReviewer;
  scoringMeta: Record<string, unknown>;
}

/** «Decisión recomendada»: la acción sugerida por el puntaje y sus tres medidas. */
export function CandidateRecommendedDecisionSection({
  candidate,
  scoringMeta,
}: CandidateRecommendedDecisionSectionProps) {
  return (
    <DrawerSection title="Decisión recomendada" icon={ClipboardCheck}>
      {(() => {
        const action = scoringMeta.recommended_action as string;
        const actionLabels: Record<string, string> = {
          review_manually: 'Revisar manualmente',
          approve: 'Aprobar',
          discard: 'Descartar',
          needs_enrichment: 'Enriquecer antes de decidir',
        };
        const actionVariants: Record<string, 'warning' | 'positive' | 'negative' | 'info'> = {
          review_manually: 'warning',
          approve: 'positive',
          discard: 'negative',
          needs_enrichment: 'info',
        };
        const label = actionLabels[action] ?? action;
        const actionVariant = actionVariants[action] ?? 'neutral';

        const fitScoreVal = candidate.fit_score ?? null;
        const confidenceVal = candidate.confidence_score ?? null;
        const completenessVal = candidate.data_completeness_score ?? null;

        let reason = '';
        if (action === 'review_manually') {
          if (fitScoreVal !== null && fitScoreVal >= 70) {
            reason = 'Candidato con buen encaje preliminar. Validar datos faltantes antes de aprobar.';
          } else if (fitScoreVal !== null && fitScoreVal >= 50) {
            reason =
              'Candidato con señales comerciales relevantes. Requiere enriquecimiento antes de aprobar.';
          } else {
            reason =
              'Candidato requiere revisión. Tiene algunas señales útiles, pero aún falta validar encaje comercial, tamaño y datos clave.';
          }
        } else if (action === 'approve') {
          reason = 'El candidato cumple con los criterios de calidad para ser aprobado.';
        } else if (action === 'discard') {
          reason = 'El candidato no cumple con los criterios mínimos de calidad.';
        } else if (action === 'needs_enrichment') {
          reason = 'Se necesita información adicional antes de tomar una decisión.';
        }

        return (
          <div className="space-y-3">
            <Badge variant={actionVariant}>{label}</Badge>
            {reason && <p className="text-sm text-muted-foreground leading-relaxed">{reason}</p>}
            {(fitScoreVal !== null || confidenceVal !== null || completenessVal !== null) && (
              <DetailList columns={3} className="border-t border-border/50 pt-3">
                {fitScoreVal !== null && (
                  <DetailItem label="Encaje">
                    <span className="font-semibold tabular-nums">{fitScoreVal}/100</span>
                  </DetailItem>
                )}
                {confidenceVal !== null && (
                  <DetailItem label="Confianza">
                    <span className="font-semibold tabular-nums">{confidenceVal}%</span>
                  </DetailItem>
                )}
                {completenessVal !== null && (
                  <DetailItem label="Completitud">
                    <span className="font-semibold tabular-nums">{completenessVal}%</span>
                  </DetailItem>
                )}
              </DetailList>
            )}
          </div>
        );
      })()}
    </DrawerSection>
  );
}

/** «Conversión a cuenta»: la empresa creada en SellUp y el estado de su envío a HubSpot. */
export function CandidateConversionSection({ candidate }: { candidate: ProspectCandidateWithReviewer }) {
  return (
    <DrawerSection title="Conversión a cuenta" icon={ArrowRightCircle}>
      <DetailList>
        <DetailItem icon={ArrowRightCircle} label="Creada en SellUp">
          <span className="break-all font-mono text-xs">ID Cuenta: {candidate.converted_account_id}</span>
        </DetailItem>

        {(() => {
          const hsSync = candidate.metadata?.hubspot_sync as HubSpotSyncAudit | undefined;
          if (!hsSync) return null;

          const statusVariants: Record<string, 'positive' | 'warning' | 'negative' | 'neutral'> = {
            synced: 'positive',
            blocked_duplicate: 'warning',
            blocked_inactive_or_liquidation: 'negative',
            skipped_flag_off: 'neutral',
            skipped_rollback: 'neutral',
            failed_lookup: 'negative',
            failed_create: 'negative',
          };

          const statusLabels: Record<string, string> = {
            synced: 'Sincronizado',
            blocked_duplicate: 'Bloqueado (Duplicado)',
            blocked_inactive_or_liquidation: 'Bloqueado (Inactivo)',
            skipped_flag_off: 'Omitido (sincronización desactivada)',
            skipped_rollback: 'Omitido (operación revertida)',
            failed_lookup: 'Falló la búsqueda',
            failed_create: 'Falló la creación',
          };

          const variant = statusVariants[hsSync.status] ?? 'neutral';
          const label = statusLabels[hsSync.status] || hsSync.status;

          return (
            <>
              <DetailItem label="Sincronización con HubSpot">
                <Badge variant={variant}>{label}</Badge>
              </DetailItem>
              {hsSync.status === 'synced' && hsSync.company_id && (
                <>
                  <DetailItem label="ID HubSpot">
                    <span className="break-all font-mono">{hsSync.company_id}</span>
                  </DetailItem>
                  <DetailItem label="Responsable">
                    {hsSync.owner_assigned || hsSync.owner_mapping_status === 'mapped'
                      ? 'Asignado'
                      : 'No asignado'}
                  </DetailItem>
                </>
              )}
            </>
          );
        })()}
      </DetailList>
    </DrawerSection>
  );
}

interface CandidateFitAnalysisSectionProps {
  candidate: ProspectCandidateWithReviewer;
  fitReasons: string[];
  isChileOfficialCandidate: boolean;
}

/** «Análisis de encaje»: razones de la evaluación y el siguiente paso recomendado. */
export function CandidateFitAnalysisSection({
  candidate,
  fitReasons,
  isChileOfficialCandidate,
}: CandidateFitAnalysisSectionProps) {
  return (
    <DrawerSection
      title="Análisis de encaje"
      icon={Target}
      action={
        <InfoHint label="Más información">
          Evaluación automática basada en información pública. No reemplaza la revisión comercial.
        </InfoHint>
      }
      contentClassName="space-y-3"
    >
      {fitReasons.length > 0 && (
        <ul className="space-y-1.5">
          {fitReasons.slice(0, 4).map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-sm text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">
                {isChileOfficialCandidate ? sanitizeTextForChile(r) : r}
              </span>
            </li>
          ))}
          {fitReasons.length > 4 && (
            <li className="text-xs text-muted-foreground italic pl-5">
              +{fitReasons.length - 4} razones más en detalle
            </li>
          )}
        </ul>
      )}
      {(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const enrichmentData = candidate.metadata?.enrichment as any;
        const recommended = enrichmentData?.sellup_fit?.recommended_next_step;
        if (!recommended) return null;
        return (
          <div className="pt-3 border-t border-border/50 space-y-1">
            <p className="text-xs font-semibold text-primary">Siguiente paso recomendado</p>
            <p className="text-sm text-foreground font-medium leading-relaxed break-words">{recommended}</p>
          </div>
        );
      })()}
    </DrawerSection>
  );
}

/**
 * «Necesidades detectadas» y «Ángulos comerciales». El «ver todas» es estado
 * propio: quien lo monta le pone `key={candidate.id}` para que se reinicie al
 * cambiar de prospecto.
 */
export function CandidateOpportunitySections({ candidate }: { candidate: ProspectCandidateWithReviewer }) {
  const [showAllNeeds, setShowAllNeeds] = React.useState(false);
  const [showAllAngles, setShowAllAngles] = React.useState(false);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <DrawerSection title="Necesidades detectadas" icon={Lightbulb}>
        {(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const enrichmentData = candidate.metadata?.enrichment as any;
          const needs = enrichmentData?.sellup_fit?.possible_needs as string[] | undefined;
          if (!needs || needs.length === 0)
            return <EmptyState variant="plain" title="Ninguna detectada" className="py-4" />;
          const visibleNeeds = showAllNeeds ? needs : needs.slice(0, 3);
          return (
            <div className="space-y-2">
              <ul className="space-y-1.5">
                {visibleNeeds.map((n, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm text-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words">{n}</span>
                  </li>
                ))}
              </ul>
              {needs.length > 3 && (
                <Button
                  variant="link"
                  size="xs"
                  className="mt-1 px-0"
                  onClick={() => setShowAllNeeds(!showAllNeeds)}
                  type="button"
                >
                  {showAllNeeds ? 'Ver menos' : `Ver todas (${needs.length})`}
                </Button>
              )}
            </div>
          );
        })()}
      </DrawerSection>
      <DrawerSection title="Ángulos comerciales" icon={Sparkles}>
        {(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const enrichmentData = candidate.metadata?.enrichment as any;
          const angles = enrichmentData?.commercial_angles as string[] | undefined;
          if (!angles || angles.length === 0)
            return <EmptyState variant="plain" title="Ninguno disponible" className="py-4" />;
          const visibleAngles = showAllAngles ? angles : angles.slice(0, 3);
          return (
            <div className="space-y-2">
              <ul className="space-y-1.5">
                {visibleAngles.map((ang, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm text-foreground font-medium">
                    <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words">{ang}</span>
                  </li>
                ))}
              </ul>
              {angles.length > 3 && (
                <Button
                  variant="link"
                  size="xs"
                  className="mt-1 px-0"
                  onClick={() => setShowAllAngles(!showAllAngles)}
                  type="button"
                >
                  {showAllAngles ? 'Ver menos' : `Ver todos (${angles.length})`}
                </Button>
              )}
            </div>
          );
        })()}
      </DrawerSection>
    </div>
  );
}

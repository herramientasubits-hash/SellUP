'use client';

// Las celdas de la tabla «Por revisar» que resumen varias señales en una sola
// línea: calidad, duplicidad y estado. Vivían dentro de
// `prospects-data-table-client.tsx`; se sacaron aquí para que la tabla se
// quede en columnas y acciones. Son solo presentación: no llaman a nada.
//
// Cada celda ocupa UNA línea (Foundation § 10.11): lo secundario —confianza,
// identificador fiscal, detalle de la evaluación— va en el tooltip y en el
// panel de detalle. Así caben el doble de filas en pantalla.

import * as React from 'react';
import type { ComponentProps } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ModalShell } from '@/components/shared/modal-shell';
import { EmptyCell } from '@/components/shared/table-cells';
import { getCandidateLinkedInUrl } from '@/modules/prospect-batches/candidate-linkedin-url';
import {
  CANDIDATE_STATUS_LABELS,
  isStructuredCandidate,
  parseDuplicateCheck,
  type ProspectCandidateWithReviewer,
} from '@/modules/prospect-batches/types';

export interface ProspectRow extends ProspectCandidateWithReviewer {
  batch?: { name: string; source: string; created_at: string } | null;
}

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;

const TOOLTIP_PANEL =
  'max-w-xs rounded-lg border border-border/60 bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-drawer z-[70]';

const FIT_STATUS_LABELS: Record<string, string> = {
  high: 'Encaje alto',
  medium: 'Encaje medio',
  low: 'Encaje bajo',
  unknown: 'Evaluación no disponible',
  high_fit: 'Encaje alto',
  good_fit: 'Buen encaje',
  medium_fit: 'Encaje medio',
  low_fit: 'Encaje bajo',
  needs_manual_review: 'Requiere revisión humana',
  insufficient_evidence: 'Evaluación no disponible por falta de evidencia pública confiable',
  tax_identifier_conflict: 'Evaluación pausada por NIT inconsistente',
};

const EVALUATED_FIT_STATUSES = ['high', 'medium', 'low', 'high_fit', 'good_fit', 'medium_fit', 'low_fit'];

// ── Helpers ────────────────────────────────────────────────────

export function getNestedValue(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function isPendingReviewStatus(status: string): boolean {
  return status === 'needs_review' || status === 'generated' || status === 'normalized';
}

function readEnrichmentStatus(candidate: ProspectRow): string | undefined {
  const enrichment = (candidate.metadata?.enrichment as Record<string, unknown>) || {};
  return enrichment.status as string | undefined;
}

function hasCleanValidation(candidate: ProspectRow): boolean {
  const validationMeta = (candidate.metadata as unknown as { validation?: Record<string, unknown> })
    ?.validation;
  const hasDuplicate =
    candidate.duplicate_status === 'possible_duplicate' ||
    candidate.duplicate_status === 'exact_duplicate';
  return Boolean(validationMeta) && !hasDuplicate;
}

/** La clave por la que se ordena y se filtra la columna «Estado». */
export function getDisplayStatusKey(candidate: ProspectRow): string {
  const enrichmentStatus = readEnrichmentStatus(candidate);
  if (enrichmentStatus === 'pending') return 'enrichment_pending';
  if (enrichmentStatus === 'enriching') return 'enriching';
  if (enrichmentStatus === 'failed') return 'enrichment_failed';
  if (hasCleanValidation(candidate)) return 'validated';
  return candidate.status;
}

/** Lo que se lee en el chip de estado. */
export function getDisplayStatus(candidate: ProspectRow): string {
  const enrichmentStatus = readEnrichmentStatus(candidate);
  if (enrichmentStatus === 'pending') return 'Enriquecimiento pendiente';
  if (enrichmentStatus === 'enriching') return 'Enriqueciendo…';
  if (enrichmentStatus === 'failed') return 'Enriquecimiento fallido';
  if (hasCleanValidation(candidate)) return 'Validado para revisión';
  if (isPendingReviewStatus(candidate.status)) return 'Necesita revisión';
  return CANDIDATE_STATUS_LABELS[candidate.status] ?? candidate.status;
}

const STATUS_KEY_VARIANT: Record<string, BadgeVariant> = {
  enrichment_pending: 'neutral',
  enriching: 'brand',
  enrichment_failed: 'negative',
  validated: 'positive',
  needs_review: 'warning',
  generated: 'warning',
  normalized: 'warning',
  approved: 'positive',
  discarded: 'neutral',
  duplicate: 'warning',
  converted_to_account: 'brand',
};

/** El tono del chip de estado: sale de la misma clave que el filtro. */
export function getDisplayStatusVariant(candidate: ProspectRow): BadgeVariant {
  return STATUS_KEY_VARIANT[getDisplayStatusKey(candidate)] ?? 'neutral';
}

interface FitEvaluation {
  score: number | null;
  /** La frase completa, para el tooltip y la vista de lista. */
  text: string;
}

/** Lo que dijo la evaluación automática de encaje, si la hubo. */
export function getFitEvaluation(candidate: ProspectRow): FitEvaluation {
  const fitStatusValue =
    candidate.commercial_fit_status ||
    getNestedValue(candidate.metadata, ['enrichment', 'ai_evaluation', 'fit_status']) ||
    getNestedValue(candidate.metadata, ['ai_evaluation', 'fit_status']) ||
    null;
  const fitStatus = typeof fitStatusValue === 'string' ? fitStatusValue : null;
  const score = candidate.fit_score ?? null;
  const hasEvaluation =
    score !== null || (fitStatus !== null && EVALUATED_FIT_STATUSES.includes(fitStatus));

  if (hasEvaluation) {
    const fitLabel = fitStatus ? (FIT_STATUS_LABELS[fitStatus] ?? fitStatus) : '';
    if (score !== null) return { score, text: `IA ${score}/100${fitLabel ? ` · ${fitLabel}` : ''}` };
    return { score, text: `IA · ${fitLabel}` };
  }
  if (fitStatus === 'insufficient_evidence') return { score, text: 'Evidencia insuficiente para evaluar' };
  if (fitStatus === 'tax_identifier_conflict') return { score, text: 'Evaluación pausada' };
  return { score, text: 'Sin evaluación de IA todavía' };
}

// ── Duplicidad ─────────────────────────────────────────────────

export function DuplicateCheckCell({ candidate }: { candidate: ProspectRow }) {
  const [detailOpen, setDetailOpen] = React.useState(false);

  const dc = parseDuplicateCheck(candidate.metadata);
  const matches = dc?.matches ?? [];
  const valObj = (candidate.metadata as unknown as {
    validation?: {
      sellup_duplicate_check?: { status?: string; matched_name?: string | null };
      hubspot_duplicate_check?: { status?: string; matched_company_name?: string | null };
    };
  })?.validation;

  let sellupStatus = valObj?.sellup_duplicate_check?.status;
  let hsStatus = valObj?.hubspot_duplicate_check?.status;

  if (!valObj && dc) {
    const sources = dc.sources_checked ?? [];
    sellupStatus = sources.includes('sellup') ? 'no_match' : undefined;
    hsStatus = sources.includes('hubspot') ? 'no_match' : undefined;

    for (const m of matches) {
      if (m.source === 'sellup') {
        sellupStatus = m.status === 'exact_duplicate' || m.status === 'duplicate' ? 'duplicate' : 'possible_duplicate';
      } else if (m.source === 'hubspot') {
        hsStatus = m.status === 'match' || m.status === 'exact_duplicate' || m.status === 'duplicate' ? 'match' : 'possible_match';
      }
    }
  }

  if (!sellupStatus && !hsStatus) {
    if (candidate.duplicate_status === 'exact_duplicate') {
      sellupStatus = 'duplicate';
    } else if (candidate.duplicate_status === 'possible_duplicate' || candidate.duplicate_status === 'related_company') {
      sellupStatus = 'possible_duplicate';
    } else if (candidate.duplicate_status === 'no_match') {
      sellupStatus = 'no_match';
      hsStatus = 'no_match';
    }
  }

  // Design Refresh v1: chip solo cuando hay alerta real de duplicidad. El caso
  // común («Sin coincidencias») va como texto plano y lo que aún no se ha
  // comprobado, como el vacío de todas las tablas.
  let primaryDupLabel = 'Sin verificar';
  let primaryDupStyle: 'negative' | 'warning' | null = null;
  let isVerified = false;

  if (sellupStatus === 'duplicate' || hsStatus === 'match') {
    primaryDupLabel = 'Duplicado confirmado';
    primaryDupStyle = 'negative';
    isVerified = true;
  } else if (sellupStatus === 'possible_duplicate' || hsStatus === 'possible_match') {
    primaryDupLabel = 'Posible duplicado';
    primaryDupStyle = 'warning';
    isVerified = true;
  } else if (sellupStatus === 'no_match' || hsStatus === 'no_match') {
    primaryDupLabel = 'Sin coincidencias';
    isVerified = true;
  }

  let sellupTooltipLabel = 'SellUp: sin verificar';
  if (sellupStatus === 'duplicate') sellupTooltipLabel = 'SellUp: duplicado confirmado';
  else if (sellupStatus === 'possible_duplicate') sellupTooltipLabel = 'SellUp: posible duplicado';
  else if (sellupStatus === 'no_match') sellupTooltipLabel = 'SellUp: sin coincidencias';

  let hsTooltipLabel = 'HubSpot: sin verificar';
  if (hsStatus === 'match') hsTooltipLabel = 'HubSpot: duplicado confirmado';
  else if (hsStatus === 'possible_match') hsTooltipLabel = 'HubSpot: posible duplicado';
  else if (hsStatus === 'no_match') hsTooltipLabel = 'HubSpot: sin coincidencias';
  else if (hsStatus === 'error') hsTooltipLabel = 'HubSpot: error de verificación';
  else if (hsStatus === 'not_configured') hsTooltipLabel = 'HubSpot: no configurado';

  let trigger: React.ReactElement;
  if (primaryDupStyle) {
    trigger = (
      <Badge variant={primaryDupStyle} className="cursor-help">
        {primaryDupLabel}
      </Badge>
    );
  } else if (isVerified) {
    trigger = <span className="w-fit cursor-help text-xs text-muted-foreground">{primaryDupLabel}</span>;
  } else {
    trigger = (
      <span className="w-fit cursor-help">
        <EmptyCell label="Duplicidad sin verificar" />
      </span>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={trigger} />
          <TooltipContent className={`space-y-1 ${TOOLTIP_PANEL}`}>
            <p className="mb-1.5 border-b border-border/50 pb-1.5 text-xs font-semibold text-foreground">Detalle de duplicidad</p>
            <p>{sellupTooltipLabel}</p>
            <p>{hsTooltipLabel}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {matches.length > 0 && (
        <Button
          variant="link"
          size="xs"
          onClick={(event) => {
            event.stopPropagation();
            setDetailOpen(true);
          }}
          aria-label={
            matches.length === 1
              ? `Ver 1 coincidencia de ${candidate.name}`
              : `Ver ${matches.length} coincidencias de ${candidate.name}`
          }
          title={matches.length === 1 ? 'Ver 1 coincidencia' : `Ver ${matches.length} coincidencias`}
          className="h-auto shrink-0 p-0 tabular-nums text-warning"
        >
          ({matches.length})
        </Button>
      )}

      <ModalShell
        open={detailOpen}
        onOpenChange={setDetailOpen}
        title="Coincidencias de duplicidad"
        description={`${candidate.name} · ${primaryDupLabel}`}
      >

          <div className="space-y-3">
            {dc?.summary && (
              <p className="text-sm leading-relaxed text-muted-foreground">{dc.summary}</p>
            )}
            {matches.length > 0 ? (
              <ul className="max-h-60 divide-y divide-border/50 overflow-y-auto pr-1">
                {matches.map((match, i) => (
                  <li key={i} className="space-y-1 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground">
                        {match.source === 'sellup' ? 'SellUp' : match.source === 'hubspot' ? 'HubSpot' : match.source}
                      </span>
                      {match.confidence !== null && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          Confianza: {match.confidence}%
                        </span>
                      )}
                    </div>
                    {match.matched_name && (
                      <p className="break-words text-sm font-medium text-foreground">{match.matched_name}</p>
                    )}
                    {match.matched_domain && (
                      <p className="break-all text-xs text-muted-foreground">{match.matched_domain}</p>
                    )}
                    {match.matched_website && (
                      <a
                        href={match.matched_website.startsWith('http') ? match.matched_website : `https://${match.matched_website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block break-all rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                      >
                        {match.matched_website}
                      </a>
                    )}
                    {match.reason && (
                      <p className="text-xs italic leading-relaxed text-muted-foreground">{match.reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin detalle de duplicidad disponible.</p>
            )}
          </div>
      </ModalShell>
    </div>
  );
}

// ── Calidad ────────────────────────────────────────────────────

export function QualityCell({ candidate }: { candidate: ProspectRow }) {
  const isChileOfficialCandidate =
    candidate.source_primary === 'datos_gob_cl' ||
    candidate.country_code === 'CL' ||
    (candidate.source_primary as string) === 'cl_res';

  const missingFields: string[] = [];
  const validationMeta = (candidate.metadata as unknown as {
    validation?: {
      quality_check?: { missing_fields?: string[]; import_confidence?: string };
    };
  })?.validation;

  if (validationMeta?.quality_check?.missing_fields) {
    missingFields.push(...validationMeta.quality_check.missing_fields);
  } else {
    if (!candidate.website) missingFields.push('website');
    const linkedinUrl = getNestedValue(candidate.metadata, ['enrichment', 'web', 'linkedin_company', 'url'])
      || getNestedValue(candidate.metadata, ['enrichment', 'linkedin_url'])
      || getNestedValue(candidate.metadata, ['enrichment', 'linkedin'])
      || getNestedValue(candidate.metadata, ['external', 'linkedin_url'])
      || getNestedValue(candidate.metadata, ['import', 'linkedin_url'])
      // Q3F-5BB.7D: also recognize the canonical helper paths (linkedin_enrichment
      // .company_url + Lusha's flat metadata.linkedin_url). Purely additive.
      || getCandidateLinkedInUrl(candidate.metadata);
    if (!linkedinUrl) missingFields.push('linkedin_url');
    if (!candidate.tax_identifier) missingFields.push('tax_identifier');
    if (!candidate.industry && !(candidate.metadata?.enrichment as Record<string, unknown> | undefined)?.sector_description) missingFields.push('industry');
  }

  // Un punto de color + texto: máximo un chip de color por fila (el de Estado).
  let completenessText = 'Información completa';
  let completenessDot = 'bg-success';
  if (missingFields.length > 0) {
    if (missingFields.length >= 3 && !candidate.website && !candidate.tax_identifier) {
      completenessText = 'Sin evidencia';
      completenessDot = 'bg-border';
    } else {
      completenessText = `${missingFields.length} ${missingFields.length === 1 ? 'dato pendiente' : 'datos pendientes'}`;
      completenessDot = 'bg-warning';
    }
  }

  let confidenceText = 'Confianza media';
  const rawConfidence = validationMeta?.quality_check?.import_confidence
    || getNestedValue(candidate.metadata, ['import', 'confidence'])
    || getNestedValue(candidate.metadata, ['validation', 'quality_check', 'confidence']);

  if (rawConfidence) {
    const confLower = String(rawConfidence).toLowerCase();
    if (confLower === 'alta' || confLower === 'high') confidenceText = 'Confianza alta';
    else if (confLower === 'media' || confLower === 'medium') confidenceText = 'Confianza media';
    else if (confLower === 'baja' || confLower === 'low') confidenceText = 'Confianza baja';
  } else if (isChileOfficialCandidate || isStructuredCandidate(candidate)) {
    confidenceText = 'Confianza alta';
  }

  let fiscalStatusKey: 'validated' | 'to_review' | 'none' = 'none';
  if (candidate.tax_identifier) {
    fiscalStatusKey = 'validated';
  } else {
    const lookup = (candidate.metadata as Record<string, unknown>)?.tax_identifier_lookup as Record<string, unknown> | undefined;
    const bestCandidate = lookup?.best_candidate as Record<string, unknown> | undefined;
    if (bestCandidate?.tax_identifier) fiscalStatusKey = 'to_review';
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={
          <span className="flex w-fit max-w-full cursor-help items-center gap-1.5 text-xs text-foreground">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${completenessDot}`} aria-hidden="true" />
            <span className="truncate">{completenessText}</span>
          </span>
        } />
        <TooltipContent className={`space-y-1.5 ${TOOLTIP_PANEL}`}>
          <p className="mb-1.5 border-b border-border/50 pb-1.5 text-xs font-semibold text-foreground">Detalle de calidad</p>
          <ul className="space-y-1 text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span className={candidate.website ? 'text-success' : 'text-warning'}>
                {candidate.website ? '✓' : '✗'}
              </span>
              <span>Sitio web: {candidate.website ? 'Presente' : 'Pendiente'}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className={!missingFields.includes('linkedin_url') ? 'text-success' : 'text-warning'}>
                {!missingFields.includes('linkedin_url') ? '✓' : '✗'}
              </span>
              <span>LinkedIn: {!missingFields.includes('linkedin_url') ? 'Presente' : 'Pendiente'}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className={candidate.tax_identifier ? 'text-success' : fiscalStatusKey === 'to_review' ? 'text-warning' : 'text-muted-foreground'}>
                {candidate.tax_identifier ? '✓' : fiscalStatusKey === 'to_review' ? '?' : '✗'}
              </span>
              <span>Identificador fiscal: {candidate.tax_identifier ? `Presente (${candidate.tax_identifier_type || 'NIT'})` : fiscalStatusKey === 'to_review' ? 'Sugerido por revisar' : 'No disponible'}</span>
            </li>
            <li className="mt-1.5 flex items-center gap-1.5 border-t border-border/50 pt-1.5">
              <span className="font-medium">Nivel de confianza:</span>
              <span className="text-foreground capitalize">{confidenceText.split(' ')[1]}</span>
            </li>
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Estado ─────────────────────────────────────────────────────

/** El chip de estado de un prospecto, por variante del sistema. */
export function ProspectStatusBadge({ candidate, className }: { candidate: ProspectRow; className?: string }) {
  const isEnriching = readEnrichmentStatus(candidate) === 'enriching';
  return (
    <Badge
      variant={getDisplayStatusVariant(candidate)}
      className={[isEnriching ? 'animate-pulse' : '', className ?? ''].join(' ').trim() || undefined}
    >
      {getDisplayStatus(candidate)}
    </Badge>
  );
}

export function StatusCell({ candidate }: { candidate: ProspectRow }) {
  const enrichment = (candidate.metadata?.enrichment as Record<string, unknown>) || {};
  const enrichmentFailed = enrichment.status === 'failed';
  const enrichmentError = enrichment.error_message as string | undefined;
  const evaluation = getFitEvaluation(candidate);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={
          <span className="flex w-fit max-w-full cursor-help items-center gap-1.5">
            <ProspectStatusBadge candidate={candidate} />
            {evaluation.score !== null && (
              <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                {evaluation.score}
              </span>
            )}
          </span>
        } />
        <TooltipContent className={`space-y-1.5 ${TOOLTIP_PANEL}`}>
          {enrichmentFailed && (
            <p className="text-destructive">
              <span className="font-semibold">Detalle del error: </span>
              {enrichmentError || 'Error desconocido durante el enriquecimiento con IA.'}
            </p>
          )}
          <p className="font-semibold text-foreground">{evaluation.text}</p>
          <p className="text-muted-foreground">
            Evaluación automática basada en la información pública disponible. No reemplaza la revisión comercial.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

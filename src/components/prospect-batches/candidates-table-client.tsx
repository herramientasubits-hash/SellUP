'use client';

import * as React from 'react';
import { Building2, Globe, ShieldCheck, ExternalLink, Link2, AlertTriangle } from 'lucide-react';
import { getCandidateLinkedInDisplay } from '@/modules/prospect-batches/candidate-linkedin-url';
import { Badge } from '@/components/ui/badge';
import { EmptyState as SharedEmptyState } from '@/components/ui/empty-state';
import {
  hasOwnershipUnverifiedFlag,
  OWNERSHIP_UNVERIFIED_DETAIL,
  OWNERSHIP_UNVERIFIED_LABEL,
} from '@/modules/prospect-batches/ownership-review-flag';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  CANDIDATE_STATUS_LABELS,
  VENDOR_STRUCTURED_SOURCE_LABELS,
  isStructuredCandidate,
  parseDuplicateCheck,
  type ProspectCandidateWithReviewer,
  type CandidateStatus,
  type DuplicateMatch,
} from '@/modules/prospect-batches/types';
import {
  BatchCandidateSafeActions,
  type BatchCandidateActionIntent,
} from './batch-candidate-safe-actions';
import { CandidateDetailSheet } from './candidate-detail-sheet';
import { getIcpSizeGateUiState } from './icp-size-gate-ui';

interface TableQualityCheck {
  has_website?: boolean;
  has_linkedin?: boolean;
  import_confidence?: string;
  has_tax_identifier?: boolean;
  warnings?: string[];
  missing_fields?: string[];
}

interface TableValidationMetadata {
  validation_source?: string;
  sellup_duplicate_check?: { status?: string; matched_name?: string | null };
  hubspot_duplicate_check?: { status?: string; matched_company_name?: string | null };
  quality_check?: TableQualityCheck;
}

interface TableCandidateMetadata {
  validation?: TableValidationMetadata;
}

type StatusTone = 'neutral' | 'warning' | 'positive' | 'negative' | 'brand';

const STATUS_TONES: Record<CandidateStatus, StatusTone> = {
  generated: 'neutral',
  normalized: 'neutral',
  needs_review: 'warning',
  approved: 'positive',
  discarded: 'neutral',
  duplicate: 'warning',
  converted_to_account: 'brand',
};

const SOURCE_LABELS: Record<string, string> = {
  sellup: 'SellUp',
  hubspot: 'HubSpot',
};

function getNestedValue(obj: unknown, path: string[]): unknown {
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

function extractDomainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const { hostname } = new URL(normalized);
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

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

function MatchDetail({ match }: { match: DuplicateMatch }) {
  return (
    <div className="space-y-1 rounded-lg border border-border/60 bg-surface-subtle p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          {SOURCE_LABELS[match.source] ?? match.source}
        </span>
        {match.confidence !== null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            Conf: {match.confidence}%
          </span>
        )}
      </div>
      {match.matched_name && (
        <p className="text-xs text-foreground">{match.matched_name}</p>
      )}
      {match.matched_domain && (
        <p className="text-xs text-muted-foreground">{match.matched_domain}</p>
      )}
      {match.matched_website && (
        <a
          href={
            match.matched_website.startsWith('http')
              ? match.matched_website
              : `https://${match.matched_website}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className="block break-all rounded-sm text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {match.matched_website}
        </a>
      )}
      {match.reason && (
        <p className="text-xs text-muted-foreground italic">{match.reason}</p>
      )}
    </div>
  );
}

function DuplicateCheckCell({ candidate }: { candidate: ProspectCandidateWithReviewer }) {
  const [detailOpen, setDetailOpen] = React.useState(false);

  const dc = parseDuplicateCheck(candidate.metadata);
  const matches = dc?.matches ?? [];
  const valObj = (candidate.metadata as unknown as TableCandidateMetadata)?.validation;

  let sellupStatus = valObj?.sellup_duplicate_check?.status;
  let hsStatus = valObj?.hubspot_duplicate_check?.status;

  // Fallback to legacy structure
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

  // Fallback to candidate fields
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

  let primaryDupLabel = 'Sin verificar';
  let primaryDupVariant: 'neutral' | 'negative' | 'warning' | 'positive' = 'neutral';

  if (sellupStatus === 'duplicate' || hsStatus === 'match') {
    primaryDupLabel = 'Duplicado confirmado';
    primaryDupVariant = 'negative';
  } else if (sellupStatus === 'possible_duplicate' || hsStatus === 'possible_match') {
    primaryDupLabel = 'Posible duplicado';
    primaryDupVariant = 'warning';
  } else if (sellupStatus === 'no_match' || hsStatus === 'no_match') {
    primaryDupLabel = 'Sin coincidencias';
    primaryDupVariant = 'positive';
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

  return (
    <div className="flex flex-col gap-1 w-fit">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={
            <Badge variant={primaryDupVariant} className="cursor-help">
              {primaryDupLabel}
            </Badge>
          } />
          <TooltipContent className="flex-col items-start gap-1 leading-relaxed">
            <p className="mb-1 border-b border-background/20 pb-1 font-semibold">Detalle de Duplicidad</p>
            <p>{sellupTooltipLabel}</p>
            <p>{hsTooltipLabel}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {matches.length > 0 && (
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="rounded-sm text-left text-xs font-medium text-warning hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {matches.length === 1 ? '1 coincidencia' : `${matches.length} coincidencias`}
        </button>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Coincidencias de duplicidad</DialogTitle>
            <DialogDescription>
              {candidate.name} · {primaryDupLabel}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {dc?.summary && (
              <p className="text-sm text-muted-foreground">{dc.summary}</p>
            )}
            {matches.length > 0 ? (
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {matches.map((match, i) => (
                  <MatchDetail key={i} match={match} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sin detalle de duplicidad disponible.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState() {
  return (
    <SharedEmptyState
      icon={Building2}
      title="Sin empresas candidatas"
      description={'Usa el botón "Agregar empresa candidata" para comenzar.'}
      className="m-4 border-0 bg-transparent py-16"
    />
  );
}

interface CandidateWithBatch extends ProspectCandidateWithReviewer {
  batch?: { name: string; source: string; created_at: string } | null;
}

function getCandidateOriginLabel(candidate: CandidateWithBatch): string {
  const batch = candidate.batch;
  if (!batch) return 'Creación manual';
  if (batch.source === 'manual') return 'Creación manual';
  if (batch.source === 'external_import') {
    if (batch.created_at) {
      const date = new Date(batch.created_at).toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'short',
      });
      return `Importado el ${date}`;
    }
    return 'Importación externa';
  }
  if (batch.source === 'agent_1') return 'Generado por IA';
  const sourceLabels: Record<string, string> = {
    socrata_colombia: 'RUES Colombia',
    datos_gob_cl: 'Oficial Chile',
    denue_mexico: 'DENUE México',
    apollo: 'Apollo',
  };
  return sourceLabels[batch.source] ?? batch.name ?? 'Origen desconocido';
}

interface CandidatesTableClientProps {
  candidates: ProspectCandidateWithReviewer[];
}

export function CandidatesTableClient({ candidates }: CandidatesTableClientProps) {
  const [detailCandidate, setDetailCandidate] =
    React.useState<ProspectCandidateWithReviewer | null>(null);
  // AGENT1-CUT4-C — qué confirmación abre el drawer. El menú de fila NUNCA muta:
  // sólo declara una intención, y `ProspectReviewActions` (en el pie del drawer)
  // decide si esa intención es siquiera elegible antes de armar nada.
  const [detailIntent, setDetailIntent] =
    React.useState<BatchCandidateActionIntent>('detail');

  const openCandidateDetail = React.useCallback(
    (candidate: ProspectCandidateWithReviewer, intent: BatchCandidateActionIntent) => {
      setDetailIntent(intent);
      setDetailCandidate(candidate);
    },
    [],
  );

  // Sólo un lote SIN filas durables está vacío. La tabla ya recibe el universo
  // durable completo, así que `length === 0` significa literalmente «no hay
  // nada persistido» — nunca «el clasificador de calidad las descartó».
  if (candidates.length === 0) return <EmptyState />;

  return (
    <>
      <div className="su-table-scroll">
        <table className="su-table su-table-sticky">
          <thead>
            <tr className="border-b border-border/60 bg-surface-subtle">
              {['Empresa', 'Perfil', 'Calidad', 'Duplicidad', 'Estado', ''].map(
                (col) => {
                  let tooltipContent = '';
                  if (col === 'Calidad') {
                    tooltipContent = 'Nivel de completitud, confianza de importación y estado del identificador fiscal.';
                  } else if (col === 'Duplicidad') {
                    tooltipContent = 'Posibles registros duplicados encontrados en SellUp o HubSpot.';
                  } else if (col === 'Estado') {
                    tooltipContent = 'Estado de revisión del prospecto y evaluación automática por IA.';
                  }

                  return (
                    <th
                      key={col}
                      className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-muted-foreground"
                    >
                      {tooltipContent ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger render={
                              <span className="cursor-help border-b border-dotted border-muted-foreground/30 pb-0.5 hover:text-foreground transition-colors">
                                {col}
                              </span>
                            } />
                            <TooltipContent className="max-w-xs leading-relaxed">
                              {tooltipContent}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        col
                      )}
                    </th>
                  );
                }
              )}
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => {
              const isChileOfficialCandidate =
                c.source_primary === 'datos_gob_cl' ||
                c.country_code === 'CL' ||
                (c.source_primary as string) === 'cl_res';
              const sectorDescription =
                c.industry ??
                ((c.metadata?.enrichment as Record<string, unknown> | undefined)
                  ?.sector_description as string | undefined) ??
                null;
              const domain = c.website ? extractDomainFromUrl(c.website) : null;
              const location = [c.country ?? c.country_code, c.city].filter(Boolean).join(' · ');

              // 1. Completeness Status & style
              const missingFields: string[] = [];
              const validationMeta = (c.metadata as unknown as TableCandidateMetadata)?.validation;
              
              if (validationMeta?.quality_check?.missing_fields) {
                missingFields.push(...validationMeta.quality_check.missing_fields);
              } else {
                if (!c.website) missingFields.push('website');
                const linkedinUrl = getNestedValue(c.metadata, ['enrichment', 'web', 'linkedin_company', 'url']) 
                  || getNestedValue(c.metadata, ['enrichment', 'linkedin_url']) 
                  || getNestedValue(c.metadata, ['enrichment', 'linkedin']) 
                  || getNestedValue(c.metadata, ['external', 'linkedin_url'])
                  || getNestedValue(c.metadata, ['import', 'linkedin_url']);
                if (!linkedinUrl) missingFields.push('linkedin_url');
                if (!c.tax_identifier) missingFields.push('tax_identifier');
                if (!c.industry && !(c.metadata?.enrichment as Record<string, unknown> | undefined)?.sector_description) missingFields.push('industry');
              }

              let completenessText = 'Información completa';
              let completenessVariant: 'positive' | 'neutral' | 'warning' = 'positive';
              if (missingFields.length > 0) {
                if (missingFields.length >= 3 && !c.website && !c.tax_identifier) {
                  completenessText = 'Sin evidencia';
                  completenessVariant = 'neutral';
                } else {
                  completenessText = `${missingFields.length} ${missingFields.length === 1 ? 'dato pendiente' : 'datos pendientes'}`;
                  completenessVariant = 'warning';
                }
              }

              // 2. Confidence Status
              let confidenceText = 'Confianza media';
              const rawConfidence = validationMeta?.quality_check?.import_confidence 
                || getNestedValue(c.metadata, ['import', 'confidence'])
                || getNestedValue(c.metadata, ['validation', 'quality_check', 'confidence']);
              
              if (rawConfidence) {
                const confLower = String(rawConfidence).toLowerCase();
                if (confLower === 'alta' || confLower === 'high') {
                  confidenceText = 'Confianza alta';
                } else if (confLower === 'media' || confLower === 'medium') {
                  confidenceText = 'Confianza media';
                } else if (confLower === 'baja' || confLower === 'low') {
                  confidenceText = 'Confianza baja';
                }
              } else if (isChileOfficialCandidate || isStructuredCandidate(c)) {
                confidenceText = 'Confianza alta';
              }

              // 3. Fiscal identifier status
              let fiscalText = 'Sin identificador';
              let fiscalStatusKey: 'validated' | 'to_review' | 'none' = 'none';
              if (c.tax_identifier) {
                fiscalText = 'Fiscal validado';
                fiscalStatusKey = 'validated';
              } else {
                const lookup = (c.metadata as Record<string, unknown>)?.tax_identifier_lookup as Record<string, unknown> | undefined;
                const bestCandidate = lookup?.best_candidate as Record<string, unknown> | undefined;
                if (bestCandidate?.tax_identifier) {
                  fiscalText = 'Fiscal por revisar';
                  fiscalStatusKey = 'to_review';
                }
              }

              return (
                <tr
                  key={c.id}
                  className="group border-b border-border/50 transition-colors last:border-0 hover:bg-surface-muted"
                >
                  {/* ── Empresa ── */}
                  <td className="max-w-56 px-4 py-2.5">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          id={`candidate-trigger-${c.id}`}
                          type="button"
                          onClick={() => openCandidateDetail(c, 'detail')}
                          title={c.name}
                          className="line-clamp-2 rounded-sm text-left text-sm font-semibold text-foreground transition-colors hover:text-primary focus:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                        >
                          {c.name}
                        </button>
                        {isChileOfficialCandidate ? (
                          <Badge variant="brand" className="shrink-0">
                            <ShieldCheck aria-hidden />
                            Fuente oficial Chile
                          </Badge>
                        ) : isStructuredCandidate(c) ? (
                          <Badge variant="brand" className="shrink-0">
                            <ShieldCheck aria-hidden />
                            {VENDOR_STRUCTURED_SOURCE_LABELS[c.source_primary ?? ''] ?? 'Fuente oficial'}
                          </Badge>
                        ) : null}
                        {/*
                          🔴 VISIBILIDAD DE OWNERSHIP (opción C) — la cola dice lo
                          que la ficha explica. Ámbar: no se pudo verificar, que
                          NO es lo mismo que «dominio incorrecto».
                        */}
                        {hasOwnershipUnverifiedFlag(c.review_flags) && (
                          <Badge
                            data-testid="ownership-unverified-badge"
                            title={OWNERSHIP_UNVERIFIED_DETAIL}
                            variant="warning"
                            className="shrink-0 cursor-help"
                          >
                            <AlertTriangle aria-hidden />
                            {OWNERSHIP_UNVERIFIED_LABEL}
                          </Badge>
                        )}
                      </div>

                      {location && (
                        <p className="text-xs text-muted-foreground leading-tight">
                          {location}
                        </p>
                      )}

                      {c.website && (
                        <a
                          href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Globe className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="max-w-40 truncate">{domain ?? c.website}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
                        </a>
                      )}
                      {(() => {
                        const liDisplay = getCandidateLinkedInDisplay(c.metadata);
                        if (!liDisplay) return null;
                        const isSuggested = liDisplay.status === 'suggested';
                        return (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger render={
                                <a
                                  href={liDisplay.url.startsWith('http') ? liDisplay.url : `https://${liDisplay.url}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={liDisplay.label}
                                  className={`inline-flex items-center gap-1 rounded-sm text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 ${isSuggested ? 'text-warning' : 'text-primary'}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Link2 className="h-3 w-3" aria-hidden />
                                  <span>{isSuggested ? 'LinkedIn?' : 'LinkedIn'}</span>
                                </a>
                              } />
                              <TooltipContent>
                                {liDisplay.label}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })()}
                    </div>
                  </td>

                  {/* ── Perfil ── */}
                  <td className="max-w-44 px-4 py-2.5">
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      <p className="truncate font-medium text-foreground" title={sectorDescription ?? undefined}>
                        {sectorDescription ?? 'Sin sector'}
                      </p>
                      {c.company_size && (
                        <p className="truncate">
                          {c.company_size}
                        </p>
                      )}
                      {(() => {
                        const icpState = getIcpSizeGateUiState(
                          c.metadata as Record<string, unknown> | null | undefined,
                          c.company_size
                        );
                        const toneVariant = {
                          success: 'positive',
                          warning: 'warning',
                          danger: 'negative',
                          neutral: 'neutral',
                        } as const;
                        const tooltipText = icpState.tone === 'neutral'
                          ? 'Este candidato no pasó por ICP Size Gate o viene de flujo legacy.'
                          : (icpState.reason ?? icpState.description);
                        return (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger render={
                                <Badge variant={toneVariant[icpState.tone]} className="cursor-help">
                                  {icpState.label}
                                </Badge>
                              } />
                              <TooltipContent className="max-w-xs leading-relaxed">
                                {tooltipText}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })()}
                      <p className="text-xs text-muted-foreground">
                        {getCandidateOriginLabel(c as CandidateWithBatch)}
                      </p>
                    </div>
                  </td>

                  {/* ── Calidad ── */}
                  <td className="px-4 py-2.5">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger render={
                          <div className="flex flex-col gap-1 w-fit cursor-help">
                            <Badge variant={completenessVariant}>
                              {completenessText}
                            </Badge>
                            <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium leading-none">
                              {confidenceText}
                            </span>
                            <span className={`flex items-center gap-1 text-xs font-medium leading-none ${
                              fiscalStatusKey === 'validated'
                                ? 'text-success'
                                : fiscalStatusKey === 'to_review'
                                ? 'text-warning'
                                : 'text-muted-foreground'
                            }`}>
                              {fiscalText}
                            </span>
                          </div>
                        } />
                        <TooltipContent className="max-w-xs flex-col items-start gap-1.5 leading-relaxed">
                          <p className="mb-1 border-b border-background/20 pb-1 font-semibold">Detalle de Calidad</p>
                          <ul className="space-y-1 text-background/80">
                            <li className="flex items-center gap-1.5">
                              <span className={c.website ? 'text-success' : 'text-warning'}>
                                {c.website ? '✓' : '✗'}
                              </span>
                              <span>Sitio web: {c.website ? 'Presente' : 'Pendiente'}</span>
                            </li>
                            <li className="flex items-center gap-1.5">
                              <span className={!missingFields.includes('linkedin_url') ? 'text-success' : 'text-warning'}>
                                {!missingFields.includes('linkedin_url') ? '✓' : '✗'}
                              </span>
                              <span>LinkedIn: {!missingFields.includes('linkedin_url') ? 'Presente' : 'Pendiente'}</span>
                            </li>
                            <li className="flex items-center gap-1.5">
                              <span className={c.tax_identifier ? 'text-success' : fiscalStatusKey === 'to_review' ? 'text-warning' : 'text-muted-foreground'}>
                                {c.tax_identifier ? '✓' : fiscalStatusKey === 'to_review' ? '?' : '✗'}
                              </span>
                              <span>Identificador fiscal: {c.tax_identifier ? `Presente (${c.tax_identifier_type || 'NIT'})` : fiscalStatusKey === 'to_review' ? 'Sugerido por revisar' : 'No disponible'}</span>
                            </li>
                            <li className="flex items-center gap-1.5 border-t border-background/20 pt-1 mt-1">
                              <span className="font-medium">Nivel de confianza:</span>
                              <span className="capitalize text-background">{confidenceText.split(' ')[1]}</span>
                            </li>
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </td>

                  {/* ── Duplicidad ── */}
                  <td className="px-4 py-2.5">
                    <DuplicateCheckCell candidate={c} />
                  </td>

                  {/* ── Estado ── */}
                  <td className="min-w-32 px-4 py-2.5">
                    <div className="space-y-1">
                      {(() => {
                        const validationMeta = (c.metadata as unknown as TableCandidateMetadata)?.validation;
                        const hasDuplicate =
                          c.duplicate_status === 'possible_duplicate' ||
                          c.duplicate_status === 'exact_duplicate';

                        const enrichment = (c.metadata?.enrichment as Record<string, unknown>) || {};
                        const enrichmentStatus = enrichment.status as string | undefined;
                        const enrichmentError = enrichment.error_message as string | undefined;

                        let statusLabel = CANDIDATE_STATUS_LABELS[c.status];
                        let statusTone: StatusTone = STATUS_TONES[c.status];
                        let showEnrichmentOverride = false;

                        if (enrichmentStatus === 'pending') {
                          statusLabel = 'Enriquecimiento pendiente';
                          statusTone = 'neutral';
                          showEnrichmentOverride = true;
                        } else if (enrichmentStatus === 'enriching') {
                          statusLabel = 'Enriqueciendo...';
                          statusTone = 'brand';
                          showEnrichmentOverride = true;
                        } else if (enrichmentStatus === 'failed') {
                          statusLabel = 'Enriquecimiento fallido';
                          statusTone = 'negative';
                          showEnrichmentOverride = true;
                        }

                        if (!showEnrichmentOverride) {
                          if (validationMeta && !hasDuplicate) {
                            statusLabel = 'Validado para revisión';
                            statusTone = 'positive';
                          } else if (c.status === 'needs_review' || c.status === 'generated' || c.status === 'normalized') {
                            statusLabel = 'Necesita revisión';
                            statusTone = 'warning';
                          }
                        }

                        const badgeNode = (
                          <Badge variant={statusTone} className={enrichmentStatus === 'enriching' ? 'animate-pulse' : undefined}>
                            {statusLabel}
                          </Badge>
                        );

                        const statusBadgeWithTooltip = enrichmentStatus === 'failed' ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger render={badgeNode} />
                              <TooltipContent className="max-w-xs flex-col items-start gap-1 bg-destructive leading-relaxed text-destructive-foreground">
                                <p className="mb-1 border-b border-destructive-foreground/20 pb-1 font-semibold">Detalle del Error</p>
                                <p>{enrichmentError || 'Error desconocido durante el enriquecimiento con IA.'}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : badgeNode;

                        // Build IA evaluation label
                        const fitStatusValue = c.commercial_fit_status 
                          || getNestedValue(c.metadata, ['enrichment', 'ai_evaluation', 'fit_status'])
                          || getNestedValue(c.metadata, ['ai_evaluation', 'fit_status'])
                          || null;
                        const fitStatus = typeof fitStatusValue === 'string' ? fitStatusValue : null;
                        const fitScore = c.fit_score ?? null;

                        const hasEvaluation = fitScore !== null || (fitStatus && ['high', 'medium', 'low', 'high_fit', 'good_fit', 'medium_fit', 'low_fit'].includes(fitStatus));

                        let evalText = 'Sin evaluación IA';
                        if (hasEvaluation) {
                          const fitLabel = fitStatus ? (FIT_STATUS_LABELS[fitStatus] ?? fitStatus) : '';
                          if (fitScore !== null) {
                            evalText = `IA ${fitScore}/100${fitLabel ? ` · ${fitLabel}` : ''}`;
                          } else {
                            evalText = `IA · ${fitLabel}`;
                          }
                        } else if (fitStatus === 'insufficient_evidence') {
                          evalText = 'Evidencia insuficiente';
                        } else if (fitStatus === 'tax_identifier_conflict') {
                          evalText = 'Evaluación pausada';
                        }

                        return (
                          <div className="flex flex-col gap-1 w-fit">
                            {statusBadgeWithTooltip}
                            
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger render={
                                  <span className="cursor-help text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                                    {evalText}
                                  </span>
                                } />
                                <TooltipContent className="max-w-xs leading-relaxed">
                                  Evaluación automática basada en la información pública disponible. No reemplaza la revisión comercial.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        );
                      })()}
                    </div>
                  </td>

                  {/* ── Acciones ── */}
                  <td className="px-3 py-2.5">
                    <BatchCandidateSafeActions candidate={c} onOpenDetail={openCandidateDetail} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Drawer de detalle de candidato */}
      <CandidateDetailSheet
        key={detailCandidate?.id ?? 'empty'}
        candidate={detailCandidate ? (candidates.find((c) => c.id === detailCandidate.id) ?? detailCandidate) : null}
        open={detailCandidate !== null}
        initialApproveIntent={detailIntent === 'approve'}
        onApproveIntentConsumed={() => setDetailIntent('detail')}
        initialDiscardIntent={detailIntent === 'discard'}
        onDiscardIntentConsumed={() => setDetailIntent('detail')}
        initialDuplicateIntent={detailIntent === 'duplicate'}
        onDuplicateIntentConsumed={() => setDetailIntent('detail')}
        onOpenChange={(open) => {
          if (!open) {
            const lastActiveId = detailCandidate?.id;
            setDetailIntent('detail');
            setDetailCandidate(null);
            if (lastActiveId) {
              setTimeout(() => {
                const element = document.getElementById(`candidate-trigger-${lastActiveId}`);
                element?.focus();
              }, 50);
            }
          }
        }}
        onCandidateUpdated={(updated) => {
          setDetailCandidate(updated);
        }}
      />
    </>
  );
}

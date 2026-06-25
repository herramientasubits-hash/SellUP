'use client';

import * as React from 'react';
import { Building2, Globe, ShieldCheck, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import { CandidateRowActions } from './candidate-row-actions';
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

const STATUS_STYLES: Record<CandidateStatus, string> = {
  generated: 'bg-muted text-muted-foreground',
  normalized: 'bg-muted text-muted-foreground',
  needs_review: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  discarded: 'bg-muted/60 text-muted-foreground/60',
  duplicate: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  converted_to_account: 'bg-su-brand-soft text-su-brand',
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
    <div className="rounded-xl border border-border/40 bg-card p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          {SOURCE_LABELS[match.source] ?? match.source}
        </span>
        {match.confidence !== null && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
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
          className="text-xs text-su-brand hover:underline block"
        >
          {match.matched_website}
        </a>
      )}
      {match.reason && (
        <p className="text-[10px] text-muted-foreground/70 italic">{match.reason}</p>
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
  let primaryDupStyle = 'bg-muted text-muted-foreground/60';

  if (sellupStatus === 'duplicate' || hsStatus === 'match') {
    primaryDupLabel = 'Duplicado confirmado';
    primaryDupStyle = 'bg-destructive/10 text-destructive';
  } else if (sellupStatus === 'possible_duplicate' || hsStatus === 'possible_match') {
    primaryDupLabel = 'Posible duplicado';
    primaryDupStyle = 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  } else if (sellupStatus === 'no_match' || hsStatus === 'no_match') {
    primaryDupLabel = 'Sin coincidencias';
    primaryDupStyle = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
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
            <Badge className={`${primaryDupStyle} border-0 text-[10px] font-semibold w-fit py-0.5 cursor-help`}>
              {primaryDupLabel}
            </Badge>
          } />          <TooltipContent className="text-[11px] leading-relaxed bg-popover text-popover-foreground border border-border p-2.5 rounded-xl shadow-md z-[70] space-y-1">
            <p className="font-semibold text-xs border-b border-border/40 pb-1 mb-1">Detalle de Duplicidad</p>
            <p>{sellupTooltipLabel}</p>
            <p>{hsTooltipLabel}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {matches.length > 0 && (
        <button
          onClick={() => setDetailOpen(true)}
          className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline text-left font-medium"
        >
          {matches.length === 1 ? '1 coincidencia' : `${matches.length} coincidencias`}
        </button>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md">
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
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
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
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 rounded-full bg-muted/60 p-3">
        <Building2 className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">Sin empresas candidatas</p>
      <p className="mt-1 text-xs text-muted-foreground/60">
        Usa el botón &quot;Agregar empresa candidata&quot; para comenzar.
      </p>
    </div>
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

  if (candidates.length === 0) return <EmptyState />;

  return (
    <>
      <div className="su-table-scroll">
        <table className="su-table su-table-sticky">
          <thead>
            <tr className="border-b border-border/40">
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
                      className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60"
                    >
                      {tooltipContent ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger render={
                              <span className="cursor-help border-b border-dotted border-muted-foreground/30 pb-0.5 hover:text-foreground transition-colors">
                                {col}
                              </span>
                            } />
                            <TooltipContent className="max-w-xs text-[11px] leading-relaxed bg-popover text-popover-foreground border border-border p-2 rounded shadow-md z-[70]">
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
              let completenessStyle = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
              if (missingFields.length > 0) {
                if (missingFields.length >= 3 && !c.website && !c.tax_identifier) {
                  completenessText = 'Sin evidencia';
                  completenessStyle = 'bg-muted text-muted-foreground';
                } else {
                  completenessText = `${missingFields.length} ${missingFields.length === 1 ? 'dato pendiente' : 'datos pendientes'}`;
                  completenessStyle = 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
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
                  className="group border-b border-border/30 transition-colors last:border-0 hover:bg-muted/30"
                >
                  {/* ── Empresa ── */}
                  <td className="px-4 py-2.5 max-w-[220px]">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          id={`candidate-trigger-${c.id}`}
                          type="button"
                          onClick={() => setDetailCandidate(c)}
                          className="text-left font-semibold text-foreground hover:text-su-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-su-brand rounded focus:text-su-brand transition-colors text-sm line-clamp-2"
                        >
                          {c.name}
                        </button>
                        {isChileOfficialCandidate ? (
                          <Badge className="border-0 bg-su-brand-soft text-su-brand text-[9px] font-semibold flex items-center gap-0.5 px-1.5 py-0.5 shrink-0">
                            <ShieldCheck className="h-2.5 w-2.5" />
                            Fuente oficial Chile
                          </Badge>
                        ) : isStructuredCandidate(c) ? (
                          <Badge className="border-0 bg-su-brand-soft text-su-brand text-[9px] font-semibold flex items-center gap-0.5 px-1.5 py-0.5 shrink-0">
                            <ShieldCheck className="h-2.5 w-2.5" />
                            {VENDOR_STRUCTURED_SOURCE_LABELS[c.source_primary ?? ''] ?? 'Fuente oficial'}
                          </Badge>
                        ) : null}
                      </div>

                      {location && (
                        <p className="text-[10px] text-muted-foreground/75 leading-tight">
                          {location}
                        </p>
                      )}

                      {c.website && (
                        <a
                          href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-su-brand hover:underline font-medium"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Globe className="h-2.5 w-2.5" />
                          <span className="truncate max-w-[150px]">{domain ?? c.website}</span>
                          <ExternalLink className="h-2 w-2 opacity-60" />
                        </a>
                      )}
                    </div>
                  </td>

                  {/* ── Perfil ── */}
                  <td className="px-4 py-2.5 max-w-[180px]">
                    <div className="space-y-0.5 text-xs text-muted-foreground/85">
                      <p className="font-medium text-foreground/90 truncate">
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
                        const toneClass: Record<string, string> = {
                          success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                          warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                          danger: 'bg-destructive/10 text-destructive',
                          neutral: 'bg-muted text-muted-foreground/60',
                        };
                        const tooltipText = icpState.tone === 'neutral'
                          ? 'Este candidato no pasó por ICP Size Gate o viene de flujo legacy.'
                          : (icpState.reason ?? icpState.description);
                        return (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger render={
                                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold cursor-help w-fit ${toneClass[icpState.tone]}`}>
                                  {icpState.label}
                                </span>
                              } />
                              <TooltipContent className="max-w-xs text-[11px] leading-relaxed bg-popover text-popover-foreground border border-border p-2 rounded shadow-md z-[70]">
                                {tooltipText}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })()}
                      <p className="text-[10px] text-muted-foreground/60">
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
                            <Badge className={`${completenessStyle} border-0 text-[10px] font-semibold w-fit py-0.5`}>
                              {completenessText}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1 font-medium leading-none">
                              {confidenceText}
                            </span>
                            <span className={`text-[10px] flex items-center gap-1 font-medium leading-none ${
                              fiscalStatusKey === 'validated' 
                                ? 'text-emerald-600/80 dark:text-emerald-400/80' 
                                : fiscalStatusKey === 'to_review' 
                                ? 'text-amber-600/80 dark:text-amber-400/80' 
                                : 'text-muted-foreground/60'
                            }`}>
                              {fiscalText}
                            </span>
                          </div>
                        } />
                        <TooltipContent className="max-w-xs text-[11px] leading-relaxed bg-popover text-popover-foreground border border-border p-3 rounded-xl shadow-md z-[70] space-y-1.5">
                          <p className="font-semibold text-xs border-b border-border/40 pb-1 mb-1">Detalle de Calidad</p>
                          <ul className="space-y-1 text-muted-foreground">
                            <li className="flex items-center gap-1.5">
                              <span className={c.website ? 'text-emerald-500' : 'text-amber-500'}>
                                {c.website ? '✓' : '✗'}
                              </span>
                              <span>Sitio web: {c.website ? 'Presente' : 'Pendiente'}</span>
                            </li>
                            <li className="flex items-center gap-1.5">
                              <span className={!missingFields.includes('linkedin_url') ? 'text-emerald-500' : 'text-amber-500'}>
                                {!missingFields.includes('linkedin_url') ? '✓' : '✗'}
                              </span>
                              <span>LinkedIn: {!missingFields.includes('linkedin_url') ? 'Presente' : 'Pendiente'}</span>
                            </li>
                            <li className="flex items-center gap-1.5">
                              <span className={c.tax_identifier ? 'text-emerald-500' : fiscalStatusKey === 'to_review' ? 'text-amber-500' : 'text-muted-foreground/60'}>
                                {c.tax_identifier ? '✓' : fiscalStatusKey === 'to_review' ? '?' : '✗'}
                              </span>
                              <span>Identificador fiscal: {c.tax_identifier ? `Presente (${c.tax_identifier_type || 'NIT'})` : fiscalStatusKey === 'to_review' ? 'Sugerido por revisar' : 'No disponible'}</span>
                            </li>
                            <li className="flex items-center gap-1.5 border-t border-border/20 pt-1 mt-1">
                              <span className="font-medium">Nivel de confianza:</span>
                              <span className="text-foreground capitalize">{confidenceText.split(' ')[1]}</span>
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
                  <td className="px-4 py-2.5 min-w-[120px]">
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
                        let statusStyle = STATUS_STYLES[c.status];
                        let showEnrichmentOverride = false;

                        if (enrichmentStatus === 'pending') {
                          statusLabel = 'Enriquecimiento pendiente';
                          statusStyle = 'bg-muted text-muted-foreground/80';
                          showEnrichmentOverride = true;
                        } else if (enrichmentStatus === 'enriching') {
                          statusLabel = 'Enriqueciendo...';
                          statusStyle = 'bg-su-brand-soft text-su-brand';
                          showEnrichmentOverride = true;
                        } else if (enrichmentStatus === 'failed') {
                          statusLabel = 'Enriquecimiento fallido';
                          statusStyle = 'bg-destructive/10 text-destructive';
                          showEnrichmentOverride = true;
                        }

                        if (!showEnrichmentOverride) {
                          if (validationMeta && !hasDuplicate) {
                            statusLabel = 'Validado para revisión';
                            statusStyle = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
                          } else if (c.status === 'needs_review' || c.status === 'generated' || c.status === 'normalized') {
                            statusLabel = 'Necesita revisión';
                            statusStyle = 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
                          }
                        }

                        const badgeNode = (
                          <Badge className={`${statusStyle} border-0 text-[10px] font-semibold py-0.5 w-fit ${enrichmentStatus === 'enriching' ? 'animate-pulse' : ''}`}>
                            {statusLabel}
                          </Badge>
                        );

                        const statusBadgeWithTooltip = enrichmentStatus === 'failed' ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger render={badgeNode} />
                              <TooltipContent className="max-w-xs text-[11px] leading-relaxed bg-destructive text-destructive-foreground border-0 p-2.5 rounded-xl shadow-md z-[70]">
                                <p className="font-semibold text-xs border-b border-white/20 pb-1 mb-1">Detalle del Error</p>
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
                                  <span className="text-[10px] text-muted-foreground/70 cursor-help hover:text-foreground font-medium transition-colors">
                                    {evalText}
                                  </span>
                                } />
                                <TooltipContent className="max-w-xs text-[11px] leading-relaxed bg-popover text-popover-foreground border border-border p-2 rounded shadow-md z-[70]">
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
                    <CandidateRowActions candidate={c} onBeforeAction={() => setDetailCandidate(null)} />
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
        onOpenChange={(open) => {
          if (!open) {
            const lastActiveId = detailCandidate?.id;
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

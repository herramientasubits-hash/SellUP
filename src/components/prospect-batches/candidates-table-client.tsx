'use client';

import * as React from 'react';
import { Building2, Globe, ShieldCheck, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CANDIDATE_STATUS_LABELS,
  DUPLICATE_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_STYLES,
  CRITICAL_REVIEW_FLAG_LABELS,
  VENDOR_STRUCTURED_SOURCE_LABELS,
  isStructuredCandidate,
  parseDuplicateCheck,
  type ProspectCandidateWithReviewer,
  type CandidateStatus,
  type DuplicateStatus,
  type DuplicateMatch,
  type ReviewStatus,
} from '@/modules/prospect-batches/types';
import { CandidateRowActions } from './candidate-row-actions';
import { CandidateDetailSheet } from './candidate-detail-sheet';

interface TableQualityCheck {
  has_website?: boolean;
  has_linkedin?: boolean;
  import_confidence?: string;
  has_tax_identifier?: boolean;
  warnings?: string[];
}

interface TableValidationMetadata {
  validation_source?: string;
  sellup_duplicate_check?: { status?: string };
  hubspot_duplicate_check?: { status?: string };
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

const DUPLICATE_STYLES: Record<DuplicateStatus, string> = {
  unchecked: 'bg-muted text-muted-foreground/60',
  no_match: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  possible_duplicate: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  exact_duplicate: 'bg-destructive/10 text-destructive',
  related_company: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  insufficient_data: 'bg-muted/60 text-muted-foreground/60',
};

const SOURCE_LABELS: Record<string, string> = {
  sellup: 'SellUp',
  hubspot: 'HubSpot',
};

const KNOWN_SOURCES = ['sellup', 'hubspot'];

function getFlagEmoji(code: string) {
  const offset = 0x1f1e6 - 'A'.charCodeAt(0);
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(c.charCodeAt(0) + offset)).join('');
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

const DIRECTORY_DOMAINS = new Set([
  'registronit.com',
  'informacolombia.com',
  'datacreditoempresas.com.co',
  'einforma.co',
  'empresite.eleconomistaamerica.co',
  'empresite.com',
  'paginasamarillas.com.co',
  'procolombia.co',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'google.com',
  'gmail.com',
  'youtube.com',
  'wikipedia.org',
]);

const DIRECTORY_KEYWORDS = [
  'paginasamarillas',
  'paginas-amarillas',
  'kompass',
  'opencorporates',
  'zoominfo',
  'clutch.co',
  'crunchbase',
  'emis.com',
  'empresite',
  'registronit',
  'informacolombia',
  'datacreditoempresas',
  'einforma',
  'datospymes',
  'directorioempresas',
  'buscaempresas',
  'rues.gov',
  'rues.org',
  'colombiacompra',
  'secop',
  'procolombia',
  'b2bmarketplace',
];

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

function isDirectoryOrThirdPartyDomain(url: string | null | undefined): boolean {
  const domain = extractDomainFromUrl(url);
  if (!domain) return false;
  if (DIRECTORY_DOMAINS.has(domain)) return true;
  if (DIRECTORY_KEYWORDS.some((k) => domain.includes(k))) return true;
  // Government institutional domains — never a commercial company website
  if (/\.gov\.co$/.test(domain) || domain === 'gov.co') return true;
  if (/\.gov\.cl$/.test(domain) || domain === 'gov.cl') return true;
  return false;
}

function ScoreBadge({ score, label }: { score: number | null; label: string }) {
  if (score === null) return <span className="text-muted-foreground/40">—</span>;
  const color =
    score >= 75
      ? 'text-emerald-600 dark:text-emerald-400'
      : score >= 50
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-muted-foreground';
  return (
    <span className={`tabular-nums text-xs font-medium ${color}`} title={label}>
      {score.toFixed(0)}
    </span>
  );
}

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
  const sources = dc?.sources_checked ?? [];
  const matches = dc?.matches ?? [];

  // Mostrar validación homologada para cualquier origen que tenga metadata.validation
  if ((candidate.metadata as unknown as TableCandidateMetadata)?.validation) {
    const valObj = (candidate.metadata as unknown as TableCandidateMetadata).validation;
    const sellupStatus = valObj?.sellup_duplicate_check?.status;
    const hsStatus = valObj?.hubspot_duplicate_check?.status;

    // Estado primario: SellUp
    let primaryLabel = 'Sin coincidencia en SellUp';
    let primaryStyle = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';

    if (sellupStatus === 'duplicate') {
      primaryLabel = 'Duplicado SellUp';
      primaryStyle = 'bg-destructive/10 text-destructive';
    } else if (sellupStatus === 'possible_duplicate') {
      primaryLabel = 'Posible duplicado SellUp';
      primaryStyle = 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    }

    // Estado secundario: HubSpot (solo mostrar si es relevante)
    let hsLabel: string | null = null;
    let hsStyle = '';

    if (hsStatus === 'match') {
      hsLabel = 'Coincidencia HubSpot';
      hsStyle = 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
    } else if (hsStatus === 'possible_match') {
      hsLabel = 'Posible HubSpot';
      hsStyle = 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    } else if (hsStatus === 'not_configured' && sellupStatus !== 'duplicate') {
      // Solo mostrar "no config" como secundario, nunca como único estado principal
      hsLabel = 'HubSpot no config.';
      hsStyle = 'bg-muted text-muted-foreground/50';
    }

    return (
      <div className="flex flex-col gap-1 min-w-[120px]">
        <Badge className={`${primaryStyle} border-0 text-[10px] font-semibold w-fit`}>
          {primaryLabel}
        </Badge>
        {hsLabel && (
          <Badge className={`${hsStyle} border-0 text-[10px] font-medium w-fit`}>
            {hsLabel}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-[120px]">
      <Badge
        className={`${DUPLICATE_STYLES[candidate.duplicate_status]} border-0 text-[10px] font-semibold w-fit`}
      >
        {DUPLICATE_STATUS_LABELS[candidate.duplicate_status]}
      </Badge>

      {/* Sources checked */}
      {sources.length > 0 && (
        <div className="flex gap-2">
          {KNOWN_SOURCES.map((src) => {
            const checked = sources.includes(src);
            return (
              <span
                key={src}
                className={`text-[9px] font-medium ${
                  checked
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground/40'
                }`}
              >
                {SOURCE_LABELS[src]} {checked ? '✓' : '—'}
              </span>
            );
          })}
        </div>
      )}

      {/* Match count — opens dialog */}
      {matches.length > 0 && (
        <button
          onClick={() => setDetailOpen(true)}
          className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline text-left font-medium"
        >
          {matches.length === 1 ? '1 coincidencia' : `${matches.length} coincidencias`}
        </button>
      )}

      {/* Fallback */}
      {!dc && sources.length === 0 && (
        <p className="text-[9px] text-muted-foreground/40 leading-tight">
          Sin detalle disponible
        </p>
      )}

      {/* Match detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Coincidencias de duplicidad</DialogTitle>
            <DialogDescription>
              {candidate.name} · {DUPLICATE_STATUS_LABELS[candidate.duplicate_status]}
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

interface CandidatesTableClientProps {
  candidates: ProspectCandidateWithReviewer[];
}

export function CandidatesTableClient({ candidates }: CandidatesTableClientProps) {
  const [detailCandidate, setDetailCandidate] =
    React.useState<ProspectCandidateWithReviewer | null>(null);

  if (candidates.length === 0) return <EmptyState />;

  const hasStructured = candidates.some((c) => isStructuredCandidate(c));
  // Show Evaluación column only if at least one candidate has a fit score or fit status
  const hasFit = candidates.some(
    (c) =>
      c.fit_score !== null ||
      c.commercial_fit_status !== null ||
      (c.metadata?.ai_evaluation as Record<string, unknown> | undefined)?.fit_status !== undefined,
  );

  return (
    <>
      <div className="overflow-x-auto">
        {hasStructured && (
          <div className="px-5 py-2.5 border-b border-border/30 bg-amber-500/5">
            <p className="text-[10px] text-amber-700 dark:text-amber-400">
              <span className="font-semibold">Guía de revisión:</span>{' '}
              Valida nombre, NIT, actividad/sector, duplicidad y señales de empresa activa. Usa{' '}
              <span className="font-semibold">Ver detalle</span> para información completa.
            </p>
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40">
              {['Empresa', 'Perfil', 'Señales', 'Duplicidad', ...(hasFit ? ['Evaluación'] : []), 'Estado', ''].map(
                (col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60"
                  >
                    {col}
                  </th>
                ),
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
              const flags = (c.review_flags as string[] | null) ?? [];
              const fitStatus =
                c.commercial_fit_status ??
                ((c.metadata?.ai_evaluation as Record<string, unknown> | undefined)
                  ?.fit_status as string | undefined) ??
                null;

              const enrichment = c.metadata?.enrichment as Record<string, unknown> | undefined;
              const webEnrichment = enrichment?.web as Record<string, unknown> | undefined;
              const publicEvidence = webEnrichment?.public_evidence as unknown[] | undefined;
              const hasPublicEvidence = !!(publicEvidence && publicEvidence.length > 0);

              const officialWebsiteStatus = webEnrichment?.official_website_status as string | undefined;
              const visibleWebsiteAllowed = webEnrichment?.visible_website_allowed as boolean | undefined;

              const isOfficialWebsiteConfirmed =
                officialWebsiteStatus === 'confirmed' &&
                visibleWebsiteAllowed === true;

              const domain = c.website ? extractDomainFromUrl(c.website) : null;
              
              let isValidChileWebsite = false;
              if (c.website && domain) {
                const isNotDir = !isDirectoryOrThirdPartyDomain(c.website);
                const isNotCol = !(
                  domain.includes('procolombia.co') ||
                  domain.includes('b2bmarketplace') ||
                  domain.endsWith('.co') ||
                  domain.includes('.com.co') ||
                  domain.includes('.org.co') ||
                  domain.includes('.gov.co')
                );
                
                let hasDistinctiveMatch = true;
                const nameWords = (c.name || '').toLowerCase()
                  .replace(/[^a-z0-9]/g, ' ')
                  .split(/\s+/)
                  .filter(w => w.length > 3 && !['chile', 'limitada', 'sociedad', 'holding', 'grupo', 'spa', 'eirl'].includes(w));
                
                if (nameWords.length > 0) {
                  const domainLower = domain.toLowerCase();
                  hasDistinctiveMatch = nameWords.some(w => domainLower.includes(w));
                }
                
                isValidChileWebsite = isNotDir && isNotCol && hasDistinctiveMatch;
              }

              const isOfficialWebsite =
                !!c.website &&
                !isDirectoryOrThirdPartyDomain(c.website) &&
                (!isChileOfficialCandidate || (isOfficialWebsiteConfirmed && isValidChileWebsite));

              const linkedinStatus = webEnrichment?.linkedin_status as string | undefined;
              const hasStrongEvidenceChile =
                !isChileOfficialCandidate ||
                (isOfficialWebsiteConfirmed && isValidChileWebsite) ||
                (linkedinStatus === 'confirmed');

              return (
                <tr
                  key={c.id}
                  className="group border-b border-border/30 transition-colors last:border-0 hover:bg-muted/30"
                >
                  {/* ── Empresa ── */}
                  <td className="px-4 py-3 max-w-[220px]">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-medium text-foreground leading-snug line-clamp-2">
                          {c.name}
                        </p>
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
                      {isChileOfficialCandidate ? (
                        c.tax_identifier && (
                          <p className="text-[10px] font-mono text-muted-foreground/80">
                            RUT {c.tax_identifier}
                          </p>
                        )
                      ) : c.tax_identifier ? (
                        <p className="text-[10px] font-mono text-muted-foreground/80">
                          {c.tax_identifier_type
                            ? `${c.tax_identifier_type} ${c.tax_identifier}`
                            : c.tax_identifier}
                        </p>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetailCandidate(c)}
                        className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground gap-1 -ml-1.5"
                      >
                        <Eye className="h-2.5 w-2.5" />
                        Ver detalle
                      </Button>
                    </div>
                  </td>

                  {/* ── Perfil ── */}
                  <td className="px-4 py-3 max-w-[180px]">
                    <div className="space-y-1">
                      {c.country_code ? (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{getFlagEmoji(c.country_code)}</span>
                          <span>{c.country ?? c.country_code}</span>
                          {(c.city || c.region) && (
                            <span className="text-muted-foreground/50 text-[10px]">
                              · {[c.city, c.region].filter(Boolean).join(', ')}
                            </span>
                          )}
                        </span>
                      ) : null}
                      {isChileOfficialCandidate ? (
                        <span className="text-[10px] text-muted-foreground/60 italic">
                          Sector no disponible en fuente oficial
                        </span>
                      ) : sectorDescription ? (
                        <p className="text-xs text-muted-foreground leading-snug line-clamp-2 max-w-[160px]">
                          {sectorDescription}
                        </p>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40">Sin sector</span>
                      )}
                      {isOfficialWebsite ? (
                        <a
                          href={c.website!.startsWith('http') ? c.website! : `https://${c.website!}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] text-su-brand hover:underline font-medium"
                        >
                          <Globe className="h-2.5 w-2.5" />
                          {c.domain ?? c.website}
                        </a>
                      ) : (!isChileOfficialCandidate && ((c.website && isDirectoryOrThirdPartyDomain(c.website)) || hasPublicEvidence)) ? (
                        <span className="text-[9px] text-muted-foreground/60 italic">
                          Evidencia pública disponible
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40">Sin web</span>
                      )}
                    </div>
                  </td>

                  {/* ── Señales ── */}
                  <td className="px-4 py-3 min-w-[130px]">
                    <div className="space-y-1">
                      {c.source_primary === 'external_import' && (c.metadata as unknown as TableCandidateMetadata)?.validation ? (
                        <div className="flex flex-wrap gap-1 max-w-[160px]">
                          {(c.metadata as unknown as TableCandidateMetadata).validation?.quality_check?.has_website && (
                            <Badge variant="outline" className="text-[9px] font-medium bg-su-brand-soft text-su-brand border-su-brand/20">
                              Website presente
                            </Badge>
                          )}
                          {(c.metadata as unknown as TableCandidateMetadata).validation?.quality_check?.has_linkedin && (
                            <Badge variant="outline" className="text-[9px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">
                              LinkedIn presente
                            </Badge>
                          )}
                          {(c.metadata as unknown as TableCandidateMetadata).validation?.quality_check?.import_confidence && (() => {
                            const conf = String((c.metadata as unknown as TableCandidateMetadata).validation?.quality_check?.import_confidence).toLowerCase();
                            if (conf === 'alta' || conf === 'high') {
                              return (
                                <Badge variant="outline" className="text-[9px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                                  Confianza Alta
                                </Badge>
                              );
                            }
                            if (conf === 'media' || conf === 'medium') {
                              return (
                                <Badge variant="outline" className="text-[9px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                                  Confianza Media
                                </Badge>
                              );
                            }
                            if (conf === 'baja' || conf === 'low') {
                              return (
                                <Badge variant="outline" className="text-[9px] font-semibold bg-destructive/10 text-destructive border-destructive/20">
                                  Confianza Baja
                                </Badge>
                              );
                            }
                            return null;
                          })()}
                          {c.company_size && (
                            <Badge variant="outline" className="text-[9px] font-medium bg-muted text-muted-foreground border-transparent">
                              T: {c.company_size}
                            </Badge>
                          )}
                          {!(c.metadata as unknown as TableCandidateMetadata).validation?.quality_check?.has_tax_identifier && (
                            <Badge variant="outline" className="text-[9px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
                              Sin identificador fiscal
                            </Badge>
                          )}
                        </div>
                      ) : isChileOfficialCandidate ? (
                        <div className="flex flex-col gap-1">
                          {(() => {
                            const chileSourceParams = c.source_trace?.queryParams as Record<string, unknown> | undefined;
                            const chileCapital = chileSourceParams?.capitalAmount as number | null | undefined;
                            const chileIncorporationDate = chileSourceParams?.incorporationDate as string | null | undefined;
                            
                            const capitalFormatted = typeof chileCapital === 'number'
                              ? `$${chileCapital.toLocaleString('es-CL')} CLP`
                              : null;

                            return (
                              <>
                                {capitalFormatted && (
                                  <span className="inline-block rounded px-1.5 py-0.5 text-[9px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 w-fit">
                                    Cap: {capitalFormatted}
                                  </span>
                                )}
                                {chileIncorporationDate && (
                                  <span className="inline-block rounded px-1.5 py-0.5 text-[9px] font-medium bg-su-brand-soft text-su-brand w-fit">
                                    Const: {chileIncorporationDate}
                                  </span>
                                )}
                                {!capitalFormatted && !chileIncorporationDate && (
                                  <span className="text-[10px] text-muted-foreground/40">Sin señales</span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      ) : flags.length === 0 ? (
                        typeof c.data_completeness_score === 'number' ? (
                          <span
                            className={`text-[10px] font-medium ${
                              c.data_completeness_score >= 70
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : c.data_completeness_score >= 40
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {c.data_completeness_score}% completo
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/40">Sin señales</span>
                        )
                      ) : (
                        <div className="flex flex-wrap gap-0.5 max-w-[150px]">
                          {flags.includes('liquidation_signal') && (
                            <span className="inline-block rounded px-1 py-0.5 text-[8px] font-semibold bg-destructive/10 text-destructive">
                              En liquidación
                            </span>
                          )}
                          {flags
                            .filter(
                              (f) =>
                                f !== 'liquidation_signal' && CRITICAL_REVIEW_FLAG_LABELS[f],
                            )
                            .slice(0, 3)
                            .map((flag) => (
                              <span
                                key={flag}
                                className="inline-block rounded px-1 py-0.5 text-[8px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400"
                              >
                                {CRITICAL_REVIEW_FLAG_LABELS[flag]}
                              </span>
                            ))}
                          {flags.filter(
                            (f) =>
                              f !== 'liquidation_signal' && CRITICAL_REVIEW_FLAG_LABELS[f],
                          ).length > 3 && (
                            <span className="inline-block rounded px-1 py-0.5 text-[8px] text-muted-foreground/60">
                              +{flags.filter((f) => f !== 'liquidation_signal' && CRITICAL_REVIEW_FLAG_LABELS[f]).length - 3}
                            </span>
                          )}
                          {typeof c.data_completeness_score === 'number' && (
                            <span className="text-[9px] text-muted-foreground/50 w-full mt-0.5">
                              {c.data_completeness_score}% completo
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* ── Duplicidad ── */}
                  <td className="px-4 py-3">
                    <DuplicateCheckCell candidate={c} />
                  </td>

                  {/* ── Evaluación IA (condicional) ── */}
                  {hasFit && (
                    <td className="px-4 py-3 min-w-[100px]">
                      {!hasStrongEvidenceChile ? (
                        <span className="text-[10px] text-muted-foreground/60 italic" title="Falta de evidencia pública confiable">
                          Evaluación no disponible
                        </span>
                      ) : fitStatus || c.fit_score !== null ? (
                        <div className="space-y-1">
                          {fitStatus && (
                            <Badge
                              className={`border-0 text-[9px] font-semibold w-fit ${
                                fitStatus === 'high' || fitStatus === 'high_fit' || fitStatus === 'good_fit'
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                  : fitStatus === 'medium' || fitStatus === 'medium_fit'
                                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {FIT_STATUS_LABELS[fitStatus] ?? fitStatus.replace(/_/g, ' ')}
                            </Badge>
                          )}
                          {c.fit_score !== null && (
                            <ScoreBadge score={c.fit_score} label="Fit" />
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40">—</span>
                      )}
                    </td>
                  )}

                  {/* ── Estado ── */}
                  <td className="px-4 py-3 min-w-[120px]">
                    <div className="space-y-1">
                      {(() => {
                        const validationMeta = (c.metadata as unknown as TableCandidateMetadata)?.validation;
                        const hasDuplicate =
                          c.duplicate_status === 'possible_duplicate' ||
                          c.duplicate_status === 'exact_duplicate';
                        // Auto-validated, no duplicate issues → "Validado para revisión" as primary
                        if (validationMeta && !hasDuplicate) {
                          return (
                            <>
                              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0 text-[10px] font-semibold">
                                Validado para revisión
                              </Badge>
                              <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0 text-[9px] font-semibold block w-fit">
                                Requiere revisión manual
                              </Badge>
                            </>
                          );
                        }
                        return (
                          <>
                            <Badge className={`${STATUS_STYLES[c.status]} border-0 text-[10px] font-semibold`}>
                              {CANDIDATE_STATUS_LABELS[c.status]}
                            </Badge>
                            {c.status === 'approved' &&
                              (c.commercial_trace as Record<string, unknown> | null)
                                ?.conversionRollback === true && (
                                <Badge className="border-0 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px] font-semibold block w-fit">
                                  Conv. revertida
                                </Badge>
                              )}
                            {validationMeta ? (
                              <Badge className="bg-orange-500/10 text-orange-600 dark:text-orange-400 border-0 text-[9px] font-semibold block w-fit">
                                Posible duplicado
                              </Badge>
                            ) : c.review_status ? (
                              <Badge
                                className={`${
                                  REVIEW_STATUS_STYLES[c.review_status as ReviewStatus] ??
                                  'bg-muted text-muted-foreground'
                                } border-0 text-[9px] font-semibold block w-fit`}
                              >
                                {REVIEW_STATUS_LABELS[c.review_status as ReviewStatus] ??
                                  c.review_status}
                              </Badge>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                  </td>

                  {/* ── Acciones ── */}
                  <td className="px-3 py-3">
                    <CandidateRowActions candidate={c} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Drawer de detalle de candidato */}
      <CandidateDetailSheet
        candidate={detailCandidate}
        open={detailCandidate !== null}
        onOpenChange={(open) => {
          if (!open) setDetailCandidate(null);
        }}
      />
    </>
  );
}

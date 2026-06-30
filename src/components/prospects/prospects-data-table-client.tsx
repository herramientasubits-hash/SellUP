'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Building2,
  Globe,
  ShieldCheck,
  ExternalLink,
  Sparkles,
  X,
  Info,
  Loader2,
  Clock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { Progress } from '@/components/ui/progress';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableContextMenuItem,
  type DataTableBulkAction,
} from '@/components/data-table';
import { CandidateRowActions } from '@/components/prospect-batches/candidate-row-actions';
import { CandidateDetailSheet } from '@/components/prospect-batches/candidate-detail-sheet';
import {
  LATAM_COUNTRIES,
  INDUSTRIES,
  CANDIDATE_STATUS_LABELS,
  VENDOR_STRUCTURED_SOURCE_LABELS,
  isStructuredCandidate,
  parseDuplicateCheck,
  type ProspectCandidateWithReviewer,
  type CandidateStatus,
} from '@/modules/prospect-batches/types';
import { createClient } from '@/lib/supabase/client';
import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';
import { ScopeFiltersInDrawer } from '@/components/shared/scope-filters-client';
import type { ScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';

// ── Derived types ──────────────────────────────────────────────

interface CandidateWithBatch extends ProspectCandidateWithReviewer {
  batch?: { name: string; source: string; created_at: string } | null;
}

type Row = CandidateWithBatch;

// ── Constants ──────────────────────────────────────────────────

const ORIGIN_OPTIONS = [
  { value: 'manual', label: 'Creación manual' },
  { value: 'external_import', label: 'Importación externa' },
  { value: 'agent_1', label: 'Generado por IA' },
  { value: 'socrata_colombia', label: 'RUES Colombia' },
  { value: 'datos_gob_cl', label: 'Oficial Chile' },
  { value: 'denue_mexico', label: 'DENUE México' },
  { value: 'apollo', label: 'Apollo' },
];

const DUPLICATE_STATUS_OPTIONS = [
  { value: 'no_match', label: 'Sin coincidencias' },
  { value: 'possible_duplicate', label: 'Posible duplicado' },
  { value: 'exact_duplicate', label: 'Duplicado exacto' },
  { value: 'related_company', label: 'Empresa relacionada' },
  { value: 'unchecked', label: 'Sin verificar' },
  { value: 'insufficient_data', label: 'Datos insuficientes' },
];

const STATUS_STYLES: Record<CandidateStatus, string> = {
  generated: 'bg-muted text-muted-foreground',
  normalized: 'bg-muted text-muted-foreground',
  needs_review: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  discarded: 'bg-muted/60 text-muted-foreground/60',
  duplicate: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  converted_to_account: 'bg-su-brand-soft text-su-brand',
};

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

const COUNTRY_LABELS: Record<string, string> = Object.fromEntries(
  LATAM_COUNTRIES.map((c) => [c.code, c.name])
);

function isLessThan24Hours(dateStr: string): boolean {
  const created = new Date(dateStr);
  const now = new Date();
  return now.getTime() - created.getTime() < 24 * 60 * 60 * 1000;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Helpers ────────────────────────────────────────────────────

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

function getCandidateOriginLabel(candidate: Row): string {
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

function getSourceOriginValue(candidate: Row): string {
  return candidate.batch?.source ?? 'manual';
}

function getDisplayStatus(candidate: Row): string {
  const enrichment = (candidate.metadata?.enrichment as Record<string, unknown>) || {};
  const enrichmentStatus = enrichment.status as string | undefined;
  const validationMeta = (candidate.metadata as unknown as { validation?: Record<string, unknown> })?.validation;
  const hasDuplicate =
    candidate.duplicate_status === 'possible_duplicate' ||
    candidate.duplicate_status === 'exact_duplicate';

  if (enrichmentStatus === 'pending') return 'Enriquecimiento pendiente';
  if (enrichmentStatus === 'enriching') return 'Enriqueciendo...';
  if (enrichmentStatus === 'failed') return 'Enriquecimiento fallido';

  if (validationMeta && !hasDuplicate) return 'Validado para revisión';
  if (candidate.status === 'needs_review' || candidate.status === 'generated' || candidate.status === 'normalized') return 'Necesita revisión';
  return CANDIDATE_STATUS_LABELS[candidate.status] ?? candidate.status;
}

function getDisplayStatusStyle(candidate: Row): string {
  const enrichment = (candidate.metadata?.enrichment as Record<string, unknown>) || {};
  const enrichmentStatus = enrichment.status as string | undefined;
  const validationMeta = (candidate.metadata as unknown as { validation?: Record<string, unknown> })?.validation;
  const hasDuplicate =
    candidate.duplicate_status === 'possible_duplicate' ||
    candidate.duplicate_status === 'exact_duplicate';

  if (enrichmentStatus === 'pending') return 'bg-muted text-muted-foreground/80';
  if (enrichmentStatus === 'enriching') return 'bg-su-brand-soft text-su-brand';
  if (enrichmentStatus === 'failed') return 'bg-destructive/10 text-destructive';

  if (validationMeta && !hasDuplicate) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (candidate.status === 'needs_review' || candidate.status === 'generated' || candidate.status === 'normalized') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return STATUS_STYLES[candidate.status] ?? 'bg-muted text-muted-foreground';
}

function getDisplayStatusKey(candidate: Row): string {
  const enrichment = (candidate.metadata?.enrichment as Record<string, unknown>) || {};
  const enrichmentStatus = enrichment.status as string | undefined;
  const validationMeta = (candidate.metadata as unknown as { validation?: Record<string, unknown> })?.validation;
  const hasDuplicate =
    candidate.duplicate_status === 'possible_duplicate' ||
    candidate.duplicate_status === 'exact_duplicate';

  if (enrichmentStatus === 'pending') return 'enrichment_pending';
  if (enrichmentStatus === 'enriching') return 'enriching';
  if (enrichmentStatus === 'failed') return 'enrichment_failed';
  if (validationMeta && !hasDuplicate) return 'validated';
  return candidate.status;
}

// ── Sub-components ─────────────────────────────────────────────

function getSourceBanner(sourceBatchType: string | undefined): string {
  if (!sourceBatchType) return 'Mostrando prospectos de la operación reciente';
  if (sourceBatchType === 'external_import') return 'Mostrando prospectos de la importación reciente';
  if (sourceBatchType === 'agent_1' || sourceBatchType === 'apollo') return 'Mostrando prospectos generados con IA';
  if (sourceBatchType === 'socrata_colombia') return 'Mostrando prospectos encontrados en RUES Colombia';
  if (sourceBatchType === 'datos_gob_cl') return 'Mostrando prospectos encontrados en fuente oficial Chile';
  if (sourceBatchType === 'denue_mexico') return 'Mostrando prospectos encontrados en DENUE México';
  if (sourceBatchType === 'manual') return 'Mostrando prospectos creados recientemente';
  return 'Mostrando prospectos de la operación reciente';
}

function DuplicateCheckCell({ candidate }: { candidate: Row }) {
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
          } />
          <TooltipContent className="text-[11px] leading-relaxed bg-popover text-popover-foreground border border-border p-2.5 rounded-xl shadow-md z-[70] space-y-1">
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
                  <div key={i} className="rounded-xl border border-border/40 bg-card p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        {match.source === 'sellup' ? 'SellUp' : match.source === 'hubspot' ? 'HubSpot' : match.source}
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
                        href={match.matched_website.startsWith('http') ? match.matched_website : `https://${match.matched_website}`}
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
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Sin detalle de duplicidad disponible.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QualityCell({ candidate }: { candidate: Row }) {
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
      || getNestedValue(candidate.metadata, ['import', 'linkedin_url']);
    if (!linkedinUrl) missingFields.push('linkedin_url');
    if (!candidate.tax_identifier) missingFields.push('tax_identifier');
    if (!candidate.industry && !(candidate.metadata?.enrichment as Record<string, unknown> | undefined)?.sector_description) missingFields.push('industry');
  }

  let completenessText = 'Información completa';
  let completenessStyle = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (missingFields.length > 0) {
    if (missingFields.length >= 3 && !candidate.website && !candidate.tax_identifier) {
      completenessText = 'Sin evidencia';
      completenessStyle = 'bg-muted text-muted-foreground';
    } else {
      completenessText = `${missingFields.length} ${missingFields.length === 1 ? 'dato pendiente' : 'datos pendientes'}`;
      completenessStyle = 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
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

  let fiscalText = 'Sin identificador';
  let fiscalStatusKey: 'validated' | 'to_review' | 'none' = 'none';
  if (candidate.tax_identifier) {
    fiscalText = 'Fiscal validado';
    fiscalStatusKey = 'validated';
  } else {
    const lookup = (candidate.metadata as Record<string, unknown>)?.tax_identifier_lookup as Record<string, unknown> | undefined;
    const bestCandidate = lookup?.best_candidate as Record<string, unknown> | undefined;
    if (bestCandidate?.tax_identifier) {
      fiscalText = 'Fiscal por revisar';
      fiscalStatusKey = 'to_review';
    }
  }

  return (
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
              <span className={candidate.website ? 'text-emerald-500' : 'text-amber-500'}>
                {candidate.website ? '✓' : '✗'}
              </span>
              <span>Sitio web: {candidate.website ? 'Presente' : 'Pendiente'}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className={!missingFields.includes('linkedin_url') ? 'text-emerald-500' : 'text-amber-500'}>
                {!missingFields.includes('linkedin_url') ? '✓' : '✗'}
              </span>
              <span>LinkedIn: {!missingFields.includes('linkedin_url') ? 'Presente' : 'Pendiente'}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className={candidate.tax_identifier ? 'text-emerald-500' : fiscalStatusKey === 'to_review' ? 'text-amber-500' : 'text-muted-foreground/60'}>
                {candidate.tax_identifier ? '✓' : fiscalStatusKey === 'to_review' ? '?' : '✗'}
              </span>
              <span>Identificador fiscal: {candidate.tax_identifier ? `Presente (${candidate.tax_identifier_type || 'NIT'})` : fiscalStatusKey === 'to_review' ? 'Sugerido por revisar' : 'No disponible'}</span>
            </li>
            <li className="flex items-center gap-1.5 border-t border-border/20 pt-1 mt-1">
              <span className="font-medium">Nivel de confianza:</span>
              <span className="text-foreground capitalize">{confidenceText.split(' ')[1]}</span>
            </li>
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function StatusCell({ candidate }: { candidate: Row }) {
  const statusLabel = getDisplayStatus(candidate);
  const statusStyle = getDisplayStatusStyle(candidate);
  const enrichment = (candidate.metadata?.enrichment as Record<string, unknown>) || {};
  const enrichmentStatus = enrichment.status as string | undefined;
  const enrichmentError = enrichment.error_message as string | undefined;

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

  const fitStatusValue = candidate.commercial_fit_status
    || getNestedValue(candidate.metadata, ['enrichment', 'ai_evaluation', 'fit_status'])
    || getNestedValue(candidate.metadata, ['ai_evaluation', 'fit_status'])
    || null;
  const fitStatus = typeof fitStatusValue === 'string' ? fitStatusValue : null;
  const fitScore = candidate.fit_score ?? null;

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
}

// ── Main Component ─────────────────────────────────────────────

interface ProspectsDataTableClientProps {
  candidates: ProspectCandidateWithReviewer[];
  sourceId?: string;
  sourceBatchType?: string;
  scopeFilterOptions?: ScopeFilterOptions;
  currentUserId?: string;
  currentGroupId?: string;
  currentRoleKey?: string;
}

export function ProspectsDataTableClient({
  candidates,
  sourceId,
  sourceBatchType,
  scopeFilterOptions,
  currentUserId = '',
  currentGroupId = '',
  currentRoleKey = '',
}: ProspectsDataTableClientProps) {
  const router = useRouter();

  // Attach batch data from the original fetch
  const rows: Row[] = React.useMemo(
    () => candidates as Row[],
    [candidates],
  );

  const [detailCandidate, setDetailCandidate] = React.useState<Row | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  // ── Orchestrator polling (sourceId batch enrichment) ──────────
  const [batchStats, setBatchStats] = React.useState<{
    total: number;
    pending: number;
    enriching: number;
    completed: number;
    failed: number;
    skipped: number;
    possibleDuplicates: number;
  } | null>(null);

  const syncBatchStatus = React.useCallback(async () => {
    if (!sourceId) return;
    const supabase = createClient();
    const { data: batchCandidates, error } = await supabase
      .from('prospect_candidates')
      .select('id, metadata, duplicate_status, status')
      .eq('batch_id', sourceId);

    if (error || !batchCandidates) return;

    let pendingCount = 0;
    let enrichingCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let possibleDuplicateCount = 0;

    const pendingIds: string[] = [];

    for (const cand of batchCandidates) {
      const enrichment = cand.metadata?.enrichment || {};
      const estatus = enrichment.status;

      if (estatus === 'pending') {
        pendingCount++;
        pendingIds.push(cand.id);
      } else if (estatus === 'enriching' || estatus === 'processing') {
        enrichingCount++;
      } else if (estatus === 'completed') {
        completedCount++;
      } else if (estatus === 'failed') {
        failedCount++;
      } else if (
        estatus === 'skipped' ||
        estatus === 'skipped_duplicate' ||
        estatus === 'skipped_already_complete' ||
        estatus === 'no_required'
      ) {
        skippedCount++;
      }

      if (cand.duplicate_status === 'possible_duplicate') {
        possibleDuplicateCount++;
      }
    }

    setBatchStats({
      total: batchCandidates.length,
      pending: pendingCount,
      enriching: enrichingCount,
      completed: completedCount,
      failed: failedCount,
      skipped: skippedCount,
      possibleDuplicates: possibleDuplicateCount,
    });

    return { pendingIds, enrichingCount };
  }, [sourceId]);

  React.useEffect(() => {
    if (!sourceId) return;

    const initialTimer = setTimeout(() => {
      syncBatchStatus();
    }, 0);

    const interval = setInterval(async () => {
      const stats = await syncBatchStatus();
      if (!stats) return;
      router.refresh();
      if (stats.pendingIds.length === 0 && stats.enrichingCount === 0) {
        clearInterval(interval);
      }
    }, 5000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [sourceId, syncBatchStatus, router]);

  // ── Column definitions ────────────────────────────────────────
  const columns: ColumnDef<Row, unknown>[] = React.useMemo(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Empresa" />
        ),
        cell: ({ row }) => {
          const c = row.original;
          const isChileOfficialCandidate =
            c.source_primary === 'datos_gob_cl' ||
            c.country_code === 'CL' ||
            (c.source_primary as string) === 'cl_res';
          const location = [c.country ?? c.country_code, c.city].filter(Boolean).join(' · ');
          const domain = c.website ? extractDomainFromUrl(c.website) : null;

          return (
            <div className="min-w-0 space-y-1 max-w-[220px]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setDetailCandidate(c);
                    setDetailOpen(true);
                  }}
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
                <p className="text-[10px] text-muted-foreground/75 leading-tight">{location}</p>
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
          );
        },
        size: 220,
        minSize: 180,
        enableHiding: false,
        meta: { label: 'Empresa', popoverTitle: 'Empresa' },
      },
      {
        id: 'country_code',
        accessorKey: 'country_code',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="País" />
        ),
        cell: ({ row }) => (
          <span className="truncate text-sm text-muted-foreground">
            {row.original.country_code ? (COUNTRY_LABELS[row.original.country_code] ?? row.original.country_code) : '—'}
          </span>
        ),
        size: 110,
        minSize: 80,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'País',
          popoverTitle: 'País',
          filterOptions: LATAM_COUNTRIES.map((c) => ({
            label: c.name,
            value: c.code,
          })),
        },
      },
      {
        id: 'industry',
        accessorKey: 'industry',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Sector" />
        ),
        cell: ({ row }) => {
          const sectorDescription =
            row.original.industry ??
            ((row.original.metadata?.enrichment as Record<string, unknown> | undefined)
              ?.sector_description as string | undefined) ??
            null;
          return (
            <span className="truncate text-xs text-muted-foreground">
              {sectorDescription ?? 'Sin sector'}
            </span>
          );
        },
        size: 150,
        minSize: 120,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Sector',
          popoverTitle: 'Sector',
          filterOptions: INDUSTRIES.map((ind) => ({
            label: ind,
            value: ind,
          })),
        },
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Fecha" />
        ),
        cell: ({ row }) => {
          const c = row.original;
          const isNew = c.created_at && isLessThan24Hours(c.created_at);
          return (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {c.created_at ? formatDate(c.created_at) : '—'}
              </span>
              {isNew && (
                <Badge className="border-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-semibold px-1.5 py-0.5 shrink-0">
                  Nuevo
                </Badge>
              )}
            </div>
          );
        },
        size: 150,
        minSize: 120,
        meta: {
          label: 'Fecha',
          popoverTitle: 'Fecha de creación',
        },
      },
      {
        id: 'quality',
        accessorFn: () => 'quality',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Calidad" />
        ),
        cell: ({ row }) => <QualityCell candidate={row.original} />,
        size: 160,
        minSize: 130,
        enableColumnFilter: false,
        meta: {
          label: 'Calidad',
          popoverTitle: 'Calidad',
          disableFilter: true,
        },
      },
      {
        id: 'duplicate_status',
        accessorKey: 'duplicate_status',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Duplicidad" />
        ),
        cell: ({ row }) => <DuplicateCheckCell candidate={row.original} />,
        size: 150,
        minSize: 120,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Duplicidad',
          popoverTitle: 'Duplicidad',
          filterOptions: DUPLICATE_STATUS_OPTIONS,
        },
      },
      {
        id: 'display_status',
        accessorFn: (row) => getDisplayStatusKey(row),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Estado" />
        ),
        cell: ({ row }) => <StatusCell candidate={row.original} />,
        size: 160,
        minSize: 130,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Estado',
          popoverTitle: 'Estado',
          filterOptions: [
            { value: 'needs_review', label: 'Necesita revisión' },
            { value: 'generated', label: 'Generado' },
            { value: 'normalized', label: 'Normalizado' },
            { value: 'validated', label: 'Validado para revisión' },
            { value: 'approved', label: 'Aprobado' },
            { value: 'discarded', label: 'Descartado' },
            { value: 'duplicate', label: 'Duplicado' },
            { value: 'converted_to_account', label: 'Convertido' },
            { value: 'enrichment_pending', label: 'Enriquecimiento pendiente' },
            { value: 'enriching', label: 'Enriqueciendo...' },
            { value: 'enrichment_failed', label: 'Enriquecimiento fallido' },
          ],
        },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => <CandidateRowActions candidate={row.original} />,
        size: 48,
        minSize: 48,
        enableSorting: false,
        enableHiding: false,
        enableColumnFilter: false,
        meta: { label: 'Acciones', disableFilter: true, disableSort: true },
      },
    ],
    [],
  );

  // ── Context menu ──────────────────────────────────────────────
  const contextMenu = React.useMemo(
    () => ({
      items: (row: Row): DataTableContextMenuItem[] => [
        {
          id: 'view',
          label: 'Ver detalle',
          icon: Info,
          onClick: () => {
            setDetailCandidate(row);
            setDetailOpen(true);
          },
        },
        ...(row.website
          ? [
              {
                id: 'open-website',
                label: 'Abrir sitio web',
                icon: ExternalLink,
                separator: true as const,
                onClick: () => {
                  window.open(
                    row.website!.startsWith('http') ? row.website! : `https://${row.website}`,
                    '_blank',
                    'noopener,noreferrer',
                  );
                },
              },
            ]
          : []),
      ],
    }),
    [],
  );

  // ── Bulk actions ──────────────────────────────────────────────
  const bulkActions = React.useMemo<DataTableBulkAction<Row>[]>(
    () => [
      {
        id: 'view-detail',
        label: 'Ver detalle',
        icon: Info,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => {
          setDetailCandidate(rows[0]);
          setDetailOpen(true);
        },
      },
      {
        id: 'open-websites',
        label: 'Abrir sitios web',
        icon: ExternalLink,
        disabled: (rows) => !rows.some((r) => r.website),
        onClick: (rows) => {
          rows.forEach((r) => {
            if (r.website) {
              window.open(
                r.website.startsWith('http') ? r.website : `https://${r.website}`,
                '_blank',
                'noopener,noreferrer',
              );
            }
          });
        },
      },
    ],
    [],
  );

  const isSourceFiltered = !!sourceId;

  return (
    <>
      {/* Banner de operación reciente (sourceId activo) */}
      {isSourceFiltered && (
        <div className="shrink-0 flex flex-col gap-2.5 rounded-xl border border-su-brand/20 bg-su-brand-soft/30 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {batchStats && (batchStats.pending > 0 || batchStats.enriching > 0) ? (
                <Loader2 className="h-4 w-4 shrink-0 text-su-brand animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 shrink-0 text-su-brand" />
              )}
              <p className="text-xs font-medium text-su-brand">
                {batchStats ? (
                  (batchStats.pending > 0 || batchStats.enriching > 0) ? (
                    `Importación completada. Estamos completando la información de ${batchStats.pending + batchStats.enriching} prospecto${batchStats.pending + batchStats.enriching !== 1 ? 's' : ''}...`
                  ) : (
                    `Importación completada. Se enriquecieron ${batchStats.completed} prospecto${batchStats.completed !== 1 ? 's' : ''} y ${batchStats.failed + batchStats.possibleDuplicates} requiere${batchStats.failed + batchStats.possibleDuplicates !== 1 ? 'n' : ''} revisión.`
                  )
                ) : (
                  getSourceBanner(sourceBatchType)
                )}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(PROSPECTOS_TAB_ROUTE)}
              className="h-7 shrink-0 gap-1.5 px-2.5 text-xs text-su-brand hover:bg-su-brand-soft hover:text-su-brand"
            >
              <X className="h-3 w-3" />
              Ver todos los prospectos
            </Button>
          </div>
          {batchStats && (batchStats.pending > 0 || batchStats.enriching > 0) && (
            <div className="space-y-1.5">
              <Progress
                value={batchStats.total > 0 ? ((batchStats.completed + batchStats.failed) / batchStats.total) * 100 : 0}
                className="h-1.5 bg-su-brand/10"
              />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
                <span>
                  {batchStats.completed + batchStats.failed} de {batchStats.total} procesados
                </span>
                <span className="tabular-nums font-medium text-su-brand/70">
                  {batchStats.total > 0 ? Math.round(((batchStats.completed + batchStats.failed) / batchStats.total) * 100) : 0}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        title="Listado de prospectos"
        description="Genera, importa y revisa empresas candidatas antes de convertirlas en cuentas listas para trabajar."
        count={rows.length}
        enableRowSelection
        contextMenu={contextMenu}
        bulkActions={bulkActions}
        enableColumnReorder
        initialPageSize={20}
        fillHeight
        onRowClick={(row) => {
          setDetailCandidate(row);
          setDetailOpen(true);
        }}
        rowClickable
        settingsExtraSections={
          scopeFilterOptions && !sourceId ? (
            <ScopeFiltersInDrawer
              scopeFilterOptions={scopeFilterOptions}
              currentUserId={currentUserId}
              currentGroupId={currentGroupId}
              currentRoleKey={currentRoleKey}
            />
          ) : undefined
        }
        emptyState={
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 rounded-full bg-muted/60 p-3">
              <Building2 className="h-6 w-6 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-foreground">Sin prospectos</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              {isSourceFiltered
                ? 'No se encontraron prospectos en esta operación.'
                : 'Ajusta los filtros o importa prospectos para ver resultados.'}
            </p>
          </div>
        }
      />

      <CandidateDetailSheet
        key={detailCandidate?.id ?? 'empty'}
        candidate={detailCandidate ? (rows.find((c) => c.id === detailCandidate.id) ?? detailCandidate) : null}
        open={detailOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDetailCandidate(null);
          }
        }}
        onCandidateUpdated={(updated) => {
          setDetailCandidate(updated);
        }}
      />
    </>
  );
}

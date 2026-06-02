'use client';

import * as React from 'react';
import { Building2, Globe, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
  CANDIDATE_SOURCE_LABELS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_STYLES,
  CRITICAL_REVIEW_FLAG_LABELS,
  STRUCTURED_SOURCE_LABELS,
  TAX_IDENTIFIER_TYPE_LABELS,
  isStructuredCandidate,
  parseDuplicateCheck,
  type ProspectCandidateWithReviewer,
  type CandidateStatus,
  type DuplicateStatus,
  type DuplicateMatch,
  type ReviewStatus,
} from '@/modules/prospect-batches/types';
import { CandidateRowActions } from './candidate-row-actions';

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
  // candidate.sources_checked holds pipeline provider objects {provider, checked_at, result}
  // The string[] of duplicate-check sources lives in metadata.duplicate_check.sources_checked
  const sources = dc?.sources_checked ?? [];
  const matches = dc?.matches ?? [];

  return (
    <div className="flex flex-col gap-1 min-w-[130px]">
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

      {/* Summary */}
      {dc?.summary && (
        <p
          className="text-[10px] text-muted-foreground max-w-[160px] truncate leading-tight"
          title={dc.summary}
        >
          {dc.summary}
        </p>
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

      {/* Fallback for candidates with no detail */}
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
  if (candidates.length === 0) return <EmptyState />;

  const hasStructured = candidates.some((c) => isStructuredCandidate(c));

  return (
    <div className="overflow-x-auto">
      {hasStructured && (
        <div className="px-5 py-2.5 border-b border-border/30 bg-amber-500/5">
          <p className="text-[10px] text-amber-700 dark:text-amber-400">
            <span className="font-semibold">Guía de revisión:</span>{' '}
            Antes de marcar revisado, valida nombre, NIT, actividad/sector, duplicidad y señales de empresa activa.
          </p>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40">
            {[
              'Empresa',
              'País',
              'Industria',
              'Web / Dominio',
              'Fuente',
              'Duplicidad',
              'Conf.',
              'Fit',
              'Estado',
              'Costo',
              '',
            ].map((col) => (
              <th
                key={col}
                className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr
              key={c.id}
              className="group border-b border-border/30 transition-colors last:border-0 hover:bg-muted/30"
            >
              {/* Empresa */}
              <td className="px-4 py-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-medium text-foreground leading-snug">{c.name}</p>
                    {isStructuredCandidate(c) && (
                      <Badge className="border-0 bg-su-brand-soft text-su-brand text-[9px] font-semibold flex items-center gap-0.5 px-1.5 py-0.5">
                        <ShieldCheck className="h-2.5 w-2.5" />
                        {STRUCTURED_SOURCE_LABELS[c.source_primary ?? ''] ?? 'Fuente oficial'}
                      </Badge>
                    )}
                  </div>
                  {c.legal_name && (
                    <p className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {c.legal_name}
                    </p>
                  )}
                  {c.tax_identifier && (
                    <p className="text-[10px] font-mono text-muted-foreground/80">
                      {c.tax_identifier_type
                        ? `${c.tax_identifier_type} ${c.tax_identifier}`
                        : c.tax_identifier}
                    </p>
                  )}
                </div>
              </td>
              {/* País */}
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {c.country_code ? (
                  <span className="flex items-center gap-1.5">
                    <span>{getFlagEmoji(c.country_code)}</span>
                    <span>{c.city ?? c.country ?? c.country_code}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground/40">—</span>
                )}
              </td>
              {/* Industria */}
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {c.industry ?? <span className="text-muted-foreground/40">—</span>}
              </td>
              {/* Web */}
              <td className="px-4 py-3">
                {c.website ? (
                  <a
                    href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-su-brand hover:underline"
                  >
                    <Globe className="h-3 w-3" />
                    {c.domain ?? c.website}
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground/40">—</span>
                )}
              </td>
              {/* Fuente */}
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {c.source_primary
                  ? CANDIDATE_SOURCE_LABELS[c.source_primary]
                  : <span className="text-muted-foreground/40">—</span>}
              </td>
              {/* Duplicidad */}
              <td className="px-4 py-3">
                <DuplicateCheckCell candidate={c} />
              </td>
              {/* Confianza */}
              <td className="px-4 py-3">
                <ScoreBadge score={c.confidence_score} label="Confianza" />
              </td>
              {/* Fit */}
              <td className="px-4 py-3">
                <ScoreBadge score={c.fit_score} label="Fit" />
              </td>
              {/* Estado */}
              <td className="px-4 py-3">
                <div className="space-y-1">
                  <Badge
                    className={`${STATUS_STYLES[c.status]} border-0 text-[10px] font-semibold`}
                  >
                    {CANDIDATE_STATUS_LABELS[c.status]}
                  </Badge>
                  {c.status === 'approved' &&
                    (c.commercial_trace as Record<string, unknown> | null)?.conversionRollback === true && (
                    <Badge className="border-0 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px] font-semibold block w-fit">
                      Conversión revertida
                    </Badge>
                  )}
                  {c.review_status && (
                    <Badge
                      className={`${REVIEW_STATUS_STYLES[c.review_status as ReviewStatus] ?? 'bg-muted text-muted-foreground'} border-0 text-[9px] font-semibold block w-fit`}
                    >
                      {REVIEW_STATUS_LABELS[c.review_status as ReviewStatus] ?? c.review_status}
                    </Badge>
                  )}
                  {Array.isArray(c.review_flags) && c.review_flags.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 max-w-[160px]">
                      {(c.review_flags as string[])
                        .filter((f) => CRITICAL_REVIEW_FLAG_LABELS[f])
                        .map((flag) => (
                          <span
                            key={flag}
                            className="inline-block rounded px-1 py-0.5 text-[8px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          >
                            {CRITICAL_REVIEW_FLAG_LABELS[flag]}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              </td>
              {/* Costo */}
              <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
                {c.estimated_cost_usd
                  ? `$${Number(c.estimated_cost_usd).toFixed(4)}`
                  : '—'}
              </td>
              {/* Acciones */}
              <td className="px-3 py-3">
                <CandidateRowActions candidate={c} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

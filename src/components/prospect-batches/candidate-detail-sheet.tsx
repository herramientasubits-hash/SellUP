'use client';

import * as React from 'react';
import {
  Globe,
  Link2,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Building2,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import {
  CANDIDATE_STATUS_LABELS,
  DUPLICATE_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_STYLES,
  CRITICAL_REVIEW_FLAG_LABELS,
  STRUCTURED_SOURCE_LABELS,
  VENDOR_CANDIDATE_SOURCE_LABELS,
  isStructuredCandidate,
  parseDuplicateCheck,
  type ProspectCandidateWithReviewer,
  type ReviewStatus,
  type DuplicateMatch,
} from '@/modules/prospect-batches/types';

// ── Helpers de presentación ────────────────────────────────────

function val(v: string | null | undefined, fallback = 'Sin dato'): string {
  if (v === null || v === undefined || v === '') return fallback;
  return v;
}

function numVal(v: number | null | undefined, fallback = 'Sin dato'): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function getFlagEmoji(code: string) {
  const offset = 0x1f1e6 - 'A'.charCodeAt(0);
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + offset))
    .join('');
}

// ── Sub-componentes ────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
      {children}
    </h3>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">{label}</p>
      <p className={`text-xs ${mono ? 'font-mono' : ''} text-foreground/90 leading-snug`}>
        {value}
      </p>
    </div>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</div>;
}

function Divider() {
  return <div className="border-t border-border/30 my-4" />;
}

function MissingText({ text }: { text: string }) {
  return <span className="text-muted-foreground/40 italic">{text}</span>;
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 hover:text-muted-foreground transition-colors mb-2"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {title}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  sellup: 'SellUp',
  hubspot: 'HubSpot',
};

function DuplicateMatchCard({ match }: { match: DuplicateMatch }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card p-2.5 space-y-1">
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
      {match.reason && (
        <p className="text-[10px] text-muted-foreground/60 italic">{match.reason}</p>
      )}
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────

interface CandidateDetailSheetProps {
  candidate: ProspectCandidateWithReviewer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CandidateDetailSheet({
  candidate,
  open,
  onOpenChange,
}: CandidateDetailSheetProps) {
  if (!candidate) return null;

  const isStructured = isStructuredCandidate(candidate);
  const dc = parseDuplicateCheck(candidate.metadata);
  const enrichment = candidate.metadata?.enrichment as Record<string, unknown> | undefined;
  const aiEval = candidate.metadata?.ai_evaluation as Record<string, unknown> | undefined;
  const sourcePrimaryLabel = candidate.source_primary
    ? (VENDOR_CANDIDATE_SOURCE_LABELS[candidate.source_primary] ?? candidate.source_primary)
    : null;
  const structuredSourceLabel = isStructured && candidate.source_primary
    ? (STRUCTURED_SOURCE_LABELS[candidate.source_primary] ?? sourcePrimaryLabel)
    : null;

  const flags = (candidate.review_flags as string[] | null) ?? [];
  const dcSources = dc?.sources_checked ?? [];
  const dcMatches = dc?.matches ?? [];

  // AI eval fields
  const fitStatus = candidate.commercial_fit_status
    ?? (aiEval?.fit_status as string | undefined)
    ?? null;
  const fitScore = candidate.fit_score;
  const fitReasons = (aiEval?.fit_reasons as string[] | undefined) ?? [];
  const risks = (aiEval?.risks as string[] | undefined) ?? [];
  const missingFields = (aiEval?.missing_fields as string[] | undefined) ?? [];
  const aiSummary = (aiEval?.summary as string | undefined) ?? null;
  const evidenceUsed = (aiEval?.evidence_used as string[] | undefined) ?? [];
  const hasAiEval = fitStatus !== null || fitScore !== null || aiSummary !== null;

  // Enrichment fields
  const linkedinUrl = (enrichment?.linkedin_url as string | undefined)
    ?? (enrichment?.linkedin as string | undefined)
    ?? null;
  const publicDescription = (enrichment?.description as string | undefined)
    ?? (enrichment?.public_description as string | undefined)
    ?? null;
  const employeeCount = (enrichment?.employee_count as string | number | undefined)
    ?? candidate.company_size
    ?? null;
  const sectorDescription = (enrichment?.sector_description as string | undefined)
    ?? candidate.industry
    ?? null;
  const ciiu = (enrichment?.ciiu as string | undefined)
    ?? (enrichment?.sector_code as string | undefined)
    ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-xl overflow-y-auto flex flex-col gap-0 px-0">
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border/30">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 rounded-md bg-muted p-1.5 shrink-0">
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-base font-semibold leading-snug truncate">
                {candidate.name}
              </SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                {candidate.country_code && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {candidate.country ?? candidate.country_code}
                  </span>
                )}
                {structuredSourceLabel ? (
                  <Badge className="border-0 bg-su-brand-soft text-su-brand text-[9px] font-semibold flex items-center gap-0.5 px-1.5 py-0.5 h-4">
                    <ShieldCheck className="h-2.5 w-2.5" />
                    {structuredSourceLabel}
                  </Badge>
                ) : sourcePrimaryLabel ? (
                  <span className="text-[10px] text-muted-foreground/60">{sourcePrimaryLabel}</span>
                ) : null}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="px-5 py-4 space-y-5 flex-1">
          {/* A. Resumen */}
          <div>
            <SectionHeader>Resumen</SectionHeader>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  className={`border-0 text-[10px] font-semibold ${
                    {
                      generated: 'bg-muted text-muted-foreground',
                      normalized: 'bg-muted text-muted-foreground',
                      needs_review: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                      approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                      discarded: 'bg-muted/60 text-muted-foreground/60',
                      duplicate: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
                      converted_to_account: 'bg-su-brand-soft text-su-brand',
                    }[candidate.status]
                  }`}
                >
                  {CANDIDATE_STATUS_LABELS[candidate.status]}
                </Badge>
                {candidate.review_status && (
                  <Badge
                    className={`border-0 text-[10px] font-semibold ${
                      REVIEW_STATUS_STYLES[candidate.review_status as ReviewStatus] ?? 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {REVIEW_STATUS_LABELS[candidate.review_status as ReviewStatus] ?? candidate.review_status}
                  </Badge>
                )}
                {typeof candidate.data_completeness_score === 'number' && (
                  <span className="text-[10px] text-muted-foreground/60">
                    Completitud: {candidate.data_completeness_score}%
                  </span>
                )}
              </div>
              {aiSummary && (
                <p className="text-xs text-muted-foreground leading-relaxed">{aiSummary}</p>
              )}
            </div>
          </div>

          <Divider />

          {/* B. Datos oficiales / legales */}
          <div>
            <SectionHeader>Datos oficiales / legales</SectionHeader>
            <FieldGrid>
              <Field label="Razón social" value={val(candidate.legal_name ?? candidate.name)} />
              <Field
                label={candidate.tax_identifier_type ?? 'Identificador fiscal'}
                value={candidate.tax_identifier ? (
                  <span className="font-mono">{candidate.tax_identifier}</span>
                ) : (
                  <MissingText text="Sin dato" />
                )}
              />
              <Field
                label="País"
                value={
                  candidate.country_code ? (
                    <span className="flex items-center gap-1">
                      {getFlagEmoji(candidate.country_code)} {val(candidate.country ?? candidate.country_code)}
                    </span>
                  ) : (
                    <MissingText text="Sin dato" />
                  )
                }
              />
              <Field
                label="Ciudad / Región"
                value={val(
                  [candidate.city, candidate.region].filter(Boolean).join(', ') || null,
                  'Sin dato'
                )}
              />
              {ciiu && <Field label="CIIU / Código sector" value={ciiu} mono />}
              <Field label="Actividad económica" value={val(sectorDescription, 'Sin sector')} />
              {structuredSourceLabel && (
                <Field label="Fuente oficial" value={structuredSourceLabel} />
              )}
            </FieldGrid>
          </div>

          <Divider />

          {/* C. Datos comerciales / web */}
          <div>
            <SectionHeader>Datos comerciales / web</SectionHeader>
            <div className="space-y-2.5">
              <FieldGrid>
                <Field
                  label="Sitio web"
                  value={
                    candidate.website ? (
                      <a
                        href={candidate.website.startsWith('http') ? candidate.website : `https://${candidate.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-su-brand hover:underline"
                      >
                        <Globe className="h-3 w-3 shrink-0" />
                        {candidate.domain ?? candidate.website}
                      </a>
                    ) : (
                      <MissingText text="Sin web encontrada" />
                    )
                  }
                />
                <Field
                  label="LinkedIn corporativo"
                  value={
                    linkedinUrl ? (
                      <a
                        href={linkedinUrl.startsWith('http') ? linkedinUrl : `https://${linkedinUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-su-brand hover:underline"
                      >
                        <Link2 className="h-3 w-3 shrink-0" />
                        Ver perfil
                      </a>
                    ) : (
                      <MissingText text="Sin LinkedIn encontrado" />
                    )
                  }
                />
                <Field
                  label="Tamaño / Empleados"
                  value={val(employeeCount ? String(employeeCount) : null, 'Sin dato de tamaño')}
                />
                {!isStructured && sourcePrimaryLabel && (
                  <Field label="Fuente" value={sourcePrimaryLabel} />
                )}
              </FieldGrid>
              {publicDescription && (
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Descripción pública</p>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{publicDescription}</p>
                </div>
              )}
              {!publicDescription && (
                <p className="text-xs text-muted-foreground/40 italic">No encontrado en evidencia pública</p>
              )}
            </div>
          </div>

          <Divider />

          {/* D. Evaluación IA */}
          <div>
            <SectionHeader>Evaluación IA</SectionHeader>
            {hasAiEval ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  {fitStatus && (
                    <Badge
                      className={`border-0 text-[10px] font-semibold ${
                        fitStatus === 'high_fit' || fitStatus === 'good_fit'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : fitStatus === 'medium_fit'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {fitStatus.replace(/_/g, ' ')}
                    </Badge>
                  )}
                  {fitScore !== null && (
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        fitScore >= 75
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : fitScore >= 50
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {fitScore.toFixed(0)} / 100
                    </span>
                  )}
                </div>
                {fitReasons.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Razones</p>
                    <ul className="space-y-0.5">
                      {fitReasons.map((r, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                          <CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {risks.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Riesgos</p>
                    <ul className="space-y-0.5">
                      {risks.map((r, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                          <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {missingFields.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Campos faltantes</p>
                    <div className="flex flex-wrap gap-1">
                      {missingFields.map((f, i) => (
                        <Badge key={i} className="border-0 bg-muted text-muted-foreground text-[9px]">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {evidenceUsed.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Evidencias usadas</p>
                    <ul className="space-y-0.5">
                      {evidenceUsed.map((e, i) => (
                        <li key={i} className="text-xs text-muted-foreground truncate">{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/40 italic">Sin evaluación IA todavía</p>
            )}
          </div>

          <Divider />

          {/* E. Duplicidad */}
          <div>
            <SectionHeader>Duplicidad</SectionHeader>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  className={`border-0 text-[10px] font-semibold ${
                    {
                      unchecked: 'bg-muted text-muted-foreground/60',
                      no_match: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                      possible_duplicate: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                      exact_duplicate: 'bg-destructive/10 text-destructive',
                      related_company: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
                      insufficient_data: 'bg-muted/60 text-muted-foreground/60',
                    }[candidate.duplicate_status]
                  }`}
                >
                  {DUPLICATE_STATUS_LABELS[candidate.duplicate_status]}
                </Badge>
                {dcSources.length > 0 && (
                  <div className="flex gap-2">
                    {['sellup', 'hubspot'].map((src) => {
                      const checked = dcSources.includes(src);
                      return (
                        <span
                          key={src}
                          className={`text-[10px] font-medium ${
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
              </div>
              {dc?.summary && (
                <p className="text-xs text-muted-foreground">{dc.summary}</p>
              )}
              {dcMatches.length > 0 && (
                <div className="space-y-1.5">
                  {dcMatches.map((match, i) => (
                    <DuplicateMatchCard key={i} match={match} />
                  ))}
                </div>
              )}
              {!dc && dcSources.length === 0 && (
                <p className="text-xs text-muted-foreground/40 italic">Sin detalle de duplicidad disponible</p>
              )}
            </div>
          </div>

          <Divider />

          {/* F. Faltantes y riesgos */}
          {flags.length > 0 && (
            <>
              <div>
                <SectionHeader>Faltantes y riesgos</SectionHeader>
                <div className="flex flex-wrap gap-1.5">
                  {flags.includes('liquidation_signal') && (
                    <Badge className="border-0 bg-destructive/10 text-destructive text-[9px] font-semibold flex items-center gap-0.5">
                      <XCircle className="h-2.5 w-2.5" />
                      En liquidación
                    </Badge>
                  )}
                  {flags
                    .filter((f) => f !== 'liquidation_signal')
                    .map((flag) => {
                      const label = CRITICAL_REVIEW_FLAG_LABELS[flag];
                      if (!label) return null;
                      return (
                        <Badge key={flag} className="border-0 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9px] font-medium">
                          {label}
                        </Badge>
                      );
                    })}
                </div>
              </div>
              <Divider />
            </>
          )}

          {/* G. Detalle técnico (colapsado) */}
          <CollapsibleSection title="Detalle técnico">
            <div className="rounded-lg border border-border/40 bg-muted/30 p-3 space-y-3">
              <FieldGrid>
                <Field label="Candidate ID" value={candidate.id} mono />
                <Field label="Batch ID" value={candidate.batch_id} mono />
                <Field label="Fuente primaria" value={val(candidate.source_primary)} mono />
                <Field label="Creado" value={new Date(candidate.created_at).toLocaleString('es-CO')} />
                <Field label="Actualizado" value={new Date(candidate.updated_at).toLocaleString('es-CO')} />
                {candidate.reviewed_at && (
                  <Field
                    label="Revisado"
                    value={new Date(candidate.reviewed_at).toLocaleString('es-CO')}
                  />
                )}
                {candidate.confidence_score !== null && (
                  <Field
                    label="Confianza"
                    value={`${candidate.confidence_score?.toFixed(0)}%`}
                  />
                )}
                {candidate.estimated_cost_usd !== null &&
                  Number(candidate.estimated_cost_usd) > 0 && (
                  <Field
                    label="Costo estimado"
                    value={`$${Number(candidate.estimated_cost_usd).toFixed(4)}`}
                    mono
                  />
                )}
              </FieldGrid>
              {candidate.source_trace && (
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Source trace</p>
                  <pre className="text-[9px] text-muted-foreground overflow-auto max-h-32 leading-relaxed">
                    {JSON.stringify(candidate.source_trace, null, 2)}
                  </pre>
                </div>
              )}
              {candidate.review_notes && (
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Notas de revisión</p>
                  <p className="text-xs text-muted-foreground">{candidate.review_notes}</p>
                </div>
              )}
              {candidate.reviewer && (
                <Field
                  label="Revisado por"
                  value={candidate.reviewer.full_name ?? candidate.reviewer.email}
                />
              )}
              {candidate.converted_account_id && (
                <Field label="Account ID convertida" value={candidate.converted_account_id} mono />
              )}
            </div>
          </CollapsibleSection>
        </div>
      </SheetContent>
    </Sheet>
  );
}

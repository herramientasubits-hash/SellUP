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
  ArrowRightCircle,
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

interface HubSpotSyncAudit {
  status: string;
  company_id?: string | null;
  sent_property_keys?: string[] | null;
  sent_properties_audit?: Record<string, unknown> | null;
  skipped_properties?: string[] | null;
  blocked_reason?: string | null;
  owner_mapping_status?: string | null;
  synced_at?: string | null;
}

// ── Helpers de presentación ────────────────────────────────────

function val(v: string | null | undefined, fallback = 'Sin dato'): string {
  if (v === null || v === undefined || v === '') return fallback;
  return v;
}

function getFlagEmoji(code: string) {
  const offset = 0x1f1e6 - 'A'.charCodeAt(0);
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + offset))
    .join('');
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
  // TAREA 4 — Chile website verification check client-side (called unconditionally before early return)
  const isValidChileWebsite = React.useMemo(() => {
    if (!candidate?.website) return false;
    const domain = extractDomainFromUrl(candidate.website);
    if (!domain) return false;

    // no sea directorio, etc.
    if (isDirectoryOrThirdPartyDomain(candidate.website)) return false;
    if (domain.includes('procolombia.co') || domain.includes('b2bmarketplace')) return false;
    if (domain.endsWith('.co') || domain.includes('.com.co') || domain.includes('.org.co') || domain.includes('.gov.co')) return false;

    // tenga match distintivo con razón social
    const nameWords = (candidate.name || '').toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['chile', 'limitada', 'sociedad', 'holding', 'grupo', 'spa', 'eirl'].includes(w));

    if (nameWords.length > 0) {
      const domainLower = domain.toLowerCase();
      const hasDistinctiveMatch = nameWords.some(w => domainLower.includes(w));
      if (!hasDistinctiveMatch) return false;
    }
    return true;
  }, [candidate?.website, candidate?.name]);

  if (!candidate) return null;

  const isStructured = isStructuredCandidate(candidate);
  const isChileOfficialCandidate =
    candidate.source_primary === 'datos_gob_cl' ||
    candidate.country_code === 'CL' ||
    (candidate.source_primary as string) === 'cl_res';
  const dc = parseDuplicateCheck(candidate.metadata);
  const enrichment = candidate.metadata?.enrichment as Record<string, unknown> | undefined;
  // 16AK.16C: read from enrichment.ai_evaluation (structured path), fallback to legacy top-level
  const aiEval = (enrichment?.ai_evaluation as Record<string, unknown> | undefined)
    ?? (candidate.metadata?.ai_evaluation as Record<string, unknown> | undefined);
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

  // AI eval skip reason (16AK.16C)
  const aiEvalStatus = (aiEval?.status as string | undefined) ?? null;
  const aiEvalSkipReason = (aiEval?.reason as string | undefined) ?? null;

  // Enrichment fields — 16AK.13B: structured web sub-object with backward compat
  const webEnrichment = enrichment?.web as Record<string, unknown> | undefined;
  const officialWebsiteObj = webEnrichment?.official_website as Record<string, unknown> | undefined;
  const linkedInObj = webEnrichment?.linkedin_company as Record<string, unknown> | undefined;
  const publicDescObj = webEnrichment?.public_description as Record<string, unknown> | undefined;

  // Public evidence (directories/registries) — 16AK.13B
  const publicEvidenceItems = (webEnrichment?.public_evidence as Array<Record<string, unknown>> | undefined) ?? [];

  // Possible LinkedIn matches (weak/partial) — 16AK.13B
  const possibleLinkedInMatches = (webEnrichment?.possible_linkedin_matches as Array<Record<string, unknown>> | undefined) ?? [];

  const websiteConfidence = (officialWebsiteObj?.confidence as string | undefined) ?? null;

  const officialWebsiteStatus = webEnrichment?.official_website_status as string | undefined;
  const visibleWebsiteAllowed = webEnrichment?.visible_website_allowed as boolean | undefined;

  const isOfficialWebsiteConfirmed =
    officialWebsiteStatus === 'confirmed' &&
    visibleWebsiteAllowed === true;



  // Is the stored website a confirmed official website?
  const hasOfficialWebsite =
    !!candidate.website &&
    !isDirectoryOrThirdPartyDomain(candidate.website) &&
    (!isChileOfficialCandidate || (isOfficialWebsiteConfirmed && isValidChileWebsite));

  // NIT conflict data (16AK.16C)
  const taxIdConflicts = (webEnrichment?.tax_id_conflicts as string[] | undefined) ?? [];
  const taxIdMatches = (webEnrichment?.tax_id_matches as string[] | undefined) ?? [];
  const hasNitConflict = taxIdConflicts.length > 0 && taxIdMatches.length === 0;

  const linkedinConfirmedUrl = (linkedInObj?.url as string | undefined) ?? null;
  const linkedinConfidence = (linkedInObj?.confidence as string | undefined) ?? null;

  // Backward compat: old metadata may have linkedin_url flat
  const linkedinFallbackUrl =
    (enrichment?.linkedin_url as string | undefined) ??
    (enrichment?.linkedin as string | undefined) ??
    null;

  const linkedinStatus = webEnrichment?.linkedin_status as string | undefined;

  // For Chile preview: only show confirmed corporate LinkedIn
  const linkedinUrl = isChileOfficialCandidate
    ? (linkedinStatus === 'confirmed' ? linkedinConfirmedUrl : null)
    : (linkedinConfirmedUrl ?? linkedinFallbackUrl);

  // Chile official data from source_trace
  const chileSourceParams = isChileOfficialCandidate
    ? (candidate.source_trace?.queryParams as Record<string, unknown> | undefined)
    : null;
  const chileCapital = chileSourceParams?.capitalAmount as number | null | undefined;
  const chileCapitalCurrency = (chileSourceParams?.capitalCurrency as string | undefined) ?? 'CLP';
  const chileIncorporationDate = chileSourceParams?.incorporationDate as string | null | undefined;
  const chileCompanyType = chileSourceParams?.companyType as string | null | undefined;


  const publicDescription =
    (publicDescObj?.text as string | undefined) ??
    (enrichment?.description as string | undefined) ??
    (enrichment?.public_description as string | undefined) ??
    (aiEval?.description as string | undefined) ??
    null;

  const publicDescriptionConfidence = (publicDescObj?.confidence as string | undefined) ?? null;

  const publicDescriptionStatus = webEnrichment?.public_description_status as string | undefined;

  // For Chile preview: only show confirmed description based on strong evidence
  const isDescriptionConfiable = isChileOfficialCandidate
    ? (publicDescriptionStatus === 'confirmed' &&
       (publicDescriptionConfidence === 'high' || publicDescriptionConfidence === 'medium'))
    : !!publicDescription;

  // For Chile preview: check if we have strong evidence (confirmed website or confirmed LinkedIn)
  const hasStrongEvidenceChile =
    !isChileOfficialCandidate ||
    (isOfficialWebsiteConfirmed && isValidChileWebsite) ||
    (linkedinStatus === 'confirmed');

  const showAiEvaluation = hasAiEval && hasStrongEvidenceChile;

  const sanitizeTextForChile = (text: string) => {
    if (!text) return text;
    return text
      .replace(/\bRUES\b/g, 'RES Chile')
      .replace(/sector Tecnología confirmado/gi, 'criterio solicitado Tecnología');
  };

  // Prepara la evidencia pública sumando la web física si es un directorio (caso legacy)
  const displayedPublicEvidence = [...publicEvidenceItems];
  if (candidate.website && isDirectoryOrThirdPartyDomain(candidate.website)) {
    const websiteDomain = extractDomainFromUrl(candidate.website) ?? candidate.website;
    const exists = displayedPublicEvidence.some(
      (item) => extractDomainFromUrl(item.url as string) === websiteDomain
    );
    if (!exists) {
      displayedPublicEvidence.unshift({
        title: candidate.name,
        url: candidate.website,
        domain: websiteDomain,
        source_type: 'commercial_directory',
        confidence: 'medium',
        reason: 'legacy_directory_website_fallback',
      });
    }
  }

  const employeeCount =
    (enrichment?.employee_count as string | number | undefined) ??
    candidate.company_size ??
    null;
  const sectorDescription =
    (enrichment?.sector_description as string | undefined) ?? candidate.industry ?? null;
  const ciiu =
    (enrichment?.ciiu as string | undefined) ??
    (enrichment?.sector_code as string | undefined) ??
    null;

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

  const SOURCE_TYPE_LABELS: Record<string, string> = {
    commercial_directory: 'Directorio comercial',
    public_registry: 'Registro público',
    chamber_of_commerce: 'Cámara de comercio',
    directory: 'Directorio',
    registry: 'Registro',
    news: 'Noticia / Prensa',
    social: 'Red social',
    linkedin_company: 'LinkedIn',
    official_website: 'Sitio web oficial',
  };

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
          {/* limited_public_data banner */}
          {flags.includes('limited_public_data') && (
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs text-blue-600 dark:text-blue-400">
              Datos comerciales públicos limitados. Puedes revisarlo con la información oficial disponible.
            </div>
          )}

          {/* NIT conflict warning (16AK.16C) */}
          {hasNitConflict && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>NIT inconsistente detectado en evidencia web. Verificar datos antes de aprobar.</span>
            </div>
          )}

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

          {/* Conversión — visible when candidate was converted to account */}
          {candidate.status === 'converted_to_account' && candidate.converted_account_id && (
            <>
              <Divider />
              <div>
                <SectionHeader>Empresa creada</SectionHeader>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-su-brand/20 bg-su-brand-soft/30 px-3 py-2.5 space-y-1.5 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <ArrowRightCircle className="h-3.5 w-3.5 text-su-brand shrink-0" />
                        <span className="text-xs font-medium text-su-brand">Creada en SellUp</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground/70 font-mono break-all">
                        ID: {candidate.converted_account_id}
                      </p>
                    </div>
                  </div>

                  {(() => {
                    const hsSync = candidate.metadata?.hubspot_sync as HubSpotSyncAudit | undefined;
                    if (!hsSync) return null;

                    const statusStyles: Record<string, string> = {
                      synced: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
                      blocked_duplicate: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
                      blocked_inactive_or_liquidation: 'bg-destructive/10 text-destructive border-destructive/20',
                      skipped_flag_off: 'bg-muted text-muted-foreground border-transparent',
                      skipped_rollback: 'bg-muted text-muted-foreground border-transparent',
                      failed_lookup: 'bg-destructive/10 text-destructive border-destructive/20',
                      failed_create: 'bg-destructive/10 text-destructive border-destructive/20',
                    };

                    const statusLabels: Record<string, string> = {
                      synced: 'Sincronizado',
                      blocked_duplicate: 'Bloqueado (Duplicado)',
                      blocked_inactive_or_liquidation: 'Bloqueado (Inactivo/Liquidación)',
                      skipped_flag_off: 'Omitido (Feature Flag Off)',
                      skipped_rollback: 'Omitido (Rollback)',
                      failed_lookup: 'Fallo de búsqueda',
                      failed_create: 'Fallo de creación',
                    };

                    const style = statusStyles[hsSync.status] ?? 'bg-muted text-muted-foreground border-transparent';
                    const label = statusLabels[hsSync.status] ?? hsSync.status;

                    return (
                      <div className="rounded-lg border border-border/40 bg-card p-3 space-y-2 flex flex-col justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                              HubSpot Sync
                            </span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold transition-colors ${style}`}>
                              {label}
                            </span>
                          </div>

                          {hsSync.status === 'synced' && hsSync.company_id && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">ID HubSpot:</span>
                                <span className="font-mono font-medium text-foreground">{hsSync.company_id}</span>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Asignación Owner:</span>
                                <span className="font-medium text-foreground text-[10px]">
                                  {hsSync.owner_mapping_status === 'mapped' ? 'Mapeado (Éxito)' : hsSync.owner_mapping_status === 'skipped_missing_mapping' ? 'Omitido (Falta mapping)' : 'Omitido'}
                                </span>
                              </div>
                            </div>
                          )}

                          {hsSync.status !== 'synced' && (
                            <div className="space-y-1 text-xs">
                              {hsSync.blocked_reason && (
                                <p className="text-muted-foreground italic leading-relaxed text-[11px]">
                                  Motivo: {hsSync.blocked_reason}
                                </p>
                              )}
                              {hsSync.skipped_properties && hsSync.skipped_properties.length > 0 && (
                                <div className="pt-1 border-t border-border/20 mt-1">
                                  <p className="text-[9px] text-muted-foreground/60 uppercase">Campos Omitidos:</p>
                                  <p className="text-[9px] text-muted-foreground/50 font-mono">
                                    {hsSync.skipped_properties.join(', ')}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {hsSync.synced_at && (
                          <p className="text-[9px] text-muted-foreground/50 text-right mt-1">
                            Sincronizado: {new Date(hsSync.synced_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          )}

          <Divider />

          {/* B. Datos oficiales / legales */}
          <div>
            <SectionHeader>Datos oficiales / legales</SectionHeader>
            {isChileOfficialCandidate ? (
              <FieldGrid>
                <Field label="Razón social" value={val(candidate.legal_name ?? candidate.name)} />
                <Field
                  label="RUT"
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
                {chileCompanyType && (
                  <Field label="Tipo societario" value={chileCompanyType} />
                )}
                {chileIncorporationDate && (
                  <Field
                    label="Fecha de constitución"
                    value={new Date(chileIncorporationDate).toLocaleDateString('es-CL', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  />
                )}
                {chileCapital !== null && chileCapital !== undefined && (
                  <Field
                    label="Capital CLP"
                    value={
                      <span className="font-mono">
                        ${chileCapital.toLocaleString('es-CL')} {chileCapitalCurrency}
                      </span>
                    }
                  />
                )}
                <Field label="Fuente oficial" value="Fuente oficial Chile" />
              </FieldGrid>
            ) : (
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
                <Field
                  label="Actividad económica"
                  value={
                    isChileOfficialCandidate ? (
                      <span className="text-xs text-muted-foreground/60 italic">
                        Sector no disponible en fuente oficial
                      </span>
                    ) : (
                      val(sectorDescription, 'Sin sector')
                    )
                  }
                />
                {structuredSourceLabel && (
                  <Field label="Fuente oficial" value={structuredSourceLabel} />
                )}
              </FieldGrid>
            )}
          </div>

          <Divider />

          {/* C. Datos comerciales / web */}
          <div>
            <SectionHeader>Datos comerciales / web</SectionHeader>
            <div className="space-y-2.5">
              <FieldGrid>
                <Field
                  label="Sitio web oficial"
                  value={
                    hasOfficialWebsite && candidate.website ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <a
                          href={candidate.website.startsWith('http') ? candidate.website : `https://${candidate.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-su-brand hover:underline font-medium"
                        >
                          <Globe className="h-3 w-3 shrink-0" />
                          {candidate.domain ?? candidate.website}
                        </a>
                        {websiteConfidence && (
                          <span className={`text-[9px] font-medium px-1 py-0.5 rounded ${
                            websiteConfidence === 'high'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : websiteConfidence === 'medium'
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'bg-muted text-muted-foreground/60'
                          }`}>
                            {websiteConfidence}
                          </span>
                        )}
                      </div>
                    ) : (
                      <MissingText text="Sin sitio web oficial encontrado" />
                    )
                  }
                />
                <Field
                  label={
                    linkedinUrl
                      ? "LinkedIn corporativo"
                      : (isChileOfficialCandidate && !hasNitConflict && (possibleLinkedInMatches.length > 0 || linkedinConfirmedUrl))
                      ? "Posibles coincidencias no confirmadas"
                      : (!isChileOfficialCandidate && !hasNitConflict && possibleLinkedInMatches.length > 0)
                      ? "Posibles coincidencias de LinkedIn"
                      : "LinkedIn corporativo"
                  }
                  value={
                    linkedinUrl ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <a
                          href={linkedinUrl.startsWith('http') ? linkedinUrl : `https://${linkedinUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-su-brand hover:underline font-medium"
                        >
                          <Link2 className="h-3 w-3 shrink-0" />
                          Ver perfil
                        </a>
                        {linkedinConfidence && (
                          <span className={`text-[9px] font-medium px-1 py-0.5 rounded ${
                            linkedinConfidence === 'high'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : linkedinConfidence === 'medium'
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'bg-muted text-muted-foreground/60'
                          }`}>
                            {linkedinConfidence}
                          </span>
                        )}
                      </div>
                    ) : (isChileOfficialCandidate && !hasNitConflict && (possibleLinkedInMatches.length > 0 || linkedinConfirmedUrl)) ? (
                      <div className="space-y-1.5">
                        <p className="text-[9px] text-muted-foreground/50 italic">No confirmado — requiere revisión</p>
                        {linkedinConfirmedUrl && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <a
                              href={linkedinConfirmedUrl.startsWith('http') ? linkedinConfirmedUrl : `https://${linkedinConfirmedUrl}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-muted-foreground hover:underline text-xs"
                            >
                              <Link2 className="h-3 w-3 shrink-0" />
                              Posible perfil corporativo
                            </a>
                            <span className="text-[9px] text-muted-foreground/50">(no confirmado)</span>
                          </div>
                        )}
                        {possibleLinkedInMatches.slice(0, 2).map((match, idx) => (
                          <div key={idx} className="flex items-center gap-1.5 flex-wrap">
                            <a
                              href={(match.url as string).startsWith('http') ? (match.url as string) : `https://${match.url}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-muted-foreground hover:underline text-xs"
                            >
                              <Link2 className="h-3 w-3 shrink-0" />
                              {match.title ? (match.title as string) : `Posible perfil ${idx + 1}`}
                            </a>
                            <span className="text-[9px] text-muted-foreground/50">
                              ({(match.match_quality as string) === 'partial' ? 'parcial' : 'débil'})
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (!isChileOfficialCandidate && !hasNitConflict && possibleLinkedInMatches.length > 0) ? (
                      <div className="space-y-1.5">
                        <p className="text-[9px] text-muted-foreground/50 italic">No confirmado — requiere revisión</p>
                        {possibleLinkedInMatches.slice(0, 2).map((match, idx) => (
                          <div key={idx} className="flex items-center gap-1.5 flex-wrap">
                            <a
                              href={(match.url as string).startsWith('http') ? (match.url as string) : `https://${match.url}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-muted-foreground hover:underline text-xs"
                            >
                              <Link2 className="h-3 w-3 shrink-0" />
                              {match.title ? (match.title as string) : `Posible perfil ${idx + 1}`}
                            </a>
                            <span className="text-[9px] text-muted-foreground/50">
                              ({(match.match_quality as string) === 'partial' ? 'parcial' : 'débil'})
                            </span>
                          </div>
                        ))}
                      </div>
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

              {displayedPublicEvidence.length > 0 && (
                <div className="space-y-1.5 mt-3 pt-2">
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Evidencia pública encontrada</p>
                  <div className="space-y-1.5">
                    {displayedPublicEvidence.map((item, idx) => {
                      const label = SOURCE_TYPE_LABELS[item.source_type as string] ?? item.source_type;
                      return (
                        <div key={idx} className="flex items-center justify-between text-xs rounded-xl border border-border/40 p-2.5 bg-card">
                          <div className="min-w-0 flex-1 pr-2">
                            <p className="font-medium text-foreground truncate" title={item.title as string}>
                              {item.title as string}
                            </p>
                            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                              {label as string} · {item.domain as string}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {item.confidence ? (
                              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                                item.confidence === 'high'
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                  : item.confidence === 'medium'
                                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                  : 'bg-muted text-muted-foreground/60'
                              }`}>
                                {item.confidence as string}
                              </span>
                            ) : null}
                            <a
                              href={item.url as string}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-su-brand hover:underline p-1"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!hasNitConflict && publicDescription && (!isChileOfficialCandidate || isDescriptionConfiable) ? (
                <div className="space-y-0.5 pt-2">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Descripción pública</p>
                    {publicDescriptionConfidence && (publicDescriptionConfidence === 'low' || publicDescriptionConfidence === 'unknown') && (
                      <span className="text-[9px] text-muted-foreground/50 italic bg-muted px-1.5 py-0.5 rounded font-normal">
                        Evidencia preliminar
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{publicDescription}</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/40 italic pt-2">
                  {isChileOfficialCandidate
                    ? 'Sin descripción pública confiable.'
                    : hasNitConflict
                    ? 'Sin descripción pública confiable.'
                    : 'No encontrado en evidencia pública'}
                </p>
              )}
            </div>
          </div>

          <Divider />

          {/* D. Evaluación IA */}
          <div>
            <SectionHeader>Evaluación IA</SectionHeader>
            {showAiEvaluation ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  {fitStatus && (
                    <Badge
                      className={`border-0 text-[10px] font-semibold ${
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
                          {isChileOfficialCandidate ? sanitizeTextForChile(r) : r}
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
                          {isChileOfficialCandidate ? sanitizeTextForChile(r) : r}
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
            ) : isChileOfficialCandidate ? (
              <p className="text-xs text-muted-foreground/60 italic">
                Evaluación no disponible por falta de evidencia pública confiable.
              </p>
            ) : aiEvalStatus === 'skipped' && aiEvalSkipReason ? (
              <p className="text-xs text-muted-foreground/60 italic">
                {({
                  insufficient_evidence: 'Evaluación no disponible por falta de evidencia pública confiable.',
                  tax_identifier_conflict: 'Evaluación pausada: se detectó un NIT distinto en la evidencia web.',
                  weak_entity_match: 'Evaluación no disponible: solo se encontraron empresas similares, sin coincidencia exacta.',
                  no_anthropic_key: 'Evaluación IA no configurada en esta instancia.',
                } as Record<string, string>)[aiEvalSkipReason] ?? 'Evaluación no disponible.'}
              </p>
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

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getCandidateLinkedInUrl, getCandidateLinkedInDisplay } from '@/modules/prospect-batches/candidate-linkedin-url';
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
  Sparkles,
  Loader2,
  RefreshCw,
  Info,
  Copy,
  Target,
  BarChart3,
} from 'lucide-react';
import type { TaxIdentifierLookupMetadata } from '@/server/prospect-batches/tax-identifier-lookup';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { ModalShell } from '@/components/shared/modal-shell';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
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
import type { PeruSunatEnrichmentBlock } from '@/server/prospect-batches/peru-sunat-post-approval-enrichment';
import { PeruSunatLegalValidationBlock } from './peru-sunat-legal-validation-block';
import type { PeMigoApiEnrichmentBlock } from '@/server/prospect-batches/peru-migo-legal-enrichment';
import { PeruMigoLegalValidationBlock } from './peru-migo-legal-validation-block';
import { getIcpSizeGateUiState } from './icp-size-gate-ui';
import { ReviewStatusInfo } from '@/components/prospects/review-status-info';
import { ProspectReviewActions } from '@/components/prospects/prospect-review-actions';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

interface HubSpotSyncAudit {
  status: string;
  company_id?: string | null;
  sent_property_keys?: string[] | null;
  sent_properties_audit?: Record<string, unknown> | null;
  skipped_properties?: string[] | null;
  blocked_reason?: string | null;
  owner_mapping_status?: string | null;
  synced_at?: string | null;
  owner_assigned?: boolean | null;
  owner_id?: string | null;
  owner_email?: string | null;
  account_executive_assigned?: boolean | null;
  account_executive_property?: string | null;
  account_executive_value?: string | null;
  lifecyclestage_sent?: string | null;
  properties_sent?: Record<string, string> | null;
  properties_skipped?: string[] | null;
  warnings?: string[] | null;
}

interface SheetQualityCheck {
  has_website?: boolean;
  has_linkedin?: boolean;
  import_confidence?: string;
  has_tax_identifier?: boolean;
  warnings?: string[];
  missing_fields?: string[];
}

interface SheetDuplicateCheck {
  status?: string;
  matched_account_id?: string | null;
  matched_candidate_id?: string | null;
  matched_name?: string | null;
  matched_domain?: string | null;
  matched_website?: string | null;
  matched_country_code?: string | null;
  matched_tax_identifier?: string | null;
  matched_source?: string | null;
  matched_status?: string | null;
  matched_by?: string | null;
  confidence?: number;
}

interface SheetHubSpotCheck {
  status?: string;
  matched_company_id?: string | null;
  matched_company_name?: string | null;
  matched_domain?: string | null;
  matched_website?: string | null;
  matched_phone?: string | null;
  matched_country?: string | null;
  matched_city?: string | null;
  matched_state?: string | null;
  matched_address?: string | null;
  matched_industry?: string | null;
  matched_macro_industry?: string | null;
  matched_lifecycle_stage?: string | null;
  matched_lead_status?: string | null;
  matched_owner_id?: string | null;
  matched_number_of_employees?: string | null;
  matched_description?: string | null;
  matched_linkedin_url?: string | null;
  matched_linkedin_bio?: string | null;
  matched_tax_identifier?: string | null;
  matched_createdate?: string | null;
  matched_lastmodifieddate?: string | null;
  matched_by?: string | null;
  confidence?: number;
  hubspot_url?: string | null;
}

interface SheetNormalizedKeys {
  normalized_name?: string;
  normalized_domain?: string | null;
  normalized_tax_identifier?: string | null;
  normalized_linkedin_url?: string | null;
  country_code?: string | null;
}

interface SheetValidationMetadata {
  validation_source?: string;
  sellup_duplicate_check?: SheetDuplicateCheck;
  hubspot_duplicate_check?: SheetHubSpotCheck;
  normalized_keys?: SheetNormalizedKeys;
  quality_check?: SheetQualityCheck;
  validated_at?: string;
}

interface SheetImportMetadata {
  confidence?: string;
  company_size?: string;
  source_url?: string;
  source_evidence?: string;
  linkedin_url?: string | null;
}

interface SheetCandidateMetadata {
  validation?: SheetValidationMetadata;
  import?: SheetImportMetadata;
  source_url?: string;
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

function getTaxIdLabel(countryCode: string | null | undefined): string {
  switch (countryCode?.toUpperCase()) {
    case 'CO': return 'NIT';
    case 'MX': return 'RFC';
    case 'CL': return 'RUT';
    case 'PE': return 'RUC';
    case 'EC': return 'RUC';
    default:   return 'identificador fiscal';
  }
}

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
    <div className="space-y-0.5 min-w-0">
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider truncate">{label}</p>
      <div className={`text-xs ${mono ? 'font-mono' : ''} text-foreground/90 leading-snug break-words`}>
        {value}
      </div>
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

function InfoTooltip({ content }: { content: string | React.ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-help p-0.5 ml-1 inline-flex items-center align-middle shrink-0"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          }
        />
        <TooltipContent className="max-w-xs text-[11px] leading-relaxed bg-popover text-popover-foreground border border-border p-2 rounded shadow-md z-[70]">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-5 px-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground ml-1.5 gap-1 shrink-0 inline-flex items-center"
      onClick={handleCopy}
      type="button"
    >
      {copied ? (
        <span className="text-emerald-500 font-medium">¡Copiado!</span>
      ) : (
        <>
          <Copy className="h-2.5 w-2.5" />
          <span>Copiar</span>
        </>
      )}
    </Button>
  );
}

function classifyRisk(riskText: string): 'critical' | 'high' | 'medium' | 'low' {
  const text = riskText.toLowerCase();
  if (
    text.includes('liquidación') ||
    text.includes('liquidation') ||
    text.includes('quiebra') ||
    text.includes('inactivo') ||
    text.includes('demanda') ||
    text.includes('fraude') ||
    text.includes('embargo')
  ) {
    return 'critical';
  }
  if (
    text.includes('alto') ||
    text.includes('high') ||
    text.includes('conflicto') ||
    text.includes('inconsistencia') ||
    text.includes('deuda')
  ) {
    return 'high';
  }
  if (
    text.includes('medio') ||
    text.includes('medium') ||
    text.includes('riesgo') ||
    text.includes('advertencia') ||
    text.includes('warning')
  ) {
    return 'medium';
  }
  return 'low';
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
  onCandidateUpdated?: (updated: ProspectCandidateWithReviewer) => void;
  /**
   * Opened via row menu / context menu / selection action bar "Aprobar":
   * lands on the Validación tab and arms the inline confirmation in the
   * action zone (only when the candidate is actually eligible). Never
   * approves directly.
   */
  initialApproveIntent?: boolean;
  /** Called once the approve intent above has been applied. */
  onApproveIntentConsumed?: () => void;
  /**
   * Q3F-5AZ.2G-1 — opened via row menu / context menu / selection action bar
   * "Descartar": lands on the Validación tab and arms the inline DISCARD
   * confirmation (only when the candidate is actually eligible). Never
   * discards directly.
   */
  initialDiscardIntent?: boolean;
  /** Called once the discard intent above has been applied. */
  onDiscardIntentConsumed?: () => void;
}

export function CandidateDetailSheet({
  candidate,
  open,
  onOpenChange,
  onCandidateUpdated,
  initialApproveIntent = false,
  onApproveIntentConsumed,
  initialDiscardIntent = false,
  onDiscardIntentConsumed,
}: CandidateDetailSheetProps) {
  const router = useRouter();

  const [isLookingUpTaxId, setIsLookingUpTaxId] = React.useState(false);
  const [taxIdLookupError, setTaxIdLookupError] = React.useState<string | null>(null);
  const [taxIdLookupResult, setTaxIdLookupResult] = React.useState<TaxIdentifierLookupMetadata | null>(null);

  const [isApprovingTaxId, setIsApprovingTaxId] = React.useState(false);
  const [approveTaxIdError, setApproveTaxIdError] = React.useState<string | null>(null);


  const [confirmDialogData, setConfirmDialogData] = React.useState<{
    taxIdentifier: string;
    sourceName: string;
    sourceUrl: string | null;
    legalName?: string | null;
    confidence?: string;
  } | null>(null);

  const [activeTab, setActiveTab] = React.useState<string>('empresa');
  const [showAllNeeds, setShowAllNeeds] = React.useState(false);
  const [showAllAngles, setShowAllAngles] = React.useState(false);

  // Rationale: resets transient UI state when the selected candidate changes.
  // Depends on a stable primitive (candidate.id); no cascading render risk.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    setIsLookingUpTaxId(false);
    setTaxIdLookupError(null);
    setTaxIdLookupResult(null);
    setIsApprovingTaxId(false);
    setApproveTaxIdError(null);
    setConfirmDialogData(null);
    // Row menu / context menu / selection bar "Aprobar" or "Descartar" lands
    // directly on Validación so the reviewer sees the status context next to
    // the action.
    setActiveTab(initialApproveIntent || initialDiscardIntent ? 'validacion' : 'empresa');
    setShowAllNeeds(false);
    setShowAllAngles(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleLookupTaxIdentifier = async () => {
    if (!candidate) return;
    setIsLookingUpTaxId(true);
    setTaxIdLookupError(null);
    try {
      const response = await fetch('/api/prospect-candidates/lookup-tax-identifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: candidate.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setTaxIdLookupError(data.message || 'Error al buscar identificador fiscal');
      } else {
        setTaxIdLookupResult(data.lookup);
        router.refresh();
      }
    } catch (err) {
      setTaxIdLookupError(err instanceof Error ? err.message : 'Error de red');
    } finally {
      setIsLookingUpTaxId(false);
    }
  };

  const handleApproveTaxIdentifier = async (
    taxIdentifier: string,
    sourceName: string,
    sourceUrl: string | null
  ) => {
    if (!candidate) return;

    setIsApprovingTaxId(true);
    setApproveTaxIdError(null);
    try {
      const response = await fetch('/api/prospect-candidates/approve-tax-identifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: candidate.id,
          taxIdentifier,
          sourceName,
          sourceUrl,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setApproveTaxIdError(data.error || 'Error al guardar el identificador fiscal');
      } else {
        const updated = data.candidate as ProspectCandidateWithReviewer;
        if (onCandidateUpdated) {
          onCandidateUpdated(updated);
        }
        setConfirmDialogData(null);
        router.refresh();
      }
    } catch (err) {
      setApproveTaxIdError(err instanceof Error ? err.message : 'Error de red');
    } finally {
      setIsApprovingTaxId(false);
    }
  };

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

  const isStructured = candidate ? isStructuredCandidate(candidate) : false;
  const isChileOfficialCandidate = candidate ? (
    candidate.source_primary === 'datos_gob_cl' ||
    candidate.country_code === 'CL' ||
    (candidate.source_primary as string) === 'cl_res'
  ) : false;
  const dc = candidate ? parseDuplicateCheck(candidate.metadata) : null;
  const enrichment = candidate?.metadata?.enrichment as Record<string, unknown> | undefined;
  // 16TX.1: tax identifier lookup result — prefer in-memory state (fresh lookup), fallback to persisted metadata
  const taxIdLookup = candidate ? ((taxIdLookupResult ??
    (candidate.metadata?.tax_identifier_lookup as TaxIdentifierLookupMetadata | undefined)) ?? null) : null;
  // 16AK.16C: read from enrichment.ai_evaluation (structured path), fallback to legacy top-level
  const aiEval = candidate ? ((enrichment?.ai_evaluation as Record<string, unknown> | undefined)
    ?? (candidate.metadata?.ai_evaluation as Record<string, unknown> | undefined)) : undefined;
  const sourcePrimaryLabel = candidate?.source_primary
    ? (VENDOR_CANDIDATE_SOURCE_LABELS[candidate.source_primary] ?? candidate.source_primary)
    : null;
  const structuredSourceLabel = (isStructured && candidate?.source_primary
    ? (STRUCTURED_SOURCE_LABELS[candidate.source_primary] ?? sourcePrimaryLabel)
    : null) as React.ReactNode;

  const isPeCandidate = candidate?.country_code?.toUpperCase() === 'PE';
  const peSunatBlock = isPeCandidate
    ? ((candidate?.metadata?.source_enrichment as Record<string, unknown> | undefined)
        ?.pe_sunat_bulk as PeruSunatEnrichmentBlock | null | undefined)
    : null;
  const peMigoBlock = isPeCandidate
    ? ((candidate?.metadata?.source_enrichment as Record<string, unknown> | undefined)
        ?.pe_migo_api as PeMigoApiEnrichmentBlock | null | undefined) ?? null
    : null;

  const flags = candidate ? ((candidate.review_flags as string[] | null) ?? []) : [];
  const dcSources = dc?.sources_checked ?? [];
  const dcMatches = dc?.matches ?? [];

  // AI eval fields
  const fitStatus = candidate ? (
    candidate.commercial_fit_status
    ?? (aiEval?.fit_status as string | undefined)
    ?? null
  ) : null;
  const fitScore = candidate?.fit_score ?? null;

  const fitReasons = (aiEval?.fit_reasons as string[] | undefined) ?? [];
  const risks = (aiEval?.risks as string[] | undefined) ?? [];
  const missingFields = (aiEval?.missing_fields as string[] | undefined) ?? [];
  const aiSummary = (aiEval?.summary as string | undefined) ?? null;
  const evidenceUsed = (aiEval?.evidence_used as string[] | undefined) ?? [];
  const hasAiEval = fitStatus !== null || fitScore !== null || aiSummary !== null;

  // Agent 1 evidence fields — v1.9
  const searchTrace = candidate?.metadata?.search_trace as Record<string, unknown> | undefined;
  const sourceTitle = candidate?.metadata?.source_title as string | undefined;
  const sourceSnippet = candidate?.metadata?.source_snippet as string | undefined;
  const countryEvidence = candidate?.metadata?.country_evidence as Record<string, unknown> | undefined;
  const websiteVerification = candidate?.metadata?.website_verification as Record<string, unknown> | undefined;
  const scoringMeta = candidate?.metadata?.scoring as Record<string, unknown> | undefined;

  const sortedRisks = React.useMemo(() => {
    if (!risks) return [];
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...risks].sort((a, b) => {
      const severityOrderMap: Record<string, number> = severityOrder;
      return severityOrderMap[classifyRisk(a)] - severityOrderMap[classifyRisk(b)];
    });
  }, [risks]);

  if (!candidate) return null;

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

  // External import LinkedIn fallbacks — used when enrichment paths are absent
  const isExternalImport = candidate.source_primary === 'external_import';
  const importMeta = candidate.metadata as unknown as SheetCandidateMetadata;
  const importLinkedinUrl: string | null =
    importMeta?.import?.linkedin_url ??
    ((candidate.metadata?.external as Record<string, unknown> | undefined)?.linkedin_url as string | undefined ?? null) ??
    (() => {
      const nli = importMeta?.validation?.normalized_keys?.normalized_linkedin_url;
      return nli && nli.includes('/company/') ? nli : null;
    })() ??
    null;
  const hasLinkedinSignal = importMeta?.validation?.quality_check?.has_linkedin === true;
  // v1.16K-R-E: additional fallback from linkedin_enrichment / rich_profile
  const tavilyLinkedinUrl = getCandidateLinkedInUrl(candidate?.metadata);
  const effectiveLinkedinUrl = linkedinUrl ?? (isExternalImport ? importLinkedinUrl : null) ?? tavilyLinkedinUrl;
  // v1.16K-R-H: suggested display (ambiguous with valid company_url)
  const tavilyLinkedinDisplay = getCandidateLinkedInDisplay(candidate?.metadata);
  const suggestedLinkedinDisplay =
    !effectiveLinkedinUrl && tavilyLinkedinDisplay?.status === 'suggested'
      ? tavilyLinkedinDisplay
      : null;

  // Validation-derived state for external_import candidates
  const validationMetaSheet = importMeta?.validation;
  const sellupDupStatus = validationMetaSheet?.sellup_duplicate_check?.status;
  const hsDupStatus = validationMetaSheet?.hubspot_duplicate_check?.status;
  const isAutoValidated = isExternalImport && !!validationMetaSheet;
  const hasDuplicateSignalInValidation =
    sellupDupStatus === 'duplicate' ||
    sellupDupStatus === 'possible_duplicate' ||
    hsDupStatus === 'match' ||
    hsDupStatus === 'possible_match';

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
    <>
      <DrawerShell
        open={open}
        onOpenChange={onOpenChange}
        side="right"
        className="w-full md:w-[70vw] lg:w-[50vw] lg:min-w-[720px] lg:max-w-[960px]"
        scrollable={false}
        icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
        title={candidate.name}
        description={
          <div className="flex items-center gap-2 flex-wrap">
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
          </div>
        }
        footer={
          <ProspectReviewActions
            candidate={{
              id: candidate.id,
              name: candidate.name,
              status: candidate.status,
              recordOrigin: candidate.record_origin,
              duplicateStatus: candidate.duplicate_status,
              matchedHubspotCompanyId: candidate.matched_hubspot_company_id,
              reviewedAt: candidate.reviewed_at,
              convertedAccountId: candidate.converted_account_id,
            }}
            autoConfirm={initialApproveIntent}
            onApproveIntentConsumed={onApproveIntentConsumed}
            discardAutoConfirm={initialDiscardIntent}
            onDiscardIntentConsumed={onDiscardIntentConsumed}
          />
        }
      >
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <TabsList variant="segmented" className="shrink-0 mx-7 mt-4">
            <TabsTrigger value="empresa"><Building2 className="h-4 w-4" /> Empresa</TabsTrigger>
            <TabsTrigger value="validacion"><CheckCircle2 className="h-4 w-4" /> Validación</TabsTrigger>
          </TabsList>

          {/* Tab 1: Empresa */}
          <TabsContent value="empresa" className="flex-1 overflow-y-auto px-7 py-6 min-h-0 space-y-6">
            {/* Banners de advertencia */}
            {flags.includes('limited_public_data') && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs text-blue-600 dark:text-blue-400">
                Datos comerciales públicos limitados. Puedes revisarlo con la información oficial disponible.
              </div>
            )}
            {hasNitConflict && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>NIT inconsistente detectado en evidencia web. Verificar datos antes de aprobar.</span>
              </div>
            )}
            {flags.includes('liquidation_signal') && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive flex items-start gap-2">
                <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>Esta empresa presenta una señal crítica de liquidación o cese de operaciones.</span>
              </div>
            )}

            {/* KPIs: Scores y Estado */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <MetricCard
                title="Encaje"
                description="Evaluación comercial"
                value={fitScore !== null ? fitScore.toFixed(0) : '—'}
                subtitle="/ 100"
                icon={
                  <div className="rounded-lg p-1.5 bg-su-brand-soft">
                    <Target className="h-4 w-4 text-su-brand" />
                  </div>
                }
                iconPosition="right"
                valueClassName={fitScore !== null ? (fitScore >= 75 ? 'text-emerald-600 dark:text-emerald-400' : fitScore >= 50 ? 'text-amber-600 dark:text-amber-400' : '') : ''}
              />
              <MetricCard
                title="Completitud"
                description="Datos esenciales"
                value={(() => {
                  const score = candidate.data_completeness_score;
                  if (typeof score === 'number') return score;
                  const enrichment = candidate.metadata?.enrichment as Record<string, unknown> | undefined;
                  const pct = enrichment?.completeness_pct;
                  if (typeof pct === 'number') return pct;
                  return '—';
                })()}
                subtitle={(() => {
                  const score = candidate.data_completeness_score;
                  if (typeof score === 'number') return '%';
                  const enrichment = candidate.metadata?.enrichment as Record<string, unknown> | undefined;
                  const pct = enrichment?.completeness_pct;
                  if (typeof pct === 'number') return '%';
                  return '';
                })()}
                icon={
                  <div className="rounded-lg p-1.5 bg-su-brand-soft">
                    <BarChart3 className="h-4 w-4 text-su-brand" />
                  </div>
                }
                iconPosition="right"
              />
              <MetricCard
                title="Estado"
                description="En SellUp"
                value={CANDIDATE_STATUS_LABELS[candidate.status]}
                compact
                icon={
                  <div className={`rounded-lg p-1.5 ${
                    candidate.status === 'approved' ? 'bg-emerald-500/10' :
                    candidate.status === 'needs_review' ? 'bg-amber-500/10' :
                    candidate.status === 'converted_to_account' ? 'bg-su-brand-soft' :
                    'bg-muted'
                  }`}>
                    <CheckCircle2 className={`h-4 w-4 ${
                      candidate.status === 'approved' ? 'text-emerald-500' :
                      candidate.status === 'needs_review' ? 'text-amber-500' :
                      candidate.status === 'converted_to_account' ? 'text-su-brand' :
                      'text-muted-foreground'
                    }`} />
                  </div>
                }
                iconPosition="right"
                footer={candidate.review_status ? (
                  <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                    <span className="text-[10px] text-muted-foreground">Revisión:</span>
                    <Badge className={`border-0 text-[9px] font-semibold ${
                      REVIEW_STATUS_STYLES[candidate.review_status as ReviewStatus] ?? 'bg-muted text-muted-foreground'
                    }`}>
                      {REVIEW_STATUS_LABELS[candidate.review_status as ReviewStatus] ?? candidate.review_status}
                    </Badge>
                  </div>
                ) : undefined}
              />
            </div>

            {/* AI Summary */}
            {aiSummary && (
              <div className="rounded-xl border border-border/30 bg-card p-4 space-y-2">
                <SectionHeader>Resumen del Negocio (IA)</SectionHeader>
                <p className="text-xs text-muted-foreground leading-relaxed italic">
                  &ldquo;{isChileOfficialCandidate ? sanitizeTextForChile(aiSummary) : aiSummary}&rdquo;
                </p>
              </div>
            )}

            {/* Por qué fue encontrado */}
            {!!(searchTrace ?? sourceTitle ?? sourceSnippet) && (
              <div className="rounded-xl border border-border/30 bg-card p-4 space-y-3">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-su-brand shrink-0" />
                  <SectionHeader>Por qué fue encontrado</SectionHeader>
                </div>
                <div className="space-y-2">
                  {!!searchTrace?.query_text && (
                    <div className="space-y-0.5">
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Query de búsqueda</p>
                      <p className="text-xs text-foreground/90 leading-snug font-mono break-words bg-muted/30 rounded-md px-2.5 py-1.5">
                        {String(searchTrace.query_text)}
                      </p>
                    </div>
                  )}
                  {sourceTitle && (
                    <div className="space-y-0.5">
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Título encontrado</p>
                      <p className="text-xs text-foreground/90 leading-snug">{sourceTitle}</p>
                    </div>
                  )}
                  {sourceSnippet && (
                    <div className="space-y-0.5">
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Fragmento</p>
                      <p className="text-xs text-muted-foreground leading-relaxed italic">&ldquo;{sourceSnippet}&rdquo;</p>
                    </div>
                  )}
                  {!!searchTrace && (
                    <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/20">
                      {searchTrace.round_number !== undefined && (
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Ronda</p>
                          <p className="text-xs text-foreground/90">#{String(searchTrace.round_number)}</p>
                        </div>
                      )}
                      {searchTrace.provider_rank !== undefined && (
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Ranking</p>
                          <p className="text-xs text-foreground/90">#{String(searchTrace.provider_rank)}</p>
                        </div>
                      )}
                      {!!searchTrace.query_type && (
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Tipo</p>
                          <p className="text-xs text-foreground/90 capitalize">{String(searchTrace.query_type)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Decisión recomendada */}
            {!!scoringMeta?.recommended_action && (
              <div className="rounded-xl border border-border/30 bg-card p-4 space-y-3">
                <SectionHeader>Decisión recomendada</SectionHeader>
                {(() => {
                  const action = scoringMeta.recommended_action as string;
                  const actionLabels: Record<string, string> = {
                    review_manually: 'Revisar manualmente',
                    approve: 'Aprobar',
                    discard: 'Descartar',
                    needs_enrichment: 'Enriquecer antes de decidir',
                  };
                  const actionStyles: Record<string, string> = {
                    review_manually: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
                    approve: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
                    discard: 'bg-destructive/10 text-destructive border-destructive/20',
                    needs_enrichment: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
                  };
                  const label = actionLabels[action] ?? action;
                  const style = actionStyles[action] ?? 'bg-muted text-muted-foreground border-border/30';

                  const fitScoreVal = candidate.fit_score ?? null;
                  const confidenceVal = candidate.confidence_score ?? null;
                  const completenessVal = candidate.data_completeness_score ?? null;

                  let reason = '';
                  if (action === 'review_manually') {
                    if (fitScoreVal !== null && fitScoreVal >= 70) {
                      reason = 'Candidato con buen encaje preliminar. Validar datos faltantes antes de aprobar.';
                    } else if (fitScoreVal !== null && fitScoreVal >= 50) {
                      reason = 'Candidato con señales comerciales relevantes. Requiere enriquecimiento antes de aprobar.';
                    } else {
                      reason = 'Candidato requiere revisión. Tiene algunas señales útiles, pero aún falta validar encaje comercial, tamaño y datos clave.';
                    }
                  } else if (action === 'approve') {
                    reason = 'El candidato cumple con los criterios de calidad para ser aprobado.';
                  } else if (action === 'discard') {
                    reason = 'El candidato no cumple con los criterios mínimos de calidad.';
                  } else if (action === 'needs_enrichment') {
                    reason = 'Se necesita información adicional antes de tomar una decisión.';
                  }

                  return (
                    <div className="space-y-2">
                      <div className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold ${style}`}>
                        {label}
                      </div>
                      {reason && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{reason}</p>
                      )}
                      {(fitScoreVal !== null || confidenceVal !== null || completenessVal !== null) && (
                        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/20">
                          {fitScoreVal !== null && (
                            <div className="space-y-0.5">
                              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Encaje</p>
                              <p className="text-xs font-semibold text-foreground/90">{fitScoreVal}/100</p>
                            </div>
                          )}
                          {confidenceVal !== null && (
                            <div className="space-y-0.5">
                              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Confianza</p>
                              <p className="text-xs font-semibold text-foreground/90">{confidenceVal}%</p>
                            </div>
                          )}
                          {completenessVal !== null && (
                            <div className="space-y-0.5">
                              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Completitud</p>
                              <p className="text-xs font-semibold text-foreground/90">{completenessVal}%</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Conversión y HubSpot Sync */}
            {candidate.status === 'converted_to_account' && candidate.converted_account_id && (
              <div className="rounded-xl border border-border/30 bg-card p-4 space-y-3">
                <SectionHeader>Conversión a Cuenta</SectionHeader>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-su-brand/20 bg-su-brand-soft/30 px-3 py-2.5 space-y-1">
                    <div className="flex items-center gap-2">
                      <ArrowRightCircle className="h-3.5 w-3.5 text-su-brand shrink-0" />
                      <span className="text-xs font-semibold text-su-brand">Creada en SellUp</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 font-mono break-all pt-1">
                      ID Cuenta: {candidate.converted_account_id}
                    </p>
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
                      blocked_inactive_or_liquidation: 'Bloqueado (Inactivo)',
                      skipped_flag_off: 'Omitido (Feature Flag)',
                      skipped_rollback: 'Omitido (Rollback)',
                      failed_lookup: 'Fallo búsqueda',
                      failed_create: 'Fallo creación',
                    };

                    const style = statusStyles[hsSync.status] || 'bg-muted text-muted-foreground border-transparent';
                    const label = statusLabels[hsSync.status] || hsSync.status;

                    return (
                      <div className="rounded-lg border border-border/40 bg-card px-3 py-2.5 space-y-1 flex flex-col justify-between">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                              HubSpot Sync
                            </span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold ${style}`}>
                              {label}
                            </span>
                          </div>
                          {hsSync.status === 'synced' && hsSync.company_id && (
                            <div className="space-y-1 text-xs pt-1">
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">ID HubSpot:</span>
                                <span className="font-mono font-medium text-foreground">{hsSync.company_id}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Owner:</span>
                                <span className="font-medium text-foreground text-[10px]">
                                  {hsSync.owner_assigned || hsSync.owner_mapping_status === 'mapped' ? 'Asignado' : 'No asignado'}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Análisis de Encaje IA */}
            {hasAiEval && showAiEvaluation && (
              <div className="rounded-xl border border-border/30 bg-card p-4 space-y-3">
                <div className="flex items-center gap-1">
                  <SectionHeader>Análisis de Encaje</SectionHeader>
                  <InfoTooltip content="Evaluación automática basada en información pública. No reemplaza la revisión comercial." />
                </div>
                {fitReasons.length > 0 && (
                  <ul className="space-y-1">
                    {fitReasons.slice(0, 4).map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                        <span>{isChileOfficialCandidate ? sanitizeTextForChile(r) : r}</span>
                      </li>
                    ))}
                    {fitReasons.length > 4 && (
                      <li className="text-[10px] text-muted-foreground/60 italic pl-5">
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
                    <div className="pt-3 border-t border-border/10 space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-su-brand">Siguiente paso recomendado</p>
                      <p className="text-xs text-foreground/90 font-medium leading-relaxed">{recommended}</p>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Oportunidades comerciales */}
            {hasAiEval && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border/30 bg-card p-4 space-y-3">
                  <SectionHeader>Necesidades Detectadas</SectionHeader>
                  {(() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const enrichmentData = candidate.metadata?.enrichment as any;
                    const needs = enrichmentData?.sellup_fit?.possible_needs as string[] | undefined;
                    if (!needs || needs.length === 0) return <p className="text-xs text-muted-foreground/50 italic">Ninguna detectada</p>;
                    const visibleNeeds = showAllNeeds ? needs : needs.slice(0, 3);
                    return (
                      <div className="space-y-2">
                        <ul className="space-y-1.5">
                          {visibleNeeds.map((n, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                              <span>{n}</span>
                            </li>
                          ))}
                        </ul>
                        {needs.length > 3 && (
                          <Button variant="ghost" size="sm" className="text-[10px] h-6 p-0 text-su-brand hover:bg-transparent font-semibold mt-1" onClick={() => setShowAllNeeds(!showAllNeeds)} type="button">
                            {showAllNeeds ? 'Ver menos' : `Ver todas (${needs.length})`}
                          </Button>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="rounded-xl border border-border/30 bg-card p-4 space-y-3">
                  <SectionHeader>Ángulos Comerciales</SectionHeader>
                  {(() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const enrichmentData = candidate.metadata?.enrichment as any;
                    const angles = enrichmentData?.commercial_angles as string[] | undefined;
                    if (!angles || angles.length === 0) return <p className="text-xs text-muted-foreground/50 italic">Ninguno disponible</p>;
                    const visibleAngles = showAllAngles ? angles : angles.slice(0, 3);
                    return (
                      <div className="space-y-2">
                        <ul className="space-y-1.5">
                          {visibleAngles.map((ang, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80 font-medium">
                              <Sparkles className="h-3.5 w-3.5 text-su-brand mt-0.5 shrink-0" />
                              <span>{ang}</span>
                            </li>
                          ))}
                        </ul>
                        {angles.length > 3 && (
                          <Button variant="ghost" size="sm" className="text-[10px] h-6 p-0 text-su-brand hover:bg-transparent font-semibold mt-1" onClick={() => setShowAllAngles(!showAllAngles)} type="button">
                            {showAllAngles ? 'Ver menos' : `Ver todos (${angles.length})`}
                          </Button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Datos Oficiales y Legales */}
            <CollapsibleSection title="Datos Oficiales y Legales" defaultOpen>
            <SurfaceCard>
              <SurfaceCardHeader title="Datos Oficiales y Legales" />
              {isChileOfficialCandidate ? (
                <FieldGrid>
                  <Field label="Razón social" value={val(candidate.legal_name ?? candidate.name)} />
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">RUT</p>
                    <div className="text-xs text-foreground/90 font-mono leading-snug flex items-center">
                      {candidate.tax_identifier ? (
                        <>
                          <span>{candidate.tax_identifier}</span>
                          <CopyButton value={candidate.tax_identifier} />
                        </>
                      ) : (
                        <MissingText text="Sin dato" />
                      )}
                    </div>
                  </div>
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
                <>
                  <FieldGrid>
                    <Field label="Razón social" value={val(candidate.legal_name ?? candidate.name)} />
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                        {candidate.tax_identifier_type ?? 'Identificador fiscal'}
                      </p>
                      <div className="text-xs text-foreground/90 font-mono leading-snug flex items-center">
                        {candidate.tax_identifier ? (
                          <>
                            <span>{candidate.tax_identifier}</span>
                            <CopyButton value={candidate.tax_identifier} />
                          </>
                        ) : (
                          <MissingText text="Sin dato" />
                        )}
                      </div>
                    </div>
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
                  {structuredSourceLabel && (
                    <Field label="Fuente oficial" value={structuredSourceLabel} />
                  )}
                </FieldGrid>
                </>
              )}
            </SurfaceCard>
            </CollapsibleSection>

            {/* Validación Legal SUNAT — solo para candidatos Perú */}
            {isPeCandidate && (
              <CollapsibleSection title="Validación Legal SUNAT" defaultOpen>
                <PeruSunatLegalValidationBlock block={peSunatBlock} />
              </CollapsibleSection>
            )}

            {/* Validación complementaria Migo — solo si existe pe_migo_api */}
            {isPeCandidate && peMigoBlock && (
              <CollapsibleSection title="Validación complementaria Migo" defaultOpen>
                <PeruMigoLegalValidationBlock block={peMigoBlock} />
              </CollapsibleSection>
            )}

            {/* Datos Comerciales y Web */}
            <CollapsibleSection title="Datos Comerciales y Web">
            <SurfaceCard>
              <SurfaceCardHeader title="Datos Comerciales y Web" />
              <div className="space-y-3">
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
                        <MissingText text="Sin sitio web oficial" />
                      )
                    }
                  />
                  <Field
                    label={
                      effectiveLinkedinUrl
                        ? "LinkedIn corporativo"
                        : suggestedLinkedinDisplay
                        ? "LinkedIn sugerido"
                        : (isChileOfficialCandidate && !hasNitConflict && (possibleLinkedInMatches.length > 0 || linkedinConfirmedUrl))
                        ? "Coincidencias no confirmadas"
                        : "LinkedIn corporativo"
                    }
                    value={
                      effectiveLinkedinUrl ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <a
                            href={effectiveLinkedinUrl.startsWith('http') ? effectiveLinkedinUrl : `https://${effectiveLinkedinUrl}`}
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
                      ) : suggestedLinkedinDisplay ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <a
                              href={suggestedLinkedinDisplay.url.startsWith('http') ? suggestedLinkedinDisplay.url : `https://${suggestedLinkedinDisplay.url}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline font-medium text-xs"
                            >
                              <Link2 className="h-3 w-3 shrink-0" />
                              Ver perfil
                            </a>
                          </div>
                          <p className="text-[9px] text-muted-foreground/60 italic">Requiere revisión manual</p>
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
                                Posible perfil
                              </a>
                            </div>
                          )}
                        </div>
                      ) : (
                        <MissingText text="Sin LinkedIn" />
                      )
                    }
                  />
                  <Field
                    label="Tamaño / Empleados"
                    value={val(employeeCount ? String(employeeCount) : null, 'Sin dato')}
                  />
                  {!isStructured && sourcePrimaryLabel && (
                    <Field label="Fuente" value={sourcePrimaryLabel} />
                  )}
                </FieldGrid>

                {/* Descripción pública */}
                {!hasNitConflict && publicDescription && (!isChileOfficialCandidate || isDescriptionConfiable) ? (
                  <div className="space-y-0.5 pt-2 border-t border-border/10">
                    <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Descripción pública</p>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{publicDescription}</p>
                  </div>
                ) : null}
              </div>
            </SurfaceCard>
            </CollapsibleSection>

            {/* Tamaño ICP */}
            {(() => {
              const icpState = getIcpSizeGateUiState(
                candidate.metadata as Record<string, unknown> | null | undefined,
                candidate.company_size
              );
              const toneStyle: Record<string, string> = {
                success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
                warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
                danger: 'bg-destructive/10 text-destructive border-destructive/20',
                neutral: 'bg-muted/40 text-muted-foreground border-border/30',
              };
              const badgeStyle: Record<string, string> = {
                success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                danger: 'bg-destructive/10 text-destructive',
                neutral: 'bg-muted text-muted-foreground/60',
              };
              return (
                <CollapsibleSection title="Tamaño ICP">
                <SurfaceCard>
                  <SurfaceCardHeader title="Tamaño ICP" description="Umbral: más de 200 colaboradores" />
                  <div className="space-y-3 mt-1">
                    {/* Badge de estado */}
                    <Badge className={`border-0 text-[10px] font-semibold ${badgeStyle[icpState.tone]}`}>
                      {icpState.decision === 'pass'
                        ? 'ICP >200 validado'
                        : icpState.decision === 'needs_validation'
                        ? 'Tamaño pendiente de validación'
                        : icpState.decision === 'block'
                        ? 'Fuera de ICP por tamaño'
                        : 'Sin evaluación de tamaño'}
                    </Badge>

                    {/* Detalle */}
                    {!icpState.decision ? (
                      <p className="text-xs text-muted-foreground/70 italic">
                        Este candidato no tiene evaluación de tamaño ICP registrada. Puede venir de un flujo anterior o de un flujo que aún no pasa por el ICP Size Gate.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {icpState.rangeLabel && (
                          <div className="space-y-0.5">
                            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Rango detectado</p>
                            <p className="text-xs text-foreground/90 font-medium">{icpState.rangeLabel}</p>
                          </div>
                        )}
                        {icpState.reason && (
                          <div className="space-y-0.5">
                            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Motivo</p>
                            <p className="text-xs text-muted-foreground leading-relaxed">{icpState.reason}</p>
                          </div>
                        )}
                        {icpState.requiresHumanReview && (
                          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${toneStyle.warning}`}>
                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span>Requiere validación humana</span>
                          </div>
                        )}
                        {icpState.decision === 'needs_validation' && (
                          <div className={`rounded-lg border px-3 py-2 text-xs ${toneStyle.warning}`}>
                            {icpState.description}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </SurfaceCard>
                </CollapsibleSection>
              );
            })()}

            {/* Evidencia Pública Encontrada */}
            {displayedPublicEvidence.length > 0 && (
              <CollapsibleSection title="Evidencia Pública">
              <SurfaceCard>
                <SectionHeader>Evidencia pública encontrada</SectionHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {displayedPublicEvidence.map((item, idx) => {
                    const label = SOURCE_TYPE_LABELS[item.source_type as string] || item.source_type;
                    return (
                      <div key={idx} className="flex items-center justify-between text-xs rounded-xl border border-border/40 p-2.5 bg-muted/10">
                        <div className="min-w-0 flex-1 pr-2">
                          <p className="font-semibold text-foreground truncate" title={item.title as string}>
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
              </SurfaceCard>
              </CollapsibleSection>
            )}

            {/* Identificador Fiscal — estado automático */}
            <CollapsibleSection title="Identificador Fiscal">
            <SurfaceCard>
              <SurfaceCardHeader title="Identificador Fiscal" description="Dato legal o tributario consultado en fuentes disponibles. Debe revisarse antes de aprobarlo." />

              {candidate.tax_identifier ? (
                /* Identificador ya existente */
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="border-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold flex items-center gap-1">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      Identificador validado
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {candidate.tax_identifier}
                    </span>
                    <CopyButton value={candidate.tax_identifier} />
                  </div>
                  {taxIdLookup?.selected_candidate && (
                    <p className="text-[10px] text-muted-foreground/60">
                      Fuente: {taxIdLookup.selected_candidate.source_name}
                    </p>
                  )}
                </div>
              ) : (
                /* Sin identificador — flujo automático */
                (() => {
                  const isCO = candidate.country_code?.toUpperCase() === 'CO';
                  const lookupStatus = taxIdLookup?.status;
                  const hasBestCandidate = !!taxIdLookup?.best_candidate;
                  const isDuplicateConfirmed =
                    candidate.duplicate_status === 'exact_duplicate' ||
                    sellupDupStatus === 'duplicate' ||
                    hsDupStatus === 'match';

                  /* En búsqueda activa */
                  if (isLookingUpTaxId || lookupStatus === 'searching') {
                    return (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-su-brand" />
                        <span>Buscando identificador fiscal…</span>
                        <InfoTooltip content="SellUp está consultando fuentes disponibles para encontrar el identificador fiscal." />
                      </div>
                    );
                  }

                  /* Sugerencia encontrada */
                  if (hasBestCandidate && taxIdLookup?.best_candidate) {
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className="border-0 bg-amber-500/5 text-amber-600/70 dark:text-amber-400/70 text-[9px] font-medium flex items-center gap-1">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {`${getTaxIdLabel(candidate.country_code)} sugerido — requiere revisión`}
                          </Badge>
                        </div>
                        <div className="rounded-xl border border-su-brand/20 bg-su-brand-soft/10 p-3.5 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-0.5">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-su-brand">
                                {`${getTaxIdLabel(candidate.country_code)} sugerido`}
                              </p>
                              <p className="font-mono text-sm font-bold text-foreground">
                                {taxIdLookup.best_candidate.tax_identifier}
                              </p>
                              {taxIdLookup.best_candidate.legal_name && (
                                <p className="text-xs text-muted-foreground">
                                  Razón social: {taxIdLookup.best_candidate.legal_name}
                                </p>
                              )}
                            </div>
                            <Badge className={`border-0 text-[9px] font-semibold shrink-0 ${
                              taxIdLookup.best_candidate.confidence === 'high'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            }`}>
                              {taxIdLookup.best_candidate.confidence === 'high' ? 'Alta confianza' : 'Confianza media'}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between gap-2 border-t border-border/20 pt-2.5">
                            <div className="text-[10px] text-muted-foreground/80 leading-relaxed">
                              <span>Fuente: {taxIdLookup.best_candidate.source_name}</span>
                              {taxIdLookup.best_candidate.source_url && (
                                <a href={taxIdLookup.best_candidate.source_url} target="_blank" rel="noopener noreferrer" className="ml-1 text-su-brand hover:underline inline-flex items-center gap-0.5">
                                  (Ver fuente)
                                </a>
                              )}
                            </div>
                            <Button
                              onClick={() => setConfirmDialogData({
                                taxIdentifier: taxIdLookup.best_candidate!.tax_identifier,
                                sourceName: taxIdLookup.best_candidate!.source_name,
                                sourceUrl: taxIdLookup.best_candidate!.source_url,
                                legalName: taxIdLookup.best_candidate!.legal_name,
                                confidence: taxIdLookup.best_candidate!.confidence,
                              })}
                              size="sm"
                              className="h-7 text-[10px] font-semibold bg-su-brand hover:bg-su-brand/90 text-white"
                              type="button"
                            >
                              Usar este {getTaxIdLabel(candidate.country_code)}
                            </Button>
                          </div>
                        </div>
                        {approveTaxIdError && <p className="text-xs text-destructive">{approveTaxIdError}</p>}
                      </div>
                    );
                  }

                  /* Error en búsqueda */
                  if (lookupStatus === 'failed') {
                    return (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground/80">No fue posible completar la búsqueda.</p>
                        {!isDuplicateConfirmed && isCO && (
                          <Button
                            onClick={handleLookupTaxIdentifier}
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-xs border-destructive/20 text-destructive hover:bg-destructive/5"
                            type="button"
                            aria-label="Reintentar búsqueda de identificador fiscal"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Reintentar búsqueda
                          </Button>
                        )}
                        {taxIdLookupError && <p className="text-xs text-destructive">{taxIdLookupError}</p>}
                      </div>
                    );
                  }

                  /* Sin resultado */
                  if (lookupStatus === 'no_result' || (lookupStatus === 'completed' && !hasBestCandidate)) {
                    const skipReasonLabels: Record<string, string> = {
                      no_high_confidence_candidate: 'Sin candidato con confianza suficiente.',
                      nit_check_digit_invalid: 'Dígito de verificación incorrecto en los candidatos encontrados.',
                      name_match_too_weak: 'La coincidencia de nombre es demasiado débil.',
                      critical_risk_present: 'Riesgos críticos detectados en los candidatos.',
                      no_candidates: 'No se encontraron candidatos.',
                    };
                    const skipReason = taxIdLookup?.best_candidate_skip_reason
                      ? (skipReasonLabels[taxIdLookup.best_candidate_skip_reason] || taxIdLookup.best_candidate_skip_reason)
                      : null;
                    return (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground/80">
                          No encontramos un identificador fiscal confiable.
                          {skipReason && <span className="italic text-muted-foreground/60"> Motivo: {skipReason}</span>}
                        </p>
                        {!isDuplicateConfirmed && isCO && (
                          <Button
                            onClick={handleLookupTaxIdentifier}
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-xs hover:bg-su-brand-soft hover:text-su-brand hover:border-su-brand/30"
                            type="button"
                            aria-label="Reintentar búsqueda de identificador fiscal"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Reintentar búsqueda
                          </Button>
                        )}
                        {taxIdLookupError && <p className="text-xs text-destructive">{taxIdLookupError}</p>}
                      </div>
                    );
                  }

                  /* País no soportado */
                  if (!isCO) {
                    return (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground/80 italic">
                          La búsqueda automática todavía no está disponible para este país.
                        </p>
                      </div>
                    );
                  }

                  /* Estado inicial / pendiente para CO */
                  return (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                      <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                      <span>Identificador fiscal pendiente de búsqueda automática.</span>
                    </div>
                  );
                })()
              )}
            </SurfaceCard>
            </CollapsibleSection>

          </TabsContent>

          {/* Tab 2: Validación */}
          <TabsContent value="validacion" className="flex-1 overflow-y-auto px-7 py-6 min-h-0 space-y-6">
            {/* Q3F-5AZ.2D-1-UX1 — Estado de revisión (informational only). The
                operative "Aprobar" action moved to the drawer's action zone
                (sticky footer, below) so it's available regardless of tab. */}
            <ReviewStatusInfo
              candidate={{
                id: candidate.id,
                name: candidate.name,
                status: candidate.status,
                recordOrigin: candidate.record_origin,
                duplicateStatus: candidate.duplicate_status,
                matchedHubspotCompanyId: candidate.matched_hubspot_company_id,
                reviewedAt: candidate.reviewed_at,
                convertedAccountId: candidate.converted_account_id,
              }}
            />

            {/* Estado de Duplicidad */}
            <SurfaceCard>
              <SurfaceCardHeader title="Verificación de Duplicidad" description="Determina si esta empresa ya existe en los registros internos de SellUp o HubSpot CRM." />
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {isAutoValidated ? (
                  <>
                    <Badge
                      className={`border-0 text-[10px] font-semibold ${
                        sellupDupStatus === 'duplicate'
                          ? 'bg-destructive/10 text-destructive'
                          : sellupDupStatus === 'possible_duplicate'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : sellupDupStatus === 'no_match'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground/60'
                      }`}
                    >
                      {sellupDupStatus === 'duplicate'
                        ? 'Duplicado SellUp'
                        : sellupDupStatus === 'possible_duplicate'
                        ? 'Posible duplicado SellUp'
                        : sellupDupStatus === 'no_match'
                        ? 'Sin duplicados SellUp'
                        : 'SellUp sin validar'}
                    </Badge>
                    <Badge
                      className={`border-0 text-[10px] font-semibold ${
                        hsDupStatus === 'match'
                          ? 'bg-destructive/10 text-destructive'
                          : hsDupStatus === 'possible_match'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : hsDupStatus === 'no_match'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground/60'
                      }`}
                    >
                      {hsDupStatus === 'match'
                        ? 'Duplicado HubSpot'
                        : hsDupStatus === 'possible_match'
                        ? 'Posible coincidencia HubSpot'
                        : hsDupStatus === 'no_match'
                        ? 'Sin duplicados HubSpot'
                        : 'HubSpot sin validar'}
                    </Badge>
                  </>
                ) : (
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
                )}
              </div>
            </SurfaceCard>

            {/* Coincidencias de Duplicidad */}
            {isAutoValidated ? (
              <div className="space-y-4">
                {/* Bloque SellUp detail */}
                {(sellupDupStatus === 'duplicate' || sellupDupStatus === 'possible_duplicate') &&
                  validationMetaSheet?.sellup_duplicate_check?.matched_name && (
                  <div className="rounded-xl border border-border/30 bg-card p-4 space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Coincidencia interna en SellUp
                    </p>
                    <FieldGrid>
                      <Field label="Empresa encontrada" value={val(validationMetaSheet.sellup_duplicate_check.matched_name)} />
                      <Field
                        label="Tipo de registro"
                        value={
                          validationMetaSheet.sellup_duplicate_check.matched_source === 'account'
                            ? 'Cuenta (Account)'
                            : 'Candidato'
                        }
                      />
                      <Field
                        label="ID interno"
                        value={val(validationMetaSheet.sellup_duplicate_check.matched_account_id ?? validationMetaSheet.sellup_duplicate_check.matched_candidate_id)}
                        mono
                      />
                      <Field
                        label="Dominio / web"
                        value={val(validationMetaSheet.sellup_duplicate_check.matched_domain ?? validationMetaSheet.sellup_duplicate_check.matched_website)}
                      />
                      <Field label="Identificador fiscal" value={val(validationMetaSheet.sellup_duplicate_check.matched_tax_identifier)} mono />
                      <Field
                        label="Coincidió por"
                        value={({
                          tax_identifier: 'NIT/RFC/RUT',
                          domain: 'Dominio web',
                          normalized_name_country: 'Nombre + país',
                          company_name: 'Nombre de empresa',
                        } as Record<string, string>)[validationMetaSheet.sellup_duplicate_check.matched_by ?? ''] ?? val(validationMetaSheet.sellup_duplicate_check.matched_by)}
                      />
                    </FieldGrid>
                  </div>
                )}

                {/* Bloque HubSpot detail */}
                {(hsDupStatus === 'match' || hsDupStatus === 'possible_match') &&
                  validationMetaSheet?.hubspot_duplicate_check?.matched_company_name && (
                  <div className="rounded-xl border border-border/30 bg-card p-4 space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Coincidencia en HubSpot CRM
                    </p>
                    <FieldGrid>
                      <Field label="Empresa encontrada" value={val(validationMetaSheet.hubspot_duplicate_check.matched_company_name)} />
                      <Field label="HubSpot Company ID" value={val(validationMetaSheet.hubspot_duplicate_check.matched_company_id)} mono />
                      <Field
                        label="Dominio / web"
                        value={val(validationMetaSheet.hubspot_duplicate_check.matched_domain ?? validationMetaSheet.hubspot_duplicate_check.matched_website)}
                      />
                      {validationMetaSheet.hubspot_duplicate_check.matched_phone && (
                        <Field label="Teléfono" value={validationMetaSheet.hubspot_duplicate_check.matched_phone} />
                      )}
                      {validationMetaSheet.hubspot_duplicate_check.matched_lifecycle_stage && (
                        <Field
                          label="Lifecycle stage"
                          value={({
                            subscriber: 'Suscriptor', lead: 'Lead', marketingqualifiedlead: 'MQL',
                            salesqualifiedlead: 'SQL', opportunity: 'Oportunidad', customer: 'Cliente',
                            evangelist: 'Evangelizador', other: 'Otro',
                          } as Record<string, string>)[validationMetaSheet.hubspot_duplicate_check.matched_lifecycle_stage ?? ''] ?? val(validationMetaSheet.hubspot_duplicate_check.matched_lifecycle_stage)}
                        />
                      )}
                      {validationMetaSheet.hubspot_duplicate_check.matched_tax_identifier && (
                        <Field label="NIT / Tax ID" value={validationMetaSheet.hubspot_duplicate_check.matched_tax_identifier} mono />
                      )}
                    </FieldGrid>
                    {validationMetaSheet.hubspot_duplicate_check.hubspot_url && (
                      <div className="pt-2.5 border-t border-border/20 mt-1 flex">
                        <a
                          href={validationMetaSheet.hubspot_duplicate_check.hubspot_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-su-brand hover:underline"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Ver empresa en HubSpot CRM
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* Comparación rápida */}
                {(sellupDupStatus === 'duplicate' || sellupDupStatus === 'possible_duplicate' ||
                  hsDupStatus === 'match' || hsDupStatus === 'possible_match') && (() => {
                  const su = validationMetaSheet?.sellup_duplicate_check;
                  const hs = validationMetaSheet?.hubspot_duplicate_check;
                  const hasSellupDetail = !!(su?.matched_name);

                  const matchName = hasSellupDetail ? su?.matched_name : hs?.matched_company_name;
                  const matchDomain = hasSellupDetail
                    ? (su?.matched_domain ?? su?.matched_website)
                    : (hs?.matched_domain ?? hs?.matched_website);
                  const matchCountry = hasSellupDetail ? su?.matched_country_code : hs?.matched_country;
                  const matchTaxId = hasSellupDetail ? su?.matched_tax_identifier : hs?.matched_tax_identifier;

                  if (!matchName && !matchDomain) return null;

                  const rows = [
                    { label: 'Nombre', cv: candidate.name, mv: matchName },
                    { label: 'Sitio web', cv: candidate.domain ?? candidate.website, mv: matchDomain },
                    { label: 'País', cv: candidate.country ?? candidate.country_code, mv: matchCountry },
                    { label: 'Identificador fiscal', cv: candidate.tax_identifier, mv: matchTaxId },
                  ].filter(r => r.cv || r.mv);

                  if (rows.length === 0) return null;
                  return (
                    <div className="rounded-xl border border-border/30 bg-card p-4 space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Comparación rápida</p>
                      <div className="overflow-x-auto rounded-lg border border-border/40">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/30">
                            <tr>
                              <th className="text-left text-[10px] text-muted-foreground/60 font-medium py-2 px-3">Campo</th>
                              <th className="text-left text-[10px] text-muted-foreground/60 font-medium py-2 px-3">Candidato</th>
                              <th className="text-left text-[10px] text-muted-foreground/60 font-medium py-2 px-3">Coincidencia</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20">
                            {rows.map(({ label: rl, cv, mv }) => (
                              <tr key={rl}>
                                <td className="py-2 px-3 text-muted-foreground/70 font-medium">{rl}</td>
                                <td className="py-2 px-3 text-foreground/90">{cv ?? <span className="text-muted-foreground/40 italic">Sin dato</span>}</td>
                                <td className="py-2 px-3 text-foreground/90">{mv ?? <span className="text-muted-foreground/40 italic">Sin dato</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="space-y-4">
                {dcMatches.length > 0 && (
                  <div className="rounded-xl border border-border/30 bg-card p-4 space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Coincidencias encontradas
                    </p>
                    <div className="space-y-2">
                      {dcMatches.map((match, i) => (
                        <DuplicateMatchCard key={i} match={match} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Riesgos e Incertidumbres */}
            {sortedRisks.length > 0 && (
              <CollapsibleSection title="Riesgos e Incertidumbres">
              <SurfaceCard>
                <SurfaceCardHeader title="Riesgos e Incertidumbres" />
                <div className="space-y-2">
                  {sortedRisks.map((risk, i) => {
                    const severity = classifyRisk(risk);
                    const styleMap = {
                      critical: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
                      high: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
                      medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
                      low: 'bg-muted/50 text-muted-foreground border-border/30',
                    };
                    const badgeMap = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo' };
                    return (
                      <div key={i} className={`flex items-start justify-between gap-3 text-xs rounded-lg border p-2.5 ${styleMap[severity]}`}>
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                          <span className="leading-relaxed">{isChileOfficialCandidate ? sanitizeTextForChile(risk) : risk}</span>
                        </div>
                        <Badge className="border-0 text-[8px] font-bold uppercase py-0.5 px-1.5 shrink-0 select-none bg-black/5 dark:bg-white/5 text-inherit">
                          {badgeMap[severity]}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </SurfaceCard>
              </CollapsibleSection>
            )}

            {/* Datos Faltantes (de evaluación IA) */}
            {missingFields.length > 0 && (
              <CollapsibleSection title="Datos Faltantes">
              <SurfaceCard>
                <SurfaceCardHeader title="Datos Faltantes" />
                <ul className="space-y-1.5">
                  {missingFields.map((field, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
                      <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500/70" />
                      <span>{isChileOfficialCandidate ? sanitizeTextForChile(field) : field}</span>
                    </li>
                  ))}
                </ul>
              </SurfaceCard>
              </CollapsibleSection>
            )}

            {/* Evidencia de País */}
            {!!countryEvidence && (
              <CollapsibleSection title="Evidencia de País" defaultOpen>
              <SurfaceCard>
                <SurfaceCardHeader title="Evidencia de País" />
                {(() => {
                  const level = countryEvidence.evidence_level as string | undefined;
                  const sources = countryEvidence.evidence_sources as string[] | undefined;
                  const warning = countryEvidence.warning as string | undefined;

                  const levelConfig = {
                    strong: { label: 'Fuerte', style: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> },
                    weak: { label: 'Débil', style: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> },
                    query_only: { label: 'Solo en query', style: 'bg-destructive/10 text-destructive', icon: <XCircle className="h-3.5 w-3.5 shrink-0" /> },
                  };
                  const cfg = level ? (levelConfig[level as keyof typeof levelConfig] ?? { label: level, style: 'bg-muted text-muted-foreground', icon: <Info className="h-3.5 w-3.5 shrink-0" /> }) : null;

                  return (
                    <div className="space-y-3">
                      {cfg && (
                        <div className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${cfg.style}`}>
                          {cfg.icon}
                          Nivel: {cfg.label}
                        </div>
                      )}
                      {sources && sources.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Señales detectadas</p>
                          <div className="flex flex-wrap gap-1.5">
                            {sources.map((s, i) => (
                              <span key={i} className="inline-flex items-center rounded-md bg-muted/50 px-2 py-0.5 text-[10px] font-mono text-foreground/80 border border-border/30">
                                {s}
                              </span>
                            ))}
                          </div>
                          {level === 'strong' && sources.some(s => s.includes('.com.co')) && (
                            <p className="text-[10px] text-muted-foreground/70 italic pt-0.5">
                              El dominio .com.co indica presencia en Colombia.
                            </p>
                          )}
                        </div>
                      )}
                      {level === 'query_only' && (
                        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 flex items-start gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                          <p className="text-xs text-destructive">
                            El país solo aparece en la búsqueda, no está confirmado por la fuente.
                          </p>
                        </div>
                      )}
                      {level === 'weak' && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 flex items-start gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            Evidencia de país débil. Requiere revisión manual.
                          </p>
                        </div>
                      )}
                      {warning && level !== 'query_only' && level !== 'weak' && (
                        <p className="text-xs text-muted-foreground/70 italic">{warning}</p>
                      )}
                    </div>
                  );
                })()}
              </SurfaceCard>
              </CollapsibleSection>
            )}

            {/* Validación de Sitio Web */}
            {!!websiteVerification && (
              <CollapsibleSection title="Validación de Sitio Web" defaultOpen>
              <SurfaceCard>
                <SurfaceCardHeader title="Validación de Sitio Web" />
                {(() => {
                  const wvStatus = websiteVerification.status as string | undefined;
                  const wvDomain = websiteVerification.domain as string | undefined;
                  const wvConfidence = websiteVerification.confidence as number | undefined;
                  const wvHttpStatus = websiteVerification.http_status as number | undefined;
                  const wvSkipped = websiteVerification.skipped as boolean | undefined;

                  if (wvSkipped) {
                    return (
                      <p className="text-xs text-muted-foreground/60 italic">
                        La verificación del sitio web fue omitida para este candidato.
                      </p>
                    );
                  }

                  const statusConfig: Record<string, { label: string; style: string; icon: React.ReactNode }> = {
                    verified: { label: 'Verificado', style: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> },
                    inferred: { label: 'Inferido', style: 'bg-blue-500/10 text-blue-700 dark:text-blue-400', icon: <Info className="h-3.5 w-3.5 shrink-0" /> },
                    mismatch: { label: 'No coincide', style: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> },
                    not_found: { label: 'No encontrado', style: 'bg-muted text-muted-foreground/70', icon: <XCircle className="h-3.5 w-3.5 shrink-0" /> },
                    error: { label: 'Error', style: 'bg-destructive/10 text-destructive', icon: <XCircle className="h-3.5 w-3.5 shrink-0" /> },
                  };
                  const cfg = wvStatus ? (statusConfig[wvStatus] ?? { label: wvStatus, style: 'bg-muted text-muted-foreground', icon: <Info className="h-3.5 w-3.5" /> }) : null;

                  return (
                    <div className="space-y-3">
                      {cfg && (
                        <div className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${cfg.style}`}>
                          {cfg.icon}
                          {cfg.label}
                        </div>
                      )}
                      <FieldGrid>
                        {wvDomain && <Field label="Dominio" value={wvDomain} mono />}
                        {wvConfidence !== undefined && <Field label="Confianza" value={`${wvConfidence}%`} />}
                        {wvHttpStatus !== undefined && (
                          <Field
                            label="HTTP Status"
                            value={
                              <span className={wvHttpStatus === 200 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-amber-600 dark:text-amber-400 font-semibold'}>
                                {wvHttpStatus}
                              </span>
                            }
                          />
                        )}
                      </FieldGrid>
                    </div>
                  );
                })()}
              </SurfaceCard>
              </CollapsibleSection>
            )}

            {/* Motivos de Revisión */}
            {!!(scoringMeta?.reasons || scoringMeta?.warnings) && (
              <CollapsibleSection title="Motivos de Revisión" defaultOpen>
              <SurfaceCard>
                <SurfaceCardHeader title="Motivos de Revisión del Agente 1" />
                <div className="space-y-3">
                  {Array.isArray(scoringMeta.reasons) && (scoringMeta.reasons as string[]).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Razones positivas</p>
                      <ul className="space-y-1">
                        {(scoringMeta.reasons as string[]).map((r, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(scoringMeta.warnings) && (scoringMeta.warnings as string[]).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Advertencias</p>
                      <ul className="space-y-1">
                        {(scoringMeta.warnings as string[]).map((w, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(scoringMeta.blockers) && (scoringMeta.blockers as string[]).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Bloqueadores</p>
                      <ul className="space-y-1">
                        {(scoringMeta.blockers as string[]).map((b, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                            <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </SurfaceCard>
              </CollapsibleSection>
            )}

            {/* Datos de Validación (Claves normalizadas) */}
            {validationMetaSheet && (
              <CollapsibleSection title="Claves Normalizadas">
              <SurfaceCard>
                <SurfaceCardHeader title="Datos de la Validación" />
                <div className="space-y-3">
                  <FieldGrid>
                    <Field
                      label="Campos faltantes"
                      value={(() => {
                        const missing = validationMetaSheet.quality_check?.missing_fields;
                        if (!missing || missing.length === 0) return 'Ninguno';
                        const labels: Record<string, string> = {
                          tax_identifier: 'Identificador fiscal',
                          linkedin_url: 'LinkedIn',
                          website: 'Sitio web',
                          industry: 'Sector/Industria',
                        };
                        return missing.map((f) => labels[f] || f).join(', ');
                      })()}
                    />
                    <Field
                      label="Confianza importada"
                      value={(() => {
                        const conf = validationMetaSheet.quality_check?.import_confidence || (candidate.metadata as unknown as SheetCandidateMetadata)?.import?.confidence;
                        if (!conf) return 'No disponible';
                        const confMap: Record<string, string> = {
                          alta: 'Alta', media: 'Media', baja: 'Baja',
                          high: 'Alta', medium: 'Media', low: 'Baja',
                        };
                        return confMap[String(conf).toLowerCase()] || String(conf);
                      })()}
                    />
                    <Field
                      label="Última validación"
                      value={new Date(validationMetaSheet.validated_at || candidate.updated_at).toLocaleString('es-CO')}
                    />
                  </FieldGrid>

                  {validationMetaSheet.normalized_keys && (
                    <div className="pt-3 border-t border-border/10">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">Claves normalizadas</p>
                      <FieldGrid>
                        {validationMetaSheet.normalized_keys.normalized_name && (
                          <Field label="Nombre norm." value={validationMetaSheet.normalized_keys.normalized_name} mono />
                        )}
                        {validationMetaSheet.normalized_keys.normalized_domain && (
                          <Field label="Dominio norm." value={validationMetaSheet.normalized_keys.normalized_domain} mono />
                        )}
                        {validationMetaSheet.normalized_keys.normalized_tax_identifier && (
                          <Field label="Tax ID norm." value={validationMetaSheet.normalized_keys.normalized_tax_identifier} mono />
                        )}
                      </FieldGrid>
                    </div>
                  )}
                </div>
              </SurfaceCard>
              </CollapsibleSection>
            )}

            {/* Detalle Técnico del Sistema */}
            <CollapsibleSection title="Detalle Técnico">
            <SurfaceCard>
              <SurfaceCardHeader title="Detalle Técnico del Sistema" />
              <FieldGrid>
                <Field label="Candidate ID" value={candidate.id} mono />
                <Field label="Batch ID" value={candidate.batch_id} mono />
                <Field label="Fuente primaria" value={val(candidate.source_primary)} mono />
                <Field label="Creado" value={new Date(candidate.created_at).toLocaleString('es-CO')} />
                <Field label="Actualizado" value={new Date(candidate.updated_at).toLocaleString('es-CO')} />
                {candidate.reviewed_at && (
                  <Field label="Revisado" value={new Date(candidate.reviewed_at).toLocaleString('es-CO')} />
                )}
                {candidate.confidence_score !== null && (
                  <Field label="Puntaje Confianza" value={`${candidate.confidence_score?.toFixed(0)}%`} />
                )}
                {candidate.estimated_cost_usd !== null && Number(candidate.estimated_cost_usd) > 0 && (
                  <Field label="Costo estimado" value={`$${Number(candidate.estimated_cost_usd).toFixed(4)} USD`} mono />
                )}
              </FieldGrid>

              {candidate.review_notes && (
                <div className="pt-3 border-t border-border/10">
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Notas de revisión</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{candidate.review_notes}</p>
                </div>
              )}
            </SurfaceCard>

            <SurfaceCard>
              <SurfaceCardHeader title="Source Trace Raw JSON" />
              {(() => {
                const hasSourceTrace = candidate.source_trace && Object.keys(candidate.source_trace).length > 0;
                const hasSearchTrace = searchTrace && Object.keys(searchTrace).length > 0;
                const rawTrace = hasSourceTrace ? candidate.source_trace : hasSearchTrace ? searchTrace : null;
                if (!rawTrace) {
                  return (
                    <p className="text-xs text-muted-foreground/60 italic">
                      No hay trazabilidad de búsqueda disponible para este candidato.
                    </p>
                  );
                }
                return (
                  <pre className="text-[9px] text-muted-foreground/80 overflow-auto max-h-48 leading-relaxed font-mono bg-muted/40 p-2.5 rounded-lg border border-border/20">
                    {JSON.stringify(rawTrace, null, 2)}
                  </pre>
                );
              })()}
            </SurfaceCard>
            </CollapsibleSection>
          </TabsContent>
        </Tabs>
      </DrawerShell>

      <ModalShell
        open={!!confirmDialogData}
        onOpenChange={(open) => { if (!open) setConfirmDialogData(null); }}
        title="Confirmar Identificador Fiscal"
        description={
          <span>
            ¿Estás seguro de que deseas aprobar <span className="font-mono text-foreground font-medium">{confirmDialogData?.taxIdentifier}</span> como el identificador fiscal oficial de este candidato?
          </span>
        }
        showCloseButton={false}
        className="max-w-md"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setConfirmDialogData(null)}
              disabled={isApprovingTaxId}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="text-xs bg-su-brand hover:bg-su-brand/90 text-white"
              onClick={async () => {
                if (confirmDialogData) {
                  await handleApproveTaxIdentifier(
                    confirmDialogData.taxIdentifier,
                    confirmDialogData.sourceName,
                    confirmDialogData.sourceUrl
                  );
                }
              }}
              disabled={isApprovingTaxId}
            >
              {isApprovingTaxId ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Guardando...
                </>
              ) : (
                `Guardar ${getTaxIdLabel(candidate?.country_code)}`
              )}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {confirmDialogData?.legalName && (
            <div className="text-xs flex items-center justify-between border-b border-border/30 pb-2">
              <span className="text-muted-foreground">Razón Social:</span>
              <span className="font-medium text-foreground">{confirmDialogData.legalName}</span>
            </div>
          )}
          <div className="text-xs flex items-center justify-between border-b border-border/30 pb-2">
            <span className="text-muted-foreground">Fuente:</span>
            <span className="text-foreground">{confirmDialogData?.sourceName}</span>
          </div>
          {confirmDialogData?.confidence && (
            <div className="text-xs flex items-center justify-between pb-2">
              <span className="text-muted-foreground">Confianza:</span>
              <span className={`font-semibold capitalize ${
                confirmDialogData.confidence === 'high' ? 'text-emerald-500' : 'text-amber-500'
              }`}>
                {confirmDialogData.confidence === 'high' ? 'Alta' : 'Media'}
              </span>
            </div>
          )}
          <p className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-md p-2 mt-2 leading-relaxed">
            * El identificador se guardará localmente en SellUp. No se sincronizará con HubSpot en este momento.
          </p>
        </div>
      </ModalShell>
    </>
  );
}

'use client';

import * as React from 'react';
import { getCandidateLinkedInUrl, getCandidateLinkedInDisplay } from '@/modules/prospect-batches/candidate-linkedin-url';
import {
  resolveLinkedInFieldDisplay,
  resolveEmployeeCountFieldDisplay,
} from '@/modules/prospect-batches/candidate-company-fields-display';
// AGENT1-APOLLO-CANDIDATE-INSERT-FORENSICS-1 § 11 — la subindustria pedida, su
// veredicto y si cuenta hacia el objetivo. El dato ya se persistía; faltaba
// enseñarlo, y sin él una empresa AMBIGUA se leía como una empresa confirmada.
import { resolveCandidateSubindustryStatus } from '@/modules/prospect-batches/candidate-subindustry-status-display';
import { ShieldCheck, Building2, MapPin, CheckCircle2, FileText, Tag } from '@/icons';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DrawerSection } from '@/components/shared/drawer-section';
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import { CollapsibleDrawerSection } from '@/components/shared/collapsible-drawer-section';
import { CandidateDetailSummary, describePendingEvaluation } from './candidate-detail-summary';
import { Badge } from '@/components/ui/badge';
import { CandidateDetailBanners } from './candidate-detail-banners';
import {
  CANDIDATE_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_STYLES,
  STRUCTURED_SOURCE_LABELS,
  VENDOR_CANDIDATE_SOURCE_LABELS,
  isStructuredCandidate,
  parseDuplicateCheck,
  type ProspectCandidateWithReviewer,
  type ReviewStatus,
} from '@/modules/prospect-batches/types';
import type { PeruSunatEnrichmentBlock } from '@/server/prospect-batches/peru-sunat-post-approval-enrichment';
import { PeruSunatLegalValidationBlock } from './peru-sunat-legal-validation-block';
import { ClaudeClassificationBlock } from './claude-classification-block';
import { readClaudeClassificationDisplay } from './claude-classification-display';
import type { PeMigoApiEnrichmentBlock } from '@/server/prospect-batches/peru-migo-legal-enrichment';
import { PeruMigoLegalValidationBlock } from './peru-migo-legal-validation-block';
import { ReviewStatusInfo } from '@/components/prospects/review-status-info';
import { ProspectReviewActions } from '@/components/prospects/prospect-review-actions';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  extractDomainFromUrl,
  isDirectoryOrThirdPartyDomain,
  sanitizeTextForChile,
  type SheetCandidateMetadata,
} from './candidate-detail-helpers';
import {
  CandidateConversionSection,
  CandidateFitAnalysisSection,
  CandidateFoundReasonSection,
  CandidateOpportunitySections,
  CandidateRecommendedDecisionSection,
} from './candidate-detail-insight-sections';
import {
  CandidateCommercialDataSection,
  CandidateIcpSizeSection,
  CandidateOfficialDataSection,
  CandidatePublicEvidenceSection,
} from './candidate-detail-company-sections';
import {
  CandidateTaxIdConfirmDialog,
  CandidateTaxIdSection,
  useCandidateTaxIdLookup,
} from './candidate-detail-tax-id-section';
import {
  CandidateDuplicateMatchesSections,
  CandidateDuplicateStatusSection,
} from './candidate-detail-duplicate-sections';
import {
  CandidateCountryEvidenceSection,
  CandidateMissingFieldsSection,
  CandidateReviewReasonsSection,
  CandidateRisksSection,
  CandidateTechnicalDetailSection,
  CandidateValidationDataSection,
  CandidateWebsiteVerificationSection,
} from './candidate-detail-validation-sections';

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
  /**
   * Q3F-5AZ.2G-2 — opened via row menu / context menu / selection action bar
   * "Marcar duplicado": lands on the Validación tab and arms the inline
   * MARK-DUPLICATE confirmation (only when the candidate is actually eligible).
   * Never marks directly.
   */
  initialDuplicateIntent?: boolean;
  /** Called once the duplicate intent above has been applied. */
  onDuplicateIntentConsumed?: () => void;
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
  initialDuplicateIntent = false,
  onDuplicateIntentConsumed,
}: CandidateDetailSheetProps) {

  const taxIdLookupState = useCandidateTaxIdLookup(candidate, onCandidateUpdated);
  const [activeTab, setActiveTab] = React.useState<string>('empresa');

  // Rationale: resets transient UI state when the selected candidate changes.
  // Depends on a stable primitive (candidate.id); no cascading render risk.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    // Row menu / context menu / selection bar "Aprobar" or "Descartar" lands
    // directly on Validación so the reviewer sees the status context next to
    // the action.
    setActiveTab(
      initialApproveIntent || initialDiscardIntent || initialDuplicateIntent
        ? 'validacion'
        : 'empresa',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
  // 16AK.16C: read from enrichment.ai_evaluation (structured path), fallback to legacy top-level
  const aiEval = candidate ? ((enrichment?.ai_evaluation as Record<string, unknown> | undefined)
    ?? (candidate.metadata?.ai_evaluation as Record<string, unknown> | undefined)) : undefined;
  const sourcePrimaryLabel = candidate?.source_primary
    ? (VENDOR_CANDIDATE_SOURCE_LABELS[candidate.source_primary] ?? candidate.source_primary)
    : null;
  const structuredSourceLabel = (isStructured && candidate?.source_primary
    ? (STRUCTURED_SOURCE_LABELS[candidate.source_primary] ?? sourcePrimaryLabel)
    : null) as React.ReactNode;

  const claudeClassification = readClaudeClassificationDisplay(candidate?.metadata);
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
  const hasAiEval = fitStatus !== null || fitScore !== null || aiSummary !== null;

  // Agent 1 evidence fields — v1.9
  const searchTrace = candidate?.metadata?.search_trace as Record<string, unknown> | undefined;
  const sourceTitle = candidate?.metadata?.source_title as string | undefined;
  const sourceSnippet = candidate?.metadata?.source_snippet as string | undefined;
  const countryEvidence = candidate?.metadata?.country_evidence as Record<string, unknown> | undefined;
  const websiteVerification = candidate?.metadata?.website_verification as Record<string, unknown> | undefined;
  const scoringMeta = candidate?.metadata?.scoring as Record<string, unknown> | undefined;


  if (!candidate) return null;

  // AI eval skip reason (16AK.16C)

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

  // A1-APOLLO-LINKEDIN-EMPLOYEES-1 — un solo «No disponible» para todos los casos
  // hacía indistinguible «Apollo no lo devolvió» de «llegó y se perdió por dentro».
  // Estos dos descriptores traen el mensaje exacto de cada estado.
  const linkedInFieldDisplay = resolveLinkedInFieldDisplay(
    candidate.metadata,
    effectiveLinkedinUrl ?? candidate.linkedin_url ?? null,
  );
  const employeeCountFieldDisplay = resolveEmployeeCountFieldDisplay(
    candidate.metadata,
    candidate.employee_count ?? employeeCount,
  );
  const sectorDescription =
    (enrichment?.sector_description as string | undefined) ?? candidate.industry ?? null;
  const ciiu =
    (enrichment?.ciiu as string | undefined) ??
    (enrichment?.sector_code as string | undefined) ??
    null;

  // ── Resumen de cabecera y de las secciones plegables ──────────
  // Una sección plegada no es una fila muda: adelanta lo que contiene.
  const completenessPct =
    typeof candidate.data_completeness_score === 'number'
      ? candidate.data_completeness_score
      : typeof enrichment?.completeness_pct === 'number'
        ? enrichment.completeness_pct
        : null;

  const pendingEvaluation = describePendingEvaluation({
    enrichmentStatus: (enrichment?.status as string | undefined) ?? null,
    fitStatus,
    hasTaxIdConflict: hasNitConflict,
    hasOfficialWebsite,
    hasLinkedin: Boolean(effectiveLinkedinUrl),
    hasSector: Boolean(sectorDescription),
    hasSize: Boolean(employeeCount),
  });


  return (
    <>
      <DrawerShell
        open={open}
        onOpenChange={onOpenChange}
        side="right"
        className="w-full md:w-[70vw] lg:w-[50vw] lg:min-w-[720px] lg:max-w-[960px]"
        scrollable={false}
        icon={<Building2 className="h-4 w-4" />}
        title={candidate.name}
        description={
          // Cabecera: nombre (título) + estado + dónde está. Son `span`: la
          // descripción del panel es un párrafo y no admite bloques dentro.
          <span className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                candidate.status === 'approved'
                  ? 'positive'
                  : candidate.status === 'needs_review' || candidate.status === 'duplicate'
                    ? 'warning'
                    : candidate.status === 'converted_to_account'
                      ? 'brand'
                      : 'neutral'
              }
            >
              {CANDIDATE_STATUS_LABELS[candidate.status]}
            </Badge>
            {candidate.review_status && (
              <Badge className={`border-0 ${
                REVIEW_STATUS_STYLES[candidate.review_status as ReviewStatus] ?? 'bg-muted text-muted-foreground'
              }`}>
                {REVIEW_STATUS_LABELS[candidate.review_status as ReviewStatus] ?? candidate.review_status}
              </Badge>
            )}
            {candidate.country_code && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                {candidate.country ?? candidate.country_code}
              </span>
            )}
            {structuredSourceLabel ? (
              <Badge variant="brand">
                <ShieldCheck aria-hidden="true" />
                {structuredSourceLabel}
              </Badge>
            ) : sourcePrimaryLabel ? (
              <span className="text-xs text-muted-foreground">{sourcePrimaryLabel}</span>
            ) : null}
          </span>
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
            duplicateAutoConfirm={initialDuplicateIntent}
            onDuplicateIntentConsumed={onDuplicateIntentConsumed}
          />
        }
      >
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <TabsList variant="segmented" className="shrink-0 mx-7 mt-4">
            <TabsTrigger value="empresa"><Building2 className="h-4 w-4" /> Empresa</TabsTrigger>
            <TabsTrigger value="validacion"><CheckCircle2 className="h-4 w-4" /> Validación</TabsTrigger>
          </TabsList>

          {/* Tab 1: Empresa */}
          <TabsContent value="empresa" className="flex-1 overflow-y-auto px-7 py-6 min-h-0 space-y-4">
            {/* Banners de advertencia */}
            <CandidateDetailBanners flags={flags} hasNitConflict={hasNitConflict} />

            {/* Resumen: lo que hay evaluado o, si no hay nada, qué falta para evaluarlo */}
            <CandidateDetailSummary
              fitScore={fitScore}
              completeness={completenessPct}
              pendingEvaluation={pendingEvaluation}
            />

            {/* AI Summary */}
            {aiSummary && (
              <DrawerSection title="Resumen del negocio (IA)" icon={FileText}>
                <p className="text-sm text-muted-foreground leading-relaxed italic break-words">
                  &ldquo;{isChileOfficialCandidate ? sanitizeTextForChile(aiSummary) : aiSummary}&rdquo;
                </p>
              </DrawerSection>
            )}

            {/* Por qué fue encontrado */}
            {!!(searchTrace ?? sourceTitle ?? sourceSnippet) && (
              <CandidateFoundReasonSection
                searchTrace={searchTrace}
                sourceTitle={sourceTitle}
                sourceSnippet={sourceSnippet}
              />
            )}

            {/* Decisión recomendada */}
            {!!scoringMeta?.recommended_action && (
              <CandidateRecommendedDecisionSection candidate={candidate} scoringMeta={scoringMeta} />
            )}

            {/* Conversión y HubSpot Sync */}
            {candidate.status === 'converted_to_account' && candidate.converted_account_id && (
              <CandidateConversionSection candidate={candidate} />
            )}

            {/* Análisis de Encaje IA */}
            {hasAiEval && showAiEvaluation && (
              <CandidateFitAnalysisSection
                candidate={candidate}
                fitReasons={fitReasons}
                isChileOfficialCandidate={isChileOfficialCandidate}
              />
            )}

            {/* Oportunidades comerciales */}
            {hasAiEval && <CandidateOpportunitySections key={candidate.id} candidate={candidate} />}

            {/* Datos oficiales y legales */}
            <CandidateOfficialDataSection
              candidate={candidate}
              isChileOfficialCandidate={isChileOfficialCandidate}
              ciiu={ciiu}
              structuredSourceLabel={structuredSourceLabel}
            />

            {/* Estos tres bloques ya son una tarjeta con su propio título:
                envolverlos en otro rótulo plegable enseñaba el nombre dos veces. */}
            {/* Sugerencia de Claude (sector/tamaño con fuente) — sólo si existe */}
            {claudeClassification && <ClaudeClassificationBlock display={claudeClassification} />}

            {/* Validación Legal SUNAT — solo para candidatos Perú */}
            {isPeCandidate && <PeruSunatLegalValidationBlock block={peSunatBlock} />}

            {/* Validación complementaria Migo — solo si existe pe_migo_api */}
            {isPeCandidate && peMigoBlock && <PeruMigoLegalValidationBlock block={peMigoBlock} />}

            {/* Datos comerciales y web — abierta cuando hay algo que mirar */}
            <CandidateCommercialDataSection
              candidate={candidate}
              hasOfficialWebsite={hasOfficialWebsite}
              websiteConfidence={websiteConfidence}
              effectiveLinkedinUrl={effectiveLinkedinUrl}
              suggestedLinkedinDisplay={suggestedLinkedinDisplay}
              linkedinConfirmedUrl={linkedinConfirmedUrl}
              linkedinConfidence={linkedinConfidence}
              possibleLinkedInMatches={possibleLinkedInMatches}
              linkedInFieldDisplay={linkedInFieldDisplay}
              employeeCountFieldDisplay={employeeCountFieldDisplay}
              employeeCount={employeeCount}
              isChileOfficialCandidate={isChileOfficialCandidate}
              hasNitConflict={hasNitConflict}
              isStructured={isStructured}
              sourcePrimaryLabel={sourcePrimaryLabel}
              publicDescription={publicDescription}
              isDescriptionConfiable={isDescriptionConfiable}
            />

            {/* Tamaño ICP */}
            <CandidateIcpSizeSection candidate={candidate} />

            {/* Subindustria solicitada — FORENSICS-1 § 11.
                Qué se pidió, qué se demostró, si cuenta hacia el objetivo y por
                qué quedó para revisión. Antes nada de esto se veía: una empresa
                con subindustria AMBIGUA (Juan Valdez, Alpina, Grupo Diana en la
                corrida `9a9acf99`) era indistinguible de una confirmada. */}
            {(() => {
              const subindustryStatus = resolveCandidateSubindustryStatus(
                candidate.metadata as Record<string, unknown> | null | undefined,
              );
              if (!subindustryStatus.hasData) return null;

              // AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 9 — `unmapped`
              // usa el mismo tono neutro que «Sin medir»: no es un error del
              // candidato, es SellUp sin reglas todavía para esa subindustria, y
              // no debe leerse con la misma alarma que «Ambigua» o «Rechazada».
              const verdictBadgeVariant =
                subindustryStatus.verdict === 'confirmed'
                  ? 'positive'
                  : subindustryStatus.verdict === 'ambiguous'
                  ? 'warning'
                  : subindustryStatus.verdict === 'rejected'
                  ? 'negative'
                  : 'neutral';
              // Cubre 'unmapped' y null (sin medir) — ambos comparten el estilo
              // neutro por diseño, no por omisión.

              return (
                <CollapsibleDrawerSection
                  title="Subindustria solicitada"
                  hint="Sólo una subindustria confirmada cuenta hacia el objetivo de la búsqueda."
                  summary={`${subindustryStatus.requestedSubindustry ?? 'Sin subindustria declarada'} · ${subindustryStatus.verdictLabel}`}
                  icon={Tag}
                  tone={
                    subindustryStatus.verdict === 'rejected'
                      ? 'negative'
                      : subindustryStatus.verdict === 'ambiguous'
                      ? 'warning'
                      : 'brand'
                  }
                  // Abierta cuando NO quedó confirmada: es justo lo que hay que mirar.
                  defaultOpen={
                    subindustryStatus.verdict === 'ambiguous' || subindustryStatus.verdict === 'rejected'
                  }
                >
                  <div className="space-y-3" data-testid="candidate-subindustry-status">
                    <DetailList columns={2}>
                      <DetailItem label="Subindustria solicitada">
                        <span className="font-medium">
                          {subindustryStatus.requestedSubindustry ?? 'Sin subindustria declarada'}
                        </span>
                      </DetailItem>
                    </DetailList>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant={verdictBadgeVariant}
                        data-testid="candidate-subindustry-verdict"
                      >
                        {subindustryStatus.verdictLabel}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Cuenta hacia el objetivo:{' '}
                        <span
                          className="font-semibold text-foreground"
                          data-testid="candidate-subindustry-counts-toward-target"
                        >
                          {subindustryStatus.countsTowardTargetLabel}
                        </span>
                      </span>
                    </div>

                    {subindustryStatus.notConfirmedMessage && (
                      <Alert variant="warning">
                        <AlertDescription
                          className="text-xs leading-relaxed text-current"
                          data-testid="candidate-subindustry-not-confirmed"
                        >
                          {subindustryStatus.notConfirmedMessage}
                        </AlertDescription>
                      </Alert>
                    )}

                    {subindustryStatus.reviewReasons.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Motivo de revisión
                        </p>
                        <ul className="space-y-1" data-testid="candidate-subindustry-review-reasons">
                          {subindustryStatus.reviewReasons.map((reason) => (
                            <li
                              key={reason.key}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground"
                              data-testid={`candidate-subindustry-reason-${reason.key}`}
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-warning shrink-0"
                                aria-hidden
                              />
                              {reason.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </CollapsibleDrawerSection>
              );
            })()}

            {/* Evidencia pública encontrada */}
            {displayedPublicEvidence.length > 0 && (
              <CandidatePublicEvidenceSection displayedPublicEvidence={displayedPublicEvidence} />
            )}

            {/* Identificador fiscal — estado automático */}
            <CandidateTaxIdSection
              candidate={candidate}
              lookup={taxIdLookupState}
              sellupDupStatus={sellupDupStatus}
              hsDupStatus={hsDupStatus}
            />

          </TabsContent>

          {/* Tab 2: Validación */}
          <TabsContent value="validacion" className="flex-1 overflow-y-auto px-7 py-6 min-h-0 space-y-4">
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
            <CandidateDuplicateStatusSection
              candidate={candidate}
              isAutoValidated={isAutoValidated}
              validationMetaSheet={validationMetaSheet}
            />

            {/* Coincidencias de Duplicidad */}
            <CandidateDuplicateMatchesSections
              candidate={candidate}
              isAutoValidated={isAutoValidated}
              validationMetaSheet={validationMetaSheet}
              dcMatches={dcMatches}
            />

            {/* Riesgos e incertidumbres — abierta si hay alguno crítico o alto */}
            <CandidateRisksSection risks={risks} isChileOfficialCandidate={isChileOfficialCandidate} />

            {/* Datos faltantes (de evaluación IA) */}
            {missingFields.length > 0 && (
              <CandidateMissingFieldsSection
                missingFields={missingFields}
                isChileOfficialCandidate={isChileOfficialCandidate}
              />
            )}

            {/* Evidencia de país */}
            {!!countryEvidence && <CandidateCountryEvidenceSection countryEvidence={countryEvidence} />}

            {/* Validación del sitio web */}
            {!!websiteVerification && (
              <CandidateWebsiteVerificationSection websiteVerification={websiteVerification} />
            )}

            {/* Motivos de revisión */}
            {!!(scoringMeta?.reasons || scoringMeta?.warnings) && (
              <CandidateReviewReasonsSection scoringMeta={scoringMeta} />
            )}

            {/* Datos de la validación (incluye las claves normalizadas) */}
            {validationMetaSheet && (
              <CandidateValidationDataSection
                candidate={candidate}
                validationMetaSheet={validationMetaSheet}
              />
            )}

            {/* Detalle técnico: identificadores, fechas y la traza de la búsqueda */}
            <CandidateTechnicalDetailSection candidate={candidate} searchTrace={searchTrace} />
          </TabsContent>
        </Tabs>
      </DrawerShell>

      <CandidateTaxIdConfirmDialog candidate={candidate} lookup={taxIdLookupState} />
    </>
  );
}

// Agente 2A — Automatic Routing Request Action: Core (Hito 17B.4X.7C.5C)
//
// Pure, DI-testable core for the automatic-routing action. Adds
// nothing but input validation and action-result mapping on top of
// runAutomaticContactEnrichmentFallbackForRequest (17B.4X.7C.5B) — the flag
// check, attempt creation, and provider coordination all live in the
// orchestrator, unchanged. Kept separate from automatic-routing-actions.ts
// (the 'use server' wrapper) so it can be tested without Supabase
// auth/cookies, mirroring candidate-review-core.ts / request-attempt-
// resolution-core.ts in this same module.

import {
  runAutomaticContactEnrichmentFallbackForRequest,
  type AutomaticRoutingOrchestratorDeps,
  type AutomaticRoutingOrchestratorResult,
} from '@/server/agents/contact-enrichment-toolkit/contact-enrichment-routing-orchestrator';

export type RunAutomaticContactEnrichmentForRequestStatus =
  | AutomaticRoutingOrchestratorResult['outcome']
  | 'invalid_request_id';

export interface RunAutomaticContactEnrichmentForRequestResult {
  success: boolean;
  status: RunAutomaticContactEnrichmentForRequestStatus;
  automaticRoutingEnabled: boolean;
  fallbackExecuted: boolean;
  attempt1AttemptId: string | null;
  attempt2AttemptId: string | null;
  blockedReason: string | null;
  /**
   * AGENT2A-LOCAL-REVIEWABLE-CANDIDATE-REUSE-1.1 — count of already-existing
   * actionable pending_review candidates (source 'apollo' or 'lusha') that
   * made the provider fallback unnecessary. >= 1 only when status is
   * 'fallback_skipped_local_reuse'; 0 on every other branch, including
   * 'invalid_request_id'.
   *
   * Kept strictly separate from any created-candidate count: this milestone
   * does NOT introduce a combined effective-reviewable-count concept, because
   * the reuse branch terminates before attempt #2 and there is no second
   * fallback decision downstream that would need one.
   */
  reusedExistingCandidates: number;
  /**
   * AGENT2A-ZERO-CANDIDATES-MESSAGE (backlog A3/A6) — candidates each provider
   * actually left in pending_review during THIS routing call. `null` means the
   * provider did not run (no attempt, provider not called, or no fallback),
   * which the UI must not confuse with "ran and found 0". The chat message
   * reports these counts so the user never sees a success message — and never
   * goes to review — when nothing was created.
   *
   * Strictly per provider and separate from `reusedExistingCandidates`: this
   * is NOT the combined effective-reviewable count that REUSE-1.1 ruled out.
   */
  providerCandidatesCreated: AutomaticRoutingCandidatesCreated;
  /** Sources that failed in this call; [] when every source that ran worked. */
  failedProviders: AutomaticRoutingProviderName[];
  /**
   * AGENT2-HUBSPOT-FIRST-1 — candidatos que «Primero HubSpot» dejó en la corrida (0 si la
   * etapa no corrió). Separado de `providerCandidatesCreated`: no los creó ningún proveedor.
   */
  hubspotFirstCandidates?: number;
  /** true cuando HubSpot bastó y no se llamó a ningún proveedor. */
  hubspotFirstSatisfied?: boolean;
  /** AGENT2-CONTACT-BANK-1 — candidatos traídos de otra ficha de la misma compañía. */
  contactBankCandidates?: number;
  /** true cuando lo ya conocido bastó y no se llamó a Apollo ni a Lusha. */
  contactBankSatisfied?: boolean;
  /** AGENT2-COMPANY-SITE-PEOPLE-1 — personas del sitio web de la empresa (sin correo). */
  companySiteCandidates?: number;
  /**
   * AGENT2-AUDIT-FIXES-1 — por qué la búsqueda dejó lo que dejó. El chat lo usa para explicar un
   * cero con el siguiente paso en vez de un «No se encontraron contactos» a secas.
   */
  diagnosis?: AutomaticRoutingDiagnosis;
}

export interface AutomaticRoutingDiagnosis {
  /** Apollo no se llamó: faltaban dominio y nombre. */
  apolloSkipped: boolean;
  /** 'found_by_domain' | 'found_by_name' | 'not_found' | 'error' | null (no se sabe). */
  apolloOrganization: string | null;
  /** Personas que devolvió la búsqueda de Apollo; null si Apollo no corrió. */
  apolloPeopleFound: number | null;
  /** De esas, descartadas por cargo o datos incompletos. */
  apolloRejected: number | null;
  /** Ya conocidas (contactos existentes o identidades ya vistas): no se pagaron de nuevo. */
  apolloAlreadyKnown: number;
  /** Estado de cada etapa gratuita (ver FreeStageStatusesV1). */
  freeStages: { hubspotFirst: string; contactBank: string; companySite: string };
  /** Lusha se omitió porque ya dio cero aquí en esta fecha (ISO). */
  lushaRecentZeroAt: string | null;
  /** Lusha corrió en esta búsqueda. */
  lushaRan: boolean;
  /** Por qué los contactos de HubSpot no entraron; null si «Primero HubSpot» no corrió. */
  hubspotFirst?: {
    hubspotContacts: number;
    otherSeller: number;
    knownInSellUp: number;
    notRelevant: number;
    noName: number;
  } | null;
}

export interface AutomaticRoutingCandidatesCreated {
  apollo: number | null;
  lusha: number | null;
}

export type AutomaticRoutingProviderName = 'Apollo' | 'Lusha';

const LUSHA_NON_FAILURE_STATUSES = new Set(['success', 'no_reviewable_candidate']);

/**
 * Providers that FAILED in this call (error, missing credentials, unavailable).
 * "Ran and found 0" is not a failure. The chat only names a source when it
 * appears here.
 */
function deriveFailedProviders(
  result: Awaited<ReturnType<typeof runAutomaticContactEnrichmentFallbackForRequest>>,
): AutomaticRoutingProviderName[] {
  const failed: AutomaticRoutingProviderName[] = [];
  const apollo = result.attempt1?.result;
  if (apollo && (apollo.status === 'error' || apollo.providerStatus === 'error')) {
    failed.push('Apollo');
  }
  const lusha = result.attempt2?.result;
  if (
    result.outcome === 'fallback_provider_unavailable' ||
    (lusha && !LUSHA_NON_FAILURE_STATUSES.has(lusha.status))
  ) {
    failed.push('Lusha');
  }
  return failed;
}

function buildDiagnosis(
  result: Awaited<ReturnType<typeof runAutomaticContactEnrichmentFallbackForRequest>>,
): AutomaticRoutingDiagnosis {
  const apolloSkipped = result.outcome === 'attempt1_provider_not_called';
  const apollo = !apolloSkipped ? result.attempt1?.result ?? null : null;
  return {
    apolloSkipped,
    apolloOrganization: apollo?.organizationResolutionStatus ?? null,
    apolloPeopleFound: apollo ? apollo.rawResultsCount : null,
    apolloRejected: apollo ? apollo.rejectedByRelevance : null,
    apolloAlreadyKnown: apollo
      ? (apollo.skippedKnownProviderIdentity ?? 0) + apollo.exactDuplicates + apollo.existingPendingDuplicatesSkipped
      : 0,
    freeStages: {
      hubspotFirst: result.freeStages?.hubspot_first ?? 'not_reached',
      contactBank: result.freeStages?.contact_bank ?? 'not_reached',
      companySite: result.freeStages?.company_site ?? 'not_reached',
    },
    lushaRecentZeroAt: result.recentFallbackZero?.lastZeroAt ?? null,
    lushaRan: !!result.attempt2?.result,
    hubspotFirst: result.hubspotFirstBreakdown
      ? {
          hubspotContacts: result.hubspotFirstBreakdown.hubspotContacts,
          otherSeller: result.hubspotFirstBreakdown.otherSeller,
          knownInSellUp: result.hubspotFirstBreakdown.knownInSellUp,
          notRelevant: result.hubspotFirstBreakdown.notRelevant,
          noName: result.hubspotFirstBreakdown.noName,
        }
      : null,
  };
}

function invalidRequestIdResult(): RunAutomaticContactEnrichmentForRequestResult {
  return {
    success: false,
    status: 'invalid_request_id',
    automaticRoutingEnabled: false,
    fallbackExecuted: false,
    attempt1AttemptId: null,
    attempt2AttemptId: null,
    blockedReason: 'invalid_request_id',
    reusedExistingCandidates: 0,
    providerCandidatesCreated: { apollo: null, lusha: null },
    failedProviders: [],
    hubspotFirstCandidates: 0,
    hubspotFirstSatisfied: false,
    contactBankCandidates: 0,
    contactBankSatisfied: false,
    companySiteCandidates: 0,
  };
}

/**
 * Single core entry point for the automatic-routing request action. This is
 * LIVE: the contact-enrichment wizard CTA reaches it through
 * automatic-routing-actions.ts (AGENT2-ROUTING-WIRE-1). With the
 * automatic-routing flag off — the CODE default when the env flag is absent,
 * not an assertion about what Production currently sets — `deps` is never
 * exercised beyond `getConfig`: no attempt is created, no provider is called,
 * no telemetry is written. The orchestrator's own first check enforces this.
 */
export async function runAutomaticContactEnrichmentForRequestCore(
  requestId: unknown,
  triggeredBy: string,
  evaluatedAt: string,
  deps: AutomaticRoutingOrchestratorDeps = {},
): Promise<RunAutomaticContactEnrichmentForRequestResult> {
  if (typeof requestId !== 'string' || !requestId.trim()) {
    return invalidRequestIdResult();
  }

  const result = await runAutomaticContactEnrichmentFallbackForRequest(
    { requestId: requestId.trim(), triggeredBy, evaluatedAt },
    deps,
  );

  return {
    success: true,
    status: result.outcome,
    automaticRoutingEnabled: result.automaticRoutingEnabled,
    fallbackExecuted: result.fallbackExecuted,
    attempt1AttemptId:
      result.attempt1?.attemptId ?? result.hubspotFirst?.attemptId ?? result.contactBank?.attemptId ?? null,
    attempt2AttemptId: result.attempt2?.attemptId ?? null,
    blockedReason: result.blockedReason,
    reusedExistingCandidates: result.reusedExistingCandidates,
    providerCandidatesCreated: {
      apollo:
        result.attempt1 && result.outcome !== 'attempt1_provider_not_called'
          ? result.attempt1.result.candidatesCreated
          : null,
      lusha: result.attempt2?.result ? result.attempt2.result.candidatesCreated : null,
    },
    failedProviders: deriveFailedProviders(result),
    hubspotFirstCandidates: result.hubspotFirst?.inserted ?? 0,
    hubspotFirstSatisfied: result.hubspotFirst?.satisfied ?? false,
    contactBankCandidates: result.contactBank?.inserted ?? 0,
    contactBankSatisfied: result.contactBank?.satisfied ?? false,
    companySiteCandidates: result.companySite?.inserted ?? 0,
    diagnosis: buildDiagnosis(result),
  };
}

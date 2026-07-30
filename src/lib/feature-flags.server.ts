// Server-only: this module reads process.env and must never be imported from
// client components. The values are resolved at request time by server
// components and server actions, then sent to the client as plain booleans.

/**
 * Returns true when ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION is "true"
 * (case-insensitive, leading/trailing whitespace ignored).
 */
export function isProspectChatWizardExecutionEnabled(): boolean {
  return (
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION?.trim().toLowerCase() ===
    'true'
  );
}

/** Flag name constant for the Agente 1 conversational "Generar con IA" wizard. */
export const PROSPECT_CHAT_WIZARD_FLAG = 'ENABLE_PROSPECT_CHAT_WIZARD';

/**
 * Returns true when ENABLE_PROSPECT_CHAT_WIZARD is exactly "true"
 * (case-insensitive, leading/trailing whitespace ignored).
 *
 * A1-LEGACY-PATH-FENCE-1 (P0): this flag was previously read in
 * prospects-module-panel with a strict `process.env.X === 'true'`, so the values
 * `"TRUE"`, `" true"` and `"true\n"` read as OFF in the panel. Combined with the
 * old resolver — which degraded to the legacy Apollo form whenever the wizard
 * looked disabled — a whitespace/case variant in the environment was enough to
 * silently route a search to legacy Apollo. The flag is declared `sensitive` in
 * Vercel, so its literal value is not recoverable from outside; the deployed
 * code must therefore interpret ANY value correctly rather than assume one.
 * Default: false (absent or invalid value ⇒ OFF, fail-closed).
 */
export function isProspectChatWizardEnabled(): boolean {
  return process.env[PROSPECT_CHAT_WIZARD_FLAG]?.trim().toLowerCase() === 'true';
}

/** Flag name constant for the catalog-driven exploratory search form (v2). */
export const EXPLORATORY_SEARCH_FORM_V2_FLAG =
  'ENABLE_EXPLORATORY_SEARCH_FORM_V2';

/**
 * Returns true when ENABLE_EXPLORATORY_SEARCH_FORM_V2 is exactly "true"
 * (case-insensitive, leading/trailing whitespace ignored).
 *
 * Same canonical-parser rationale as isProspectChatWizardEnabled.
 * Default: false, fail-closed.
 */
export function isExploratorySearchFormV2Enabled(): boolean {
  return (
    process.env[EXPLORATORY_SEARCH_FORM_V2_FLAG]?.trim().toLowerCase() === 'true'
  );
}

/** Flag name constant for the legacy Apollo prospect generation capability. */
export const LEGACY_APOLLO_PROSPECT_GENERATION_FLAG =
  'ENABLE_LEGACY_APOLLO_PROSPECT_GENERATION';

/**
 * Returns true when ENABLE_LEGACY_APOLLO_PROSPECT_GENERATION is exactly "true"
 * (case-insensitive, leading/trailing whitespace ignored).
 *
 * A1-LEGACY-PATH-FENCE-1 (P0) — server-side capability gate for
 * `generateAIProspectBatch`, the legacy Agente 1 company-discovery action. That
 * action used to be reachable implicitly: a failed industry catalog load became
 * `catalog=null`, which the experience resolver turned into `legacy`, which
 * rendered the legacy form, whose CTA called this action and spent up to 25
 * Apollo credits per click with no reservation, no spend confirmation and no
 * idempotency.
 *
 * With this flag OFF (the default, and the value in every environment as of this
 * milestone) the action returns a typed `legacy_path_blocked` result BEFORE any
 * batch creation, agent run, IA call, provider call, billing or usage logging:
 * zero writes, zero provider calls, zero credits.
 *
 * This is a capability gate, NOT a routing switch: turning it on does not enable
 * Apollo. The legacy Apollo branch additionally requires
 * ENABLE_APOLLO_COMPANY_SEARCH (see isApolloCompanySearchEnabled), which is
 * enforced authoritatively at runtime immediately before each Apollo call.
 *
 * Never exposed to the client and never accepted from client-supplied input:
 * no `source`, `origin` or `legacyAllowed` field can substitute for it.
 * Must not be enabled in any environment by this milestone.
 */
export function isLegacyApolloProspectGenerationEnabled(): boolean {
  return (
    process.env[LEGACY_APOLLO_PROSPECT_GENERATION_FLAG]
      ?.trim()
      .toLowerCase() === 'true'
  );
}

/** Flag name constant for post-approval source enrichment. */
export const POST_APPROVAL_SOURCE_ENRICHMENT_FLAG =
  'ENABLE_POST_APPROVAL_SOURCE_ENRICHMENT';

/**
 * Returns true when ENABLE_POST_APPROVAL_SOURCE_ENRICHMENT is "true".
 * Default: false. NIT-first strategy only. No LinkedIn, no Tavily, no LLM.
 */
export function isPostApprovalSourceEnrichmentEnabled(): boolean {
  return (
    process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG]?.trim().toLowerCase() ===
    'true'
  );
}

/** Flag name constant for the global commercial visibility scope layer. */
export const COMMERCIAL_SCOPE_FLAG = 'ENABLE_COMMERCIAL_SCOPE';

/**
 * Returns true when ENABLE_COMMERCIAL_SCOPE is "true".
 *
 * Default: false. When disabled (the production default), every operativa
 * surface behaves exactly as before: Empresas/Prospectos remain visible to all
 * active users and Uso de IA stays admin-only. When enabled, the commercial
 * scope layer (src/modules/access/commercial-scope.ts) restricts each surface
 * server-side by role + hierarchy: admin sees everything, líder/manager see
 * their group subtree and direct reports, vendedor/BD see only their own data.
 *
 * Gated so the rollout is reversible: it must be turned on only after the
 * role/group assignments in the live database have been verified, otherwise
 * users with unpopulated role/group data could lose visibility.
 */
export function isCommercialScopeEnabled(): boolean {
  return (
    process.env[COMMERCIAL_SCOPE_FLAG]?.trim().toLowerCase() === 'true'
  );
}

/** Flag name constant for controlled LinkedIn company URL search (v1.16K-R). */
export const LINKEDIN_COMPANY_SEARCH_FLAG = 'ENABLE_LINKEDIN_COMPANY_SEARCH';

/**
 * Returns true when ENABLE_LINKEDIN_COMPANY_SEARCH is "true".
 *
 * Default: false. When disabled (the production default), the writer pipeline
 * runs with NO LinkedIn company search override — i.e. zero Tavily calls and no
 * change in cost or behavior. When enabled, Agent 1's incremental search wires a
 * strictly-capped Tavily LinkedIn company search into the writer so company
 * pages can be resolved before human review. Real calls happen ONLY when this
 * flag is "true"; it is not enabled in any environment by this milestone.
 */
export function isLinkedInCompanySearchEnabled(): boolean {
  return (
    process.env[LINKEDIN_COMPANY_SEARCH_FLAG]?.trim().toLowerCase() === 'true'
  );
}

/** Flag name constant for Apollo company discovery in Agent 1 (v1.16K-W). */
export const APOLLO_COMPANY_SEARCH_FLAG = 'ENABLE_APOLLO_COMPANY_SEARCH';

/**
 * Returns true when ENABLE_APOLLO_COMPANY_SEARCH is "true".
 *
 * Default: false. When disabled (the production default), the apollo_organizations
 * provider returns a dry-run skipped output with zero cost and no API calls.
 * When enabled, real Apollo organization searches are wired into Agent 1's
 * discovery pipeline. Must not be enabled until pricing migration is applied
 * and the real Apollo API integration is validated.
 */
export function isApolloCompanySearchEnabled(): boolean {
  return (
    process.env[APOLLO_COMPANY_SEARCH_FLAG]?.trim().toLowerCase() === 'true'
  );
}

/** Flag name constant for Apollo Organization Enrichment cascade in Agent 1 (L2.15). */
export const APOLLO_ORGANIZATION_ENRICHMENT_CASCADE_FLAG =
  'ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE';

/**
 * Returns true when ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE is "true".
 *
 * Default: false. When disabled, Organization Search results flow directly to the
 * sector gate without enrichment — behavior is identical to L2.14.
 * When enabled, each search result with a resolvable domain is enriched via
 * Apollo's /organizations/enrich endpoint before the sector gate, giving the gate
 * richer signals (industry, keywords, descriptions, employee count).
 *
 * Hard cap: at most AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN enrichments per run
 * (env var, default 1, max 3). Must not be enabled until the enrichment pricing
 * entry (operation_key='organization_enrichment') is confirmed in production.
 */
export function isApolloOrganizationEnrichmentCascadeEnabled(): boolean {
  return (
    process.env[APOLLO_ORGANIZATION_ENRICHMENT_CASCADE_FLAG]
      ?.trim()
      .toLowerCase() === 'true'
  );
}

/**
 * Returns the max enrichments per run for the Organization Enrichment cascade.
 * Reads AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN; clamps to [1, 3].
 * Default: 1.
 */
export function resolveApolloMaxEnrichmentsPerRun(): number {
  const raw = process.env['AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN'];
  if (!raw) return 1;
  const parsed = parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 3); // hard cap 3
}

// ============================================================
// Lusha Contact Enrichment (Agente 2A · 17B)
// ============================================================

/** Flag name constant for the Lusha contact enrichment provider. */
export const LUSHA_CONTACT_ENRICHMENT_FLAG = 'ENABLE_LUSHA_CONTACT_ENRICHMENT';

/**
 * Returns true when ENABLE_LUSHA_CONTACT_ENRICHMENT is "true".
 *
 * Default: false. Lusha is a secondary/challenger provider behind this flag.
 * Apollo People Search remains the primary contact enrichment provider and must
 * not be affected by this flag. (Unrelated to Apollo Organizations company
 * discovery, which is a separate pipeline — see APOLLO_COMPANY_SEARCH_FLAG.)
 * Do not enable until the live integration (17B.4) is validated.
 */
export function isLushaContactEnrichmentEnabled(): boolean {
  return (
    process.env[LUSHA_CONTACT_ENRICHMENT_FLAG]?.trim().toLowerCase() === 'true'
  );
}

/**
 * Returns the max candidates per Lusha run.
 * Reads LUSHA_MAX_CANDIDATES_PER_RUN; clamps to [1, 10]. Default: 5.
 */
export function resolveLushaMaxCandidatesPerRun(): number {
  const raw = process.env['LUSHA_MAX_CANDIDATES_PER_RUN'];
  if (!raw) return 5;
  const parsed = parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 5;
  return Math.min(parsed, 10);
}

/**
 * Returns the Lusha API timeout in ms.
 * Reads LUSHA_SEARCH_TIMEOUT_MS; clamps to [5000, 60000]. Default: 20000.
 */
export function resolveLushaSearchTimeoutMs(): number {
  const raw = process.env['LUSHA_SEARCH_TIMEOUT_MS'];
  if (!raw) return 20_000;
  const parsed = parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 5_000) return 20_000;
  return Math.min(parsed, 60_000);
}

/**
 * Phone reveal is intentionally disabled for all Lusha calls in v1.
 * This function always returns false and must never be changed to read an env var.
 */
export function isLushaPhoneRevealEnabled(): false {
  return false;
}

// ============================================================
// Apollo Phone Reveal Recovery L2 cron (Agente 2A · RECOVERY-CRON-1)
// ============================================================

/** Flag name constant for the scheduled Apollo phone-reveal recovery (L2). */
export const APOLLO_PHONE_REVEAL_RECOVERY_CRON_FLAG =
  'ENABLE_APOLLO_PHONE_REVEAL_RECOVERY_CRON';

/**
 * Returns true when ENABLE_APOLLO_PHONE_REVEAL_RECOVERY_CRON is exactly "true"
 * (case-insensitive, leading/trailing whitespace ignored).
 *
 * Default: false, fail-closed. Gates ONLY the scheduled trigger of the already
 * merged recovery core (`/api/cron/phone-reveal-recovery`): with the flag OFF the
 * endpoint authenticates the caller and then returns 200 `disabled` without
 * selecting candidates, without the Apollo `webhook_result` GET and without any
 * write. Deploying this milestone therefore starts no polling by itself.
 *
 * When ON, each run recovers up to 5 (hard cap 10) Apollo reveals that stayed
 * in-flight for at least 15 minutes because the webhook never landed, with ONE GET
 * per candidate per run, no retry loop, no new reveal and 0 new credits — it only
 * reads a result a previously authorized reveal already produced. Unrelated to
 * ENABLE_APOLLO_PHONE_REVEAL (which gates the START, i.e. the creation of new
 * reveals) and to ENABLE_APOLLO_PHONE_CACHE. Suppression tombstones are enforced
 * inside the recovery core regardless of every one of these flags.
 */
export function isApolloPhoneRevealRecoveryCronEnabled(): boolean {
  return (
    process.env[APOLLO_PHONE_REVEAL_RECOVERY_CRON_FLAG]?.trim().toLowerCase() ===
    'true'
  );
}

// ============================================================
// Lusha Company Discovery Preview (Agente 1 · Q3F-5BB.3 / 10C2)
// ============================================================

/** Flag name constant for the Lusha "Generar con IA" company discovery preview. */
export const LUSHA_PREVIEW_FLAG = 'ENABLE_LUSHA_PREVIEW';

/**
 * Returns true when ENABLE_LUSHA_PREVIEW is exactly "true"
 * (case-insensitive, leading/trailing whitespace ignored).
 *
 * Default: false. This gates the whole Lusha company-discovery preview + the
 * "Buscar con IA" pending-review persistence. It was previously enforced ONLY in
 * the UI (see prospects-module-panel), which meant a direct call to the server
 * actions could still reach Lusha. Q3F-5BB.10C2 makes the gate authoritative
 * SERVER-SIDE: with the flag off, `previewLushaCompaniesAction` and
 * `generateLushaPendingReviewBatchAction` return a safe blocked result WITHOUT
 * building the Lusha client, running a search, or writing to the database. Must
 * not be enabled in any environment by this milestone.
 */
export function isLushaPreviewEnabled(): boolean {
  return process.env[LUSHA_PREVIEW_FLAG]?.trim().toLowerCase() === 'true';
}

// ============================================================
// Apollo Phone Reveal (Agente 2A · PHONE-3D.1)
// ============================================================

/** Flag name constant for explicit Apollo phone reveal (PHONE-3D.1). */
export const APOLLO_PHONE_REVEAL_FLAG = 'ENABLE_APOLLO_PHONE_REVEAL';

/**
 * Returns true when ENABLE_APOLLO_PHONE_REVEAL is exactly "true"
 * (case-insensitive, leading/trailing whitespace ignored).
 *
 * Default: false. This flag scaffolds the FUTURE explicit Apollo phone reveal.
 * As of PHONE-3D.1 it gates nothing at runtime: no route, server action, runner
 * or UI reads it, so enabling it has no effect and spends no credits. Automatic
 * completion, the Apollo runner and the routing fallback continue to omit
 * `reveal_phone_number` entirely (see contact-completion-adapter.buildMatchParams).
 * Real reveal remains blocked pending the legal/product decision (Habeas Data /
 * Ley 1581 / LOPDP). Unrelated to Lusha, whose phone reveal is hard-off
 * (see isLushaPhoneRevealEnabled). Must not be enabled in any environment by
 * this milestone.
 */
export function isApolloPhoneRevealEnabled(): boolean {
  return (
    process.env[APOLLO_PHONE_REVEAL_FLAG]?.trim().toLowerCase() === 'true'
  );
}

// ============================================================
// Apollo Phone Cache (Agente 2A · APOLLO-PHONE-CACHE-1b)
// ============================================================

/** Flag name constant for the Apollo phone reveal cache fast path. */
export const APOLLO_PHONE_CACHE_FLAG = 'ENABLE_APOLLO_PHONE_CACHE';

/**
 * Returns true when ENABLE_APOLLO_PHONE_CACHE is exactly "true"
 * (case-insensitive, leading/trailing whitespace ignored).
 *
 * Default: false, fail-closed. With the flag OFF (the production default) the
 * whole APOLLO-PHONE-CACHE-1b path is inert: no cache READ before an Apollo
 * reveal, no cache WRITE when a reveal/webhook/recovery lands, and therefore no
 * behavioural change whatsoever versus the pre-cache Apollo reveal — the core
 * short-circuits before touching the cache store.
 *
 * When ON, an Apollo phone reveal that was already paid for can be reused for
 * the SAME account and the SAME country for 90 days, at 0 credits, with
 * provenance `apollo_cache` and a mandatory lawful processing basis. Suppression
 * (hard delete + tombstone) works regardless of this flag so a DSAR is never
 * blocked by a flag being off.
 *
 * This milestone does NOT enable the flag in any environment.
 */
export function isApolloPhoneCacheEnabled(): boolean {
  return process.env[APOLLO_PHONE_CACHE_FLAG]?.trim().toLowerCase() === 'true';
}

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
 * Apollo remains the primary provider and must not be affected by this flag.
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

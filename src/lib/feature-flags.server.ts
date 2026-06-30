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

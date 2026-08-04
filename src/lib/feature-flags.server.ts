// Server-only: this module reads process.env and must never be imported from
// client components. The values are resolved at request time by server
// components and server actions, then sent to the client as plain booleans.

import { isEnvFlagEnabled } from '@/lib/env-flag-parser';

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
/**
 * A1-APOLLO-BUDGET-RECONCILIATION-1: routed through the canonical env parser so
 * this read and wizard-provider-resolver's can never drift apart — the provider
 * indicator and the code that spends credits must resolve the same flag the
 * same way. Behaviour is unchanged: only the exact token `true` enables Apollo.
 */
export function isApolloCompanySearchEnabled(): boolean {
  return isEnvFlagEnabled(process.env[APOLLO_COMPANY_SEARCH_FLAG]);
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
  // A1-APOLLO-BUDGET-RECONCILIATION-1: same canonical parser as the company
  // search flag. This flag also drives how many enrichment credits the wizard
  // reserves, so estimation and execution must read it identically.
  return isEnvFlagEnabled(process.env[APOLLO_ORGANIZATION_ENRICHMENT_CASCADE_FLAG]);
}

/**
 * Flag name constant for writing spend-correlation COLUMNS on
 * provider_usage_logs (A1-APOLLO-BUDGET-RECONCILIATION-1, migration 100).
 */
export const PROVIDER_USAGE_CORRELATION_COLUMNS_FLAG =
  'ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS';

/**
 * Returns true when ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS is "true".
 *
 * Default: false, and it must stay false until migration 100 has been applied —
 * writing a column that does not exist fails the whole insert, and usage
 * logging failing would lose the very spend record this milestone is about.
 *
 * The feature does NOT depend on this flag. The same correlation values are
 * always written to `metadata.run_correlation`, and the reconciliation reads
 * columns first, metadata second. Turning the flag on after the migration adds
 * indexable columns for new rows; historic rows keep answering from metadata,
 * so no backfill is needed.
 */
export function isProviderUsageCorrelationColumnsEnabled(): boolean {
  return isEnvFlagEnabled(process.env[PROVIDER_USAGE_CORRELATION_COLUMNS_FLAG]);
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

/**
 * Flag name constant for the Apollo two-round adaptive discovery modality
 * (A1-APOLLO-TWO-ROUND-QUALITY-1).
 */
export const APOLLO_TWO_ROUND_DISCOVERY_FLAG = 'ENABLE_APOLLO_TWO_ROUND_DISCOVERY';

/**
 * Returns true when ENABLE_APOLLO_TWO_ROUND_DISCOVERY is "true".
 *
 * Default: false. This flag governs the SHAPE of an Apollo run (two adaptive
 * rounds, target of five eligible companies, at most two enrichments) — it does
 * NOT authorise Apollo. ENABLE_APOLLO_COMPANY_SEARCH remains the kill switch:
 * with it off, no Apollo call happens whatever this flag says.
 *
 * Kept separate on purpose. Conflating "may Apollo run" with "how should an
 * Apollo run be shaped" would mean a routing experiment could silently switch
 * the provider on.
 */
export function isApolloTwoRoundDiscoveryEnabled(): boolean {
  return isEnvFlagEnabled(process.env[APOLLO_TWO_ROUND_DISCOVERY_FLAG]);
}

/**
 * Flag name constant for per-run discovery provider selection
 * (A1-APOLLO-TWO-ROUND-QUALITY-1 § 1).
 */
export const WIZARD_RUN_PROVIDER_OVERRIDE_FLAG =
  'ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE';

/**
 * Returns true when ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE is "true".
 *
 * Default: false. With it off, a per-run provider request is ignored and the
 * global default decides — exactly today's behaviour. The flag never widens who
 * may request a provider: the admin / internal-contract authorisation check
 * applies on top of it, not instead of it.
 */
export function isWizardRunProviderOverrideEnabled(): boolean {
  return isEnvFlagEnabled(process.env[WIZARD_RUN_PROVIDER_OVERRIDE_FLAG]);
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

// ============================================================
// Lusha Phone Reveal Fallback — SCAFFOLD ONLY (Agente 2A · LUSHA-PHONE-FALLBACK-1S)
// ============================================================

/** Flag name constant for the Lusha phone reveal fallback scaffold. */
export const LUSHA_PHONE_REVEAL_FALLBACK_FLAG =
  'ENABLE_LUSHA_PHONE_REVEAL_FALLBACK';

/**
 * Returns true when ENABLE_LUSHA_PHONE_REVEAL_FALLBACK is exactly "true"
 * (case-insensitive, leading/trailing whitespace ignored).
 *
 * Default: false, fail-closed. This flag does NOT replace, weaken or
 * substitute isLushaPhoneRevealEnabled(): false above — that hard, non-env
 * ban on phone reveal for the existing V3 email-only client (enrichLushaContactsV3)
 * stays exactly as-is and is unaffected by this flag in either state.
 *
 * This is a SEPARATE flag for a distinct action: a manual, single-candidate
 * Lusha phone reveal fallback, offered only after Apollo's own phone reveal
 * already returned `no_phone_found`. Approved internally as Legal/Compliance GO,
 * Product GO (manual fallback), Spend GO (conditioned), single-candidate,
 * non-bulk, non-automatic, no-retry, no HubSpot write.
 *
 * The senior Lusha support ticket that used to gate it RESOLVED on 2026-07-31:
 * `v1.`-prefixed V3 contact ids may be reused later for /v3/contacts/enrich, and
 * `reveal:["phones"]` needs no entitlement beyond Enrich Contacts access plus
 * credits. Accordingly `LUSHA_CONTACT_ID_REUSE_CONFIRMED` and
 * `LUSHA_PHONE_ENTITLEMENT_CONFIRMED` (lusha-phone-fallback-core.ts) are both
 * `true`, so `evaluateLushaPhoneFallbackEligibility` CAN now reach `eligible` —
 * the opposite of what this comment said while the ticket was open. A 403 in
 * practice is still handled fail-closed as `provider_permission_error`.
 *
 * STATUS (actualizado en AGENT2A-PHONE-REVEAL-UI-STATE-1 § 9 — el texto anterior
 * afirmaba que este flag no estaba configurado en ningún entorno de Vercel y que
 * ninguna ruta, server action o componente lo leía; las dos afirmaciones dejaron
 * de ser ciertas y describían el estado congelado de LUSHA-PHONE-FALLBACK-1S):
 *   * el flag SÍ está registrado en Vercel y el fallback manual de Lusha es una
 *     ruta VIVA en Producción cuando resuelve a `"true"` (LUSHA-PHONE-FALLBACK-1
 *     y su cap de créditos posterior);
 *   * lo leen server actions y UI reales — `lusha-phone-fallback-actions.ts`, el
 *     drawer de candidatos y la 2ª pata del waterfall —, así que cambiar su valor
 *     SÍ tiene efecto en vivo;
 *   * su valor concreto no se puede leer desde el código ni desde `vercel env ls`
 *     (`type: sensitive`): sólo se confirma en runtime.
 *
 * Lo que NO cambió: sigue siendo fail-closed y por defecto `false`, y con el flag
 * OFF toda función que lo lee evalúa a ineligible/disabled ANTES de cualquier
 * llamada de red. Tampoco debilita `isLushaPhoneRevealEnabled(): false`, ni
 * autoriza por sí solo ningún gasto: cada reveal exige además su autorización
 * explícita.
 */
export function isLushaPhoneRevealFallbackEnabled(): boolean {
  return isEnvFlagEnabled(process.env[LUSHA_PHONE_REVEAL_FALLBACK_FLAG]);
}

// ============================================================
// Apollo → Lusha phone reveal WATERFALL (Agente 2A · AGENT2A-PHONE-WATERFALL-1)
// ============================================================

/** Flag name constant for the Apollo → Lusha phone reveal waterfall. */
export const PHONE_REVEAL_WATERFALL_FLAG = 'ENABLE_PHONE_REVEAL_WATERFALL';

/**
 * Returns true when ENABLE_PHONE_REVEAL_WATERFALL is exactly "true"
 * (case-insensitive, leading/trailing whitespace ignored).
 *
 * Default: false, fail-closed. Nunca es un flag `NEXT_PUBLIC_*`: se resuelve
 * server-side y viaja al cliente solo como booleano, igual que
 * `isApolloPhoneRevealEnabled` / `isLushaPhoneRevealFallbackEnabled`.
 *
 * PRESENCIA (verificado 2026-08-04, AGENT2A-PHONE-REVEAL-UI-STATE-1): la variable
 * SÍ está registrada en el entorno Production de Vercel. El texto anterior decía
 * «NOT configured in any environment as of AGENT2A-PHONE-WATERFALL-1» y dejó de ser
 * cierto.
 *
 * Estar registrada NO significa estar encendida: el registro es `Encrypted`, así que
 * su valor es ilegible desde el código y desde `vercel env ls`, y cualquier valor que
 * no sea exactamente `"true"` deja el waterfall APAGADO. Confirmar el estado real
 * exige runtime: GET /api/debug/agent2a-phone-waterfall-config (admin-only) publica
 * `phone_reveal_waterfall_flag_configured` y
 * `phone_reveal_waterfall_enabled_resolved` por separado justamente para que
 * «listada» y «activa» no se confundan. No dar por supuesto ninguno de los dos.
 *
 * What it turns on: ONE operator click on "Revelar teléfono" authorizes a
 * two-leg reveal — Apollo first and, only if Apollo terminates as
 * `no_phone_found`, Lusha automatically underneath, with no second click and no
 * second modal. Admin-only; `commercial_manager` keeps the Apollo-only flow.
 *
 * What it does NOT change in either state:
 *   * `isLushaPhoneRevealEnabled(): false` — the hard, non-env ban on phone
 *     reveal for the V3 email-only client (enrichLushaContactsV3) is untouched.
 *   * `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK` — still the flag that authorizes any
 *     Lusha phone reveal at all. This flag only automates WHEN that already
 *     authorized fallback runs; with the fallback flag OFF the Lusha leg is
 *     `feature_disabled` no matter what this flag says. Both must be ON.
 *   * `ENABLE_APOLLO_PHONE_REVEAL` — still the flag that authorizes creating an
 *     Apollo reveal at all.
 *
 * With this flag OFF the waterfall path is inert: no run row is created, the
 * continuation hooks are never wired into the webhook / recovery cores, and the
 * UI renders exactly the pre-waterfall controls (Apollo reveal + the separate
 * manual Lusha button when it applies).
 */
export function isPhoneRevealWaterfallEnabled(): boolean {
  return isEnvFlagEnabled(process.env[PHONE_REVEAL_WATERFALL_FLAG]);
}

/**
 * ¿Existe la variable `ENABLE_PHONE_REVEAL_WATERFALL` en este runtime?
 *
 * PRESENCIA, no valor (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 11). Devuelve `true`
 * cuando la variable está definida y no está vacía, sin revelar su contenido.
 * Existe porque «configurada» y «resuelta como activa» son preguntas distintas y
 * confundirlas es lo que hace imposible diagnosticar el estado real: una variable
 * presente con un valor que no sea exactamente `"true"` deja el waterfall APAGADO,
 * y sin este par de señales ese caso es indistinguible de la variable ausente.
 *
 * En Vercel los flags son `type: sensitive`: su valor es ilegible para siempre
 * (ni la API con `?decrypt=true` lo devuelve), así que `vercel env ls` sólo prueba
 * presencia. Este helper es el equivalente en runtime de esa comprobación, y el
 * endpoint de diagnóstico lo publica JUNTO a `isPhoneRevealWaterfallEnabled()`
 * para que el operador pueda distinguir los tres casos: ausente, presente-pero-no-
 * `"true"`, y presente-y-activa.
 *
 * Nunca devuelve, registra ni deriva el valor crudo — sólo su longitud tras
 * `trim()`, reducida a un booleano.
 */
export function isPhoneRevealWaterfallFlagConfigured(): boolean {
  const raw = process.env[PHONE_REVEAL_WATERFALL_FLAG];
  return typeof raw === 'string' && raw.trim().length > 0;
}

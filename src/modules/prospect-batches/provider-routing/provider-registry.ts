/**
 * Q3F-5BB.11B — Declarative provider capability registry.
 *
 * A DATA-ONLY description of every discovery provider the wizard can route to.
 * The resolver reads these descriptors; nothing here reads env, calls a
 * provider, or performs I/O. Coverage / cost values reflect the constraints
 * documented in the Q3F-5BB.11A design and the existing provider modules; they
 * are intentionally conservative and additive-only.
 *
 * Sources for the encoded values (documented, not imported at runtime to keep
 * this module pure):
 *   - Lusha: 1 credit / page, 10 results / credit, MAX_PAGES = 2,
 *     EXPECTED_MAX_CREDITS = 2, USD price NOT authorized (unknown). Coverage is
 *     a narrow allowlist (3 mapped sectors, ~20 countries) — see
 *     lusha-sector-mapping / lusha-preview. Encoded as explicit allowlists so a
 *     non-covered search never silently "matches" Lusha.
 *   - Apollo (organizations): 1 credit / result, MAX = 10, ~$0.00875 / credit,
 *     no country allowlist, industry by keywords. `fallbackEligible = false`
 *     enforces the 10C3 invariant at the registry level.
 *   - Tavily / Web AI: no hard cap declared, USD cost pending provider pricing
 *     config (unknown). Coverage unrestricted.
 */

import {
  COVERAGE_ALL,
  type ProviderCapabilityDescriptor,
  type ProviderCapabilityRegistry,
} from './types';

/**
 * Lusha-supported sector keys (narrow allowlist). Mirrors the mapped sectors in
 * `lusha-sector-mapping`; kept as a literal here so this module stays pure. If
 * the live mapping grows, this list is widened in a follow-up — never silently.
 */
const LUSHA_SUPPORTED_SECTORS = [
  'healthcare',
  'education',
  'technology',
] as const;

/**
 * Lusha-supported ISO2 countries (representative allowlist). The authoritative
 * list lives in `lusha-preview`; encoded conservatively here. A search whose
 * country is not in this list does not match Lusha at the registry level.
 */
const LUSHA_SUPPORTED_COUNTRIES = [
  'CO', 'MX', 'AR', 'CL', 'PE', 'BR', 'EC', 'US', 'CA', 'ES',
  'GB', 'DE', 'FR', 'IT', 'PT', 'NL', 'BE', 'IE', 'AU', 'IN',
] as const;

const LUSHA_DESCRIPTOR: ProviderCapabilityDescriptor = {
  id: 'lusha',
  label: 'Lusha',
  enabledFlag: 'ENABLE_LUSHA_PREVIEW',
  canRunInProduction: true,
  canRunInPreview: true,
  supportsCompanySearch: true,
  supportsPeopleSearch: true,
  supportsEnrichment: true,
  supportedCountries: LUSHA_SUPPORTED_COUNTRIES,
  supportedIndustries: LUSHA_SUPPORTED_SECTORS,
  requiredCriteria: ['searchType', 'sector', 'countryCode'],
  costModel: {
    creditsPerUnit: 1,
    resultsPerCredit: 10,
    maxBillableUnits: 2,
    expectedMaxCredits: 2,
    unitCostUsd: null, // USD pricing not authorized → unknown, never 0.
    currency: 'USD',
    pricingStatus: 'unknown',
  },
  // Lusha is never an automatic fallback target: it is only ever a deliberate,
  // eligibility-gated PRIMARY. (Lusha → Tavily is not automatic — 11A decision.)
  fallbackEligible: false,
  riskLevel: 'medium',
};

const APOLLO_DESCRIPTOR: ProviderCapabilityDescriptor = {
  id: 'apollo',
  label: 'Apollo',
  enabledFlag: 'ENABLE_APOLLO_COMPANY_SEARCH',
  canRunInProduction: true,
  canRunInPreview: true,
  supportsCompanySearch: true,
  supportsPeopleSearch: true,
  supportsEnrichment: true,
  supportedCountries: COVERAGE_ALL,
  supportedIndustries: COVERAGE_ALL,
  requiredCriteria: ['searchType'],
  costModel: {
    creditsPerUnit: 1,
    resultsPerCredit: 1,
    maxBillableUnits: 10,
    expectedMaxCredits: 10,
    unitCostUsd: 0.00875,
    currency: 'USD',
    pricingStatus: 'known',
  },
  // HARD 10C3 GUARANTEE: Apollo may NEVER be an automatic fallback target. A
  // Lusha intent must never fall through to Apollo, and no silent Apollo
  // fall-through is allowed anywhere. Apollo can only ever be an explicit,
  // config-permitted default_ai primary.
  fallbackEligible: false,
  riskLevel: 'high',
};

const TAVILY_DESCRIPTOR: ProviderCapabilityDescriptor = {
  id: 'tavily',
  label: 'Tavily / Web AI',
  enabledFlag: 'AGENT1_WIZARD_DISCOVERY_PROVIDER',
  canRunInProduction: true,
  canRunInPreview: true,
  supportsCompanySearch: true,
  supportsPeopleSearch: false,
  supportsEnrichment: false,
  supportedCountries: COVERAGE_ALL,
  supportedIndustries: COVERAGE_ALL,
  requiredCriteria: ['searchType'],
  costModel: {
    creditsPerUnit: null,
    resultsPerCredit: null,
    maxBillableUnits: null,
    expectedMaxCredits: null,
    unitCostUsd: null, // pending_provider_pricing_config → unknown, never 0.
    currency: 'USD',
    pricingStatus: 'pending_provider_pricing_config',
  },
  fallbackEligible: true,
  riskLevel: 'medium',
};

/**
 * `web_ai` is reserved as a distinct provider id in the intake vocabulary but
 * has no real routing path yet. It is declared DISABLED-by-capability
 * (cannot run in any environment) so it never accidentally becomes selectable.
 * When a real Web AI path exists this descriptor is filled in.
 */
const WEB_AI_DESCRIPTOR: ProviderCapabilityDescriptor = {
  id: 'web_ai',
  label: 'Web AI (reserved)',
  enabledFlag: null,
  canRunInProduction: false,
  canRunInPreview: false,
  supportsCompanySearch: false,
  supportsPeopleSearch: false,
  supportsEnrichment: false,
  supportedCountries: [],
  supportedIndustries: [],
  requiredCriteria: ['searchType'],
  costModel: {
    creditsPerUnit: null,
    resultsPerCredit: null,
    maxBillableUnits: null,
    expectedMaxCredits: null,
    unitCostUsd: null,
    currency: 'USD',
    pricingStatus: 'unknown',
  },
  fallbackEligible: false,
  riskLevel: 'high',
};

/** The default, frozen provider registry. */
export const DEFAULT_PROVIDER_REGISTRY: ProviderCapabilityRegistry = Object.freeze({
  lusha: LUSHA_DESCRIPTOR,
  apollo: APOLLO_DESCRIPTOR,
  tavily: TAVILY_DESCRIPTOR,
  web_ai: WEB_AI_DESCRIPTOR,
});

/** Pure lookup helper. Returns `undefined` for an unknown provider id. */
export function getProviderDescriptor(
  registry: ProviderCapabilityRegistry,
  id: string,
): ProviderCapabilityDescriptor | undefined {
  return registry[id as keyof typeof registry];
}

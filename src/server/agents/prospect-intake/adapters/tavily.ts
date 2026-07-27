/**
 * Q3F-5BB.10B1 — Tavily / Web AI → ProviderDiscoveredCompany adapter (PURE).
 *
 * Maps a web-discovered company (as produced by the Tavily / Web AI prospecting
 * pipeline + candidate writer) into the common intake shape. It does NOT import
 * the Tavily client, does NOT call Tavily, and does NOT touch the candidate
 * writer. The `provider` label defaults to `web_ai` and can be set to `tavily`
 * via context when the discovery came straight from a Tavily result.
 */

import type {
  ProspectIntakeProvider,
  ProviderAdapterContext,
  ProviderDiscoveredCompany,
} from '../types';

/** Structural, permissive shape of a web/Tavily-discovered company. */
export interface WebAiRawCompany {
  companyName?: string | null;
  name?: string | null;
  inferredName?: string | null;
  website?: string | null;
  websiteUrl?: string | null;
  url?: string | null;
  domain?: string | null;
  sourceUrl?: string | null;
  snippet?: string | null;
  description?: string | null;
  country?: string | null;
  countryCode?: string | null;
  industry?: string | null;
  sector?: string | null;
  employeeCount?: number | null;
  linkedin?: string | null;
  linkedinUrl?: string | null;
  confidence?: number | null;
  sourceConfidence?: number | null;
}

/** Context for the web adapter: lets the caller distinguish tavily vs web_ai. */
export interface WebAiAdapterContext extends ProviderAdapterContext {
  provider?: Extract<ProspectIntakeProvider, 'tavily' | 'web_ai'>;
}

export function mapWebAiCompanyToProviderDiscoveredCompany(
  raw: WebAiRawCompany,
  context: WebAiAdapterContext = {},
): ProviderDiscoveredCompany {
  const provider = context.provider ?? 'web_ai';
  const companyName = raw.companyName ?? raw.name ?? raw.inferredName ?? null;

  return {
    provider,
    providerRequestId: context.requestId ?? null,

    companyName,
    websiteUrl: raw.websiteUrl ?? raw.website ?? raw.url ?? null,
    domain: raw.domain ?? null,
    linkedinUrl: raw.linkedinUrl ?? raw.linkedin ?? null,

    country: raw.country ?? null,
    countryCode: raw.countryCode ?? null,

    industry: raw.industry ?? raw.sector ?? null,

    employeeCount: raw.employeeCount ?? null,

    description: raw.description ?? raw.snippet ?? null,
    sourceUrl: raw.sourceUrl ?? raw.url ?? null,
    sourceConfidence: raw.sourceConfidence ?? raw.confidence ?? null,

    searchCriteria: context.searchCriteria
      ? { ...(context.searchCriteria.rawWizardCriteriaSafe ?? {}) }
      : undefined,

    // Safe metadata only — never a raw web/Tavily payload dump.
    providerMetadataSafe: {
      provider,
      endpoint: 'web_discovery',
      shapeVersion: 'web_ai.company.v1',
    },
  };
}

// Agente 2A — Contact Enrichment Toolkit Types (server-side)
// Hito 17A.1

// Re-exporta tipos compartidos para evitar duplicación
export type {
  Agent2AInput,
  CompanyCandidate,
  CompanyResolutionResult,
  ContactEnrichmentRunResult,
  ContactEnrichmentRunStatus,
  ContactCandidateStatus,
  ContactDuplicateStatus,
  ContactSource,
  ContactSeniority,
  ContactEnrichmentProviderResult,
  ContactEnrichmentSummary,
} from '@/modules/contact-enrichment/types';

// Tipos internos del toolkit — no expuestos al módulo de cliente

export interface SellUpAccountMatch {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  country_code: string | null;
  hubspot_company_id: string | null;
  linkedin_url?: string | null;
}

export interface HubSpotCompanyMatch {
  id: string;
  name: string | null;
  domain: string | null;
  website: string | null;
}

export interface CompanyResolverDeps {
  searchSellUpByAccountId?: (id: string) => Promise<SellUpAccountMatch | null>;
  searchSellUpByHubSpotId?: (hsId: string) => Promise<SellUpAccountMatch[]>;
  searchSellUpByDomain?: (domain: string) => Promise<SellUpAccountMatch[]>;
  searchSellUpByName?: (name: string) => Promise<SellUpAccountMatch[]>;
  searchHubSpot?: (opts: {
    domain?: string;
    name?: string;
  }) => Promise<HubSpotCompanyMatch[]>;
}

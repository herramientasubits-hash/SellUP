/**
 * Q3F-5BB.10B1 — Apollo → ProviderDiscoveredCompany adapter (PURE).
 *
 * Maps an Apollo organization from `mixed_companies/search` into the common
 * intake shape. This adapter is firmographic-only: it uses the ORGANIZATION
 * search endpoint, NEVER People Search. It does not import the Apollo runtime,
 * does not call Apollo, and does not touch
 * `apollo-organization-enrichment-cascade.ts`.
 */

import type { ProviderAdapterContext, ProviderDiscoveredCompany } from '../types';

/** Structural, permissive shape of an Apollo organization (no runtime import). */
export interface ApolloRawOrganization {
  id?: string | null;
  organization_id?: string | null;
  name?: string | null;
  website_url?: string | null;
  domain?: string | null;
  primary_domain?: string | null;
  linkedin_url?: string | null;
  industry?: string | null;
  estimated_num_employees?: number | null;
  employee_range?: string | null;
  organization_num_employees_ranges?: string[] | null;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  organization_naics_codes?: string[] | null;
  organization_sic_codes?: string[] | null;
  short_description?: string | null;
}

function firstRange(ranges: string[] | null | undefined): string | null {
  return Array.isArray(ranges) && ranges.length > 0 ? ranges[0] : null;
}

export function mapApolloCompanyToProviderDiscoveredCompany(
  raw: ApolloRawOrganization,
  context: ProviderAdapterContext = {},
): ProviderDiscoveredCompany {
  const naics = Array.isArray(raw.organization_naics_codes)
    ? raw.organization_naics_codes.map((code) => String(code))
    : undefined;
  const sic = Array.isArray(raw.organization_sic_codes)
    ? raw.organization_sic_codes.map((code) => String(code))
    : undefined;
  const industryCodes = naics || sic ? { ...(naics ? { naics } : {}), ...(sic ? { sic } : {}) } : undefined;

  return {
    provider: 'apollo',
    providerRecordId: raw.id ?? raw.organization_id ?? null,
    providerRequestId: context.requestId ?? null,

    companyName: raw.name ?? null,
    websiteUrl: raw.website_url ?? null,
    domain: raw.primary_domain ?? raw.domain ?? null,
    linkedinUrl: raw.linkedin_url ?? null,

    country: raw.country ?? null,
    region: raw.state ?? null,
    city: raw.city ?? null,

    industry: raw.industry ?? null,
    industryCodes,

    employeeCount: raw.estimated_num_employees ?? null,
    employeeRange: raw.employee_range ?? firstRange(raw.organization_num_employees_ranges),

    description: raw.short_description ?? null,

    searchCriteria: context.searchCriteria
      ? { ...(context.searchCriteria.rawWizardCriteriaSafe ?? {}) }
      : undefined,

    // Safe metadata only — never a raw Apollo payload dump.
    providerMetadataSafe: {
      provider: 'apollo',
      endpoint: 'mixed_companies/search',
      shapeVersion: 'apollo.organization.v1',
    },
  };
}

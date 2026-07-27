/**
 * Q3F-5BB.10B1 — Lusha → ProviderDiscoveredCompany adapter (PURE).
 *
 * Maps a Lusha company-prospecting record into the common intake shape. Does NOT
 * import the Lusha runtime client, does NOT call Lusha, and does NOT touch
 * `lusha-pending-review.ts` / `lusha-preview.ts`. The input type is a permissive
 * structural shape so this stays decoupled from provider SDK internals.
 */

import type { ProviderAdapterContext, ProviderDiscoveredCompany } from '../types';

/** Structural, permissive shape of a Lusha company record (no runtime import). */
export interface LushaRawCompany {
  id?: string | number | null;
  requestId?: string | null;
  name?: string | null;
  domain?: string | null;
  fqdn?: string | null;
  website?: string | null;
  linkedin?: string | null;
  social?: { linkedin?: string | null } | null;
  socialLinks?: { linkedin?: string | null } | null;
  employees?: number | null;
  employeeCount?: number | null;
  industry?: string | null;
  mainIndustry?: string | null;
  mainIndustriesIds?: (string | number)[] | null;
  description?: string | null;
  location?: {
    country?: string | null;
    countryCode?: string | null;
    city?: string | null;
    state?: string | null;
    region?: string | null;
  } | null;
  country?: string | null;
  countryCode?: string | null;
}

function toStringId(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

export function mapLushaCompanyToProviderDiscoveredCompany(
  raw: LushaRawCompany,
  context: ProviderAdapterContext = {},
): ProviderDiscoveredCompany {
  const linkedinUrl = raw.linkedin ?? raw.social?.linkedin ?? raw.socialLinks?.linkedin ?? null;

  const providerIndustryIds = Array.isArray(raw.mainIndustriesIds)
    ? raw.mainIndustriesIds.map((id) => String(id))
    : undefined;

  return {
    provider: 'lusha',
    providerRecordId: toStringId(raw.id),
    providerRequestId: context.requestId ?? raw.requestId ?? null,

    companyName: raw.name ?? null,
    websiteUrl: raw.website ?? null,
    domain: raw.domain ?? raw.fqdn ?? null,
    linkedinUrl,

    country: raw.location?.country ?? raw.country ?? null,
    countryCode: raw.location?.countryCode ?? raw.countryCode ?? null,
    region: raw.location?.state ?? raw.location?.region ?? null,
    city: raw.location?.city ?? null,

    industry: raw.industry ?? raw.mainIndustry ?? null,
    industryCodes: providerIndustryIds ? { providerIndustryIds } : undefined,

    employeeCount: raw.employeeCount ?? raw.employees ?? null,

    description: raw.description ?? null,

    searchCriteria: context.searchCriteria
      ? { ...(context.searchCriteria.rawWizardCriteriaSafe ?? {}) }
      : undefined,

    // Safe metadata only — never a raw Lusha payload dump.
    providerMetadataSafe: {
      provider: 'lusha',
      endpoint: 'company/prospecting',
      shapeVersion: 'lusha.company.v1',
    },
  };
}

import type {
  FedesoftCompany,
  FedesoftDirectoryListing,
  FedesoftMember,
  FedesoftConnectorResult,
} from './types';
import { FEDESOFT_SOURCE_KEY, FEDESOFT_COUNTRY_CODE } from './types';
import { normalizeFedesoftCompanyName, normalizeFedesoftNit } from './normalizers';

export interface BuildFedesoftCompaniesInput {
  listings: FedesoftDirectoryListing[];
  members: FedesoftMember[];
  categoriesById: Map<number, string>;
  locationsById: Map<number, string>;
}

export function buildFedesoftCompanies(input: BuildFedesoftCompaniesInput): FedesoftCompany[] {
  const { listings, members, categoriesById, locationsById } = input;

  const memberIndex = buildMemberIndex(members);
  const seenByTaxId = new Set<string>();
  const seenByName = new Set<string>();
  const companies: FedesoftCompany[] = [];

  for (const listing of listings) {
    const name = typeof listing.title === 'string' ? listing.title.trim() : typeof listing.title === 'object' && listing.title !== null ? String((listing.title as Record<string, unknown>).rendered ?? listing.title).trim() : (listing.slug || '');
    if (!name) continue;

    const normalizedName = normalizeFedesoftCompanyName(name);
    const member = memberIndex.get(normalizedName);

    let taxId: string | null = null;
    let normalizedTaxId: string | null = null;
    let matchSource: FedesoftCompany['matchSource'] = 'directory_only';
    let joinConfidence: FedesoftCompany['joinConfidence'] = 'none';
    let memberType: string | null = null;

    if (member) {
      taxId = member.taxId;
      normalizedTaxId = taxId ? normalizeFedesoftNit(taxId) : null;
      matchSource = 'directory_and_member_table';
      joinConfidence = 'exact_normalized_name';
      memberType = member.memberType;
    }

    const company: FedesoftCompany = {
      sourceKey: FEDESOFT_SOURCE_KEY,
      countryCode: FEDESOFT_COUNTRY_CODE,

      name,
      normalizedName,

      taxId,
      normalizedTaxId,

      fedesoftDirectoryUrl: listing.link || null,
      fedesoftSlug: listing.slug || null,

      memberType,

      categoryIds: listing.at_biz_dir_category || [],
      categories: resolveNames(listing.at_biz_dir_category || [], categoriesById),

      locationIds: listing.at_biz_dir_location || [],
      locations: resolveNames(listing.at_biz_dir_location || [], locationsById),

      date: listing.date || null,
      modified: listing.modified || null,

      matchSource,
      joinConfidence,

      metadata: {
        directoryId: listing.id,
        tags: listing.tags,
        rawDirectoryRecord: listing,
      },
    };

    addUnique(companies, company, seenByTaxId, seenByName);
  }

  for (const member of members) {
    const normalizedName = normalizeFedesoftCompanyName(member.companyName);
    const alreadyExists = listings.some((l) => {
      const listingName = typeof l.title === 'string' ? l.title.trim() : typeof l.title === 'object' && l.title !== null ? String((l.title as Record<string, unknown>).rendered ?? l.title) : (l.slug || '');
      return normalizeFedesoftCompanyName(listingName) === normalizedName;
    });
    if (alreadyExists) continue;

    const taxId = member.taxId;
    const normalizedTaxId = taxId ? normalizeFedesoftNit(taxId) : null;

    const company: FedesoftCompany = {
      sourceKey: FEDESOFT_SOURCE_KEY,
      countryCode: FEDESOFT_COUNTRY_CODE,

      name: member.companyName,
      normalizedName,

      taxId,
      normalizedTaxId,

      fedesoftDirectoryUrl: null,
      fedesoftSlug: null,

      memberType: member.memberType,

      categoryIds: [],
      categories: [],

      locationIds: [],
      locations: [],

      date: null,
      modified: null,

      matchSource: 'member_table_only',
      joinConfidence: 'none',

      metadata: {
        rawMemberRecord: member,
      },
    };

    addUnique(companies, company, seenByTaxId, seenByName);
  }

  return companies;
}

function buildMemberIndex(members: FedesoftMember[]): Map<string, FedesoftMember> {
  const index = new Map<string, FedesoftMember>();
  for (const member of members) {
    const key = normalizeFedesoftCompanyName(member.companyName);
    if (!key) continue;
    if (!index.has(key)) {
      index.set(key, member);
    }
  }
  return index;
}

function resolveNames(ids: number[], map: Map<number, string>): string[] {
  return ids.map((id) => map.get(id) ?? '').filter((n) => n.length > 0);
}

function addUnique(
  companies: FedesoftCompany[],
  company: FedesoftCompany,
  seenByTaxId: Set<string>,
  seenByName: Set<string>,
): void {
  const taxKey = company.normalizedTaxId;
  if (taxKey) {
    if (seenByTaxId.has(taxKey)) return;
    seenByTaxId.add(taxKey);
  }

  const nameKey = company.normalizedName;
  if (seenByName.has(nameKey)) return;
  seenByName.add(nameKey);

  companies.push(company);
}

export async function runFedesoftConnector(options?: {
  perPage?: number;
  maxPages?: number;
  signal?: AbortSignal;
}): Promise<FedesoftConnectorResult> {
  const { fetchFedesoftDirectoryListings, fetchFedesoftCategories, fetchFedesoftLocations, fetchFedesoftMembersTable } = await import('./fedesoft-client');

  const [listings, categoriesById, locationsById, members] = await Promise.all([
    fetchFedesoftDirectoryListings({ ...options }),
    fetchFedesoftCategories({ signal: options?.signal }),
    fetchFedesoftLocations({ signal: options?.signal }),
    fetchFedesoftMembersTable({ signal: options?.signal }),
  ]);

  const companies = buildFedesoftCompanies({ listings, members, categoriesById, locationsById });

  return {
    listings,
    members,
    categoriesById,
    locationsById,
    companies,
  };
}

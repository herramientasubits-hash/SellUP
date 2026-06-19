export type FedesoftSourceKey = 'co_fedesoft';
export const FEDESOFT_SOURCE_KEY: FedesoftSourceKey = 'co_fedesoft';
export const FEDESOFT_COUNTRY_CODE = 'CO';

export interface FedesoftDirectoryListing {
  id: number;
  slug: string;
  title: string | { rendered: string; raw?: string };
  date: string;
  modified: string;
  type: string;
  link: string;
  at_biz_dir_category: number[];
  at_biz_dir_location: number[];
  tags?: number[];
  meta?: Record<string, unknown>;
}

export interface FedesoftMember {
  memberType: string;
  taxId: string | null;
  companyName: string;
}

export interface FedesoftTaxonomyEntry {
  id: number;
  name: string;
  slug: string;
}

export type FedesoftMatchSource =
  | 'directory_and_member_table'
  | 'directory_only'
  | 'member_table_only';

export type FedesoftJoinConfidence = 'exact_normalized_name' | 'none';

export interface FedesoftCompany {
  sourceKey: FedesoftSourceKey;
  countryCode: 'CO';

  name: string;
  normalizedName: string;

  taxId: string | null;
  normalizedTaxId: string | null;

  fedesoftDirectoryUrl: string | null;
  fedesoftSlug: string | null;

  memberType: string | null;

  categoryIds: number[];
  categories: string[];

  locationIds: number[];
  locations: string[];

  date: string | null;
  modified: string | null;

  matchSource: FedesoftMatchSource;
  joinConfidence: FedesoftJoinConfidence;

  metadata: {
    directoryId?: number;
    tags?: number[];
    rawDirectoryRecord?: unknown;
    rawMemberRecord?: unknown;
  };
}

export interface FedesoftConnectorResult {
  listings: FedesoftDirectoryListing[];
  members: FedesoftMember[];
  categoriesById: Map<number, string>;
  locationsById: Map<number, string>;
  companies: FedesoftCompany[];
}

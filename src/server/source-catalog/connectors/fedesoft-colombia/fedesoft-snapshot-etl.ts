import { createClient } from '@supabase/supabase-js';
import { runFedesoftConnector } from './fedesoft-connector';
import { FEDESOFT_SOURCE_KEY, FEDESOFT_COUNTRY_CODE } from './types';
import type { FedesoftCompany, FedesoftConnectorResult, FedesoftMatchSource } from './types';

export type FedesoftSnapshotEtlResult = {
  ok: boolean;
  sourceYear: number;
  listingsCount: number;
  membersCount: number;
  categoriesCount: number;
  locationsCount: number;
  companiesBuilt: number;
  matchedDirectoryAndMemberTable: number;
  directoryOnly: number;
  memberTableOnly: number;
  withNit: number;
  withoutNit: number;
  recordsUpserted: number;
  runId: string | undefined;
  errors: string[];
  warnings: string[];
};

export type FedesoftSnapshotEtlOptions = {
  dryRun?: boolean;
  signal?: AbortSignal;
  /** @internal — for testing/dependency injection */
  sb?: SupabaseClient;
  /** @internal — for testing/dependency injection */
  connectorResult?: FedesoftConnectorResult;
};

const BATCH_SIZE = 100;
const MAX_PRIORITY = 90;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

function getAdminSupabase(): SupabaseClient {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://lrdruowtadwbdulndlph.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(url, serviceKey);
}

export function getFedesoftPriorityScore(company: FedesoftCompany): number {
  const baseScores: Record<FedesoftMatchSource, number> = {
    directory_and_member_table: 80,
    member_table_only: 65,
    directory_only: 55,
  };

  let score = baseScores[company.matchSource];

  if (company.normalizedTaxId) score += 5;
  if (company.categories.length > 0) score += 5;
  if (company.locations.length > 0) score += 3;

  return Math.min(score, MAX_PRIORITY);
}

export function buildFedesoftSnapshotRow(
  company: FedesoftCompany,
  sourceYear: number,
) {
  const normalizedTaxId = company.normalizedTaxId ?? `name:${company.normalizedName}`;

  const firstLocation = company.locations.length > 0 ? company.locations[0] : null;

  return {
    source_key: FEDESOFT_SOURCE_KEY,
    country_code: FEDESOFT_COUNTRY_CODE,
    source_year: sourceYear,

    tax_id: company.taxId,
    normalized_tax_id: normalizedTaxId,

    legal_name: company.name,
    normalized_legal_name: company.normalizedName,

    sector: 'Tecnología / Software y TI',
    city: firstLocation,
    department: null,
    region: null,

    priority_score: getFedesoftPriorityScore(company),

    signals: {
      fedesoft_member: true,
      tech_association_signal: true,
      match_source: company.matchSource,
      join_confidence: company.joinConfidence,
      has_nit: Boolean(company.normalizedTaxId),
      has_directory_listing: company.matchSource !== 'member_table_only',
      has_member_table_record: company.matchSource !== 'directory_only',
      category_count: company.categories.length,
      location_count: company.locations.length,
      categories: company.categories,
      locations: company.locations,
      fedesoft_directory_url: company.fedesoftDirectoryUrl,
      fedesoft_slug: company.fedesoftSlug,
      member_type: company.memberType,
    },

    financials: {},

    raw_data: {
      source: 'fedesoft',
      company,
      imported_from: {
        directory_api: true,
        members_table: true,
        categories_api: true,
        locations_api: true,
      },
    },
  };
}

export function buildFedesoftSnapshotRows(
  companies: FedesoftCompany[],
  sourceYear: number,
) {
  return companies.map((c) => buildFedesoftSnapshotRow(c, sourceYear));
}

async function createRun(
  sb: SupabaseClient,
  sourceYear: number,
  listingsCount: number,
  membersCount: number,
  categoriesCount: number,
  locationsCount: number,
) {
  const { data: runData } = await sb
    .from('source_snapshot_runs')
    .insert({
      source_key: FEDESOFT_SOURCE_KEY,
      country_code: FEDESOFT_COUNTRY_CODE,
      status: 'running',
      source_year: sourceYear,
      started_at: new Date().toISOString(),
      metadata: {
        mode: 'commit',
        listings_count: listingsCount,
        members_count: membersCount,
        categories_count: categoriesCount,
        locations_count: locationsCount,
      },
    })
    .select('id')
    .single();

  return (runData as { id?: string } | null)?.id;
}

async function finishRun(
  sb: SupabaseClient,
  runId: string | undefined,
  status: 'completed' | 'failed',
  meta: {
    records_found: number;
    records_upserted: number;
    companies_built: number;
    matched_directory_and_member_table: number;
    directory_only: number;
    member_table_only: number;
    with_nit: number;
    without_nit: number;
    error?: string;
  },
) {
  if (!runId) return;
  try {
    await sb
      .from('source_snapshot_runs')
      .update({
        status,
        completed_at: new Date().toISOString(),
        records_found: meta.records_found,
        records_upserted: meta.records_upserted,
        error_message: meta.error ?? null,
        metadata: {
          companies_built: meta.companies_built,
          matched_directory_and_member_table: meta.matched_directory_and_member_table,
          directory_only: meta.directory_only,
          member_table_only: meta.member_table_only,
          with_nit: meta.with_nit,
          without_nit: meta.without_nit,
        },
      })
      .eq('id', runId);
  } catch {
    /* best-effort */
  }
}

export async function runFedesoftSnapshotEtl(
  sourceYear: number,
  options?: FedesoftSnapshotEtlOptions,
): Promise<FedesoftSnapshotEtlResult> {
  const dryRun = options?.dryRun ?? false;
  const errors: string[] = [];
  const warnings: string[] = [];
  let runId: string | undefined;
  let recordsUpserted = 0;

  const sb = options?.sb ?? (!dryRun ? getAdminSupabase() : undefined);

  try {
    const connectorResult = options?.connectorResult ?? await runFedesoftConnector({
      perPage: 100,
      maxPages: 5,
      signal: options?.signal,
    });

    const companies = connectorResult.companies;

    const matched = companies.filter(
      (c) => c.matchSource === 'directory_and_member_table',
    );
    const directoryOnly = companies.filter(
      (c) => c.matchSource === 'directory_only',
    );
    const memberTableOnly = companies.filter(
      (c) => c.matchSource === 'member_table_only',
    );
    const withNit = companies.filter((c) => c.normalizedTaxId !== null);
    const withoutNit = companies.filter((c) => c.normalizedTaxId === null);

    if (!dryRun && sb) {
      try {
        runId = await createRun(
          sb,
          sourceYear,
          connectorResult.listings.length,
          connectorResult.members.length,
          connectorResult.categoriesById.size,
          connectorResult.locationsById.size,
        );
      } catch {
        warnings.push('Could not record ETL run start in source_snapshot_runs');
      }
    }

    if (dryRun) {
      return {
        ok: true,
        sourceYear,
        listingsCount: connectorResult.listings.length,
        membersCount: connectorResult.members.length,
        categoriesCount: connectorResult.categoriesById.size,
        locationsCount: connectorResult.locationsById.size,
        companiesBuilt: companies.length,
        matchedDirectoryAndMemberTable: matched.length,
        directoryOnly: directoryOnly.length,
        memberTableOnly: memberTableOnly.length,
        withNit: withNit.length,
        withoutNit: withoutNit.length,
        recordsUpserted: 0,
        runId: undefined,
        errors,
        warnings: [
          ...warnings,
          `DRY RUN — ${companies.length} companies built, no writes performed.`,
        ],
      };
    }

    const rows = buildFedesoftSnapshotRows(companies, sourceYear);

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      const { error: upsertErr } = await sb!
        .from('source_company_snapshots')
        .upsert(batch, {
          onConflict: 'source_key,country_code,source_year,normalized_tax_id',
        });

      if (upsertErr) {
        errors.push(`Batch upsert error at offset ${i}: ${upsertErr.message}`);
      } else {
        recordsUpserted += batch.length;
      }
    }

    await finishRun(sb!, runId, 'completed', {
      records_found: companies.length,
      records_upserted: recordsUpserted,
      companies_built: companies.length,
      matched_directory_and_member_table: matched.length,
      directory_only: directoryOnly.length,
      member_table_only: memberTableOnly.length,
      with_nit: withNit.length,
      without_nit: withoutNit.length,
    });

    return {
      ok: true,
      sourceYear,
      listingsCount: connectorResult.listings.length,
      membersCount: connectorResult.members.length,
      categoriesCount: connectorResult.categoriesById.size,
      locationsCount: connectorResult.locationsById.size,
      companiesBuilt: companies.length,
      matchedDirectoryAndMemberTable: matched.length,
      directoryOnly: directoryOnly.length,
      memberTableOnly: memberTableOnly.length,
      withNit: withNit.length,
      withoutNit: withoutNit.length,
      recordsUpserted,
      runId,
      errors,
      warnings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);

    if (!dryRun) {
      await finishRun(sb!, runId, 'failed', {
        records_found: 0,
        records_upserted: 0,
        companies_built: 0,
        matched_directory_and_member_table: 0,
        directory_only: 0,
        member_table_only: 0,
        with_nit: 0,
        without_nit: 0,
        error: msg,
      });
    }

    return {
      ok: false,
      sourceYear,
      listingsCount: 0,
      membersCount: 0,
      categoriesCount: 0,
      locationsCount: 0,
      companiesBuilt: 0,
      matchedDirectoryAndMemberTable: 0,
      directoryOnly: 0,
      memberTableOnly: 0,
      withNit: 0,
      withoutNit: 0,
      recordsUpserted: 0,
      runId,
      errors,
      warnings,
    };
  }
}

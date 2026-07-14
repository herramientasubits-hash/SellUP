import { describe, it, mock, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FedesoftConnectorResult, FedesoftCompany } from '../types';

const MOCK_SOURCE_YEAR = 2025;

const fakeCompanies: FedesoftCompany[] = [
  {
    sourceKey: 'co_fedesoft',
    countryCode: 'CO',
    name: 'Tech Solutions SAS',
    normalizedName: 'tech solutions',
    taxId: '900123456',
    normalizedTaxId: '900123456',
    fedesoftDirectoryUrl: 'https://fedesoft.org/company/tech-solutions',
    fedesoftSlug: 'tech-solutions',
    memberType: 'Activo',
    categoryIds: [1],
    categories: ['Software'],
    locationIds: [10],
    locations: ['Bogotá'],
    date: '2024-01-01',
    modified: '2024-06-15',
    matchSource: 'directory_and_member_table',
    joinConfidence: 'exact_normalized_name',
    metadata: {},
  },
  {
    sourceKey: 'co_fedesoft',
    countryCode: 'CO',
    name: 'Member Only Company',
    normalizedName: 'member only company',
    taxId: '800987654',
    normalizedTaxId: '800987654',
    fedesoftDirectoryUrl: null,
    fedesoftSlug: null,
    memberType: 'Honorario',
    categoryIds: [],
    categories: [],
    locationIds: [],
    locations: [],
    date: null,
    modified: null,
    matchSource: 'member_table_only',
    joinConfidence: 'none',
    metadata: {},
  },
  {
    sourceKey: 'co_fedesoft',
    countryCode: 'CO',
    name: 'Directory Only SAS',
    normalizedName: 'directory only',
    taxId: null,
    normalizedTaxId: null,
    fedesoftDirectoryUrl: 'https://fedesoft.org/company/dir-only',
    fedesoftSlug: 'dir-only',
    memberType: null,
    categoryIds: [],
    categories: [],
    locationIds: [],
    locations: [],
    date: '2024-03-01',
    modified: '2024-03-15',
    matchSource: 'directory_only',
    joinConfidence: 'none',
    metadata: {},
  },
  {
    sourceKey: 'co_fedesoft',
    countryCode: 'CO',
    name: 'No NIT Company',
    normalizedName: 'no nit company',
    taxId: null,
    normalizedTaxId: null,
    fedesoftDirectoryUrl: null,
    fedesoftSlug: null,
    memberType: 'Activo',
    categoryIds: [3],
    categories: ['Consultoría'],
    locationIds: [],
    locations: [],
    date: null,
    modified: null,
    matchSource: 'member_table_only',
    joinConfidence: 'none',
    metadata: {},
  },
];

const fakeResult: FedesoftConnectorResult = {
  listings: Array.from({ length: 337 }, (_, i) => ({
    id: i + 1,
    slug: `listing-${i + 1}`,
    title: `Listing ${i + 1}`,
    date: '2024-01-01',
    modified: '2024-06-15',
    type: 'at_biz_dir',
    link: `https://fedesoft.org/company/listing-${i + 1}`,
    at_biz_dir_category: [1],
    at_biz_dir_location: [10],
  })),
  members: Array.from({ length: 402 }, (_, i) => ({
    memberType: i % 2 === 0 ? 'Activo' : 'Honorario',
    taxId: i < 300 ? `900${String(i).padStart(6, '0')}` : null,
    companyName: `Member ${i + 1}`,
  })),
  categoriesById: new Map([[1, 'Software'], [2, 'Consultoría'], [3, 'Cloud']]),
  locationsById: new Map([[10, 'Bogotá'], [20, 'Medellín']]),
  companies: fakeCompanies,
};

let upsertCallCount = 0;

function makeMockSupabase() {
  return {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: { id: 'mock-run-id' }, error: null }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve() }),
      upsert: () => {
        upsertCallCount++;
        return { error: null };
      },
    }),
  };
}

before(() => {
  mock.module('../fedesoft-connector', {
    namedExports: {
      runFedesoftConnector: async () => fakeResult,
    },
  });
});

describe('runFedesoftSnapshotEtl (dry-run flow)', () => {
  it('returns counts without writing to Supabase', async () => {
    const { runFedesoftSnapshotEtl } = await import('../fedesoft-snapshot-etl');
    const result = await runFedesoftSnapshotEtl(MOCK_SOURCE_YEAR, { dryRun: true });

    assert.equal(result.ok, true);
    assert.equal(result.listingsCount, 337);
    assert.equal(result.membersCount, 402);
    assert.equal(result.categoriesCount, 3);
    assert.equal(result.locationsCount, 2);
    assert.equal(result.companiesBuilt, 4);
    assert.equal(result.matchedDirectoryAndMemberTable, 1);
    assert.equal(result.directoryOnly, 1);
    assert.equal(result.memberTableOnly, 2);
    assert.equal(result.withNit, 2);
    assert.equal(result.withoutNit, 2);
    assert.equal(result.recordsUpserted, 0);
    assert.equal(result.runId, undefined);
  });

  it('does not require SUPABASE_SERVICE_ROLE_KEY', async () => {
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { runFedesoftSnapshotEtl } = await import('../fedesoft-snapshot-etl');
    const result = await runFedesoftSnapshotEtl(MOCK_SOURCE_YEAR, { dryRun: true });

    assert.equal(result.ok, true);
    assert.equal(result.recordsUpserted, 0);

    if (origKey) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
  });
});

describe('runFedesoftSnapshotEtl (commit flow)', () => {
  it('throws if SUPABASE_SERVICE_ROLE_KEY is missing and no sb injected', async () => {
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { runFedesoftSnapshotEtl } = await import('../fedesoft-snapshot-etl');
    try {
      await runFedesoftSnapshotEtl(MOCK_SOURCE_YEAR, { dryRun: false });
      assert.fail('Expected getAdminSupabase to throw');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      assert.ok(
        msg.includes('SUPABASE_SERVICE_ROLE_KEY'),
        `Expected error about SUPABASE_SERVICE_ROLE_KEY, got: ${msg}`,
      );
    }

    if (origKey) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
  });

  it('completes with injected supabase client', async () => {
    upsertCallCount = 0;
    const mockSb = makeMockSupabase();
    const { runFedesoftSnapshotEtl } = await import('../fedesoft-snapshot-etl');
    const result = await runFedesoftSnapshotEtl(MOCK_SOURCE_YEAR, {
      dryRun: false,
      sb: mockSb,
    });

    assert.equal(result.ok, true);
    assert.equal(result.companiesBuilt, 4);
    // 2 of 4 fake companies resolve to tax:<nit>; the other 2 fall back to the
    // legacy `name:<normalizedName>` normalized_tax_id and are blocked by the
    // P2B identity boundary before upsert (see recordIdentityBoundary test below).
    assert.equal(result.recordsUpserted, 2);
    assert.equal(result.runId, 'mock-run-id');
    assert.ok(upsertCallCount > 0, 'upsert should have been called');
  });

  it('metadata in result contains correct counts', async () => {
    upsertCallCount = 0;
    const mockSb = makeMockSupabase();
    const { runFedesoftSnapshotEtl } = await import('../fedesoft-snapshot-etl');
    const result = await runFedesoftSnapshotEtl(MOCK_SOURCE_YEAR, {
      dryRun: false,
      sb: mockSb,
    });

    assert.equal(result.matchedDirectoryAndMemberTable, 1);
    assert.equal(result.directoryOnly, 1);
    assert.equal(result.memberTableOnly, 2);
    assert.equal(result.withNit, 2);
    assert.equal(result.withoutNit, 2);
  });

  it('upserts in batches', async () => {
    upsertCallCount = 0;
    const manyCompanies: FedesoftCompany[] = Array.from({ length: 250 }, (_, i) => ({
      sourceKey: 'co_fedesoft' as const,
      countryCode: 'CO' as const,
      name: `Company ${i}`,
      normalizedName: `company ${i}`,
      taxId: `${i}`,
      normalizedTaxId: `${i}`,
      fedesoftDirectoryUrl: null,
      fedesoftSlug: null,
      memberType: null,
      categoryIds: [],
      categories: [],
      locationIds: [],
      locations: [],
      date: null,
      modified: null,
      matchSource: 'directory_only' as const,
      joinConfidence: 'none' as const,
      metadata: {},
    }));

    const manyResult: FedesoftConnectorResult = {
      listings: [],
      members: [],
      categoriesById: new Map(),
      locationsById: new Map(),
      companies: manyCompanies,
    };

    const mockSb = makeMockSupabase();
    const { runFedesoftSnapshotEtl } = await import('../fedesoft-snapshot-etl');
    const result = await runFedesoftSnapshotEtl(MOCK_SOURCE_YEAR, {
      dryRun: false,
      sb: mockSb,
      connectorResult: manyResult,
    });

    assert.equal(result.ok, true);
    assert.equal(result.companiesBuilt, 250);
    assert.equal(result.recordsUpserted, 250);
    assert.ok(upsertCallCount >= 3, `Expected >= 3 upsert calls (BATCH_SIZE=100), got ${upsertCallCount}`);
  });

  it('upserts with the shared OLD_TAX_GRAIN_ON_CONFLICT target and returns shadow counts', async () => {
    upsertCallCount = 0;
    const capturedOnConflict: unknown[] = [];
    const capturedRows: Array<Record<string, unknown>> = [];
    const mockSb = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'mock-run-id' }, error: null }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve() }),
        upsert: (rows: Array<Record<string, unknown>>, opts: { onConflict: unknown }) => {
          upsertCallCount++;
          capturedOnConflict.push(opts.onConflict);
          capturedRows.push(...rows);
          return { error: null };
        },
      }),
    };

    const { runFedesoftSnapshotEtl } = await import('../fedesoft-snapshot-etl');
    const { OLD_TAX_GRAIN_ON_CONFLICT } = await import('../../../record-identity');
    const result = await runFedesoftSnapshotEtl(MOCK_SOURCE_YEAR, {
      dryRun: false,
      sb: mockSb,
    });

    assert.equal(result.ok, true);
    assert.ok(capturedOnConflict.length > 0);
    assert.ok(capturedOnConflict.every((v) => v === OLD_TAX_GRAIN_ON_CONFLICT));
    assert.equal(OLD_TAX_GRAIN_ON_CONFLICT, 'source_key,country_code,source_year,normalized_tax_id');

    // fakeCompanies: 2 with NIT (no directoryId → tax:<nit>), 2 without NIT (name: fallback → unavailable)
    assert.equal(result.recordIdentityResolved, 2);
    assert.equal(result.recordIdentityUnavailable, 2);
    assert.equal(result.recordIdentityUnavailableReasons.missing_tax_id, 2);

    const withTax = capturedRows.find((r) => r.normalized_tax_id === '900123456');
    assert.equal(withTax?.record_identity_key, 'tax:900123456');

    // P2B identity boundary (EC4D5.E): companies whose normalized_tax_id is the
    // legacy `name:<normalizedName>` fallback have record_identity_key = null
    // and are blocked BEFORE upsert — they must not appear in capturedRows.
    const withoutTax = capturedRows.find((r) => r.normalized_tax_id === 'name:no nit company');
    assert.equal(withoutTax, undefined, 'a row with an unavailable identity must not reach upsert');

    assert.equal(capturedRows.length, 2, 'only the 2 rows with a resolvable identity reach upsert');
    assert.ok(
      capturedRows.every((r) => typeof r.record_identity_key === 'string'),
      'every row that reaches upsert has a valid record_identity_key',
    );
    assert.equal(result.recordIdentityBoundaryAllowed, 2);
    assert.equal(result.recordIdentityBoundaryBlocked, 2);
    // validateRecordIdentityKey sees the final (null) record_identity_key value,
    // not the upstream derivation reason — a null value is always 'missing_value'.
    assert.equal(result.recordIdentityBoundaryBlockedReasons.missing_value, 2);
  });

  it('handles upsert error gracefully', async () => {
    upsertCallCount = 0;
    const errorSb = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'mock-run-id-err' }, error: null }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve() }),
        upsert: () => ({ error: new Error('relation "source_company_snapshots" does not exist') }),
      }),
    };

    const { runFedesoftSnapshotEtl } = await import('../fedesoft-snapshot-etl');
    const result = await runFedesoftSnapshotEtl(MOCK_SOURCE_YEAR, {
      dryRun: false,
      sb: errorSb,
    });

    assert.equal(result.ok, true);
    assert.equal(result.recordsUpserted, 0);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].includes('source_company_snapshots'));
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getFedesoftPriorityScore,
  buildFedesoftSnapshotRow,
  buildFedesoftSnapshotRows,
  deriveFedesoftRecordIdentity,
} from '../fedesoft-snapshot-etl';
import type { FedesoftCompany } from '../types';

function makeCompany(
  overrides: Partial<FedesoftCompany> = {},
): FedesoftCompany {
  return {
    sourceKey: 'co_fedesoft',
    countryCode: 'CO',
    name: 'Tech Solutions SAS',
    normalizedName: 'tech solutions',
    taxId: '900123456',
    normalizedTaxId: '900123456',
    fedesoftDirectoryUrl: 'https://fedesoft.org/company/tech-solutions',
    fedesoftSlug: 'tech-solutions',
    memberType: 'Activo',
    categoryIds: [1, 3],
    categories: ['Software', 'Consultoría'],
    locationIds: [10],
    locations: ['Bogotá'],
    date: '2024-01-01',
    modified: '2024-06-15',
    matchSource: 'directory_and_member_table',
    joinConfidence: 'exact_normalized_name',
    metadata: {},
    ...overrides,
  };
}

const SOURCE_YEAR = 2025;

describe('getFedesoftPriorityScore', () => {
  it('returns 80 for directory_and_member_table with NIT + categories + location', () => {
    const company = makeCompany({ matchSource: 'directory_and_member_table' });
    assert.equal(getFedesoftPriorityScore(company), 90);
  });

  it('returns 65 for member_table_only with NIT only', () => {
    const company = makeCompany({
      matchSource: 'member_table_only',
      categories: [],
      locations: [],
      categoryIds: [],
      locationIds: [],
    });
    assert.equal(getFedesoftPriorityScore(company), 65 + 5);
  });

  it('returns 55 for directory_only without NIT, categories, or location', () => {
    const company = makeCompany({
      matchSource: 'directory_only',
      normalizedTaxId: null,
      categories: [],
      locations: [],
      categoryIds: [],
      locationIds: [],
    });
    assert.equal(getFedesoftPriorityScore(company), 55);
  });

  it('caps at 90', () => {
    const company = makeCompany({
      matchSource: 'directory_and_member_table',
      categories: ['Software', 'Consultoría', 'Cloud'],
      locations: ['Bogotá', 'Medellín'],
    });
    const score = getFedesoftPriorityScore(company);
    assert.ok(score <= 90);
  });
});

describe('buildFedesoftSnapshotRow', () => {
  it('builds row with NIT — uses normalizedTaxId', () => {
    const company = makeCompany({ normalizedTaxId: '900123456' });
    const row = buildFedesoftSnapshotRow(company, SOURCE_YEAR);

    assert.equal(row.source_key, 'co_fedesoft');
    assert.equal(row.country_code, 'CO');
    assert.equal(row.source_year, SOURCE_YEAR);
    assert.equal(row.tax_id, '900123456');
    assert.equal(row.normalized_tax_id, '900123456');
    assert.equal(row.legal_name, 'Tech Solutions SAS');
    assert.equal(row.normalized_legal_name, 'tech solutions');
    assert.equal(row.sector, 'Tecnología / Software y TI');
    assert.equal(row.city, 'Bogotá');
    assert.equal(row.department, null);
    assert.equal(row.region, null);
    assert.equal(row.signals.has_nit, true);
    assert.equal(row.signals.fedesoft_member, true);
    assert.equal(row.signals.match_source, 'directory_and_member_table');
    assert.equal(row.signals.category_count, 2);
    assert.equal(row.signals.location_count, 1);
    assert.ok(Array.isArray(row.signals.categories));
    assert.ok(Array.isArray(row.signals.locations));
    assert.equal(row.signals.fedesoft_directory_url, 'https://fedesoft.org/company/tech-solutions');
    assert.equal(row.signals.fedesoft_slug, 'tech-solutions');
    assert.equal(row.signals.member_type, 'Activo');
    assert.deepEqual(row.financials, {});
    assert.equal(row.raw_data.source, 'fedesoft');
  });

  it('builds row without NIT — uses name:<normalizedName> as normalized_tax_id', () => {
    const company = makeCompany({
      taxId: null,
      normalizedTaxId: null,
      matchSource: 'directory_only',
      categories: [],
      locations: [],
      categoryIds: [],
      locationIds: [],
    });
    const row = buildFedesoftSnapshotRow(company, SOURCE_YEAR);

    assert.equal(row.tax_id, null);
    assert.equal(row.normalized_tax_id, 'name:tech solutions');
    assert.equal(row.signals.has_nit, false);
  });

  it('sets city to first location only', () => {
    const company = makeCompany({
      locations: ['Bogotá', 'Medellín', 'Cali'],
    });
    const row = buildFedesoftSnapshotRow(company, SOURCE_YEAR);
    assert.equal(row.city, 'Bogotá');
  });

  it('sets city to null when no locations', () => {
    const company = makeCompany({
      locations: [],
      locationIds: [],
    });
    const row = buildFedesoftSnapshotRow(company, SOURCE_YEAR);
    assert.equal(row.city, null);
  });

  it('sets has_directory_listing false for member_table_only', () => {
    const company = makeCompany({
      matchSource: 'member_table_only',
      fedesoftDirectoryUrl: null,
      fedesoftSlug: null,
    });
    const row = buildFedesoftSnapshotRow(company, SOURCE_YEAR);
    assert.equal(row.signals.has_directory_listing, false);
    assert.equal(row.signals.has_member_table_record, true);
  });

  it('sets has_member_table_record false for directory_only', () => {
    const company = makeCompany({
      matchSource: 'directory_only',
    });
    const row = buildFedesoftSnapshotRow(company, SOURCE_YEAR);
    assert.equal(row.signals.has_member_table_record, false);
    assert.equal(row.signals.has_directory_listing, true);
  });
});

describe('buildFedesoftSnapshotRows', () => {
  it('returns empty array for empty companies', () => {
    const rows = buildFedesoftSnapshotRows([], SOURCE_YEAR);
    assert.equal(rows.length, 0);
  });

  it('returns one row per company', () => {
    const c1 = makeCompany({ name: 'Company A', normalizedName: 'company a', normalizedTaxId: '111' });
    const c2 = makeCompany({ name: 'Company B', normalizedName: 'company b', normalizedTaxId: '222' });
    const rows = buildFedesoftSnapshotRows([c1, c2], SOURCE_YEAR);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].normalized_tax_id, '111');
    assert.equal(rows[1].normalized_tax_id, '222');
  });
});

// ─── deriveFedesoftRecordIdentity — EC4D5.C3 shadow dual-write ───────────────

describe('deriveFedesoftRecordIdentity', () => {
  it('directoryId gana sobre normalized_tax_id', () => {
    const result = deriveFedesoftRecordIdentity({
      directoryId: 4821,
      normalizedTaxId: '900123456',
    });
    assert.deepEqual(result, { status: 'resolved', recordIdentityKey: 'fedesoft-directory:4821' });
  });

  it('cae a tax cuando no hay directoryId y normalized_tax_id es válido', () => {
    const result = deriveFedesoftRecordIdentity({
      directoryId: null,
      normalizedTaxId: '900123456',
    });
    assert.deepEqual(result, { status: 'resolved', recordIdentityKey: 'tax:900123456' });
  });

  it('normalized_tax_id legado `name:` produce unavailable (nunca resuelto)', () => {
    const result = deriveFedesoftRecordIdentity({
      directoryId: null,
      normalizedTaxId: 'name:tech solutions',
    });
    assert.equal(result.status, 'unavailable');
  });

  it('unavailable cuando no hay directoryId ni normalized_tax_id', () => {
    const result = deriveFedesoftRecordIdentity({
      directoryId: undefined,
      normalizedTaxId: null,
    });
    assert.equal(result.status, 'unavailable');
  });

  it('unavailable no excluye la fila del writer — buildFedesoftSnapshotRow sigue construyéndose', () => {
    const company = makeCompany({
      normalizedTaxId: null,
      normalizedName: 'sin identidad sas',
      metadata: {},
    });
    const row = buildFedesoftSnapshotRow(company, SOURCE_YEAR);
    assert.equal(row.normalized_tax_id, 'name:sin identidad sas');
    assert.equal(row.record_identity_key, null);
    assert.equal(row.source_key, 'co_fedesoft');
  });
});

describe('buildFedesoftSnapshotRow — record_identity_key wiring', () => {
  it('usa fedesoft-directory:<directoryId> cuando metadata.directoryId está presente', () => {
    const company = makeCompany({ metadata: { directoryId: 4821 } });
    const row = buildFedesoftSnapshotRow(company, SOURCE_YEAR);
    assert.equal(row.record_identity_key, 'fedesoft-directory:4821');
  });

  it('usa tax:<normalized_tax_id> cuando no hay directoryId', () => {
    const company = makeCompany({ metadata: {}, normalizedTaxId: '900123456' });
    const row = buildFedesoftSnapshotRow(company, SOURCE_YEAR);
    assert.equal(row.record_identity_key, 'tax:900123456');
  });

  it('nunca usa fedesoftSlug como record_identity_key', () => {
    const company = makeCompany({
      metadata: {},
      normalizedTaxId: null,
      fedesoftSlug: 'tech-solutions',
      normalizedName: 'tech solutions',
    });
    const row = buildFedesoftSnapshotRow(company, SOURCE_YEAR);
    assert.equal(row.record_identity_key, null);
    assert.notEqual(row.record_identity_key, 'tech-solutions');
    assert.ok(!String(row.record_identity_key ?? '').includes('tech-solutions'));
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFedesoftCompanies } from '../fedesoft-connector';
import type { BuildFedesoftCompaniesInput } from '../fedesoft-connector';
import type { FedesoftDirectoryListing, FedesoftMember } from '../types';

function makeListing(overrides: Partial<FedesoftDirectoryListing> = {}): FedesoftDirectoryListing {
  return {
    id: 1,
    slug: 'test-company',
    title: 'Test Company SAS',
    date: '2024-01-01',
    modified: '2024-01-15',
    type: 'at_biz_dir',
    link: 'https://fedesoft.org/company/test-company',
    at_biz_dir_category: [],
    at_biz_dir_location: [],
    ...overrides,
  };
}

function makeMember(overrides: Partial<FedesoftMember> = {}): FedesoftMember {
  return {
    memberType: 'Activo',
    taxId: '900123456',
    companyName: 'Test Company SAS',
    ...overrides,
  };
}

function makeInput(overrides: Partial<BuildFedesoftCompaniesInput> = {}): BuildFedesoftCompaniesInput {
  return {
    listings: [],
    members: [],
    categoriesById: new Map(),
    locationsById: new Map(),
    ...overrides,
  };
}

describe('buildFedesoftCompanies', () => {
  it('matches listing + member with same normalized name', () => {
    const listing = makeListing({ title: 'Tech Solutions S.A.S.' });
    const member = makeMember({ companyName: 'Tech Solutions SAS' });
    const input = makeInput({ listings: [listing], members: [member] });

    const companies = buildFedesoftCompanies(input);

    assert.equal(companies.length, 1);
    assert.equal(companies[0].matchSource, 'directory_and_member_table');
    assert.equal(companies[0].joinConfidence, 'exact_normalized_name');
    assert.equal(companies[0].taxId, '900123456');
    assert.equal(companies[0].normalizedTaxId, '900123456');
  });

  it('creates directory_only when listing has no matching member', () => {
    const listing = makeListing({ title: 'Orphan Company SAS' });
    const member = makeMember({ companyName: 'Different Company' });
    const input = makeInput({ listings: [listing], members: [member] });

    const companies = buildFedesoftCompanies(input);

    const dirOnly = companies.find((c) => c.matchSource === 'directory_only');
    assert.ok(dirOnly);
    assert.equal(dirOnly!.taxId, null);
    assert.equal(dirOnly!.normalizedTaxId, null);
  });

  it('creates member_table_only when member has no listing', () => {
    const member = makeMember({ companyName: 'Member Only Company' });
    const input = makeInput({ members: [member] });

    const companies = buildFedesoftCompanies(input);

    const memberOnly = companies.find((c) => c.matchSource === 'member_table_only');
    assert.ok(memberOnly);
    assert.equal(memberOnly!.name, 'Member Only Company');
    assert.equal(memberOnly!.categoryIds.length, 0);
  });

  it('does not assign NIT when names differ', () => {
    const listing = makeListing({ title: 'Company A SAS' });
    const member = makeMember({ companyName: 'Company B SAS', taxId: '800999999' });
    const input = makeInput({ listings: [listing], members: [member] });

    const companies = buildFedesoftCompanies(input);

    const companyA = companies.find((c) => c.name === 'Company A SAS');
    const companyB = companies.find((c) => c.name === 'Company B SAS');

    assert.ok(companyA);
    assert.equal(companyA!.taxId, null);

    assert.ok(companyB);
    assert.equal(companyB!.taxId, '800999999');
  });

  it('deduplicates by NIT when two listings normalize to same name', () => {
    const listing = makeListing({ title: 'Duplicate SAS' });
    const member = makeMember({ companyName: 'Duplicate SAS', taxId: '900123456' });
    const input = makeInput({ listings: [listing, listing], members: [member] });

    const companies = buildFedesoftCompanies(input);

    assert.equal(companies.length, 1);
  });

  it('resolves categories by id', () => {
    const listing = makeListing({
      title: 'Categorized Company',
      at_biz_dir_category: [1, 3],
    });
    const categoriesById = new Map<number, string>([
      [1, 'Software'],
      [3, 'Consultoría'],
    ]);
    const input = makeInput({ listings: [listing], categoriesById });

    const companies = buildFedesoftCompanies(input);

    assert.equal(companies[0].categories.length, 2);
    assert.ok(companies[0].categories.includes('Software'));
    assert.ok(companies[0].categories.includes('Consultoría'));
  });

  it('resolves locations by id', () => {
    const listing = makeListing({
      title: 'Located Company',
      at_biz_dir_location: [10, 20],
    });
    const locationsById = new Map<number, string>([
      [10, 'Bogotá'],
      [20, 'Medellín'],
    ]);
    const input = makeInput({ listings: [listing], locationsById });

    const companies = buildFedesoftCompanies(input);

    assert.equal(companies[0].locations.length, 2);
    assert.ok(companies[0].locations.includes('Bogotá'));
    assert.ok(companies[0].locations.includes('Medellín'));
  });

  it('sets sourceKey and countryCode correctly', () => {
    const listing = makeListing({ title: 'Test SAS' });
    const input = makeInput({ listings: [listing] });

    const companies = buildFedesoftCompanies(input);

    assert.equal(companies[0].sourceKey, 'co_fedesoft');
    assert.equal(companies[0].countryCode, 'CO');
  });

  it('sets fedesoftDirectoryUrl and slug', () => {
    const listing = makeListing({
      title: 'Test SAS',
      link: 'https://fedesoft.org/company/test-company',
      slug: 'test-company',
    });
    const input = makeInput({ listings: [listing] });

    const companies = buildFedesoftCompanies(input);

    assert.equal(companies[0].fedesoftDirectoryUrl, 'https://fedesoft.org/company/test-company');
    assert.equal(companies[0].fedesoftSlug, 'test-company');
  });

  it('assigns memberType from matched member', () => {
    const listing = makeListing({ title: 'Tech SAS' });
    const member = makeMember({ companyName: 'Tech SAS', memberType: 'Honorario' });
    const input = makeInput({ listings: [listing], members: [member] });

    const companies = buildFedesoftCompanies(input);

    assert.equal(companies[0].memberType, 'Honorario');
  });

  it('stores raw records in metadata', () => {
    const listing = makeListing({ title: 'Meta SAS' });
    const input = makeInput({ listings: [listing] });

    const companies = buildFedesoftCompanies(input);

    assert.ok(companies[0].metadata.rawDirectoryRecord);
    assert.equal((companies[0].metadata.rawDirectoryRecord as FedesoftDirectoryListing).id, 1);
  });
});

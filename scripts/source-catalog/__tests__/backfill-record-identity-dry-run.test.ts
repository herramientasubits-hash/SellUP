/**
 * Backfill record_identity_key dry-run tooling — tests (EC4D5.H).
 *
 * Covers: source config invariants, SQL generation shape/safety,
 * safety-gate evaluation over fixtures, and CLI static safety (no DB
 * connection, no env reads, forbidden write flags rejected).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  SOURCE_CONFIGS,
  findSourceConfig,
  isKnownSourceKey,
  buildCoverageSql,
  buildCanonicalCollisionSql,
  buildTaxInvariantSql,
  buildNativeProjectionSql,
  evaluateSafetyGate,
  parseCliArgs,
  formatDryRunReport,
  buildDryRunJsonContract,
  ForbiddenFlagError,
  UnknownSourceKeyError,
  UnknownFlagError,
  type SourceConfig,
} from '../backfill-record-identity-dry-run-core';

const EXPECTED_SOURCE_KEYS = [
  'co_siis',
  'rd_dgii_bulk',
  'cl_chilecompra_ocds',
  'hn_contrataciones_abiertas',
  'gt_rgae_proveedores',
  'do_dgcp',
  'cr_sicop',
  'pa_panamacompra_convenio',
  'co_fedesoft',
] as const;

const FORBIDDEN_WRITE_SQL_PATTERN = /\b(UPDATE|INSERT|DELETE|MERGE|UPSERT)\b/i;
const FORBIDDEN_SELECT_STAR_PATTERN = /SELECT\s+\*/i;

function readScript(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

// ─── Source config ──────────────────────────────────────────────────────────

describe('Source config — 9 effective source keys', () => {
  it('has exactly the 9 expected source_key entries, no more, no less', () => {
    const actualKeys = SOURCE_CONFIGS.map((c) => c.sourceKey).sort();
    assert.deepEqual(actualKeys, [...EXPECTED_SOURCE_KEYS].sort());
  });

  it('has no duplicate source_key entries', () => {
    const keys = SOURCE_CONFIGS.map((c) => c.sourceKey);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('treats do_dgcp as a single source_key despite two underlying writers', () => {
    const dgcpConfigs = SOURCE_CONFIGS.filter((c) => c.sourceKey === 'do_dgcp');
    assert.equal(dgcpConfigs.length, 1);
  });

  it('isKnownSourceKey / findSourceConfig agree for known and unknown keys', () => {
    for (const key of EXPECTED_SOURCE_KEYS) {
      assert.equal(isKnownSourceKey(key), true);
      assert.notEqual(findSourceConfig(key), null);
    }
    assert.equal(isKnownSourceKey('unknown_source_xyz'), false);
    assert.equal(findSourceConfig('unknown_source_xyz'), null);
  });

  it('all TAX_GRAIN sources derive tax:<normalized_tax_id>', () => {
    const taxGrainSources = SOURCE_CONFIGS.filter((c) => c.family === 'TAX_GRAIN');
    assert.equal(taxGrainSources.length, 7);
    for (const config of taxGrainSources) {
      assert.match(config.derivationSqlExpression, /'tax:'/);
      assert.match(config.derivationSqlExpression, /normalized_tax_id/);
      assert.equal(config.invariantType, 'tax');
      assert.deepEqual(config.nativeIdentityNamespaces, []);
    }
  });

  it('Panama (pa_panamacompra_convenio) precedence is company -> provider -> tax', () => {
    const panama = findSourceConfig('pa_panamacompra_convenio');
    assert.ok(panama);
    const expr = panama!.derivationSqlExpression;
    const companyIdx = expr.indexOf("'company:'");
    const providerIdx = expr.indexOf("'provider:'");
    const taxIdx = expr.indexOf("'tax:'");
    assert.ok(companyIdx >= 0 && providerIdx >= 0 && taxIdx >= 0);
    assert.ok(companyIdx < providerIdx);
    assert.ok(providerIdx < taxIdx);
    assert.deepEqual(panama!.nativeIdentityNamespaces, ['company', 'provider']);
    assert.equal(panama!.family, 'NATIVE_RECORD_GRAIN');
    assert.equal(panama!.invariantType, 'native');
  });

  it('Fedesoft (co_fedesoft) precedence is directoryId -> tax, excluding name: fallback', () => {
    const fedesoft = findSourceConfig('co_fedesoft');
    assert.ok(fedesoft);
    const expr = fedesoft!.derivationSqlExpression;
    const directoryIdx = expr.indexOf("'fedesoft-directory:'");
    const taxIdx = expr.indexOf("'tax:'");
    assert.ok(directoryIdx >= 0 && taxIdx >= 0);
    assert.ok(directoryIdx < taxIdx);
    assert.match(expr, /NOT LIKE 'name:%'/);
    assert.deepEqual(fedesoft!.nativeIdentityNamespaces, ['fedesoft-directory']);
    assert.equal(fedesoft!.family, 'NATIVE_RECORD_GRAIN');
  });

  it('no config derives identity from name/legal_name/slug/hash', () => {
    for (const config of SOURCE_CONFIGS) {
      const expr = config.derivationSqlExpression.toLowerCase();
      assert.ok(!expr.includes('legal_name'));
      assert.ok(!expr.includes('slug'));
      assert.ok(!expr.includes('hash'));
      // 'name:' may appear only as an EXCLUSION guard (NOT LIKE 'name:%'),
      // never as a resolvable branch producing 'name:' + value.
      assert.ok(!/then\s+'name:'/i.test(config.derivationSqlExpression));
    }
  });

  it('every config declares an expected country_code', () => {
    for (const config of SOURCE_CONFIGS) {
      assert.equal(typeof config.countryCode, 'string');
      assert.ok(config.countryCode.length > 0);
    }
  });
});

// ─── SQL generation ─────────────────────────────────────────────────────────

describe('SQL generation — coverage projection', () => {
  for (const config of SOURCE_CONFIGS) {
    it(`${config.sourceKey}: coverage SQL includes source_key, country_code, source_year and no forbidden writes`, () => {
      const sql = buildCoverageSql(config);
      assert.match(sql, /source_key/);
      assert.match(sql, /country_code/);
      assert.match(sql, /source_year/);
      assert.match(sql, new RegExp(config.sourceKey));
      assert.doesNotMatch(sql, FORBIDDEN_WRITE_SQL_PATTERN);
      assert.doesNotMatch(sql, FORBIDDEN_SELECT_STAR_PATTERN);
    });
  }
});

describe('SQL generation — canonical grain collision projection', () => {
  for (const config of SOURCE_CONFIGS) {
    it(`${config.sourceKey}: collision SQL groups by projected_record_identity_key, samples are hashed not raw`, () => {
      const sql = buildCanonicalCollisionSql(config);
      assert.match(sql, /GROUP BY[\s\S]*projected_record_identity_key/);
      assert.match(sql, /duplicate_group_count/);
      assert.match(sql, /duplicate_excess_rows/);
      assert.match(sql, /sample_key_hashes/);
      // The final projection (after the CTEs) must expose only the md5
      // hash of the identity key, never the identity key or raw_data
      // payload itself. Native-grain sources legitimately reference
      // raw_data *inside* the derivation CTE to compute the key — that is
      // not a leak, so we only assert the final SELECT list is clean.
      const finalSelect = sql.slice(sql.lastIndexOf('\nSELECT\n'));
      assert.doesNotMatch(finalSelect, /raw_data/);
      assert.match(finalSelect, /md5\(key_hash|key_hash/);
      assert.doesNotMatch(sql, FORBIDDEN_WRITE_SQL_PATTERN);
      assert.doesNotMatch(sql, FORBIDDEN_SELECT_STAR_PATTERN);
    });
  }
});

describe('SQL generation — tax-grain invariant projection', () => {
  const taxGrainConfigs = SOURCE_CONFIGS.filter((c) => c.family === 'TAX_GRAIN');
  const nativeConfigs = SOURCE_CONFIGS.filter((c) => c.family === 'NATIVE_RECORD_GRAIN');

  for (const config of taxGrainConfigs) {
    it(`${config.sourceKey}: tax invariant SQL is generated and includes required fields`, () => {
      const sql = buildTaxInvariantSql(config);
      assert.match(sql, /tax_duplicate_group_count/);
      assert.match(sql, /tax_duplicate_excess_rows/);
      assert.match(sql, /null_tax_rows/);
      assert.match(sql, /name_tax_rows/);
      assert.doesNotMatch(sql, FORBIDDEN_WRITE_SQL_PATTERN);
      assert.doesNotMatch(sql, FORBIDDEN_SELECT_STAR_PATTERN);
    });
  }

  for (const config of nativeConfigs) {
    it(`${config.sourceKey}: tax invariant SQL is NOT applicable (NATIVE_RECORD_GRAIN)`, () => {
      assert.throws(() => buildTaxInvariantSql(config), /tax_invariant_not_applicable/);
    });
  }
});

describe('SQL generation — native-record projection', () => {
  const nativeConfigs = SOURCE_CONFIGS.filter((c) => c.family === 'NATIVE_RECORD_GRAIN');
  const taxGrainConfigs = SOURCE_CONFIGS.filter((c) => c.family === 'TAX_GRAIN');

  it('applies to exactly Panama and Fedesoft', () => {
    assert.deepEqual(
      nativeConfigs.map((c) => c.sourceKey).sort(),
      ['co_fedesoft', 'pa_panamacompra_convenio'],
    );
  });

  for (const config of nativeConfigs) {
    it(`${config.sourceKey}: native projection SQL includes required fields`, () => {
      const sql = buildNativeProjectionSql(config);
      assert.match(sql, /native_identity_rows/);
      assert.match(sql, /tax_fallback_rows/);
      assert.match(sql, /unavailable_rows/);
      assert.match(sql, /same_tax_multi_record_groups/);
      assert.match(sql, /same_tax_multi_record_excess_rows/);
      assert.doesNotMatch(sql, FORBIDDEN_WRITE_SQL_PATTERN);
      assert.doesNotMatch(sql, FORBIDDEN_SELECT_STAR_PATTERN);
    });
  }

  for (const config of taxGrainConfigs) {
    it(`${config.sourceKey}: native projection SQL is NOT applicable (TAX_GRAIN)`, () => {
      assert.throws(() => buildNativeProjectionSql(config), /native_projection_not_applicable/);
    });
  }
});

describe('SQL generation — full report / JSON contract', () => {
  it('formatDryRunReport(text) covers all 9 sources when no source-key filter is given', () => {
    const report = formatDryRunReport({ sourceKey: null, format: 'text' });
    for (const key of EXPECTED_SOURCE_KEYS) {
      assert.match(report, new RegExp(key));
    }
    assert.doesNotMatch(report, FORBIDDEN_WRITE_SQL_PATTERN);
  });

  it('formatDryRunReport(text) with --source-key filters to a single source', () => {
    const report = formatDryRunReport({ sourceKey: 'co_siis', format: 'text' });
    assert.match(report, /co_siis/);
    assert.doesNotMatch(report, /rd_dgii_bulk/);
  });

  it('buildDryRunJsonContract never claims a DB connection was used', () => {
    const contract = buildDryRunJsonContract(SOURCE_CONFIGS as SourceConfig[]);
    assert.equal(contract.dbConnectionUsed, false);
    assert.equal(contract.mode, 'dry-run-sql-only');
    assert.equal(contract.sources.length, 9);
  });

  it('formatDryRunReport(json) returns valid JSON with the same safety contract', () => {
    const report = formatDryRunReport({ sourceKey: null, format: 'json' });
    const parsed = JSON.parse(report);
    assert.equal(parsed.dbConnectionUsed, false);
    assert.equal(parsed.mode, 'dry-run-sql-only');
  });
});

// ─── Safety gate evaluation ─────────────────────────────────────────────────

describe('Safety gate evaluation', () => {
  it('PASS when everything resolves and no collisions exist', () => {
    const result = evaluateSafetyGate({
      coverageRows: [
        {
          sourceKey: 'co_siis',
          countryCode: 'CO',
          sourceYear: 2025,
          totalRows: 100,
          alreadyHasRecordIdentityKey: 100,
          projectedResolvedRows: 100,
          projectedUnavailableRows: 0,
          projectedNameNamespaceRows: 0,
          projectedEmptyIdentityRows: 0,
        },
      ],
      collisionRows: [
        {
          sourceKey: 'co_siis',
          countryCode: 'CO',
          sourceYear: 2025,
          duplicateGroupCount: 0,
          duplicateExcessRows: 0,
        },
      ],
    });
    assert.equal(result.pass, true);
    assert.deepEqual(result.blockedSources, []);
    assert.deepEqual(result.blockingReasons, []);
    assert.equal(result.manualReviewRequired, false);
  });

  it('FAILs on unavailable rows and requires manual review', () => {
    const result = evaluateSafetyGate({
      coverageRows: [
        {
          sourceKey: 'pa_panamacompra_convenio',
          countryCode: 'PA',
          sourceYear: null,
          totalRows: 50,
          alreadyHasRecordIdentityKey: 0,
          projectedResolvedRows: 45,
          projectedUnavailableRows: 5,
          projectedNameNamespaceRows: 0,
          projectedEmptyIdentityRows: 0,
        },
      ],
      collisionRows: [],
    });
    assert.equal(result.pass, false);
    assert.equal(result.unavailableRowsDetected, true);
    assert.ok(result.blockingReasons.includes('unavailable_rows'));
    assert.ok(result.blockedSources.includes('pa_panamacompra_convenio'));
    assert.equal(result.manualReviewRequired, true);
  });

  it('FAILs on canonical grain duplicates', () => {
    const result = evaluateSafetyGate({
      coverageRows: [],
      collisionRows: [
        {
          sourceKey: 'rd_dgii_bulk',
          countryCode: 'DO',
          sourceYear: 2025,
          duplicateGroupCount: 3,
          duplicateExcessRows: 7,
        },
      ],
    });
    assert.equal(result.pass, false);
    assert.equal(result.canonicalCollisionDetected, true);
    assert.ok(result.blockingReasons.includes('canonical_collision'));
    assert.ok(result.blockedSources.includes('rd_dgii_bulk'));
    assert.equal(result.manualReviewRequired, true);
  });

  it('FAILs on empty identity rows', () => {
    const result = evaluateSafetyGate({
      coverageRows: [
        {
          sourceKey: 'cl_chilecompra_ocds',
          countryCode: 'CL',
          sourceYear: 2025,
          totalRows: 10,
          alreadyHasRecordIdentityKey: 0,
          projectedResolvedRows: 9,
          projectedUnavailableRows: 0,
          projectedNameNamespaceRows: 0,
          projectedEmptyIdentityRows: 1,
        },
      ],
      collisionRows: [],
    });
    assert.equal(result.pass, false);
    assert.equal(result.emptyIdentityDetected, true);
    assert.ok(result.blockingReasons.includes('empty_identity'));
    assert.equal(result.manualReviewRequired, true);
  });

  it('FAILs on name-namespace rows', () => {
    const result = evaluateSafetyGate({
      coverageRows: [
        {
          sourceKey: 'co_fedesoft',
          countryCode: 'CO',
          sourceYear: null,
          totalRows: 10,
          alreadyHasRecordIdentityKey: 0,
          projectedResolvedRows: 8,
          projectedUnavailableRows: 0,
          projectedNameNamespaceRows: 2,
          projectedEmptyIdentityRows: 0,
        },
      ],
      collisionRows: [],
    });
    assert.equal(result.pass, false);
    assert.equal(result.nameNamespaceDetected, true);
    assert.ok(result.blockingReasons.includes('name_namespace'));
    assert.equal(result.manualReviewRequired, true);
  });

  it('detects and fails on an unknown source_key', () => {
    const result = evaluateSafetyGate({
      coverageRows: [
        {
          sourceKey: 'unknown_source_zzz',
          countryCode: null,
          sourceYear: null,
          totalRows: 1,
          alreadyHasRecordIdentityKey: 0,
          projectedResolvedRows: 1,
          projectedUnavailableRows: 0,
          projectedNameNamespaceRows: 0,
          projectedEmptyIdentityRows: 0,
        },
      ],
      collisionRows: [],
    });
    assert.equal(result.pass, false);
    assert.equal(result.unknownSourceDetected, true);
    assert.ok(result.blockingReasons.includes('unknown_source'));
    assert.ok(result.blockedSources.includes('unknown_source_zzz'));
  });
});

// ─── CLI safety ─────────────────────────────────────────────────────────────

describe('CLI safety — argument parsing', () => {
  it('--print-sql produces a report synchronously with no network/DB dependency', () => {
    const options = parseCliArgs(['--print-sql']);
    const report = formatDryRunReport(options);
    assert.equal(typeof report, 'string');
    assert.ok(report.length > 0);
  });

  it('accepts --source-key to scope the report', () => {
    const options = parseCliArgs(['--source-key', 'gt_rgae_proveedores']);
    assert.equal(options.sourceKey, 'gt_rgae_proveedores');
  });

  it('accepts --format json', () => {
    const options = parseCliArgs(['--format', 'json']);
    assert.equal(options.format, 'json');
  });

  it('rejects an unknown --source-key value', () => {
    assert.throws(() => parseCliArgs(['--source-key', 'not_a_real_source']), UnknownSourceKeyError);
  });

  it('rejects an unrecognized flag', () => {
    assert.throws(() => parseCliArgs(['--totally-made-up']), UnknownFlagError);
  });

  for (const forbiddenFlag of ['--apply', '--write', '--backfill', '--execute-update']) {
    it(`rejects the forbidden write flag ${forbiddenFlag}`, () => {
      assert.throws(() => parseCliArgs([forbiddenFlag]), ForbiddenFlagError);
    });
  }

  it('rejects --allow-db-read (not implemented in this hito)', () => {
    assert.throws(() => parseCliArgs(['--allow-db-read']), ForbiddenFlagError);
  });
});

describe('CLI safety — static source audit', () => {
  const cliSource = readScript('backfill-record-identity-dry-run.ts');
  const coreSource = readScript('backfill-record-identity-dry-run-core.ts');

  it('never imports or references a Supabase client', () => {
    for (const source of [cliSource, coreSource]) {
      assert.doesNotMatch(source, /createClient/);
      assert.doesNotMatch(source, /@supabase\/supabase-js/);
    }
  });

  it('never reads process.env, dotenv, or a service-role key', () => {
    for (const source of [cliSource, coreSource]) {
      assert.doesNotMatch(source, /process\.env/);
      assert.doesNotMatch(source, /\brequire\(['"]dotenv['"]\)/);
      assert.doesNotMatch(source, /SERVICE_ROLE_KEY/);
      assert.doesNotMatch(source, /readFileSync\([^)]*\.env/);
    }
  });

  it('the CLI file never issues raw SQL (no template literal containing a write verb)', () => {
    // The CLI's own doc comment legitimately *names* the rejected flags
    // (e.g. "--execute-update"), which is not SQL. Strip line comments
    // before scanning for accidental executable SQL strings.
    const codeOnly = cliSource
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n');
    assert.doesNotMatch(codeOnly, FORBIDDEN_WRITE_SQL_PATTERN);
  });
});

describe('Shared record-identity module — untouched invariants', () => {
  const sharedModuleDir = path.join(__dirname, '..', '..', '..', 'src', 'server', 'source-catalog', 'record-identity');
  const sharedFiles = ['record-identity-key.ts', 'record-identity-types.ts', 'tax-record-identity.ts', 'record-identity-conflict-targets.ts'];

  it('the shared module has no source_key switch and no dry-run-specific source keys', () => {
    for (const file of sharedFiles) {
      const content = fs.readFileSync(path.join(sharedModuleDir, file), 'utf8');
      for (const key of EXPECTED_SOURCE_KEYS) {
        assert.doesNotMatch(content, new RegExp(key));
      }
    }
  });
});

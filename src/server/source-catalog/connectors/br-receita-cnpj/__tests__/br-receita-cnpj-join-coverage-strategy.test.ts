/**
 * BR Receita CNPJ join COVERAGE STRATEGY — tests (BR-SOURCE-10H).
 *
 * BR-SOURCE-10G proved that a `first_rows` sample of each file rarely overlaps, so a
 * linear first-N-of-each sample is a poor coverage probe. BR-SOURCE-10H adds a second,
 * explicit sampling strategy — `establishment_keys_then_company_probe` — that samples
 * establishments first, collects their STRUCTURAL join keys into an ephemeral in-memory
 * set, then scans a BOUNDED (hard-capped) window of empresas rows looking ONLY for those
 * keys. This suite proves:
 *   - `first_rows` keeps the BR-SOURCE-10G behaviour (default, backward-compatible);
 *   - the probe recovers a company that appears BEYOND the first-N sample but WITHIN the
 *     bounded scan window, where `first_rows` cannot;
 *   - the probe does NOT recover a company beyond `max_company_scan_rows`, and counts
 *     `coverage_scan_limit_reached`;
 *   - establishment keys / company keys / CNPJ básico never reach the output;
 *   - company-context PII and establishment-own PII both exclude with aggregate metrics;
 *   - `max_company_scan_rows` has a conservative default and a hard absolute cap;
 *   - an invalid sampling strategy fails closed;
 *   - `coverage_is_representative` is always false and no import/Supabase/runtime/Agent 1
 *     is ever activated.
 *
 * 100% synthetic. No real dataset, no Supabase, no network, no runtime. Column COUNTS
 * mirror the official layout; cell VALUES are meaningless placeholders. Every multi-digit
 * token is built by CONCATENATION so no 8-/11-/14-digit literal exists in source, and the
 * structural join key is never a continuous 8-digit literal here.
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS } from '../br-receita-cnpj-file-reader';
import {
  BR_RECEITA_CNPJ_JOIN_DEFAULT_MAX_COMPANY_SCAN_ROWS,
  BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT,
  BrReceitaCnpjJoinDryRunError,
  runBrReceitaCnpjCompanyEstablishmentJoinDryRun,
} from '../br-receita-cnpj-company-establishment-join-dry-run';
import {
  assertNoForbiddenKeysInOutput,
  assertSanitizedRunnerOutput,
  buildJoinRunnerReport,
  formatReportJson,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-company-establishment-join-dry-run';
import type { BrReceitaCnpjManifest } from '../br-receita-cnpj-manifest';

const COUNTS = BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS;

/** Distinct 8-digit structural roots, assembled so no 8-digit literal lives in source. */
const ROOT_TARGET = '0001' + '0203';
const ROOT_FILLER = '0009' + '0807';
/** A CPF-length (11-digit) token, assembled so no 11-digit literal lives in source. */
const CPF_LIKE_TOKEN = '12345' + '678901';
/** A persistible-column index for ESTABELECIMENTOS (identificador_matriz_filial). */
const ESTAB_PERSISTIBLE_INDEX = 3;

function q(cells: readonly string[]): string {
  return cells.map((c) => `"${c}"`).join(';');
}

function empresasRow(opts: { root?: string; razao?: string; natureza?: string } = {}): string {
  return q([
    opts.root ?? ROOT_TARGET,
    opts.razao ?? 'ACME COMERCIO LTDA',
    opts.natureza ?? '2062',
    'qualif',
    '1000',
    '05',
    'ente',
  ]);
}

function estabRow(opts: { root?: string; piiAtPersistibleIndex?: string } = {}): string {
  const cells = Array.from({ length: COUNTS.estabelecimentos }, (_, i) => `c${i}`);
  cells[0] = opts.root ?? ROOT_TARGET;
  cells[1] = '0001';
  cells[2] = '55';
  if (opts.piiAtPersistibleIndex !== undefined) {
    cells[ESTAB_PERSISTIBLE_INDEX] = opts.piiAtPersistibleIndex;
  }
  return q(cells);
}

function file(rows: readonly string[]): string {
  return `${rows.join('\n')}\n`;
}

/**
 * An empresas file whose TARGET company (root = ROOT_TARGET) sits at 1-based
 * `targetPosition`, preceded by filler companies with a different root.
 */
function empresasWithTargetAt(targetPosition: number, totalRows: number): string {
  const rows: string[] = [];
  for (let i = 1; i <= totalRows; i++) {
    rows.push(i === targetPosition ? empresasRow({ root: ROOT_TARGET }) : empresasRow({ root: ROOT_FILLER }));
  }
  return file(rows);
}

const createdDirs: string[] = [];

after(() => {
  for (const dir of createdDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

interface FixtureSpec {
  readonly empresas: string;
  readonly estabelecimentos: string;
}

function headerlessManifest(): BrReceitaCnpjManifest {
  return {
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    mode: 'local_manifest_validation',
    files: [
      { fileType: 'empresas', path: 'empresas.csv', encoding: 'latin1', delimiter: ';', layoutMode: 'official_headerless' },
      { fileType: 'estabelecimentos', path: 'estabelecimentos.csv', encoding: 'latin1', delimiter: ';', layoutMode: 'official_headerless' },
    ],
  };
}

function makeFixture(spec: FixtureSpec): { manifestPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brs10h-'));
  createdDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'empresas.csv'), spec.empresas, 'latin1');
  fs.writeFileSync(path.join(dir, 'estabelecimentos.csv'), spec.estabelecimentos, 'latin1');
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(headerlessManifest(), null, 2));
  return { manifestPath };
}

// ─── 1) first_rows preserves the BR-SOURCE-10G behaviour ────────────────────────

describe('coverage strategy — first_rows preserves 10G', () => {
  it('joins a safe company to a safe establishment under first_rows (and as the default)', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_TARGET })]),
      estabelecimentos: file([estabRow({ root: ROOT_TARGET })]),
    });

    const explicit = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      samplingStrategy: 'first_rows',
    });
    assert.equal(explicit.ok, true);
    assert.equal(explicit.samplingStrategy, 'first_rows');
    assert.equal(explicit.joinCounts.joined_with_sampled_company_context, 1);
    assert.equal(explicit.companiesScannedForCoverage, 0); // no coverage scan in first_rows

    // The default strategy is first_rows and produces the same verdict.
    const byDefault = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
    });
    assert.equal(byDefault.samplingStrategy, 'first_rows');
    assert.equal(byDefault.joinCounts.joined_with_sampled_company_context, 1);
  });
});

// ─── 2) probe recovers a company beyond the sample but within the scan window ───

describe('coverage strategy — probe recovers deeper company context', () => {
  it('joins when the company appears after the first-N sample but within max_company_scan_rows', async () => {
    const { manifestPath } = makeFixture({
      // TARGET company at row 30 of 40; first-20 sample never reaches it.
      empresas: empresasWithTargetAt(30, 40),
      estabelecimentos: file([estabRow({ root: ROOT_TARGET })]),
    });

    const probe = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      samplingStrategy: 'establishment_keys_then_company_probe',
      maxCompanyRows: 20,
      maxEstablishmentRows: 20,
      maxCompanyScanRows: 1000,
    });
    assert.equal(probe.samplingStrategy, 'establishment_keys_then_company_probe');
    assert.equal(probe.establishmentKeysCollectedInMemory, 1);
    assert.equal(probe.joinCounts.joined_with_sampled_company_context, 1);
    assert.equal(probe.joinReasonCounts.sampled_company_context_found, 1);
    assert.equal(probe.companiesIndexedForJoin, 1);
    assert.equal(probe.coverageSummary.coverageScanLimitReached, false);

    // first_rows on the SAME fixture cannot join — the company is past the 20-row sample.
    const firstRows = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      samplingStrategy: 'first_rows',
      maxCompanyRows: 20,
      maxEstablishmentRows: 20,
    });
    assert.equal(firstRows.joinCounts.joined_with_sampled_company_context, 0);
  });
});

// ─── 3) probe does NOT recover a company beyond the scan window ─────────────────

describe('coverage strategy — probe respects the scan window', () => {
  it('does not join when the company appears after max_company_scan_rows', async () => {
    const { manifestPath } = makeFixture({
      // TARGET company at row 10 of 40, but the scan window is only 3 rows.
      empresas: empresasWithTargetAt(10, 40),
      estabelecimentos: file([estabRow({ root: ROOT_TARGET })]),
    });

    const probe = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      samplingStrategy: 'establishment_keys_then_company_probe',
      maxCompanyScanRows: 3,
    });
    assert.equal(probe.joinCounts.joined_with_sampled_company_context, 0);
    assert.equal(probe.companiesIndexedForJoin, 0);
    assert.ok(probe.companiesScannedForCoverage <= 3);
    assert.equal(probe.coverageSummary.coverageScanLimitReached, true);
  });
});

// ─── 4) coverage_scan_limit_reached is counted ──────────────────────────────────

describe('coverage strategy — coverage_scan_limit_reached counting', () => {
  it('counts coverage_scan_limit_reached for a keyed establishment missed by the bounded scan', async () => {
    const { manifestPath } = makeFixture({
      empresas: empresasWithTargetAt(10, 40),
      estabelecimentos: file([estabRow({ root: ROOT_TARGET })]),
    });
    const probe = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      samplingStrategy: 'establishment_keys_then_company_probe',
      maxCompanyScanRows: 3,
    });
    assert.equal(probe.joinReasonCounts.coverage_scan_limit_reached, 1);
    // Every establishment still resolves to exactly one join status.
    const joinSum = Object.values(probe.joinCounts).reduce((a, b) => a + b, 0);
    assert.equal(joinSum, probe.establishmentsSampled);
    const reasonSum = Object.values(probe.joinReasonCounts).reduce((a, b) => a + b, 0);
    assert.equal(reasonSum, probe.establishmentsSampled);
  });
});

// ─── 5–8) The output never carries keys, básico, or raw values ──────────────────

describe('coverage strategy — sanitized output', () => {
  async function probeResult() {
    const { manifestPath } = makeFixture({
      empresas: empresasWithTargetAt(5, 20),
      estabelecimentos: file([estabRow({ root: ROOT_TARGET })]),
    });
    return runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      samplingStrategy: 'establishment_keys_then_company_probe',
      maxCompanyScanRows: 1000,
    });
  }

  it('never surfaces the structural establishment/company join key', async () => {
    const result = await probeResult();
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, new RegExp(ROOT_TARGET)); // establishment key never present
    assert.doesNotMatch(json, new RegExp(ROOT_FILLER)); // company key never present
  });

  it('never emits a forbidden key-dump field name (establishment_keys / company_keys)', async () => {
    const result = await probeResult();
    const report = buildJoinRunnerReport(result);
    assert.doesNotThrow(() => assertNoForbiddenKeysInOutput(report));
    // A bare plural key-dump field must be rejected.
    assert.throws(
      () => assertNoForbiddenKeysInOutput({ ok: true, establishment_keys: ['x'] }),
      /SENSITIVE_OUTPUT_LEAK/,
    );
    assert.throws(
      () => assertNoForbiddenKeysInOutput({ ok: true, company_keys: ['x'] }),
      /SENSITIVE_OUTPUT_LEAK/,
    );
  });

  it('never emits an 8-digit CNPJ-básico-like literal', async () => {
    const result = await probeResult();
    const rendered = formatReportJson(buildJoinRunnerReport(result));
    assert.doesNotMatch(rendered, /\b\d{8}\b/);
    assert.doesNotThrow(() => assertSanitizedRunnerOutput(rendered));
  });

  it('never emits a raw row, a real legal name, or a CPF/CNPJ-length literal', async () => {
    const result = await probeResult();
    const rendered = formatReportJson(buildJoinRunnerReport(result));
    assert.doesNotMatch(rendered, /ACME COMERCIO LTDA/);
    assert.doesNotMatch(rendered, /\b\d{11}\b/);
    assert.doesNotMatch(rendered, /\b\d{14}\b/);
  });
});

// ─── 9) Company-context PII excludes the establishment ──────────────────────────

describe('coverage strategy — excluded by company context', () => {
  it('excludes an establishment whose CPF-flagged company is found by the probe', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_TARGET, razao: CPF_LIKE_TOKEN })]),
      estabelecimentos: file([estabRow({ root: ROOT_TARGET })]),
    });
    const probe = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      samplingStrategy: 'establishment_keys_then_company_probe',
      maxCompanyScanRows: 1000,
    });
    assert.equal(probe.companyClassificationCounts.excluded_person_or_pii_risk, 1);
    assert.equal(probe.companiesIndexedForJoin, 0);
    assert.equal(probe.companiesExcludedFromJoin, 1);
    assert.equal(probe.joinCounts.excluded_due_to_company_context, 1);
    assert.equal(probe.joinReasonCounts.company_context_person_or_pii_risk, 1);
  });
});

// ─── 10) Establishment-own PII excludes it and its key is never collected ───────

describe('coverage strategy — establishment own privacy signal', () => {
  it('excludes an establishment carrying its own CPF-like token and never probes for it', async () => {
    const { manifestPath } = makeFixture({
      empresas: empresasWithTargetAt(3, 10),
      estabelecimentos: file([estabRow({ root: ROOT_TARGET, piiAtPersistibleIndex: CPF_LIKE_TOKEN })]),
    });
    const probe = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      samplingStrategy: 'establishment_keys_then_company_probe',
      maxCompanyScanRows: 1000,
    });
    assert.equal(probe.establishmentClassificationCounts.excluded_person_or_pii_risk, 1);
    assert.equal(probe.joinCounts.excluded_due_to_establishment_privacy_signal, 1);
    assert.equal(probe.joinReasonCounts.establishment_privacy_signal_detected, 1);
    // An establishment pre-empted by its OWN PII never has its key collected/probed.
    assert.equal(probe.establishmentKeysCollectedInMemory, 0);
    assert.equal(probe.companiesScannedForCoverage, 0);
  });
});

// ─── 11) max_company_scan_rows default + absolute cap ───────────────────────────

describe('coverage strategy — bounded scan window', () => {
  it('uses a conservative default and enforces a hard absolute cap', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_TARGET })]),
      estabelecimentos: file([estabRow({ root: ROOT_TARGET })]),
    });

    const defaulted = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      samplingStrategy: 'establishment_keys_then_company_probe',
    });
    assert.equal(defaulted.maxCompanyScanRows, BR_RECEITA_CNPJ_JOIN_DEFAULT_MAX_COMPANY_SCAN_ROWS);
    assert.ok(
      BR_RECEITA_CNPJ_JOIN_DEFAULT_MAX_COMPANY_SCAN_ROWS <=
        BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT,
    );

    await assert.rejects(
      () =>
        runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
          manifestPath,
          allowLocalManifest: true,
          samplingStrategy: 'establishment_keys_then_company_probe',
          maxCompanyScanRows: BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT + 1,
        }),
      /company_scan_row_limit_exceeded/,
    );
  });
});

// ─── 12) Invalid sampling strategy fails closed ─────────────────────────────────

describe('coverage strategy — invalid strategy', () => {
  it('rejects an unrecognized sampling strategy before reading any file', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
    });
    await assert.rejects(
      () =>
        runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
          manifestPath,
          allowLocalManifest: true,
          // @ts-expect-error — intentionally invalid strategy value.
          samplingStrategy: 'full_scan_everything',
        }),
      BrReceitaCnpjJoinDryRunError,
    );
  });
});

// ─── 13) coverage_is_representative is always false ─────────────────────────────

describe('coverage strategy — never representative', () => {
  it('marks coverage_is_representative false for both strategies', async () => {
    const { manifestPath } = makeFixture({
      empresas: empresasWithTargetAt(5, 20),
      estabelecimentos: file([estabRow({ root: ROOT_TARGET })]),
    });
    const probe = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      samplingStrategy: 'establishment_keys_then_company_probe',
    });
    const firstRows = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      samplingStrategy: 'first_rows',
    });
    assert.equal(probe.coverageSummary.coverageIsRepresentative, false);
    assert.equal(firstRows.coverageSummary.coverageIsRepresentative, false);
  });
});

// ─── 14) No import / Supabase / runtime / Agent 1 activation ────────────────────

describe('coverage strategy — safety invariants', () => {
  it('activates no import, Supabase, runtime, or Agent 1 path', async () => {
    const { manifestPath } = makeFixture({
      empresas: empresasWithTargetAt(5, 20),
      estabelecimentos: file([estabRow({ root: ROOT_TARGET })]),
    });
    const probe = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      samplingStrategy: 'establishment_keys_then_company_probe',
    });
    assert.equal(probe.fullDatasetProcessed, false);
    assert.equal(probe.importExecuted, false);
    assert.equal(probe.supabaseWrite, false);
    assert.equal(probe.runtimeIntegration, false);
    assert.equal(probe.agent1Integration, false);
    for (const value of Object.values(probe.safety)) {
      assert.equal(value, false);
    }
    assert.equal(probe.safety.joinKeysPrinted, false);
    assert.equal(probe.safety.establishmentKeysPrinted, false);
    assert.equal(probe.establishmentKeysPrinted, false);
  });
});

// ─── 15) The default strategy remains 10G-equivalent ────────────────────────────

describe('coverage strategy — 10G equivalence under default', () => {
  it('produces the 10G join verdict when the default strategy is used', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_TARGET })]),
      estabelecimentos: file([estabRow({ root: ROOT_TARGET })]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.samplingStrategy, 'first_rows');
    assert.equal(result.mode, 'company_establishment_join_bounded_dry_run');
    assert.equal(result.companiesSampled, 1);
    assert.equal(result.companiesIndexedForJoin, 1);
    assert.equal(result.establishmentsSampled, 1);
    assert.equal(result.joinCounts.joined_with_sampled_company_context, 1);
    assert.equal(result.joinReasonCounts.sampled_company_context_found, 1);
  });
});

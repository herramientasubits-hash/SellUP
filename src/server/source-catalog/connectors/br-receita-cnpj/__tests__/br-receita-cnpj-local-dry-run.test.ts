/**
 * BR Receita CNPJ local real-file dry-run module — tests (BR-SOURCE-7).
 *
 * Verifies the dry-run is a safe, local-only, bounded, sanitized tool:
 *   - validates the internal synthetic manifest and samples bounded rows;
 *   - reading local files requires BOTH allowLocalManifest and dryRunOnly;
 *   - default sample rows ≤ 5, and > 20 is refused (fail-closed);
 *   - a failed manifest validation blocks the dry-run (no sampling);
 *   - it never processes the full dataset, returns rows, paths, or snapshots;
 *   - the result carries an all-false safety block and no CNPJ/CPF/PII.
 *
 * 100% synthetic. No real dataset, no Supabase, no download, no runtime.
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BR_RECEITA_CNPJ_DRY_RUN_DEFAULT_MAX_SAMPLE_ROWS,
  BR_RECEITA_CNPJ_DRY_RUN_MAX_SAMPLE_ROWS_LIMIT,
  BrReceitaCnpjLocalDryRunError,
  runBrReceitaCnpjLocalDryRun,
  type BrReceitaCnpjLocalDryRunResult,
} from '../br-receita-cnpj-local-dry-run';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const SYNTHETIC_MANIFEST_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'source-catalog',
  'fixtures',
  'br-receita-cnpj-synthetic',
  'manifest.synthetic.json',
);

const FOURTEEN_DIGITS = /\b\d{14}\b/;
const FOURTEEN_ALNUM = /\b[A-Z0-9]{14}\b/;
const ELEVEN_DIGITS = /\b\d{11}\b/;

// ─── Temp synthetic manifest helper (files written at runtime — never committed) ──

const tempDirs: string[] = [];

function makeTempManifest(files: {
  manifest: unknown;
  csvs: Record<string, string>;
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-src7-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files.csvs)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(files.manifest), 'utf8');
  return manifestPath;
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function validManifest(extraFiles: Array<Record<string, unknown>> = []): unknown {
  return {
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    mode: 'local_manifest_validation',
    files: [
      { fileType: 'empresas', path: 'empresas.csv', encoding: 'utf8', delimiter: ',' },
      { fileType: 'estabelecimentos', path: 'estabelecimentos.csv', encoding: 'utf8', delimiter: ',' },
      ...extraFiles,
    ],
  };
}

const GATE = { allowLocalManifest: true, dryRunOnly: true } as const;

// ─── Fixture happy path ─────────────────────────────────────────────────────────

describe('runBrReceitaCnpjLocalDryRun — synthetic manifest', () => {
  it('validates the manifest and samples bounded rows (ok)', async () => {
    const result = await runBrReceitaCnpjLocalDryRun({
      manifestPath: SYNTHETIC_MANIFEST_PATH,
      ...GATE,
      strict: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'local_real_file_dry_run');
    assert.equal(result.manifestValidation, 'passed');
    assert.equal(result.sourceKey, 'br_receita_cnpj_dados_abertos');
    assert.equal(result.countryCode, 'BR');
    assert.equal(result.filesSeen, 6);
    assert.equal(result.filesAccepted, 6);
    assert.equal(result.filesRejected, 0);
    assert.equal(result.sampleRowsRejectedForStructure, 0);
    assert.equal(result.rejectionReasons.length, 0);
    assert.ok(result.sampleRowsRead > 0);
  });

  it('bounds estabelecimentos (6 rows) to the default sample of 5', async () => {
    const result = await runBrReceitaCnpjLocalDryRun({ manifestPath: SYNTHETIC_MANIFEST_PATH, ...GATE });
    const estab = result.fileReports.find((r) => r.fileType === 'estabelecimentos');
    assert.ok(estab);
    assert.equal(estab.sampleRowsRead, BR_RECEITA_CNPJ_DRY_RUN_DEFAULT_MAX_SAMPLE_ROWS);
    assert.equal(estab.sampleRowsRead, 5);
  });

  it('never exceeds filesAccepted * maxSampleRows rows (no full-dataset scan)', async () => {
    const result = await runBrReceitaCnpjLocalDryRun({
      manifestPath: SYNTHETIC_MANIFEST_PATH,
      ...GATE,
      maxSampleRowsPerFile: 3,
    });
    assert.ok(result.sampleRowsRead <= result.filesAccepted * 3);
    for (const r of result.fileReports) {
      assert.ok(r.sampleRowsRead <= 3);
    }
    assert.equal(result.fullDatasetProcessed, false);
  });

  it('carries an all-false safety block', async () => {
    const result = await runBrReceitaCnpjLocalDryRun({ manifestPath: SYNTHETIC_MANIFEST_PATH, ...GATE });
    for (const value of Object.values(result.safety)) {
      assert.equal(value, false);
    }
    assert.equal(result.importExecuted, false);
    assert.equal(result.supabaseWrite, false);
  });
});

// ─── Fail-closed gates ──────────────────────────────────────────────────────────

describe('runBrReceitaCnpjLocalDryRun — fail-closed gates', () => {
  it('requires allowLocalManifest', async () => {
    await assert.rejects(
      () =>
        runBrReceitaCnpjLocalDryRun({
          manifestPath: SYNTHETIC_MANIFEST_PATH,
          allowLocalManifest: false,
          dryRunOnly: true,
        }),
      (err: unknown) =>
        err instanceof BrReceitaCnpjLocalDryRunError &&
        err.reasonCode === 'allow_local_manifest_required',
    );
  });

  it('requires dryRunOnly', async () => {
    await assert.rejects(
      () =>
        runBrReceitaCnpjLocalDryRun({
          manifestPath: SYNTHETIC_MANIFEST_PATH,
          allowLocalManifest: true,
          dryRunOnly: false,
        }),
      (err: unknown) =>
        err instanceof BrReceitaCnpjLocalDryRunError && err.reasonCode === 'dry_run_mode_required',
    );
  });

  it('refuses maxSampleRowsPerFile > 20', async () => {
    await assert.rejects(
      () =>
        runBrReceitaCnpjLocalDryRun({
          manifestPath: SYNTHETIC_MANIFEST_PATH,
          ...GATE,
          maxSampleRowsPerFile: BR_RECEITA_CNPJ_DRY_RUN_MAX_SAMPLE_ROWS_LIMIT + 1,
        }),
      (err: unknown) =>
        err instanceof BrReceitaCnpjLocalDryRunError && err.reasonCode === 'sample_row_limit_exceeded',
    );
  });

  it('refuses a non-finite maxSampleRowsPerFile (no full-dataset request)', async () => {
    await assert.rejects(
      () =>
        runBrReceitaCnpjLocalDryRun({
          manifestPath: SYNTHETIC_MANIFEST_PATH,
          ...GATE,
          maxSampleRowsPerFile: Number.POSITIVE_INFINITY,
        }),
      (err: unknown) =>
        err instanceof BrReceitaCnpjLocalDryRunError &&
        err.reasonCode === 'full_dataset_processing_not_allowed',
    );
  });

  it('defaults maxSampleRowsPerFile to 5', () => {
    assert.equal(BR_RECEITA_CNPJ_DRY_RUN_DEFAULT_MAX_SAMPLE_ROWS, 5);
    assert.ok(BR_RECEITA_CNPJ_DRY_RUN_DEFAULT_MAX_SAMPLE_ROWS <= 5);
  });
});

// ─── Manifest validation failure blocks the dry-run ──────────────────────────────

describe('runBrReceitaCnpjLocalDryRun — manifest validation failure', () => {
  it('blocks the dry-run when the manifest is structurally invalid (no sampling)', async () => {
    const manifestPath = makeTempManifest({
      manifest: {
        sourceKey: 'wrong_source_key',
        countryCode: 'BR',
        sourceYear: 2026,
        sourcePeriod: '2026-07',
        mode: 'local_manifest_validation',
        files: [{ fileType: 'empresas', path: 'empresas.csv' }],
      },
      csvs: { 'empresas.csv': 'cnpj_basico\n11222333\n' },
    });
    const result = await runBrReceitaCnpjLocalDryRun({ manifestPath, ...GATE });
    assert.equal(result.ok, false);
    assert.equal(result.manifestValidation, 'failed');
    assert.equal(result.sampleRowsRead, 0);
    assert.ok(result.rejectionReasons.length > 0);
  });
});

// ─── Sample structural validation over temp fixtures ─────────────────────────────

describe('runBrReceitaCnpjLocalDryRun — sample structural validation', () => {
  it('flags a forbidden 11/14-digit run in a sampled cell without leaking it', async () => {
    const elevenDigits = '9'.repeat(11); // constructed — no literal digit run in source
    const manifestPath = makeTempManifest({
      manifest: validManifest(),
      csvs: {
        'empresas.csv': `cnpj_basico,razao_social\n11222333,SAFE NAME\n11222333,${elevenDigits}\n`,
        'estabelecimentos.csv': 'cnpj_basico,cnpj_ordem,cnpj_dv\n11222333,0001,81\n',
      },
    });
    const result = await runBrReceitaCnpjLocalDryRun({ manifestPath, ...GATE });
    assert.equal(result.ok, false);
    const empresas = result.fileReports.find((r) => r.fileType === 'empresas');
    assert.ok(empresas);
    assert.equal(empresas.sampleValidation, 'failed');
    assert.equal(empresas.reasonCode, 'sample_row_forbidden_value_detected');
    // The flagged value never appears anywhere in the result.
    assert.doesNotMatch(JSON.stringify(result), ELEVEN_DIGITS);
  });

  it('flags a column-count mismatch as a structural rejection', async () => {
    const manifestPath = makeTempManifest({
      manifest: validManifest(),
      csvs: {
        'empresas.csv': 'cnpj_basico\n11222333\n',
        'estabelecimentos.csv': 'cnpj_basico,cnpj_ordem,cnpj_dv\n11222333,0001\n',
      },
    });
    const result = await runBrReceitaCnpjLocalDryRun({ manifestPath, ...GATE });
    const estab = result.fileReports.find((r) => r.fileType === 'estabelecimentos');
    assert.ok(estab);
    assert.equal(estab.sampleValidation, 'failed');
    assert.equal(estab.reasonCode, 'sample_row_column_mismatch');
  });
});

// ─── Output sanitization / no leakage ────────────────────────────────────────────

describe('runBrReceitaCnpjLocalDryRun — no leakage', () => {
  async function fixtureResult(): Promise<BrReceitaCnpjLocalDryRunResult> {
    return runBrReceitaCnpjLocalDryRun({ manifestPath: SYNTHETIC_MANIFEST_PATH, ...GATE, strict: true });
  }

  it('returns no rows, no snapshot field, no raw content', async () => {
    const result = await fixtureResult();
    const serialized = JSON.stringify(result);
    for (const banned of ['"rows"', 'raw_row', 'original_row', 'full_row', 'snapshot', '"cells"']) {
      assert.ok(!serialized.includes(banned), `result leaked "${banned}"`);
    }
  });

  it('returns no absolute local path', async () => {
    const result = await fixtureResult();
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(REPO_ROOT), 'result leaked the repo root path');
    assert.ok(!serialized.includes('/Users/'), 'result leaked an absolute path');
    assert.ok(!serialized.includes(path.sep === '/' ? '/scripts/' : '\\scripts\\'));
  });

  it('returns no full CNPJ or CPF', async () => {
    const result = await fixtureResult();
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, FOURTEEN_DIGITS);
    assert.doesNotMatch(serialized, FOURTEEN_ALNUM);
    assert.doesNotMatch(serialized, ELEVEN_DIGITS);
  });

  it('returns no contact or fine-address tokens as keys', async () => {
    const result = await fixtureResult();
    const lower = JSON.stringify(result).toLowerCase();
    for (const token of [
      'telefone',
      'fax',
      'correio_eletronico',
      'logradouro',
      'numero',
      'complemento',
      'bairro',
      'cep',
      'cpf',
      'socios',
      'qsa',
    ]) {
      assert.ok(!lower.includes(`"${token}"`), `result leaked token "${token}"`);
    }
  });

  it('only file hashes (hash12) identify files — never CNPJ', async () => {
    const result = await fixtureResult();
    for (const r of result.fileReports) {
      if (r.sha256Hash12 !== undefined) {
        assert.match(r.sha256Hash12, /^[0-9a-f]{12}$/);
      }
    }
  });
});

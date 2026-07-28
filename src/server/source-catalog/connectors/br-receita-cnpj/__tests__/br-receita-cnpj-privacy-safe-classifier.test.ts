/**
 * BR Receita CNPJ privacy-safe bounded dry-run classifier — tests (BR-SOURCE-10E).
 *
 * The classifier turns the BR-SOURCE-10C hard-block finding (a CPF-length token in
 * real company data) into a per-record eligibility COUNT, without ever surfacing a
 * row, a value, a full CNPJ, or a CPF. These tests prove:
 *   - it accepts an `official_headerless` synthetic manifest and produces
 *     aggregated counts;
 *   - a clean company row lands in `eligible_for_future_import` (only under an
 *     injected legal-nature policy) or, fail-closed by default, `needs_legal_review`;
 *   - a CPF-like / long token in a candidate-persistible field counts as
 *     `excluded_person_or_pii_risk` — and NEVER appears in the output;
 *   - contact/address columns are NOT candidate-persistible (a phone-length run
 *     there does not exclude the row);
 *   - forbidden SOCIOS/QSA/CPF file families are rejected (manifest authority);
 *   - the real-file classifier requires `official_headerless`;
 *   - `maxSampleRows > 20` is refused, and the bounded read never scans the file;
 *   - the BR-SOURCE-7 hard-block dry-run STILL aborts on the same PII sample;
 *   - aggregated counts are correct and every safety flag stays false.
 *
 * 100% synthetic. No real dataset, no Supabase, no network, no runtime. Column
 * COUNTS mirror the official layout; cell VALUES are meaningless placeholders. Any
 * long token is built by CONCATENATION so no 11-/14-digit literal exists in source.
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS } from '../br-receita-cnpj-file-reader';
import { runBrReceitaCnpjLocalDryRun } from '../br-receita-cnpj-local-dry-run';
import {
  BrReceitaCnpjPrivacyClassifierError,
  runBrReceitaCnpjPrivacySafeClassifier,
} from '../br-receita-cnpj-privacy-safe-classifier';
import type { BrReceitaCnpjManifest } from '../br-receita-cnpj-manifest';

// ─── Synthetic headerless builders (`;`-quoted; column COUNT = official layout) ──

const COUNTS = BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS;

/** Short 8-digit placeholder root (below the 11-digit red-flag threshold). */
const CNPJ_ROOT = '00010203';
/** A CPF-length (11-digit) token, assembled so no 11-digit literal lives in source. */
const CPF_LIKE_TOKEN = '12345' + '678901';
/** A phone-length (12-digit) token for a contact column, assembled by concatenation. */
const PHONE_LIKE_TOKEN = '11' + '987654' + '3210';

function q(cells: readonly string[]): string {
  return cells.map((c) => `"${c}"`).join(';');
}

/** A synthetic headerless EMPRESAS row (7 cols). `razao`/`natureza` are overridable. */
function empresasRow(opts: { razao?: string; natureza?: string } = {}): string {
  const cells = [
    CNPJ_ROOT,
    opts.razao ?? 'ACME COMERCIO LTDA',
    opts.natureza ?? '2062',
    'qualif',
    '1000',
    '05',
    'ente',
  ];
  return q(cells);
}

/** A synthetic headerless ESTABELECIMENTOS row (30 cols); optional contact-column token. */
function estabRow(opts: { phoneAtContactIndex?: string } = {}): string {
  const cells = Array.from({ length: COUNTS.estabelecimentos }, (_, i) => `c${i}`);
  cells[0] = CNPJ_ROOT;
  cells[1] = '0001';
  cells[2] = '55';
  if (opts.phoneAtContactIndex !== undefined) cells[22] = opts.phoneAtContactIndex; // telefone_1
  return q(cells);
}

function file(rows: readonly string[]): string {
  return `${rows.join('\n')}\n`;
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
  /** Extra raw files (name → content) written verbatim into the fixture dir. */
  readonly extraFiles?: Record<string, string>;
  /** Mutate the default headerless manifest before it is written. */
  readonly mutate?: (m: BrReceitaCnpjManifest) => void;
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

function makeFixture(spec: FixtureSpec): { dir: string; manifestPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brs10e-'));
  createdDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'empresas.csv'), spec.empresas, 'latin1');
  fs.writeFileSync(path.join(dir, 'estabelecimentos.csv'), spec.estabelecimentos, 'latin1');
  for (const [name, content] of Object.entries(spec.extraFiles ?? {})) {
    fs.writeFileSync(path.join(dir, name), content, 'latin1');
  }
  const manifest = headerlessManifest();
  spec.mutate?.(manifest);
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { dir, manifestPath };
}

// ─── Acceptance + aggregate shape ───────────────────────────────────────────────

describe('runBrReceitaCnpjPrivacySafeClassifier — acceptance', () => {
  it('accepts an official_headerless synthetic manifest and produces aggregate counts', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow(), empresasRow()]),
      estabelecimentos: file([estabRow(), estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });

    assert.equal(result.ok, true);
    assert.equal(result.manifestValidation, 'passed');
    assert.equal(result.mode, 'privacy_safe_bounded_dry_run');
    assert.equal(result.layoutMode, 'official_headerless');
    assert.equal(result.sampleRowsSeen, 4);
    assert.ok(result.classificationCounts);
    assert.ok(result.exclusionCountsByReason);
    assert.equal(result.fullDatasetProcessed, false);
    assert.equal(result.importExecuted, false);
  });

  it('classifies a clean company row as needs_legal_review with no policy (fail-closed)', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });
    assert.equal(result.classificationCounts.eligible_for_future_import, 0);
    assert.equal(result.classificationCounts.needs_legal_review, 2);
    assert.equal(result.exclusionCountsByReason.unknown_requires_legal_review, 1);
    assert.equal(result.exclusionCountsByReason.insufficient_positive_company_signal, 1);
  });

  it('classifies a clean empresas row as eligible ONLY under an injected legal-nature policy', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ natureza: '2062' })]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({
      manifestPath,
      allowLocalManifest: true,
      eligibilityPolicy: { eligibleLegalNatureCodes: new Set(['2062']) },
    });
    assert.equal(result.classificationCounts.eligible_for_future_import, 1);
    assert.equal(result.exclusionCountsByReason.passed_all_eligibility_checks, 1);
  });

  it('routes a risky legal nature to excluded_unsupported_legal_nature', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ natureza: '2135' })]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({
      manifestPath,
      allowLocalManifest: true,
      eligibilityPolicy: { riskyLegalNatureCodes: new Set(['2135']) },
    });
    assert.equal(result.classificationCounts.excluded_unsupported_legal_nature, 1);
  });
});

// ─── Person / PII risk ──────────────────────────────────────────────────────────

describe('runBrReceitaCnpjPrivacySafeClassifier — PII risk', () => {
  it('counts a CPF-like token in a persistible field as excluded_person_or_pii_risk', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ razao: CPF_LIKE_TOKEN })]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });
    assert.equal(result.classificationCounts.excluded_person_or_pii_risk, 1);
    assert.equal(result.exclusionCountsByReason.cpf_like_token_detected, 1);
  });

  it('does NOT exclude a row for a phone-length run inside a contact column (not persistible)', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow({ phoneAtContactIndex: PHONE_LIKE_TOKEN })]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });
    assert.equal(result.classificationCounts.excluded_person_or_pii_risk, 0);
    assert.equal(result.classificationCounts.needs_legal_review, 2);
  });

  it('never surfaces a raw row, cell value, CPF, or full CNPJ in the output', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow(), empresasRow({ razao: CPF_LIKE_TOKEN })]),
      estabelecimentos: file([estabRow({ phoneAtContactIndex: PHONE_LIKE_TOKEN })]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, /\b\d{11}\b/); // no CPF-like literal
    assert.doesNotMatch(json, /\b\d{14}\b/); // no full-CNPJ literal
    assert.doesNotMatch(json, new RegExp(CPF_LIKE_TOKEN));
    assert.doesNotMatch(json, new RegExp(PHONE_LIKE_TOKEN));
    assert.doesNotMatch(json, /ACME COMERCIO LTDA/);
    assert.doesNotMatch(json.toLowerCase(), /"(cpf|socios|qsa|telefone|logradouro|bairro|cep|raw_row|legal_name)"/);
  });
});

// ─── Forbidden families & layout-mode enforcement ───────────────────────────────

describe('runBrReceitaCnpjPrivacySafeClassifier — fail-closed gates', () => {
  it('rejects a forbidden file family (cpf token in a file name)', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
      extraFiles: { 'cpf_dump.csv': file([q(['a', 'b'])]) },
      mutate: (m) => {
        m.files.push({ fileType: 'cnaes', path: 'cpf_dump.csv', layoutMode: 'official_headerless' });
      },
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });
    assert.equal(result.ok, false);
    assert.equal(result.manifestValidation, 'failed');
    assert.equal(result.sampleRowsSeen, 0);
    assert.ok(result.rejectionReasons.includes('forbidden_file_name'));
  });

  it('rejects a real-style manifest that is not official_headerless (header mode)', async () => {
    const { manifestPath } = makeFixture({
      empresas: file(['cnpj_basico;razao_social;natureza_juridica;capital_social;porte_empresa', empresasRow()]),
      estabelecimentos: file(['cnpj_basico;cnpj_ordem;cnpj_dv', q([CNPJ_ROOT, '0001', '55'])]),
      mutate: (m) => {
        m.layoutMode = 'header';
        for (const f of m.files) f.layoutMode = 'header';
      },
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });
    assert.equal(result.ok, false);
    assert.equal(result.manifestValidation, 'passed');
    assert.equal(result.sampleRowsSeen, 0);
    assert.ok(result.rejectionReasons.some((r) => r.endsWith('layout_mode_not_official_headerless')));
  });

  it('requires allowLocalManifest: true (fail-closed otherwise)', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
    });
    await assert.rejects(
      () => runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: false }),
      BrReceitaCnpjPrivacyClassifierError,
    );
  });

  it('refuses maxSampleRows > 20 before reading any file', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
    });
    await assert.rejects(
      () =>
        runBrReceitaCnpjPrivacySafeClassifier({
          manifestPath,
          allowLocalManifest: true,
          maxSampleRowsPerFile: 21,
        }),
      /sample_row_limit_exceeded/,
    );
  });
});

// ─── Coexistence with the hard-block dry-run + aggregate correctness ─────────────

describe('runBrReceitaCnpjPrivacySafeClassifier — coexistence & aggregates', () => {
  it('preserves the BR-SOURCE-7 hard-block dry-run on the same PII sample', async () => {
    // A CPF-like token on the THIRD row so the hard-block dry-run (which treats the
    // first headerless line as a header) still scans it as a data line and aborts.
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow(), empresasRow(), empresasRow({ razao: CPF_LIKE_TOKEN })]),
      estabelecimentos: file([estabRow(), estabRow()]),
    });

    const hardBlock = await runBrReceitaCnpjLocalDryRun({
      manifestPath,
      allowLocalManifest: true,
      dryRunOnly: true,
      maxSampleRowsPerFile: 5,
    });
    assert.equal(hardBlock.ok, false);
    assert.ok(hardBlock.rejectionReasons.includes('empresas:sample_row_forbidden_value_detected'));

    const classifier = await runBrReceitaCnpjPrivacySafeClassifier({
      manifestPath,
      allowLocalManifest: true,
      maxSampleRowsPerFile: 5,
    });
    assert.equal(classifier.ok, true); // counts instead of aborting
    assert.equal(classifier.classificationCounts.excluded_person_or_pii_risk, 1);
  });

  it('fails when --fail-on-any-excluded is set and a record is excluded', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ razao: CPF_LIKE_TOKEN })]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({
      manifestPath,
      allowLocalManifest: true,
      failOnAnyExcluded: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.classificationCounts.excluded_person_or_pii_risk, 1);
  });

  it('produces correct aggregate counts that sum to sample_rows_seen', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow(), empresasRow(), empresasRow({ razao: CPF_LIKE_TOKEN })]),
      estabelecimentos: file([estabRow(), estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({
      manifestPath,
      allowLocalManifest: true,
      maxSampleRowsPerFile: 5,
    });
    assert.equal(result.sampleRowsSeen, 5);
    assert.equal(result.classificationCounts.excluded_person_or_pii_risk, 1);
    assert.equal(result.classificationCounts.needs_legal_review, 4);
    assert.equal(result.exclusionCountsByReason.unknown_requires_legal_review, 2);
    assert.equal(result.exclusionCountsByReason.insufficient_positive_company_signal, 2);
    assert.equal(result.exclusionCountsByReason.cpf_like_token_detected, 1);

    const statusSum = Object.values(result.classificationCounts).reduce((a, b) => a + b, 0);
    assert.equal(statusSum, result.sampleRowsSeen);
  });

  it('keeps every safety flag false', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });
    for (const value of Object.values(result.safety)) {
      assert.equal(value, false);
    }
  });
});

/**
 * BR Receita CNPJ company↔establishment BOUNDED JOIN dry-run — tests (BR-SOURCE-10G).
 *
 * BR-SOURCE-10F proved `estabelecimentos` rows cannot be classified alone (they
 * carry no natureza jurídica). This suite proves the bounded, privacy-safe join
 * that associates an establishment to its company context by the STRUCTURAL join
 * identifier (`cnpj_basico` / raiz) held ONLY in an ephemeral in-memory index, and:
 *   - joins a safe company to a safe establishment by structural key;
 *   - never prints or returns the join key;
 *   - holds an establishment with no sampled company (missing / pending);
 *   - excludes an establishment whose company is CPF-excluded (by association);
 *   - excludes an establishment with its OWN PII signal;
 *   - never lets reference lookups participate in the join;
 *   - bounds both sample sizes and refuses > 20;
 *   - emits join_counts + join_reason_counts, with all import/runtime/Agent 1 false;
 *   - preserves the BR-SOURCE-7 hard-block dry-run and the 10E/10F classifier;
 *   - trips the runner's sensitive-output assertion on raw values / join keys.
 *
 * 100% synthetic. No real dataset, no Supabase, no network, no runtime. Column
 * COUNTS mirror the official layout; cell VALUES are meaningless placeholders. Every
 * multi-digit token is built by CONCATENATION so no 8-/11-/14-digit literal exists
 * in source, and the join key is never a continuous 8-digit literal here.
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS } from '../br-receita-cnpj-file-reader';
import { runBrReceitaCnpjLocalDryRun } from '../br-receita-cnpj-local-dry-run';
import { runBrReceitaCnpjPrivacySafeClassifier } from '../br-receita-cnpj-privacy-safe-classifier';
import {
  BrReceitaCnpjJoinDryRunError,
  runBrReceitaCnpjCompanyEstablishmentJoinDryRun,
} from '../br-receita-cnpj-company-establishment-join-dry-run';
import {
  assertNoForbiddenKeysInOutput,
  assertSanitizedRunnerOutput,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-company-establishment-join-dry-run';
import type { BrReceitaCnpjManifest } from '../br-receita-cnpj-manifest';

// ─── Synthetic headerless builders (`;`-quoted; column COUNT = official layout) ──

const COUNTS = BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS;

/** Two distinct 8-digit structural roots, assembled so no 8-digit literal is source. */
const ROOT_A = '0001' + '0203';
const ROOT_B = '0009' + '0807';
/** A CPF-length (11-digit) token, assembled so no 11-digit literal lives in source. */
const CPF_LIKE_TOKEN = '12345' + '678901';
/** A persistible-column index for ESTABELECIMENTOS (identificador_matriz_filial). */
const ESTAB_PERSISTIBLE_INDEX = 3;

function q(cells: readonly string[]): string {
  return cells.map((c) => `"${c}"`).join(';');
}

/** A synthetic headerless EMPRESAS row (7 cols). `root`/`razao`/`natureza` overridable. */
function empresasRow(opts: { root?: string; razao?: string; natureza?: string } = {}): string {
  const cells = [
    opts.root ?? ROOT_A,
    opts.razao ?? 'ACME COMERCIO LTDA',
    opts.natureza ?? '2062',
    'qualif',
    '1000',
    '05',
    'ente',
  ];
  return q(cells);
}

/** A synthetic headerless ESTABELECIMENTOS row (30 cols). `root` + optional own-PII token. */
function estabRow(opts: { root?: string; piiAtPersistibleIndex?: string } = {}): string {
  const cells = Array.from({ length: COUNTS.estabelecimentos }, (_, i) => `c${i}`);
  cells[0] = opts.root ?? ROOT_A;
  cells[1] = '0001';
  cells[2] = '55';
  if (opts.piiAtPersistibleIndex !== undefined) {
    cells[ESTAB_PERSISTIBLE_INDEX] = opts.piiAtPersistibleIndex;
  }
  return q(cells);
}

/** A synthetic headerless CNAES reference row (2 cols) — a lookup, never a company. */
function cnaesRow(i: number): string {
  return q([`k${i}`, `label ${i}`]);
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
  /** Optional reference/regime lookup content (written + declared as `cnaes`). */
  readonly cnaes?: string;
  /** Mutate the default headerless manifest before it is written. */
  readonly mutate?: (m: BrReceitaCnpjManifest) => void;
}

function headerlessManifest(withCnaes: boolean): BrReceitaCnpjManifest {
  const files: BrReceitaCnpjManifest['files'] = [
    { fileType: 'empresas', path: 'empresas.csv', encoding: 'latin1', delimiter: ';', layoutMode: 'official_headerless' },
    { fileType: 'estabelecimentos', path: 'estabelecimentos.csv', encoding: 'latin1', delimiter: ';', layoutMode: 'official_headerless' },
  ];
  if (withCnaes) {
    files.push({ fileType: 'cnaes', path: 'cnaes.csv', encoding: 'latin1', delimiter: ';', layoutMode: 'official_headerless' });
  }
  return {
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    mode: 'local_manifest_validation',
    files,
  };
}

function makeFixture(spec: FixtureSpec): { dir: string; manifestPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brs10g-'));
  createdDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'empresas.csv'), spec.empresas, 'latin1');
  fs.writeFileSync(path.join(dir, 'estabelecimentos.csv'), spec.estabelecimentos, 'latin1');
  if (spec.cnaes !== undefined) fs.writeFileSync(path.join(dir, 'cnaes.csv'), spec.cnaes, 'latin1');
  const manifest = headerlessManifest(spec.cnaes !== undefined);
  spec.mutate?.(manifest);
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { dir, manifestPath };
}

// ─── 1) Structural join of a safe company + safe establishment ──────────────────

describe('join dry-run — structural association', () => {
  it('joins a synthetic safe company to a synthetic safe establishment by structural key', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_A })]),
      estabelecimentos: file([estabRow({ root: ROOT_A })]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.manifestValidation, 'passed');
    assert.equal(result.mode, 'company_establishment_join_bounded_dry_run');
    assert.equal(result.companiesSampled, 1);
    assert.equal(result.companiesIndexedForJoin, 1);
    assert.equal(result.establishmentsSampled, 1);
    assert.equal(result.joinCounts.joined_with_sampled_company_context, 1);
    assert.equal(result.joinReasonCounts.sampled_company_context_found, 1);
  });

  it('joins under an injected eligible legal-nature policy (company becomes eligible)', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_A, natureza: '2062' })]),
      estabelecimentos: file([estabRow({ root: ROOT_A })]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      eligibilityPolicy: { eligibleLegalNatureCodes: new Set(['2062']) },
    });
    assert.equal(result.companyClassificationCounts.eligible_for_future_import, 1);
    assert.equal(result.companiesIndexedForJoin, 1);
    assert.equal(result.joinCounts.joined_with_sampled_company_context, 1);
  });
});

// ─── 2) The join key is never printed or returned ───────────────────────────────

describe('join dry-run — join key never surfaced', () => {
  it('never returns the structural join key or an 8-digit CNPJ-básico literal', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_A })]),
      estabelecimentos: file([estabRow({ root: ROOT_A })]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
    });
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, new RegExp(ROOT_A)); // join key never present
    assert.doesNotMatch(json, /\b\d{8}\b/); // no CNPJ-básico-length literal
    assert.doesNotMatch(json, /\b\d{11}\b/); // no CPF-length literal
    assert.doesNotMatch(json, /\b\d{14}\b/); // no full-CNPJ literal
    assert.doesNotMatch(json, /ACME COMERCIO LTDA/); // no legal name
    assert.doesNotMatch(json.toLowerCase(), /"(join_key|company_key|establishment_key|cnpj_basico|row_hash)"/);
  });
});

// ─── 3) Establishment without a sampled company ─────────────────────────────────

describe('join dry-run — no sampled company context', () => {
  it('holds an establishment whose company is not in the bounded sample', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_A })]),
      estabelecimentos: file([estabRow({ root: ROOT_B })]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
    });
    assert.equal(result.joinCounts.joined_with_sampled_company_context, 0);
    // "missing" OR "pending_full_join_context" is acceptable per the contract.
    assert.equal(
      result.joinCounts.missing_sampled_company_context +
        result.joinCounts.pending_full_join_context,
      1,
    );
  });

  it('marks establishments pending_full_join_context when NO company was indexed', async () => {
    const { manifestPath } = makeFixture({
      // CPF-excluded company is not structurally usable context for a positive join,
      // but it IS indexed (blocked). To force an EMPTY index, sample zero company rows.
      empresas: file([empresasRow({ root: ROOT_A })]),
      estabelecimentos: file([estabRow({ root: ROOT_A })]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      maxCompanyRows: 0,
    });
    assert.equal(result.companiesSampled, 0);
    assert.equal(result.joinCounts.pending_full_join_context, 1);
    assert.equal(result.joinReasonCounts.establishment_requires_full_join_context, 1);
  });
});

// ─── 4) Establishment excluded by its company's PII risk ────────────────────────

describe('join dry-run — excluded by company context', () => {
  it('excludes an establishment whose CPF-excluded company blocks the join', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_A, razao: CPF_LIKE_TOKEN })]),
      estabelecimentos: file([estabRow({ root: ROOT_A })]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
    });
    assert.equal(result.companyClassificationCounts.excluded_person_or_pii_risk, 1);
    assert.equal(result.companiesIndexedForJoin, 0);
    assert.equal(result.companiesExcludedFromJoin, 1);
    assert.equal(result.joinCounts.excluded_due_to_company_context, 1);
    assert.equal(result.joinReasonCounts.company_context_person_or_pii_risk, 1);
  });
});

// ─── 5) Establishment with its OWN PII signal ───────────────────────────────────

describe('join dry-run — establishment own privacy signal', () => {
  it('excludes an establishment carrying its own CPF-like token before any join', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_A })]),
      estabelecimentos: file([estabRow({ root: ROOT_A, piiAtPersistibleIndex: CPF_LIKE_TOKEN })]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
    });
    assert.equal(result.establishmentClassificationCounts.excluded_person_or_pii_risk, 1);
    assert.equal(result.joinCounts.excluded_due_to_establishment_privacy_signal, 1);
    assert.equal(result.joinReasonCounts.establishment_privacy_signal_detected, 1);
    assert.equal(result.joinCounts.joined_with_sampled_company_context, 0);
  });
});

// ─── 6) Reference lookups never participate in the join ─────────────────────────

describe('join dry-run — lookups excluded from the join', () => {
  it('never samples reference/regime lookups into companies or establishments', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_A })]),
      estabelecimentos: file([estabRow({ root: ROOT_A })]),
      cnaes: file([cnaesRow(1), cnaesRow(2), cnaesRow(3)]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.companiesSampled, 1);
    assert.equal(result.establishmentsSampled, 1);
    // No lookup row inflated any join or classification bucket.
    const joinSum = Object.values(result.joinCounts).reduce((a, b) => a + b, 0);
    assert.equal(joinSum, result.establishmentsSampled);
  });
});

// ─── 7) Bounded sample sizes ────────────────────────────────────────────────────

describe('join dry-run — bounded sampling', () => {
  it('refuses maxCompanyRows > 20 before reading any file', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
    });
    await assert.rejects(
      () =>
        runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
          manifestPath,
          allowLocalManifest: true,
          maxCompanyRows: 21,
        }),
      BrReceitaCnpjJoinDryRunError,
    );
  });

  it('refuses maxEstablishmentRows > 20 before reading any file', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
    });
    await assert.rejects(
      () =>
        runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
          manifestPath,
          allowLocalManifest: true,
          maxEstablishmentRows: 21,
        }),
      /sample_row_limit_exceeded/,
    );
  });

  it('caps sampled rows at the requested bound', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([
        empresasRow({ root: ROOT_A }),
        empresasRow({ root: ROOT_B }),
        empresasRow({ root: ROOT_A }),
        empresasRow({ root: ROOT_B }),
      ]),
      estabelecimentos: file([
        estabRow({ root: ROOT_A }),
        estabRow({ root: ROOT_B }),
        estabRow({ root: ROOT_A }),
      ]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
      maxCompanyRows: 2,
      maxEstablishmentRows: 2,
    });
    assert.equal(result.companiesSampled, 2);
    assert.equal(result.establishmentsSampled, 2);
  });

  it('requires allowLocalManifest: true (fail-closed otherwise)', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
    });
    await assert.rejects(
      () => runBrReceitaCnpjCompanyEstablishmentJoinDryRun({ manifestPath, allowLocalManifest: false }),
      BrReceitaCnpjJoinDryRunError,
    );
  });
});

// ─── 8–11) Output shape & safety invariants ─────────────────────────────────────

describe('join dry-run — output shape & safety invariants', () => {
  it('emits join_counts and join_reason_counts with every key present', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_A })]),
      estabelecimentos: file([estabRow({ root: ROOT_A })]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
    });
    for (const key of [
      'joined_with_sampled_company_context',
      'missing_sampled_company_context',
      'excluded_due_to_company_context',
      'excluded_due_to_establishment_privacy_signal',
      'pending_full_join_context',
    ]) {
      assert.ok(key in result.joinCounts, `join_counts missing ${key}`);
    }
    for (const key of [
      'sampled_company_context_found',
      'sampled_company_context_missing',
      'company_context_person_or_pii_risk',
      'company_context_needs_legal_review',
      'establishment_privacy_signal_detected',
      'establishment_requires_full_join_context',
      'bounded_sample_only_not_importable',
    ]) {
      assert.ok(key in result.joinReasonCounts, `join_reason_counts missing ${key}`);
    }
  });

  it('keeps full_dataset_processed false', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
    });
    assert.equal(result.fullDatasetProcessed, false);
  });

  it('keeps import_executed and supabase_write false', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
    });
    assert.equal(result.importExecuted, false);
    assert.equal(result.supabaseWrite, false);
  });

  it('keeps runtime and Agent 1 integration false and every safety flag false', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjCompanyEstablishmentJoinDryRun({
      manifestPath,
      allowLocalManifest: true,
    });
    assert.equal(result.runtimeIntegration, false);
    assert.equal(result.agent1Integration, false);
    for (const value of Object.values(result.safety)) {
      assert.equal(value, false);
    }
    assert.equal(result.safety.joinKeysPrinted, false);
  });
});

// ─── 12–13) Coexistence with prior modes ────────────────────────────────────────

describe('join dry-run — coexistence with prior modes', () => {
  it('preserves the BR-SOURCE-7 hard-block dry-run on a PII sample', async () => {
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
  });

  it('preserves the BR-SOURCE-10E/10F privacy-safe classifier', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ root: ROOT_A })]),
      estabelecimentos: file([estabRow({ root: ROOT_A })]),
    });
    const classifier = await runBrReceitaCnpjPrivacySafeClassifier({
      manifestPath,
      allowLocalManifest: true,
    });
    assert.equal(classifier.ok, true);
    assert.equal(classifier.classificationCounts.needs_legal_review, 1);
    assert.equal(classifier.classificationCounts.pending_company_join_context, 1);
  });
});

// ─── 14) Sensitive-output assertion blocks raw values / join keys ───────────────

describe('join dry-run — sensitive output assertion', () => {
  it('rejects a rendered string containing an 8-digit CNPJ-básico-like literal', () => {
    assert.throws(
      () => assertSanitizedRunnerOutput(`companies_indexed_for_join: ${ROOT_A}`),
      /SENSITIVE_OUTPUT_LEAK/,
    );
  });

  it('rejects a rendered string containing a CPF-like literal', () => {
    assert.throws(() => assertSanitizedRunnerOutput(`leak ${CPF_LIKE_TOKEN}`), /SENSITIVE_OUTPUT_LEAK/);
  });

  it('rejects a report object that carries a forbidden join-key field', () => {
    assert.throws(
      () => assertNoForbiddenKeysInOutput({ ok: true, join_key: 'x' }),
      /SENSITIVE_OUTPUT_LEAK/,
    );
  });

  it('accepts a fully sanitized aggregate report string', () => {
    assert.doesNotThrow(() =>
      assertSanitizedRunnerOutput('joined_with_sampled_company_context: 1\nsupabase_write: false'),
    );
  });
});

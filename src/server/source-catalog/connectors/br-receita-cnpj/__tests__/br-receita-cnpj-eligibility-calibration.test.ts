/**
 * BR Receita CNPJ — eligibility & legal-nature calibration tests (BR-SOURCE-10F).
 *
 * Proves the conservative calibration layered on the BR-SOURCE-10E classifier:
 *   - a clean empresas row is `eligible_for_future_import` ONLY under an injected
 *     legal-nature policy (docs § 11 #2 keeps the allowlist undecided by default);
 *   - MEI / empresário individual natures are EXCLUDED (person/PII risk), not held;
 *   - a CPF-like token (built by concatenation) is excluded and never surfaced;
 *   - a risky / unsupported nature is `excluded_unsupported_legal_nature`;
 *   - an unknown nature is held as `needs_legal_review`;
 *   - reference lookups (cnaes/municipios/naturezas) are `not_applicable_lookup`,
 *     no longer inflating `needs_legal_review`;
 *   - establishments in isolation are `pending_company_join_context`;
 *   - the sanitized output never carries a row, value, full CNPJ, or CPF;
 *   - `legal_nature_classification_counts` / `positive_company_signal_counts` are
 *     correct; the BR-SOURCE-7 hard-block dry-run is preserved; the 20-row cap and
 *     all-false safety block still hold.
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
import { classifyLegalNatureRiskClass } from '../br-receita-cnpj-eligibility-rules';
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
const CPF_LIKE_TOKEN = '99887' + '766554';

/** Conservative synthetic natureza codes — meaningful only inside injected policies. */
const NATUREZA_COMMERCIAL = '2062'; // e.g. sociedade empresária limitada (synthetic)
const NATUREZA_MEI = '2135'; // e.g. empresário individual / MEI (synthetic)
const NATUREZA_RISKY = '4090'; // e.g. natural-person-family nature (synthetic)
const NATUREZA_UNKNOWN = '9999'; // deliberately unlisted → held for legal review

function q(cells: readonly string[]): string {
  return cells.map((c) => `"${c}"`).join(';');
}

/** A synthetic headerless EMPRESAS row (7 cols). `razao`/`natureza` are overridable. */
function empresasRow(opts: { razao?: string; natureza?: string } = {}): string {
  return q([
    CNPJ_ROOT,
    opts.razao ?? 'ACME COMERCIO LTDA',
    opts.natureza ?? NATUREZA_COMMERCIAL,
    'qualif',
    '1000',
    '05',
    'ente',
  ]);
}

/** A synthetic headerless ESTABELECIMENTOS row (30 cols). */
function estabRow(): string {
  const cells = Array.from({ length: COUNTS.estabelecimentos }, (_, i) => `c${i}`);
  cells[0] = CNPJ_ROOT;
  cells[1] = '0001';
  cells[2] = '55';
  return q(cells);
}

/** A synthetic headerless NATUREZAS reference-lookup row (2 cols: codigo, descricao). */
function naturezasRow(): string {
  return q([NATUREZA_COMMERCIAL, 'lookup label']);
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
  readonly extraFiles?: Record<string, string>;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brs10f-'));
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

// ─── 1. Eligible only under an injected commercial allowlist ────────────────────

describe('BR-SOURCE-10F eligibility calibration — eligible path', () => {
  it('marks a clean commercial empresas row eligible ONLY under an injected policy', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ natureza: NATUREZA_COMMERCIAL })]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({
      manifestPath,
      allowLocalManifest: true,
      eligibilityPolicy: { eligibleLegalNatureCodes: new Set([NATUREZA_COMMERCIAL]) },
    });
    assert.equal(result.classificationCounts.eligible_for_future_import, 1);
    assert.equal(result.exclusionCountsByReason.passed_all_eligibility_checks, 1);
    assert.equal(result.legalNatureClassificationCounts.allowed_commercial_organization, 1);
    assert.equal(result.positiveCompanySignalCounts.commercial_legal_nature, 1);
    assert.equal(result.positiveCompanySignalCounts.company_name_present, 1);
  });

  it('holds the same commercial row as needs_legal_review with NO policy (fail-closed default)', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ natureza: NATUREZA_COMMERCIAL })]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });
    assert.equal(result.classificationCounts.eligible_for_future_import, 0);
    assert.equal(result.classificationCounts.needs_legal_review, 1);
    assert.equal(result.legalNatureClassificationCounts.needs_legal_review, 1);
  });
});

// ─── 2–5. Legal-nature buckets ──────────────────────────────────────────────────

describe('BR-SOURCE-10F eligibility calibration — legal-nature buckets', () => {
  it('excludes a MEI / empresário individual nature as person/PII risk (not held)', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ natureza: NATUREZA_MEI })]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({
      manifestPath,
      allowLocalManifest: true,
      eligibilityPolicy: { meiIndividualLegalNatureCodes: new Set([NATUREZA_MEI]) },
    });
    assert.equal(result.classificationCounts.excluded_person_or_pii_risk, 1);
    assert.equal(result.classificationCounts.needs_legal_review, 0);
    assert.equal(result.exclusionCountsByReason.mei_or_individual_entrepreneur_signal, 1);
    assert.equal(result.legalNatureClassificationCounts.blocked_person_or_individual, 1);
  });

  it('excludes a CPF-like token (built by concatenation) as person/PII risk', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ razao: CPF_LIKE_TOKEN })]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });
    assert.equal(result.classificationCounts.excluded_person_or_pii_risk, 1);
    assert.equal(result.exclusionCountsByReason.cpf_like_token_detected, 1);
  });

  it('routes a risky / unsupported nature to excluded_unsupported_legal_nature', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ natureza: NATUREZA_RISKY })]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({
      manifestPath,
      allowLocalManifest: true,
      eligibilityPolicy: { riskyLegalNatureCodes: new Set([NATUREZA_RISKY]) },
    });
    assert.equal(result.classificationCounts.excluded_unsupported_legal_nature, 1);
    assert.equal(result.exclusionCountsByReason.unsupported_or_risky_legal_nature, 1);
    assert.equal(result.legalNatureClassificationCounts.blocked_risky_or_unsupported, 1);
  });

  it('holds an unknown / unlisted nature as needs_legal_review', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow({ natureza: NATUREZA_UNKNOWN })]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({
      manifestPath,
      allowLocalManifest: true,
      eligibilityPolicy: { eligibleLegalNatureCodes: new Set([NATUREZA_COMMERCIAL]) },
    });
    assert.equal(result.classificationCounts.needs_legal_review, 1);
    assert.equal(result.exclusionCountsByReason.unknown_requires_legal_review, 1);
    assert.equal(result.legalNatureClassificationCounts.needs_legal_review, 1);
  });
});

// ─── 6–7. Lookups and establishments no longer inflate needs_legal_review ───────

describe('BR-SOURCE-10F eligibility calibration — structural holds', () => {
  it('classifies reference lookups (naturezas) as not_applicable_lookup', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow()]),
      extraFiles: { 'naturezas.csv': file([naturezasRow(), naturezasRow()]) },
      mutate: (m) => {
        m.files.push({
          fileType: 'naturezas',
          path: 'naturezas.csv',
          encoding: 'latin1',
          delimiter: ';',
          layoutMode: 'official_headerless',
        });
      },
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });
    assert.equal(result.classificationCounts.not_applicable_lookup, 2);
    assert.equal(result.exclusionCountsByReason.structure_only_non_company_lookup, 2);
    assert.equal(result.legalNatureClassificationCounts.not_applicable_lookup, 2);
  });

  it('classifies an establishment in isolation as pending_company_join_context', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow()]),
      estabelecimentos: file([estabRow(), estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });
    assert.equal(result.classificationCounts.pending_company_join_context, 2);
    assert.equal(result.exclusionCountsByReason.establishment_requires_company_join_context, 2);
    assert.equal(result.positiveCompanySignalCounts.establishment_requires_join_context, 2);
  });
});

// ─── 8–9. Sanitization + aggregate correctness ──────────────────────────────────

describe('BR-SOURCE-10F eligibility calibration — sanitization & aggregates', () => {
  it('never surfaces a raw row, cell value, CPF, or full CNPJ in the output', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([empresasRow(), empresasRow({ razao: CPF_LIKE_TOKEN })]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({ manifestPath, allowLocalManifest: true });
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, /\b\d{11}\b/);
    assert.doesNotMatch(json, /\b\d{14}\b/);
    assert.doesNotMatch(json, new RegExp(CPF_LIKE_TOKEN));
    assert.doesNotMatch(json, /ACME COMERCIO LTDA/);
    assert.doesNotMatch(json.toLowerCase(), /"(cpf|socios|qsa|telefone|logradouro|bairro|cep|raw_row|legal_name)"/);
  });

  it('produces legal_nature_classification_counts that agree with the row mix', async () => {
    const { manifestPath } = makeFixture({
      empresas: file([
        empresasRow({ natureza: NATUREZA_COMMERCIAL }),
        empresasRow({ natureza: NATUREZA_UNKNOWN }),
      ]),
      estabelecimentos: file([estabRow()]),
    });
    const result = await runBrReceitaCnpjPrivacySafeClassifier({
      manifestPath,
      allowLocalManifest: true,
      eligibilityPolicy: { eligibleLegalNatureCodes: new Set([NATUREZA_COMMERCIAL]) },
    });
    assert.equal(result.legalNatureClassificationCounts.allowed_commercial_organization, 1);
    assert.equal(result.legalNatureClassificationCounts.needs_legal_review, 1);
    // the establishment carries no legal nature → not counted here
    assert.equal(result.legalNatureClassificationCounts.not_applicable_lookup, 0);
    assert.equal(result.classificationCounts.pending_company_join_context, 1);

    const statusSum = Object.values(result.classificationCounts).reduce((a, b) => a + b, 0);
    assert.equal(statusSum, result.sampleRowsSeen);
  });

  it('exposes classifyLegalNatureRiskClass as a pure fail-closed rule', () => {
    assert.equal(classifyLegalNatureRiskClass(NATUREZA_COMMERCIAL, undefined), 'needs_legal_review');
    assert.equal(
      classifyLegalNatureRiskClass(NATUREZA_COMMERCIAL, {
        eligibleLegalNatureCodes: new Set([NATUREZA_COMMERCIAL]),
      }),
      'allowed_commercial_organization',
    );
    assert.equal(
      classifyLegalNatureRiskClass(NATUREZA_MEI, {
        meiIndividualLegalNatureCodes: new Set([NATUREZA_MEI]),
      }),
      'blocked_person_or_individual',
    );
    // Most-restrictive-first: a risky listing wins even if also on the eligible set.
    assert.equal(
      classifyLegalNatureRiskClass(NATUREZA_RISKY, {
        eligibleLegalNatureCodes: new Set([NATUREZA_RISKY]),
        riskyLegalNatureCodes: new Set([NATUREZA_RISKY]),
      }),
      'blocked_risky_or_unsupported',
    );
  });
});

// ─── 10–12. Coexistence, bounded read, safety ───────────────────────────────────

describe('BR-SOURCE-10F eligibility calibration — invariants preserved', () => {
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
      BrReceitaCnpjPrivacyClassifierError,
    );
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
    assert.equal(result.fullDatasetProcessed, false);
    assert.equal(result.importExecuted, false);
    assert.equal(result.supabaseWrite, false);
    assert.equal(result.runtimeIntegration, false);
    assert.equal(result.agent1Integration, false);
  });
});

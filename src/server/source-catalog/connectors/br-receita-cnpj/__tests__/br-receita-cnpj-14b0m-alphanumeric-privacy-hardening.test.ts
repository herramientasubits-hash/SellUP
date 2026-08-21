/**
 * BR Receita CNPJ — ALPHANUMERIC CNPJ PRIVACY HARDENING — tests (BR-SOURCE-14B.0M § 21-28).
 *
 * The audit for this milestone found four independent, digit-only detectors that would each miss an
 * alphanumeric CNPJ (§ 3.1/§ 3.4, effective July 2026):
 *   - the privacy-safe classifier's `maxDigitRun` guard;
 *   - the BR-SOURCE-7 local dry-run's `FORBIDDEN_DIGIT_RUN` hard-block;
 *   - the full-join output sanitizer's `VALUE_PATTERNS`;
 *   - the private operator-metric-channel's `IDENTIFIER_LIKE_DIGIT_RUN` guard.
 *
 * This file tests the shared canonical detector (`br-receita-cnpj-identifier-shape.ts`) on its own,
 * then exercises each of the four sites through its REAL public entry point to prove the wiring
 * actually closes the gap — not just that the detector module works in isolation.
 *
 * 100% synthetic. Every CNPJ used here is a fabricated, DV-computed value — never a real one.
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { computeBrazilCnpjCheckDigits } from '../br-cnpj';
import {
  containsBrazilCnpjLikeIdentifier,
  findBrazilCnpjLikeIdentifiers,
} from '../br-receita-cnpj-identifier-shape';
import { classifyRow } from '../br-receita-cnpj-privacy-safe-classifier';
import { sanitizeBrazilReceitaFullJoinReport } from '../br-receita-cnpj-full-join-output-sanitizer';
import { validateBrazilReceitaFullJoinPrivateContent } from '../br-receita-cnpj-full-join-operator-metric-channel';
import { runBrReceitaCnpjLocalDryRun } from '../br-receita-cnpj-local-dry-run';

// ─── A synthetic, DV-valid alphanumeric CNPJ (never a real one) ───────────────────
const ALPHANUMERIC_CNPJ_IDENTITY = '12ABC345ABCD';
const ALPHANUMERIC_CNPJ = `${ALPHANUMERIC_CNPJ_IDENTITY}${computeBrazilCnpjCheckDigits(ALPHANUMERIC_CNPJ_IDENTITY)}`;
const ALPHANUMERIC_CNPJ_FORMATTED = `${ALPHANUMERIC_CNPJ.slice(0, 2)}.${ALPHANUMERIC_CNPJ.slice(2, 5)}.${ALPHANUMERIC_CNPJ.slice(5, 8)}/${ALPHANUMERIC_CNPJ.slice(8, 12)}-${ALPHANUMERIC_CNPJ.slice(12, 14)}`;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. The canonical detector, standalone
// ═══════════════════════════════════════════════════════════════════════════════

describe('br-receita-cnpj-identifier-shape — canonical alphanumeric CNPJ detector', () => {
  it('finds a DV-valid alphanumeric CNPJ embedded in a larger string', () => {
    assert.equal(containsBrazilCnpjLikeIdentifier(`prefix ${ALPHANUMERIC_CNPJ} suffix`), true);
    assert.deepEqual(findBrazilCnpjLikeIdentifiers(`x=${ALPHANUMERIC_CNPJ};y=1`), [ALPHANUMERIC_CNPJ]);
  });

  it('finds the officially formatted mask (letters in raiz+ordem, numeric DV)', () => {
    assert.equal(containsBrazilCnpjLikeIdentifier(ALPHANUMERIC_CNPJ_FORMATTED), true);
  });

  it('is case-insensitive on the base characters (normalizes before DV check)', () => {
    assert.equal(containsBrazilCnpjLikeIdentifier(ALPHANUMERIC_CNPJ.toLowerCase()), true);
  });

  it('still finds a legacy all-numeric, DV-valid CNPJ (subset of the alphanumeric grammar)', () => {
    const numericIdentity = '11222333000';
    const numericCnpj = `${numericIdentity}1${computeBrazilCnpjCheckDigits(`${numericIdentity}1`)}`;
    assert.equal(containsBrazilCnpjLikeIdentifier(numericCnpj), true);
  });

  // False-positive safety (§ 23).
  it('does NOT flag a hash-like 32-character hex string', () => {
    assert.equal(containsBrazilCnpjLikeIdentifier('d41d8cd98f00b204e9800998ecf8427e'), false);
  });

  it('does NOT flag a UUID fragment', () => {
    assert.equal(containsBrazilCnpjLikeIdentifier('a1b2c3d4-e5f6-47a8-9b0c-d1e2f3a4b5c6'), false);
  });

  it('does NOT flag an arbitrary 14-character uppercase technical token', () => {
    // Constructed to be shape-plausible (14 chars, [A-Z0-9]) but NOT DV-valid.
    const arbitraryToken = 'ZZZZZZZZZZZZZZ';
    assert.equal(containsBrazilCnpjLikeIdentifier(arbitraryToken), false);
  });

  it('does NOT flag a benign filename', () => {
    assert.equal(containsBrazilCnpjLikeIdentifier('empresas_part_09_final.csv'), false);
  });

  it('does NOT flag a metric/label key', () => {
    assert.equal(containsBrazilCnpjLikeIdentifier('partitionHandlePeakOpenCount'), false);
  });

  it('returns [] / false for non-string and empty input, and never throws', () => {
    assert.deepEqual(findBrazilCnpjLikeIdentifiers(undefined), []);
    assert.deepEqual(findBrazilCnpjLikeIdentifiers(null), []);
    assert.deepEqual(findBrazilCnpjLikeIdentifiers(42), []);
    assert.deepEqual(findBrazilCnpjLikeIdentifiers(''), []);
    assert.equal(containsBrazilCnpjLikeIdentifier(''), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Classifier — an alphanumeric CNPJ in a persistible cell is caught
// ═══════════════════════════════════════════════════════════════════════════════

describe('br-receita-cnpj-privacy-safe-classifier — alphanumeric CNPJ wiring', () => {
  it('classifies a row carrying an alphanumeric CNPJ as cnpj_like_token_detected_outside_identity', () => {
    const cells = ['AB', 'Synthetic Ltda', ALPHANUMERIC_CNPJ, '2062', '100.00'];
    const result = classifyRow('empresas', 'company', cells, cells.length, undefined);
    assert.equal(result.reason, 'cnpj_like_token_detected_outside_identity');
  });

  it('numeric behavior is preserved: a legacy 14-digit run is still caught', () => {
    const numericRun = '9'.repeat(14);
    const cells = ['AB', numericRun, '2062', '100.00', '03'];
    const result = classifyRow('empresas', 'company', cells, cells.length, undefined);
    assert.equal(result.reason, 'cnpj_like_token_detected_outside_identity');
  });

  it('does not flag an ordinary row', () => {
    const cells = ['AB', 'Synthetic Ltda', '2062', '100.00', '03'];
    const result = classifyRow('empresas', 'company', cells, cells.length, undefined);
    assert.notEqual(result.reason, 'cnpj_like_token_detected_outside_identity');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Output sanitizer — scalar, nested, array, error message
// ═══════════════════════════════════════════════════════════════════════════════

describe('br-receita-cnpj-full-join-output-sanitizer — alphanumeric CNPJ wiring', () => {
  it('catches an alphanumeric CNPJ as a top-level scalar value', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ someField: ALPHANUMERIC_CNPJ });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.kind === 'cnpj_completo_like' && f.path === 'someField'));
  });

  it('catches an alphanumeric CNPJ nested inside an object', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ outer: { inner: { deep: ALPHANUMERIC_CNPJ } } });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.kind === 'cnpj_completo_like'));
  });

  it('catches an alphanumeric CNPJ inside an array', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ items: ['safe', ALPHANUMERIC_CNPJ, 'also safe'] });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.kind === 'cnpj_completo_like'));
  });

  it('catches an alphanumeric CNPJ embedded in an error-message-shaped string', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      errors: [{ message: `unexpected value for company ${ALPHANUMERIC_CNPJ}` }],
    });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.kind === 'cnpj_completo_like'));
  });

  it('catches the officially formatted alphanumeric mask too', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ someField: ALPHANUMERIC_CNPJ_FORMATTED });
    assert.equal(result.ok, false);
  });

  it('numeric behavior is preserved: a legacy formatted CNPJ is still caught first by its own pattern', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ someField: '11.222.333/0001-81' });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.kind === 'cnpj_completo_like'));
  });

  it('does not flag an ordinary bucketed report', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      family: 'empresas',
      status: 'not_approved',
      count_bucket: 'lte_1000',
    });
    assert.equal(result.ok, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Private operator-metric channel — rejects both numeric and alphanumeric
// ═══════════════════════════════════════════════════════════════════════════════

describe('br-receita-cnpj-full-join-operator-metric-channel — alphanumeric CNPJ wiring', () => {
  function basePayload(overrides: Record<string, unknown> = {}) {
    return {
      channel_version: 1,
      envelope_version: 1,
      peakRssBytes: 1,
      peakHeapUsedBytes: 1,
      peakExternalMemoryBytes: 1,
      totalDurationMs: 1,
      phaseDurationsMs: {
        preflight: null,
        manifest_validation: null,
        empresas_read: 1,
        estabelecimentos_read: 1,
        cleanup: 1,
        sanitization: null,
      },
      bytesRead: 1,
      rowsRead: 1,
      filesOpened: 1,
      temporaryStoragePeakBytes: 0,
      joinKeysPeakInMemory: 0,
      outputRowsMaterialized: 0,
      partitionsCreated: 1,
      largestPartitionReferenceCount: 0,
      filesOpenedPeak: 1,
      partitionHandlePeakOpen: 0,
      cleanupResult: 'completed',
      sanitizerResult: 'passed',
      ...overrides,
    };
  }

  it('rejects a payload carrying an alphanumeric CNPJ value', () => {
    const findings = validateBrazilReceitaFullJoinPrivateContent(
      basePayload({ cleanupResult: ALPHANUMERIC_CNPJ }) as never,
    );
    assert.ok(findings.length > 0);
  });

  it('numeric behavior is preserved: still rejects a legacy digit-run value', () => {
    const findings = validateBrazilReceitaFullJoinPrivateContent(
      basePayload({ cleanupResult: '9'.repeat(14) }) as never,
    );
    assert.ok(findings.length > 0);
    assert.ok(findings.some((f) => f.kind === 'identifier_like_digit_run'));
  });

  it('accepts the unmodified baseline payload', () => {
    const findings = validateBrazilReceitaFullJoinPrivateContent(basePayload() as never);
    assert.deepEqual(findings, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. BR-SOURCE-7 local dry-run hard-block — alphanumeric CNPJ in a sampled cell
// ═══════════════════════════════════════════════════════════════════════════════

const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

function makeTempManifest(csvs: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brs14b0m-alnum-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(csvs)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  const manifest = {
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    mode: 'local_manifest_validation',
    files: [
      { fileType: 'empresas', path: 'empresas.csv', encoding: 'utf8', delimiter: ',' },
      { fileType: 'estabelecimentos', path: 'estabelecimentos.csv', encoding: 'utf8', delimiter: ',' },
    ],
  };
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
  return manifestPath;
}

describe('runBrReceitaCnpjLocalDryRun — alphanumeric CNPJ hard-block wiring', () => {
  it('flags a sampled cell carrying an alphanumeric CNPJ, without leaking it', async () => {
    const manifestPath = makeTempManifest({
      'empresas.csv': `cnpj_basico,razao_social\n11222333,SAFE NAME\n11222333,${ALPHANUMERIC_CNPJ}\n`,
      'estabelecimentos.csv': 'cnpj_basico,cnpj_ordem,cnpj_dv\n11222333,0001,81\n',
    });
    const result = await runBrReceitaCnpjLocalDryRun({
      manifestPath,
      allowLocalManifest: true,
      dryRunOnly: true,
    });
    assert.equal(result.ok, false);
    const empresas = result.fileReports.find((r) => r.fileType === 'empresas');
    assert.ok(empresas);
    assert.equal(empresas.sampleValidation, 'failed');
    assert.equal(empresas.reasonCode, 'sample_row_forbidden_value_detected');
    assert.doesNotMatch(JSON.stringify(result), new RegExp(ALPHANUMERIC_CNPJ));
  });
});

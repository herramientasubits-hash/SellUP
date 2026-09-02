/**
 * BR Receita CNPJ — ALPHANUMERIC CNPJ REDACTION COMPLETENESS (§ 3.1/§ 3.4, July 2026).
 *
 * BR-SOURCE-14B.0M closed the letters gap on the FOUR detection surfaces it audited — the
 * privacy-safe classifier, the BR-SOURCE-7 local dry-run hard block, the full-join output
 * sanitizer and the private operator metric channel — by routing each through the shared
 * DV-validated detector in `br-receita-cnpj-identifier-shape`. This milestone audited the rest of
 * the connector for the same defect and found TWO surfaces 14B.0M did not reach:
 *
 *   1. `br-receita-cnpj-compact-storage`'s run-provenance guard, `\d{14}`. This one is a
 *      PERSISTENCE boundary, not a report: it decides whether `parser_version`,
 *      `source_file_name` or `import_batch_id` may land in `source_snapshot_runs.metadata`.
 *      Letters are inside every safe provenance charset, so an alphanumeric CNPJ satisfied every
 *      shape check, matched no digit rule, and would have been persisted as a SECOND exact CNPJ
 *      representation — the thing GATE-4A allows exactly once.
 *   2. `run-br-receita-cnpj-controlled-parser`'s `assertSanitizedRunnerOutput`, `\b\d{14}\b`. Its
 *      sibling runners (`privacy-safe-dry-run`, `local-dry-run`, `manifest-validator`,
 *      `company-establishment-join-dry-run`) all carry the alphanumeric literal check as well;
 *      the controlled parser — the runner that actually parses Receita files — did not.
 *
 * ── The three cases this suite pins on every surface ────────────────────────────
 *   A. a HISTORICAL numeric CNPJ                → refused / redacted (unchanged behaviour)
 *   B. an ALPHANUMERIC Receita-2026 CNPJ        → refused / redacted (the gap this closes)
 *   C. a CNPJ-LOOKALIKE that is not a CNPJ      → NOT refused, so output stays usable
 *
 * Case C is why the two surfaces answer with different filters, and the difference is deliberate:
 *   · a REPORT surface is DV-filtered, because flagging every fourteen-character technical token
 *     would make every report unusable (a random token passes two mod-11 digits ~1-in-10,000);
 *   · a PERSISTENCE surface is shape-only and boundary-delimited, because there a false positive
 *     costs one absent optional provenance field while a false negative persists an identifier.
 *
 * 100% synthetic and pure: every CNPJ here is fabricated and DV-COMPUTED, never a real one. No
 * network, no Supabase, no provider, no real Receita data, no filesystem write. The only I/O is
 * reading this repository's own sources for the completeness ratchet. 0 credits, 0 writes, 0 rows.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { computeBrazilCnpjCheckDigits } from '../br-cnpj';
import {
  BR_RECEITA_COMPACT_STORAGE_CONTRACT,
  brReceitaRunProvenanceForRun,
  containsForbiddenCnpjIdentifierShape,
} from '../br-receita-cnpj-compact-storage';
import { BR_RECEITA_CNPJ_PARSER_VERSION } from '../br-receita-cnpj-types';
import { containsBrazilCnpjLikeIdentifier } from '../br-receita-cnpj-identifier-shape';
import { sanitizeBrazilReceitaFullJoinReport } from '../br-receita-cnpj-full-join-output-sanitizer';
import { classifyRow } from '../br-receita-cnpj-privacy-safe-classifier';
import {
  RunnerOutputSanitizationError,
  assertSanitizedRunnerOutput,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-controlled-parser';

// ─── Synthetic fixtures (assembled, never literal) ────────────────────────────

/** Case A — the historical numeric identifier. */
const NUMERIC_CNPJ = ['11222333', '0001', '81'].join('');

/** Case B — the § 3.1 alphanumeric identifier, with REAL check digits for its identity. */
const ALNUM_IDENTITY = '12ABC345ABCD';
const ALNUM_CNPJ = `${ALNUM_IDENTITY}${computeBrazilCnpjCheckDigits(ALNUM_IDENTITY)}`;
/** The same identity with the WRONG check digits: CNPJ-shaped, DV-invalid. */
const ALNUM_CNPJ_BAD_DV = `${ALNUM_IDENTITY}${computeBrazilCnpjCheckDigits(ALNUM_IDENTITY) === '00' ? '01' : '00'}`;

/** Case C — lookalikes that are NOT CNPJ-shaped under either grammar. */
const UUID_BATCH_ID = '33333333-3333-4333-8333-333333333333';
const MD5_LIKE = 'd41d8cd98f00b204e9800998ecf8427e';
const SHA1_LIKE = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
/** Fourteen alphanumerics, but the last two are LETTERS: no CNPJ has a non-numeric DV. */
const FOURTEEN_ENDING_IN_LETTERS = 'DEADBEEFCAFEBA';
/** Thirteen and fifteen alphanumerics: the wrong length for the grammar. */
const THIRTEEN_RUN = 'DEADBEEFCAF12';
const FIFTEEN_RUN = 'DEADBEEFCAFEB12';
const SIMPLE_FILE_NAME = 'empresas_part_09_final.csv';
const CANONICAL_INSTANT = '2026-07-12T09:18:00.000Z';

const PERSISTABLE_LOOKALIKES = [
  BR_RECEITA_CNPJ_PARSER_VERSION,
  UUID_BATCH_ID,
  MD5_LIKE,
  SHA1_LIKE,
  FOURTEEN_ENDING_IN_LETTERS,
  THIRTEEN_RUN,
  FIFTEEN_RUN,
  SIMPLE_FILE_NAME,
  'national-2026-07',
  CANONICAL_INSTANT,
];

// ═══════════════════════════════════════════════════════════════════════════════
// 1. The PERSISTENCE boundary: run-level provenance
// ═══════════════════════════════════════════════════════════════════════════════

describe('compact-storage run provenance — alphanumeric CNPJ refusal', () => {
  it('case A: a historical numeric CNPJ is still refused (behaviour unchanged)', () => {
    assert.equal(containsForbiddenCnpjIdentifierShape(NUMERIC_CNPJ), true);
    assert.equal(containsForbiddenCnpjIdentifierShape(`national-${NUMERIC_CNPJ}`), true);
    // Unanchored on purpose for the digit grammar: a longer run is a superset, not an escape.
    assert.equal(containsForbiddenCnpjIdentifierShape(`${NUMERIC_CNPJ}7`), true);
  });

  it('case B: an alphanumeric Receita-2026 CNPJ is refused, DV-valid or not', () => {
    assert.equal(containsForbiddenCnpjIdentifierShape(ALNUM_CNPJ), true);
    // The persistence rule is shape-only, so a typo'd identifier does not survive it either.
    assert.equal(containsForbiddenCnpjIdentifierShape(ALNUM_CNPJ_BAD_DV), true);
    assert.equal(containsForbiddenCnpjIdentifierShape(`${ALNUM_CNPJ}.csv`), true);
    assert.equal(containsForbiddenCnpjIdentifierShape(`br-receita-cnpj-${ALNUM_CNPJ}@1`), true);
    assert.equal(containsForbiddenCnpjIdentifierShape(`national-${ALNUM_CNPJ}`), true);
    assert.equal(containsForbiddenCnpjIdentifierShape(ALNUM_CNPJ.toLowerCase()), true);
  });

  it('case C: lookalikes stay persistable, so provenance does not silently vanish', () => {
    for (const safe of PERSISTABLE_LOOKALIKES) {
      assert.equal(
        containsForbiddenCnpjIdentifierShape(safe),
        false,
        `must remain persistable: length ${safe.length}`,
      );
    }
  });

  it('case B, end to end: an alphanumeric CNPJ never reaches run metadata', () => {
    const built = brReceitaRunProvenanceForRun({
      parser_version: ALNUM_CNPJ,
      source_file_name: `${ALNUM_CNPJ}.csv`,
      import_batch_id: `national-${ALNUM_CNPJ}`,
      source_downloaded_at: CANONICAL_INSTANT,
    });
    // `parser_version` is mandatory, so it FALLS BACK rather than disappearing; the two optional
    // carriers are OMITTED, never basenamed or trimmed into a laundered value.
    assert.deepEqual(built, {
      parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
      source_downloaded_at: CANONICAL_INSTANT,
    });
    assert.ok(
      !JSON.stringify(built).includes(ALNUM_CNPJ),
      'no alphanumeric CNPJ may appear in run metadata',
    );
  });

  it('case C, end to end: legitimate provenance is untouched by the widened rule', () => {
    assert.deepEqual(
      brReceitaRunProvenanceForRun({
        parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
        source_file_name: SIMPLE_FILE_NAME,
        source_downloaded_at: CANONICAL_INSTANT,
        import_batch_id: UUID_BATCH_ID,
      }),
      {
        parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
        source_file_name: SIMPLE_FILE_NAME,
        source_downloaded_at: CANONICAL_INSTANT,
        import_batch_id: UUID_BATCH_ID,
      },
    );
  });

  it('the contract records the widening, and records that it is boundary-delimited', () => {
    assert.equal(BR_RECEITA_COMPACT_STORAGE_CONTRACT.runLevelProvenanceRefusesCnpjShapedValues, true);
    assert.equal(
      BR_RECEITA_COMPACT_STORAGE_CONTRACT.runLevelProvenanceRefusesAlphanumericCnpjShapedValues,
      true,
    );
    assert.equal(
      BR_RECEITA_COMPACT_STORAGE_CONTRACT.runLevelProvenanceAlphanumericRefusalIsBoundaryDelimited,
      true,
    );
    assert.equal(
      BR_RECEITA_COMPACT_STORAGE_CONTRACT.runLevelProvenanceCnpjRefusalIsCheckDigitIndependent,
      true,
    );
    // GATE-4A is not widened by this fix: still exactly one persisted representation.
    assert.equal(BR_RECEITA_COMPACT_STORAGE_CONTRACT.identityRepresentationCount, 1);
    assert.equal(BR_RECEITA_COMPACT_STORAGE_CONTRACT.gate4aPermissionWidened, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. The controlled parser's rendered-output guard
// ═══════════════════════════════════════════════════════════════════════════════

describe('run-br-receita-cnpj-controlled-parser — rendered-output guard', () => {
  const throwsSanitization = (rendered: string) =>
    assert.throws(() => assertSanitizedRunnerOutput(rendered, []), RunnerOutputSanitizationError);

  it('case A: a rendered numeric CNPJ literal still throws', () => {
    throwsSanitization(`{"note":"${NUMERIC_CNPJ}"}`);
  });

  it('case B: a rendered alphanumeric CNPJ literal throws', () => {
    throwsSanitization(`{"note":"${ALNUM_CNPJ}"}`);
    throwsSanitization(`{"note":"${ALNUM_CNPJ_BAD_DV}"}`);
  });

  it('case C: an ordinary aggregate report renders without throwing', () => {
    assert.doesNotThrow(() =>
      assertSanitizedRunnerOutput(
        JSON.stringify({
          family: 'empresas',
          status: 'not_approved',
          period: '2026-07',
          rows_read: 1234,
          parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
          import_batch_id: UUID_BATCH_ID,
        }),
        [],
      ),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. The REPORT surfaces stay DV-filtered — the same three cases, other answer for C
// ═══════════════════════════════════════════════════════════════════════════════

describe('report surfaces — the three cases, DV-filtered', () => {
  it('case A: the sanitizer still rejects a historical numeric CNPJ', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ someField: NUMERIC_CNPJ });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((finding) => finding.kind === 'cnpj_completo_like'));
  });

  it('case B: the sanitizer rejects an alphanumeric CNPJ', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ someField: ALNUM_CNPJ });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((finding) => finding.kind === 'cnpj_completo_like'));
  });

  it('case C: lookalikes do NOT make a report unusable', () => {
    for (const lookalike of [MD5_LIKE, SHA1_LIKE, FOURTEEN_ENDING_IN_LETTERS, ALNUM_CNPJ_BAD_DV]) {
      assert.equal(containsBrazilCnpjLikeIdentifier(lookalike), false, lookalike);
    }
    const result = sanitizeBrazilReceitaFullJoinReport({
      family: 'empresas',
      status: 'not_approved',
      someField: FOURTEEN_ENDING_IN_LETTERS,
    });
    assert.equal(result.ok, true);
  });

  it('case B: the classifier flags a cell carrying an alphanumeric CNPJ', () => {
    const cells = ['AB', 'Synthetic Ltda', ALNUM_CNPJ, '2062', '100.00'];
    const result = classifyRow('empresas', 'company', cells, cells.length, undefined);
    assert.equal(result.reason, 'cnpj_like_token_detected_outside_identity');
  });

  it('case C: the classifier does not flag a lookalike cell', () => {
    const cells = ['AB', 'Synthetic Ltda', FOURTEEN_ENDING_IN_LETTERS, '2062', '100.00'];
    const result = classifyRow('empresas', 'company', cells, cells.length, undefined);
    assert.notEqual(result.reason, 'cnpj_like_token_detected_outside_identity');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Completeness ratchet: no digit-only CNPJ detector may be added without a
//    letters-aware counterpart in the same file
// ═══════════════════════════════════════════════════════════════════════════════

const ROOT = path.resolve(__dirname, '../../../../../..');
const CONNECTOR_DIR = 'src/server/source-catalog/connectors/br-receita-cnpj';
const SCRIPTS_DIR = 'scripts/source-catalog';

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/** A CNPJ-length DIGIT-ONLY detector: the exact defect class 14B.0M was about. */
const DIGIT_ONLY_CNPJ_DETECTOR = /\\d\{(?:8|11|14)(?:,\d*)?\}/;
/** Evidence that the same file also knows about letters. */
const LETTERS_AWARE = /(?:A-Za-z0-9|A-Z0-9|BrazilCnpjLikeIdentifier|normalizeBrazilCnpj)/;

function brazilSourceFiles(): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, CONNECTOR_DIR), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(`${CONNECTOR_DIR}/${entry.name}`);
  }
  for (const entry of readdirSync(path.join(ROOT, SCRIPTS_DIR), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts') && entry.name.includes('br-receita-cnpj')) {
      files.push(`${SCRIPTS_DIR}/${entry.name}`);
    }
  }
  return files;
}

describe('alphanumeric CNPJ detection completeness across the connector', () => {
  it('every digit-only CNPJ detector shares a file with a letters-aware rule', () => {
    const digitOnly: string[] = [];
    for (const rel of brazilSourceFiles()) {
      const code = stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));
      if (!DIGIT_ONLY_CNPJ_DETECTOR.test(code)) continue;
      if (!LETTERS_AWARE.test(code)) digitOnly.push(rel);
    }
    assert.deepEqual(
      digitOnly,
      [],
      `these files detect a CNPJ by digits only and would miss the July 2026 alphanumeric form: ${digitOnly.join(', ')}`,
    );
  });

  it('the two surfaces this milestone fixed are actually in the swept set', () => {
    const swept = brazilSourceFiles();
    assert.ok(swept.includes(`${CONNECTOR_DIR}/br-receita-cnpj-compact-storage.ts`));
    assert.ok(swept.includes(`${SCRIPTS_DIR}/run-br-receita-cnpj-controlled-parser.ts`));
    // …and the ratchet is reading enough of the connector to be a real sweep, not a two-file check.
    assert.ok(swept.length > 40, `expected a broad sweep, got ${swept.length} files`);
  });
});

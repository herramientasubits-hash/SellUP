/**
 * BR-SOURCE-GATE-ROUND-1 — the CNPJ snapshot blocker, closed and ratcheted.
 *
 * The recorded GATE-3 field policy prohibits `CNPJ básico`, `full CNPJ`, `cnpj_root`, `cnpj_order`,
 * `cnpj_dv` and `reconstructable CNPJ parts` in output. `BrReceitaCnpjSnapshotRawData` calls itself
 * "sanitized snapshot output (allowlist only — data-contract § 5.2)" and carried all three parts, so
 * that claim was false; and its own defence, `assertSanitizedRawData`, inspected KEY NAMES only, so
 * renaming the key would have defeated it.
 *
 * What this suite freezes:
 *
 *   1. the three fields are GONE from the sanitized output, and the allowlist assertion in the
 *      sibling parser suite catches a re-introduction by key;
 *   2. the full CNPJ cannot be RECONSTRUCTED from what remains — proved by trying, over every
 *      ordered pair and triple of string leaves, not by asserting the fields are absent again;
 *   3. the sanitizer now rejects a forbidden VALUE under a PERMITTED key, which is the whole
 *      difference between key-only and key+value;
 *   4. the alphanumeric case is covered — an alphanumeric raiz smuggled in lower case is still
 *      caught, because the comparison uses the canonical form the identifier module already uses;
 *   5. 🔴 the benign business numerics SURVIVE. An eight-digit `YYYYMMDD` opening date and a
 *      capital figure are exactly what a blunt "eight digits is a básico" rule would destroy, and
 *      this suite fails if a future tightening does destroy them.
 *
 * 100% synthetic. No real CNPJ, no real company, no CPF, no SOCIOS/QSA. Pure in-memory: no network,
 * no filesystem, no database, no provider. 0 credits.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildBrReceitaCnpjSnapshotRows,
  BrReceitaCnpjForbiddenSourceError,
} from '../br-receita-cnpj-snapshot-builder';
import {
  sampleParserInput,
  sampleFullCnpj,
  empresasFixture,
  estabelecimentosFixture,
  naturezasFixture,
  cnaesFixture,
  simplesFixture,
  RAIZ_TECNOLOGIA,
  RAIZ_EDUCACAO,
  SAMPLE_SOURCE_YEAR,
  SAMPLE_SOURCE_PERIOD,
} from '../br-receita-cnpj-fixtures';
import {
  normalizeBrazilCnpj,
  stripBrazilCnpjPunctuationAndUpper,
} from '../br-cnpj';
import type {
  BrReceitaCnpjParserInput,
  BrReceitaCnpjSnapshotRawData,
} from '../br-receita-cnpj-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Every string leaf of a sanitized output block, in declaration order. */
function stringLeaves(rawData: BrReceitaCnpjSnapshotRawData): string[] {
  const leaves: string[] = [];
  for (const value of Object.values(rawData as unknown as Record<string, unknown>)) {
    for (const leaf of Array.isArray(value) ? value : [value]) {
      if (typeof leaf === 'string' && leaf.length > 0) leaves.push(leaf);
    }
  }
  return leaves;
}

/** A parser input with one establishment row field overridden on the legacy-numeric matriz row. */
function inputWithEstablishmentOverride(
  override: Record<string, unknown>,
): BrReceitaCnpjParserInput {
  const rows = estabelecimentosFixture();
  rows[0] = { ...rows[0]!, ...override };
  return { ...sampleParserInput(), estabelecimentosRows: rows };
}

/** A parser input with one EMPRESAS field overridden on the legacy-numeric root. */
function inputWithEmpresaOverride(override: Record<string, unknown>): BrReceitaCnpjParserInput {
  const rows = empresasFixture();
  rows[0] = { ...rows[0]!, ...override };
  return { ...sampleParserInput(), empresasRows: rows };
}

const TECNOLOGIA_MATRIZ_FULL = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
const EDUCACAO_MATRIZ_FULL = sampleFullCnpj(RAIZ_EDUCACAO, '0001');

/**
 * A DV-valid CNPJ that belongs to NO row in the fixture. Used to prove the shape+DV check fires
 * independently of the per-row derivation check.
 */
const FOREIGN_DV_VALID_CNPJ = sampleFullCnpj('55666777', '0009');

// ─── 1 · the three fields are gone ────────────────────────────────────────────

describe('GATE-ROUND-1 § 1 · cnpj_root / cnpj_order / cnpj_dv are absent from the output', () => {
  it('no accepted snapshot carries any of the three keys', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    assert.ok(result.snapshots.length > 0, 'the fixture produces accepted rows');

    for (const snap of result.snapshots) {
      for (const forbidden of ['cnpj_root', 'cnpj_order', 'cnpj_dv']) {
        assert.equal(
          forbidden in snap.raw_data,
          false,
          `${forbidden} must not survive into the sanitized output`,
        );
      }
    }
  });

  it('🔴 no output key mentions cnpj at all — a renamed part is still a part', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    for (const snap of result.snapshots) {
      for (const key of Object.keys(snap.raw_data)) {
        assert.equal(
          key.toLowerCase().includes('cnpj'),
          false,
          `sanitized output key must not name the identifier: ${key}`,
        );
      }
    }
  });

  it('trade_name / nome fantasia is NOT implemented, under any spelling', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    for (const snap of result.snapshots) {
      for (const key of Object.keys(snap.raw_data)) {
        const lower = key.toLowerCase();
        assert.equal(lower.includes('trade_name'), false, key);
        assert.equal(lower.includes('fantasia'), false, key);
      }
    }
  });
});

// ─── 2 · reconstruction is impossible ─────────────────────────────────────────

describe('GATE-ROUND-1 § 2 · the full CNPJ cannot be reconstructed from the output', () => {
  it('🔴 no single leaf carries the full CNPJ or the básico, in any punctuation form', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());

    for (const snap of result.snapshots) {
      const full = stripBrazilCnpjPunctuationAndUpper(snap.normalized_tax_id);
      const basico = full.slice(0, 8);
      for (const leaf of stringLeaves(snap.raw_data)) {
        const canonical = stripBrazilCnpjPunctuationAndUpper(leaf);
        assert.equal(canonical.includes(full), false, `leaf carries the full CNPJ: ${leaf}`);
        assert.equal(canonical.includes(basico), false, `leaf carries the básico: ${leaf}`);
      }
    }
  });

  it('🔴 no ordered PAIR of leaves concatenates into this row’s CNPJ', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());

    for (const snap of result.snapshots) {
      const target = stripBrazilCnpjPunctuationAndUpper(snap.normalized_tax_id);
      const leaves = stringLeaves(snap.raw_data).map(stripBrazilCnpjPunctuationAndUpper);
      for (const a of leaves) {
        for (const b of leaves) {
          assert.notEqual(`${a}${b}`, target, 'a pair of output values rebuilt the identifier');
        }
      }
    }
  });

  it('🔴 no ordered TRIPLE of leaves concatenates into this row’s CNPJ', () => {
    // The historical shape was exactly a triple — raiz + ordem + DV — so a triple is the case this
    // assertion exists for. It is the proof that removal was not cosmetic.
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());

    for (const snap of result.snapshots) {
      const target = stripBrazilCnpjPunctuationAndUpper(snap.normalized_tax_id);
      const leaves = stringLeaves(snap.raw_data).map(stripBrazilCnpjPunctuationAndUpper);
      for (const a of leaves) {
        for (const b of leaves) {
          for (const c of leaves) {
            assert.notEqual(`${a}${b}${c}`, target, 'a triple of output values rebuilt the identifier');
          }
        }
      }
    }
  });

  it('the serialized output block contains no DV-valid CNPJ at all', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    for (const snap of result.snapshots) {
      const serialized = JSON.stringify(snap.raw_data);
      assert.ok(!serialized.includes(TECNOLOGIA_MATRIZ_FULL));
      assert.ok(!serialized.includes(EDUCACAO_MATRIZ_FULL));
      assert.ok(!serialized.includes(RAIZ_TECNOLOGIA));
      assert.ok(!serialized.includes(RAIZ_EDUCACAO));
    }
  });
});

// ─── 3 · the sanitizer now inspects VALUES ────────────────────────────────────

describe('GATE-ROUND-1 § 3 · a forbidden VALUE under a PERMITTED key is rejected', () => {
  it('🔴 the básico smuggled into matrix_branch_flag throws', () => {
    // `matrix_branch_flag` is an ALLOWED key carrying free source text. Key-only sanitization saw
    // nothing wrong with this row; that is precisely the hole being closed.
    assert.throws(
      () =>
        buildBrReceitaCnpjSnapshotRows(
          inputWithEstablishmentOverride({ identificador_matriz_filial: RAIZ_TECNOLOGIA }),
        ),
      (error: unknown) =>
        error instanceof BrReceitaCnpjForbiddenSourceError &&
        error.message.includes('CNPJ básico'),
    );
  });

  it('🔴 the full CNPJ smuggled into capital_social throws', () => {
    assert.throws(
      () =>
        buildBrReceitaCnpjSnapshotRows(
          inputWithEmpresaOverride({ capital_social: TECNOLOGIA_MATRIZ_FULL }),
        ),
      (error: unknown) => error instanceof BrReceitaCnpjForbiddenSourceError,
    );
  });

  it('a DV-valid CNPJ belonging to NO row is rejected too — shape plus DV, not just derivation', () => {
    assert.equal(normalizeBrazilCnpj(FOREIGN_DV_VALID_CNPJ).status, 'valid', 'fixture precondition');

    assert.throws(
      () =>
        buildBrReceitaCnpjSnapshotRows(
          inputWithEstablishmentOverride({ identificador_matriz_filial: FOREIGN_DV_VALID_CNPJ }),
        ),
      (error: unknown) =>
        error instanceof BrReceitaCnpjForbiddenSourceError &&
        error.message.includes('CNPJ-shaped, DV-valid'),
    );
  });

  it('a punctuated full CNPJ is rejected — punctuation is not an escape', () => {
    const punctuated = `${TECNOLOGIA_MATRIZ_FULL.slice(0, 2)}.${TECNOLOGIA_MATRIZ_FULL.slice(2, 5)}.${TECNOLOGIA_MATRIZ_FULL.slice(5, 8)}/${TECNOLOGIA_MATRIZ_FULL.slice(8, 12)}-${TECNOLOGIA_MATRIZ_FULL.slice(12)}`;
    assert.throws(
      () =>
        buildBrReceitaCnpjSnapshotRows(
          inputWithEstablishmentOverride({ identificador_matriz_filial: punctuated }),
        ),
      (error: unknown) => error instanceof BrReceitaCnpjForbiddenSourceError,
    );
  });

  it('🔴 the violation message never quotes the offending value', () => {
    try {
      buildBrReceitaCnpjSnapshotRows(
        inputWithEstablishmentOverride({ identificador_matriz_filial: TECNOLOGIA_MATRIZ_FULL }),
      );
      assert.fail('expected a fail-closed rejection');
    } catch (error) {
      assert.ok(error instanceof BrReceitaCnpjForbiddenSourceError);
      assert.equal(
        error.message.includes(TECNOLOGIA_MATRIZ_FULL),
        false,
        'a guard that printed what it caught would be the leak it prevents',
      );
      assert.equal(error.message.includes(RAIZ_TECNOLOGIA), false);
    }
  });
});

// ─── 4 · the alphanumeric case ────────────────────────────────────────────────

describe('GATE-ROUND-1 § 4 · alphanumeric CNPJ material is caught in canonical form', () => {
  it('🔴 an alphanumeric raiz smuggled in LOWER case is still rejected', () => {
    // The post-July-2026 format allows letters in the raiz. A case-sensitive comparison would have
    // let `12abc345` through while blocking `12ABC345` — the same identifier, twice.
    const rows = estabelecimentosFixture();
    // Row index 2 is the alphanumeric matriz.
    rows[2] = { ...rows[2]!, identificador_matriz_filial: RAIZ_EDUCACAO.toLowerCase() };

    assert.throws(
      () =>
        buildBrReceitaCnpjSnapshotRows({
          ...sampleParserInput(),
          estabelecimentosRows: rows,
        }),
      (error: unknown) =>
        error instanceof BrReceitaCnpjForbiddenSourceError &&
        error.message.includes('CNPJ básico'),
    );
  });

  it('the alphanumeric row is still ACCEPTED when nothing is smuggled', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const alphanumeric = result.snapshots.find(
      (snap) => snap.normalized_tax_id === EDUCACAO_MATRIZ_FULL,
    );
    assert.ok(alphanumeric, 'the alphanumeric establishment is accepted');
    // 🔴 BR-SOURCE-GATE-ROUND-2 (RB-3) — the R5 marker moved off the persisted payload onto the
    // internal control signals. It still survives, which is what this assertion is for; it is just
    // no longer somewhere a writer could persist it.
    const signals = result.internalControlSignals.find(
      (entry) => entry.source_row_index === alphanumeric.raw_data.source_row_index,
    );
    assert.ok(signals, 'its control signals exist');
    assert.equal(signals.mei_flag, true, 'and its GATE-1 R5 control marker survives');
    assert.equal('mei_flag' in alphanumeric.raw_data, false, 'but not in the persisted payload');
  });
});

// ─── 5 · benign business values survive ───────────────────────────────────────

describe('GATE-ROUND-1 § 5 · benign business numerics are PRESERVED', () => {
  it('🔴 an eight-digit YYYYMMDD opening date survives — it is not a básico', () => {
    // This is the assertion that stops a future tightening from turning the value sanitizer into an
    // "eight digits is forbidden" rule. Receita's real date format IS eight digits.
    const result = buildBrReceitaCnpjSnapshotRows(
      inputWithEstablishmentOverride({ data_inicio_atividade: '20150310' }),
    );
    const snap = result.snapshots.find((s) => s.normalized_tax_id === TECNOLOGIA_MATRIZ_FULL);
    assert.ok(snap);
    assert.equal(snap.raw_data.start_date, '20150310');
  });

  it('capital_social_value behaviour is unchanged — exact string, not a bucket', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const snap = result.snapshots.find((s) => s.normalized_tax_id === TECNOLOGIA_MATRIZ_FULL);
    assert.ok(snap);
    assert.equal(snap.raw_data.capital_social_value, '100000.00');
  });

  it('a long capital figure that normalizes past eight digits survives', () => {
    const result = buildBrReceitaCnpjSnapshotRows(
      inputWithEmpresaOverride({ capital_social: '987654321.00' }),
    );
    const snap = result.snapshots.find((s) => s.normalized_tax_id === TECNOLOGIA_MATRIZ_FULL);
    assert.ok(snap);
    assert.equal(snap.raw_data.capital_social_value, '987654321.00');
  });

  it('the approved include set still arrives intact', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const snap = result.snapshots.find((s) => s.normalized_tax_id === TECNOLOGIA_MATRIZ_FULL);
    assert.ok(snap);

    assert.equal(snap.legal_name, 'Synthetic Tecnologia Ltda');
    assert.equal(snap.raw_data.cnae_main_code, '6201501');
    assert.equal(snap.raw_data.cnae_main_label, 'Desenvolvimento de programas de computador sob encomenda');
    assert.deepEqual(snap.raw_data.cnae_secondary_codes, ['6202300', '6209100']);
    assert.equal(snap.raw_data.registration_status_code, '02');
    assert.equal(snap.raw_data.company_size_code, '03');
    assert.equal(snap.raw_data.uf, 'SP');
    assert.equal(snap.raw_data.municipality_code, '7107');
    assert.equal(snap.raw_data.municipality_name, 'Synthetic City');
    assert.equal(snap.raw_data.start_date, '2015-03-10');
    assert.equal(snap.raw_data.source_period, SAMPLE_SOURCE_PERIOD);
    assert.equal(snap.raw_data.source_type, 'official_registry');
    assert.equal(snap.source_year, SAMPLE_SOURCE_YEAR);
  });

  it('a benign four-digit lookup label is never mistaken for an ordem', () => {
    // The 4-position ordem is deliberately NOT matched by containment. If it were, a municipality
    // named with four digits — or any CNAE code — would reject the row.
    const result = buildBrReceitaCnpjSnapshotRows({
      ...sampleParserInput(),
      empresasRows: empresasFixture(),
      estabelecimentosRows: estabelecimentosFixture(),
      simplesRows: simplesFixture(),
      cnaesRows: cnaesFixture(),
      municipiosRows: [{ codigo: '7107', descricao: 'Distrito 0001' }],
      naturezasRows: naturezasFixture(),
    });
    const snap = result.snapshots.find((s) => s.normalized_tax_id === TECNOLOGIA_MATRIZ_FULL);
    assert.ok(snap);
    assert.equal(snap.raw_data.municipality_name, 'Distrito 0001');
  });
});

// ─── 6 · the pre-existing guards still hold ───────────────────────────────────

describe('GATE-ROUND-1 § 6 · nothing that already worked was traded away', () => {
  it('the forbidden personal-data source guard still throws', () => {
    assert.throws(
      () =>
        buildBrReceitaCnpjSnapshotRows({
          ...sampleParserInput(),
          sociosRows: [{ cpf: '00000000000' }],
        } as unknown as BrReceitaCnpjParserInput),
      BrReceitaCnpjForbiddenSourceError,
    );
  });

  it('the summary still reports zero writes, zero snapshot writes and zero downloads', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    assert.equal(result.summary.db_writes, 0);
    assert.equal(result.summary.snapshot_writes, 0);
    assert.equal(result.summary.dataset_downloads, 0);
  });

  it('fail-closed rejections are unchanged in kind and count', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    assert.equal(result.summary.rejectedInvalidCnpj, 1);
    assert.equal(result.summary.rejectedDuplicateRecordIdentity, 1);
    assert.equal(result.summary.rejectedMissingRootCompany, 1);
  });
});

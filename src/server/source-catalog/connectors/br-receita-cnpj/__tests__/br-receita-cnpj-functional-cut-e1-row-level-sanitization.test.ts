/**
 * BR-SOURCE FUNCTIONAL CUT E1 — ROW-LEVEL SANITIZATION REJECTION.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS CUT CHANGED, AND WHAT IT DELIBERATELY DID NOT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `assertSanitizedRawData` had documented, since GATE-ROUND-1, that a `raw_data` value colliding
 * with the row's own CNPJ material means «the row is rejected rather than published». The
 * implementation did not do that. It THREW, from inside the establishment loop of
 * `buildBrReceitaCnpjSnapshotRows`, so one offending row took the ENTIRE batch with it and nothing
 * at all was published.
 *
 * With synthetic CNPJs the collision never happens, so the gap was invisible for four cuts. CUT E
 * ran the real July-2026 Receita sample: TWO real rows hit it, and the month could only be
 * published by bisecting the input from OUTSIDE the parser and excluding those rows by hand.
 *
 * CUT E1 changes ONE thing: the DISPOSITION.
 *
 *   THROW GLOBAL  →  REJECT ROW
 *
 * 🔴 What is NOT changed, and what this suite is built to catch a change to:
 *
 *   · the detection PATTERN — same three checks, same order;
 *   · the SENSITIVITY — nothing relaxed, nothing widened;
 *   · the ALLOWLIST — no field was added, removed or exempted;
 *   · the CNPJ policy and the `raw_data` policy — untouched;
 *   · GATE-3 — this cut legislates nothing; it makes the code obey what GATE-3 already said.
 *
 * The two real cases look like FALSE POSITIVES: a `capital_social_value` that happens to contain
 * the row's own básico. Relaxing the detector on that hunch is a separate decision that needs its
 * own evidence, and is not taken here. A false positive costs one row now; before CUT E1 it cost
 * the country.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * PRIVACY / COST
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 100% synthetic CNPJs, DV-valid by construction. No real company, no CPF, no SOCIOS/QSA. Pure
 * in-memory: no network, no filesystem, no database, no provider, no flag. 0 credits, 0 writes.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { buildBrReceitaCnpjSnapshotRows } from '../br-receita-cnpj-snapshot-builder';
import { computeBrazilCnpjCheckDigits, normalizeBrazilCnpj } from '../br-cnpj';
import { SAMPLE_SOURCE_PERIOD, SAMPLE_SOURCE_YEAR } from '../br-receita-cnpj-fixtures';
import type {
  BrReceitaCnpjParserInput,
  BrReceitaEmpresaRow,
  BrReceitaEstabelecimentoRow,
} from '../br-receita-cnpj-types';

// ─── Synthetic material ───────────────────────────────────────────────────────

const MATRIZ = '0001';

/** An 8-position numeric raiz built from an ordinal. Distinct ordinal ⇒ distinct raiz. */
function raizFor(ordinal: number): string {
  return String(10_000_000 + ordinal).padStart(8, '0');
}

function fullCnpjFor(raiz: string): string {
  return `${raiz}${MATRIZ}${computeBrazilCnpjCheckDigits(`${raiz}${MATRIZ}`)}`;
}

/**
 * A CLEAN establishment row. Every value it carries is a benign business value the output exists to
 * carry — including an eight-digit `YYYYMMDD` opening date, which a blunt "eight digits is a básico"
 * rule would destroy and which this suite therefore keeps in every clean row.
 */
function cleanEstablishment(raiz: string): BrReceitaEstabelecimentoRow {
  return {
    cnpj_basico: raiz,
    cnpj_ordem: MATRIZ,
    cnpj_dv: computeBrazilCnpjCheckDigits(`${raiz}${MATRIZ}`),
    identificador_matriz_filial: '1',
    situacao_cadastral: '02',
    cnae_fiscal_principal: '6201501',
    data_inicio_atividade: '20150310',
    municipio: '7107',
    uf: 'SP',
  };
}

/**
 * The SAME row, with its own básico smuggled into `identificador_matriz_filial` — an ALLOWED key
 * carrying free source text. This is the shape of the real CUT E finding: a permitted field whose
 * value happens to contain the row's own identifier material.
 */
function collidingEstablishment(raiz: string): BrReceitaEstabelecimentoRow {
  return { ...cleanEstablishment(raiz), identificador_matriz_filial: raiz };
}

function empresaFor(raiz: string, ordinal: number): BrReceitaEmpresaRow {
  return {
    cnpj_basico: raiz,
    razao_social: `Sintetica ${ordinal} Ltda`,
    natureza_juridica: '2062',
    porte_empresa: '03',
    capital_social: '1500000',
  };
}

/** A parser input over an explicit list of establishment rows, each with its own EMPRESAS root. */
function inputOver(rows: readonly BrReceitaEstabelecimentoRow[]): BrReceitaCnpjParserInput {
  const roots = new Map<string, BrReceitaEmpresaRow>();
  rows.forEach((row, index) => {
    const raiz = row.cnpj_basico as string;
    if (!roots.has(raiz)) roots.set(raiz, empresaFor(raiz, index));
  });
  return {
    sourceYear: SAMPLE_SOURCE_YEAR,
    sourcePeriod: SAMPLE_SOURCE_PERIOD,
    empresasRows: [...roots.values()],
    estabelecimentosRows: [...rows],
    cnaesRows: [{ codigo: '6201501', descricao: 'Desenvolvimento de programas' }],
    municipiosRows: [{ codigo: '7107', descricao: 'Synthetic City' }],
    naturezasRows: [{ codigo: '2062', descricao: 'Sociedade Empresária Limitada' }],
    sourceFileName: 'ESTABELECIMENTOS0.SYNTHETIC.csv',
  };
}

/** Every rejection carrying the CUT E1 category. */
const collisions = (result: ReturnType<typeof buildBrReceitaCnpjSnapshotRows>) =>
  result.rejected.filter((r) => r.reasonCode === 'sanitized_raw_data_collision');

// ═══════════════════════════════════════════════════════════════════════════════

describe('CUT E1 · CASE 1 — a normal row is accepted', () => {
  it('the clean row publishes, and nothing is rejected', () => {
    const raiz = raizFor(1);
    assert.equal(normalizeBrazilCnpj(fullCnpjFor(raiz)).status, 'valid', 'fixture precondition');

    const result = buildBrReceitaCnpjSnapshotRows(inputOver([cleanEstablishment(raiz)]));

    assert.equal(result.summary.acceptedRows, 1);
    assert.equal(result.summary.rejectedRows, 0);
    assert.equal(result.summary.rejectedSanitizedRawDataCollision, 0);
    assert.equal(result.snapshots[0]!.normalized_tax_id, fullCnpjFor(raiz));
    // 🔴 The benign eight-digit date SURVIVED. The detector is derivation-based, not shape-based,
    // and CUT E1 did not touch that: a per-row disposition is worthless if the rule fires on dates.
    assert.equal(result.snapshots[0]!.raw_data.start_date, '20150310');
  });
});

describe('CUT E1 · CASE 2 — a colliding row is rejected, not published', () => {
  it('the row is refused under the CUT E1 category and produces no snapshot', () => {
    const raiz = raizFor(2);
    const result = buildBrReceitaCnpjSnapshotRows(inputOver([collidingEstablishment(raiz)]));

    assert.equal(result.summary.acceptedRows, 0);
    assert.equal(result.snapshots.length, 0, 'NO snapshot — the row is not published');
    assert.equal(result.summary.rejectedSanitizedRawDataCollision, 1);
    assert.deepEqual(
      collisions(result).map((r) => r.sourceRowIndex),
      [0],
    );
  });

  it('🔴 the raw_data was NOT edited, and the offending field was NOT stripped to salvage the row', () => {
    // Two failure modes this cut explicitly forbids: mutating the value so the guard passes, and
    // deleting just the offending key while publishing the rest. Both would produce a snapshot.
    // The absence of ANY snapshot is what rules both out — there is no salvaged row to inspect.
    const raiz = raizFor(3);
    const result = buildBrReceitaCnpjSnapshotRows(inputOver([collidingEstablishment(raiz)]));
    assert.equal(result.snapshots.length, 0);
    assert.equal(result.internalControlSignals.length, 0, 'nor a control signal for a refused row');
  });
});

describe('CUT E1 · CASE 3 — normal / collision / normal', () => {
  it('2 accepted, 1 rejected, and NO exception escapes the batch', () => {
    // 🔴 This is the test the pre-CUT-E1 implementation cannot pass. Restoring the global throw
    // makes `buildBrReceitaCnpjSnapshotRows` raise here instead of returning, and the assertion is
    // never reached.
    const rows = [
      cleanEstablishment(raizFor(10)),
      collidingEstablishment(raizFor(11)),
      cleanEstablishment(raizFor(12)),
    ];
    const result = buildBrReceitaCnpjSnapshotRows(inputOver(rows));

    assert.equal(result.summary.acceptedRows, 2);
    assert.equal(result.summary.rejectedRows, 1);
    assert.equal(result.summary.rejectedSanitizedRawDataCollision, 1);
    // The SURVIVORS are the two clean rows, identified — not merely counted.
    assert.deepEqual(
      result.snapshots.map((snap) => snap.normalized_tax_id).sort(),
      [fullCnpjFor(raizFor(10)), fullCnpjFor(raizFor(12))].sort(),
    );
    // And the excluded row is the middle one, so the loop resumed rather than restarted.
    assert.deepEqual(
      collisions(result).map((r) => r.sourceRowIndex),
      [1],
    );
  });

  it('the collision in FIRST position does not prevent the rows after it', () => {
    // Order independence. A guard that aborted would fail identically wherever the bad row sat;
    // a guard that rejects must be proved not to abandon the remainder.
    const rows = [
      collidingEstablishment(raizFor(20)),
      cleanEstablishment(raizFor(21)),
      cleanEstablishment(raizFor(22)),
    ];
    const result = buildBrReceitaCnpjSnapshotRows(inputOver(rows));
    assert.equal(result.summary.acceptedRows, 2);
    assert.deepEqual(
      collisions(result).map((r) => r.sourceRowIndex),
      [0],
    );
  });
});

describe('CUT E1 · CASE 4 — two collisions inside a large batch', () => {
  const BATCH = 50_000;
  const FIRST = 12_345;
  const SECOND = 41_002;

  const rows: BrReceitaEstabelecimentoRow[] = [];
  for (let i = 0; i < BATCH; i += 1) {
    const raiz = raizFor(i);
    rows.push(i === FIRST || i === SECOND ? collidingEstablishment(raiz) : cleanEstablishment(raiz));
  }
  const result = buildBrReceitaCnpjSnapshotRows(inputOver(rows));

  it('exactly 2 rejection records, and exactly 2 on the counter', () => {
    assert.equal(collisions(result).length, 2);
    assert.equal(result.summary.rejectedSanitizedRawDataCollision, 2);
    assert.deepEqual(
      collisions(result).map((r) => r.sourceRowIndex),
      [FIRST, SECOND],
      'the counted rows are the offending rows, by ordinal',
    );
  });

  it('the other 49 998 rows continue — this is the real CUT E shape, at scale', () => {
    assert.equal(result.summary.acceptedRows, BATCH - 2);
    assert.equal(result.snapshots.length, BATCH - 2);
    assert.equal(result.summary.totalEstablishmentRows, BATCH);
  });
});

describe('CUT E1 · CASE 5 — the rejection carries no CNPJ', () => {
  it('neither the full CNPJ, nor the básico, nor a fingerprint of either', () => {
    const raiz = raizFor(30);
    const full = fullCnpjFor(raiz);
    const result = buildBrReceitaCnpjSnapshotRows(
      inputOver([cleanEstablishment(raizFor(29)), collidingEstablishment(raiz)]),
    );

    const serialized = JSON.stringify(collisions(result));
    assert.ok(serialized.length > 0, 'there is a rejection to inspect');
    assert.equal(serialized.includes(full), false, 'the full CNPJ');
    assert.equal(serialized.includes(raiz), false, 'the básico');
    assert.equal(serialized.includes(full.slice(0, 12)), false, 'the pre-DV identity');
    // 🔴 GATE-1 R4 forbids a HASH or TRUNCATION of the CNPJ too, so the assertion is not "the
    // literal string is absent" but "no run of eight or more digits appears at all". `row-<n>` and
    // the source file name are the only strings in the record, and neither can hold one.
    assert.equal(/\d{8}/.test(serialized), false, 'no eight-digit run of any provenance');
  });

  it('the summary carries no CNPJ either — it is the other thing a reader reads', () => {
    const raiz = raizFor(31);
    const result = buildBrReceitaCnpjSnapshotRows(inputOver([collidingEstablishment(raiz)]));
    const summaryJson = JSON.stringify(result.summary);
    assert.equal(summaryJson.includes(raiz), false);
    assert.equal(summaryJson.includes(fullCnpjFor(raiz)), false);
  });
});

describe('CUT E1 · CASE 6 — the rejection carries no offending value', () => {
  it('not the value, not the key, not the legal name, not the raw_data', () => {
    // A distinctive, DV-valid FOREIGN CNPJ as the offending value: it belongs to no row, so if it
    // appears in the record it can only have come from the value the detector caught.
    const raiz = raizFor(40);
    const foreignRaiz = raizFor(999_001);
    const foreignFull = fullCnpjFor(foreignRaiz);
    assert.equal(normalizeBrazilCnpj(foreignFull).status, 'valid', 'fixture precondition');

    const poisoned: BrReceitaEstabelecimentoRow = {
      ...cleanEstablishment(raiz),
      identificador_matriz_filial: foreignFull,
    };
    const result = buildBrReceitaCnpjSnapshotRows(inputOver([poisoned]));
    assert.equal(result.summary.rejectedSanitizedRawDataCollision, 1);

    const serialized = JSON.stringify(collisions(result));
    assert.equal(serialized.includes(foreignFull), false, 'the offending VALUE');
    assert.equal(serialized.includes(foreignRaiz), false, 'a fragment of the offending value');
    assert.equal(
      serialized.includes('identificador_matriz_filial') ||
        serialized.includes('matrix_branch_flag'),
      false,
      'nor the offending KEY: the category is the whole diagnostic',
    );
    assert.equal(serialized.includes('Sintetica'), false, 'nor the legal name');

    // 🔴 The record's SHAPE is the guarantee, not a list of strings a future edit could grow past:
    // these four keys are all there is, and none of them can hold an identifier.
    assert.deepEqual(Object.keys(collisions(result)[0]!).sort(), [
      'reasonCode',
      'safeIdentifier',
      'sourceFile',
      'sourceRowIndex',
    ]);
    assert.equal(collisions(result)[0]!.safeIdentifier, 'row-0');
  });
});

describe('CUT E1 · CASE 7 — the summary reconciles', () => {
  it('acceptedRows + rejectedRows === totalEstablishmentRows, with collisions present', () => {
    const rows = [
      cleanEstablishment(raizFor(50)),
      collidingEstablishment(raizFor(51)),
      cleanEstablishment(raizFor(52)),
      collidingEstablishment(raizFor(53)),
      cleanEstablishment(raizFor(54)),
    ];
    const result = buildBrReceitaCnpjSnapshotRows(inputOver(rows));

    assert.equal(
      result.summary.acceptedRows + result.summary.rejectedRows,
      result.summary.totalEstablishmentRows,
    );
    assert.equal(result.summary.totalEstablishmentRows, rows.length);
    // 🔴 And `rejectedRows` is the SUM of its five categories — a category that did not roll up
    // would reconcile the total while hiding which rule fired.
    assert.equal(
      result.summary.rejectedInvalidCnpj +
        result.summary.rejectedDuplicateRecordIdentity +
        result.summary.rejectedMissingRootCompany +
        result.summary.rejectedIncompatibleRootCompany +
        result.summary.rejectedSanitizedRawDataCollision,
      result.summary.rejectedRows,
    );
    assert.equal(result.summary.rejectedSanitizedRawDataCollision, 2);
    // The rejection ARRAY and the counter cannot disagree.
    assert.equal(result.rejected.length, result.summary.rejectedRows);
  });

  it('the invariants that say nothing was written still hold', () => {
    const result = buildBrReceitaCnpjSnapshotRows(
      inputOver([collidingEstablishment(raizFor(60))]),
    );
    assert.equal(result.summary.db_writes, 0);
    assert.equal(result.summary.snapshot_writes, 0);
    assert.equal(result.summary.dataset_downloads, 0);
  });
});

describe('CUT E1 · CASE 8 — no other rejection reason changes', () => {
  /**
   * One input exercising all five categories at once. The four pre-existing ones must come out at
   * exactly the counts they had before CUT E1, and — the part that matters — a colliding row must
   * not be MISFILED under one of them, nor steal a row from one of them.
   */
  const mixedInput = (): BrReceitaCnpjParserInput => {
    const clean = raizFor(70);
    const colliding = raizFor(71);
    const orphan = raizFor(72); // has NO EMPRESAS root
    const conflicted = raizFor(73); // two incompatible EMPRESAS roots

    const rows: BrReceitaEstabelecimentoRow[] = [
      cleanEstablishment(clean),
      collidingEstablishment(colliding),
      { ...cleanEstablishment(clean) }, // duplicate of row 0 → duplicate_record_identity_key
      { ...cleanEstablishment(raizFor(74)), cnpj_dv: '00' }, // → invalid_cnpj
      cleanEstablishment(orphan), // → missing_root_company
      cleanEstablishment(conflicted), // → incompatible_root_company
    ];

    const base = inputOver(rows);
    return {
      ...base,
      empresasRows: [
        // the orphan's root is REMOVED, and the conflicted root is supplied TWICE, incompatibly.
        ...base.empresasRows.filter((e) => e.cnpj_basico !== orphan),
        { ...empresaFor(conflicted, 73), razao_social: 'Sintetica OUTRA Ltda' },
      ],
    };
  };

  it('the four pre-existing categories keep their exact counts', () => {
    const result = buildBrReceitaCnpjSnapshotRows(mixedInput());
    assert.equal(result.summary.rejectedInvalidCnpj, 1);
    assert.equal(result.summary.rejectedDuplicateRecordIdentity, 1);
    assert.equal(result.summary.rejectedMissingRootCompany, 1);
    assert.equal(result.summary.rejectedIncompatibleRootCompany, 1);
    assert.equal(result.summary.rejectedSanitizedRawDataCollision, 1);
    assert.equal(result.summary.rejectedRows, 5);
    assert.equal(result.summary.acceptedRows, 1);
  });

  it('🔴 each category is attached to the row that actually earned it', () => {
    const result = buildBrReceitaCnpjSnapshotRows(mixedInput());
    const byIndex = new Map(result.rejected.map((r) => [r.sourceRowIndex, r.reasonCode]));
    assert.equal(byIndex.get(1), 'sanitized_raw_data_collision');
    assert.equal(byIndex.get(2), 'duplicate_record_identity_key');
    assert.equal(byIndex.get(3), 'invalid_cnpj');
    assert.equal(byIndex.get(4), 'missing_root_company');
    assert.equal(byIndex.get(5), 'incompatible_root_company');
  });

  it('🔴 a refused row still CONSUMES its identity — a later duplicate of it is still refused', () => {
    // CUT E1 moved the disposition, NOT the identity claim. Had the claim moved below the
    // sanitizer, the duplicate below would publish the very identity the sanitizer had just
    // refused, from a different source row. Fail-closed stays fail-closed.
    const raiz = raizFor(80);
    const rows = [collidingEstablishment(raiz), cleanEstablishment(raiz)];
    const result = buildBrReceitaCnpjSnapshotRows(inputOver(rows));

    assert.equal(result.summary.acceptedRows, 0, 'the refused identity is not published by a twin');
    assert.equal(result.summary.rejectedSanitizedRawDataCollision, 1);
    assert.equal(result.summary.rejectedDuplicateRecordIdentity, 1);
  });

  it('the hard errors are STILL hard errors — a rejection is not the answer to every violation', () => {
    // A SOCIOS/QSA/CPF source and an invalid sourceYear must still take the run down: they are not
    // row-level facts, and CUT E1 did not touch them.
    assert.throws(() =>
      buildBrReceitaCnpjSnapshotRows({
        ...inputOver([cleanEstablishment(raizFor(90))]),
        sociosRows: [{ cpf: '00000000000' }],
      } as unknown as BrReceitaCnpjParserInput),
    );
    assert.throws(() =>
      buildBrReceitaCnpjSnapshotRows({
        ...inputOver([cleanEstablishment(raizFor(91))]),
        sourceYear: 0,
      }),
    );
  });
});

describe('CUT E1 · CASE 9 — the mutation this suite exists to catch', () => {
  const BUILDER = 'br-receita-cnpj-snapshot-builder.ts';

  /** The builder's source with comments stripped, so a mention is never mistaken for a call. */
  const builderCode = (): string => {
    const raw = readFileSync(join(__dirname, '..', BUILDER), 'utf8');
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
  };

  it('🔴 the collision site REJECTS the row — restoring a throw there fails this test', () => {
    const code = builderCode();
    // The reject call exists, with the CUT E1 category, in executable code.
    assert.match(code, /reject\(\s*i\s*,\s*'sanitized_raw_data_collision'\s*\)/);
    // The value detector is a PREDICATE. If it were reinstated as an assert/throw, the guard
    // below would be its only caller shape and this pattern would be gone.
    assert.match(code, /if\s*\(\s*\n?\s*rawDataCarriesForbiddenCnpjMaterial\(/);
    // 🔴 And the two functions that used to throw are gone by NAME, so a partial revert that keeps
    // the old thrower alongside the new predicate is caught too.
    assert.equal(code.includes('assertSanitizedRawData'), false);
    assert.equal(code.includes('assertValueCarriesNoCnpjMaterial'), false);
  });

  it('🔴 the value detector contains no throw at all', () => {
    const code = builderCode();
    const start = code.indexOf('function rawDataCarriesForbiddenCnpjMaterial');
    const end = code.indexOf('function normalizeText');
    assert.ok(start > 0 && end > start, 'the detector block was located');
    const detector = code.slice(start, end);
    assert.equal(
      detector.includes('throw'),
      false,
      'a throw anywhere in the value detector is the defect CUT E1 removed',
    );
  });

  it('the behavioural proof, stated as the mutation it kills', () => {
    // Reinstating `throw` for a value collision makes this call raise. Nothing below runs, and
    // CASE 2, 3, 4, 5, 6, 7 and 8 fail with it. The suite cannot pass with a global abort.
    let threw = false;
    try {
      buildBrReceitaCnpjSnapshotRows(
        inputOver([
          cleanEstablishment(raizFor(100)),
          collidingEstablishment(raizFor(101)),
          cleanEstablishment(raizFor(102)),
        ]),
      );
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'a collision must not raise out of the batch');
  });
});

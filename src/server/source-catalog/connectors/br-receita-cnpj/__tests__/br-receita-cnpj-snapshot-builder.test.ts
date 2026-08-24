/**
 * Tests — BR Receita CNPJ local/sample parser (snapshot builder).
 * Pure: no network, no DB, no filesystem, no providers. Hito: BR-SOURCE-2.
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
  RAIZ_TECNOLOGIA,
  RAIZ_EDUCACAO,
  SAMPLE_SOURCE_YEAR,
  SAMPLE_SOURCE_PERIOD,
} from '../br-receita-cnpj-fixtures';
import type { BrReceitaCnpjSnapshotRow } from '../br-receita-cnpj-types';

const ALLOWED_RAW_DATA_KEYS = new Set([
  'source_type',
  'human_review_required',
  'parser_version',
  'source_period',
  'source_row_index',
  'source_file_name',
  'source_downloaded_at',
  'import_batch_id',
  // 🔴 BR-SOURCE-GATE-ROUND-1 — `cnpj_root`, `cnpj_order` and `cnpj_dv` are NO LONGER allowed
  // keys. They are absent from the type, absent from the builder, and their absence from this set
  // is what makes the `no unexpected key` assertion below catch a re-introduction.
  // 🔴 BR-SOURCE-GATE-ROUND-2 (RB-3) — `legal_nature_code`, `legal_nature_label`, `simples_opt_in`,
  // `simei_opt_in` and `mei_flag` are NO LONGER allowed payload keys. They are labelled
  // INTERNAL_PRIVACY_CONTROL_ONLY / EXCLUDED_OUTPUT and travel on `internalControlSignals`, and
  // their absence from this set is what makes the `no unexpected key` assertion catch a
  // re-introduction.
  'matrix_branch_flag',
  'company_size_code',
  'capital_social_value',
  'registration_status_code',
  'registration_status_label',
  'cnae_main_code',
  'cnae_main_label',
  'cnae_secondary_codes',
  'municipality_code',
  'municipality_name',
  'uf',
  'start_date',
]);

function bySnapshotIdentity(
  rows: BrReceitaCnpjSnapshotRow[],
  normalized: string,
): BrReceitaCnpjSnapshotRow {
  const found = rows.find((r) => r.normalized_tax_id === normalized);
  assert.ok(found, `expected a snapshot for ${normalized}`);
  return found;
}

/**
 * BR-SOURCE-GATE-ROUND-2 — the control signals for one accepted row.
 *
 * Correlated by `source_row_index`, which is the ONLY link between a row and its signals: the
 * signals are deliberately not reachable from the row itself.
 */
function controlSignalsFor(
  result: ReturnType<typeof buildBrReceitaCnpjSnapshotRows>,
  normalized: string,
) {
  const row = bySnapshotIdentity(result.snapshots, normalized);
  const signals = result.internalControlSignals.find(
    (entry) => entry.source_row_index === row.raw_data.source_row_index,
  );
  assert.ok(signals, `expected control signals for ${normalized}`);
  return signals;
}

describe('buildBrReceitaCnpjSnapshotRows — acceptance & mapping', () => {
  it('produces snapshots with the official source_key / country_code / source_year', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    assert.equal(result.snapshots.length, 3);
    for (const snap of result.snapshots) {
      assert.equal(snap.source_key, 'br_receita_cnpj_dados_abertos');
      assert.equal(snap.country_code, 'BR');
      assert.equal(snap.source_year, SAMPLE_SOURCE_YEAR);
    }
  });

  it('generates record_identity_key = tax:<normalized_14> and Mode A normalized_tax_id', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const legacyFull = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
    const snap = bySnapshotIdentity(result.snapshots, legacyFull);
    assert.equal(snap.normalized_tax_id, legacyFull);
    assert.equal(snap.record_identity_key, `tax:${legacyFull}`);
    assert.equal(snap.tax_id, legacyFull); // raw = concatenated parts here
    // 🔴 GATE-ROUND-1 — the identifier no longer survives INTO the sanitized output block. The
    // top-level identity columns above are the shared `source_company_snapshots` contract and are
    // GATE-4's subject; `raw_data` is the § 5.2 allowlist and carries none of it.
    assert.equal('cnpj_root' in snap.raw_data, false);
    assert.equal('cnpj_order' in snap.raw_data, false);
    assert.equal('cnpj_dv' in snap.raw_data, false);
  });

  it('joins EMPRESAS + ESTABELECIMENTOS by the source raiz (legal_name, natureza, porte)', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const snap = bySnapshotIdentity(result.snapshots, sampleFullCnpj(RAIZ_TECNOLOGIA, '0001'));
    assert.equal(snap.legal_name, 'Synthetic Tecnologia Ltda');
    // Natureza jurídica still drives the join; after RB-3 it lands on the control signals rather
    // than in the persisted payload.
    const signals = controlSignalsFor(result, sampleFullCnpj(RAIZ_TECNOLOGIA, '0001'));
    assert.equal(signals.legal_nature_code, '2062');
    assert.equal(signals.legal_nature_label, 'Sociedade Empresária Limitada');
    assert.equal(snap.raw_data.company_size_code, '03');
    assert.equal(snap.raw_data.capital_social_value, '100000.00');
  });

  it('adds município (code + name) and UF', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const snap = bySnapshotIdentity(result.snapshots, sampleFullCnpj(RAIZ_TECNOLOGIA, '0001'));
    assert.equal(snap.raw_data.municipality_code, '7107');
    assert.equal(snap.raw_data.municipality_name, 'Synthetic City');
    assert.equal(snap.raw_data.uf, 'SP');
  });

  it('adds CNAE (main code + label + secondary codes)', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const snap = bySnapshotIdentity(result.snapshots, sampleFullCnpj(RAIZ_TECNOLOGIA, '0001'));
    assert.equal(snap.raw_data.cnae_main_code, '6201501');
    assert.equal(
      snap.raw_data.cnae_main_label,
      'Desenvolvimento de programas de computador sob encomenda',
    );
    assert.deepEqual(snap.raw_data.cnae_secondary_codes, ['6202300', '6209100']);
  });

  it('derives SIMPLES/SIMEI flags and mei_flag onto the internal control signals', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const tec = controlSignalsFor(result, sampleFullCnpj(RAIZ_TECNOLOGIA, '0001'));
    assert.equal(tec.simples_opt_in, true);
    assert.equal(tec.simei_opt_in, false);
    assert.equal(tec.mei_flag, false);

    const edu = controlSignalsFor(result, sampleFullCnpj(RAIZ_EDUCACAO, '0001'));
    assert.equal(edu.simei_opt_in, true);
    assert.equal(edu.mei_flag, true);

    // The count that was `mei_flag`'s only non-test consumer still works, off the control array.
    assert.equal(result.summary.meiFlaggedRows, 1);
  });

  it('accepts the alphanumeric establishment (post-July-2026 format)', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const edu = bySnapshotIdentity(result.snapshots, sampleFullCnpj(RAIZ_EDUCACAO, '0001'));
    assert.ok(/[A-Z]/.test(edu.normalized_tax_id));
    // The alphanumeric raiz still drives the join; it just does not survive into the output.
    const signals = controlSignalsFor(result, sampleFullCnpj(RAIZ_EDUCACAO, '0001'));
    assert.equal(signals.legal_nature_code !== null, true);
  });
});

describe('buildBrReceitaCnpjSnapshotRows — exclusions & sanitization', () => {
  it('never maps contact fields or fine-grained address into raw_data', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    for (const snap of result.snapshots) {
      for (const key of Object.keys(snap.raw_data)) {
        assert.ok(
          ALLOWED_RAW_DATA_KEYS.has(key),
          `raw_data carried a non-allowlisted key: ${key}`,
        );
      }
    }
  });

  it('does not leak any excluded VALUE into the serialized result', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const json = JSON.stringify(result);
    // Excluded field KEY tokens (§ 5.3).
    for (const token of [
      'telefone',
      'fax',
      'correio',
      'logradouro',
      'numero',
      'complemento',
      'bairro',
      'socio',
      'qsa',
      'cpf',
    ]) {
      assert.ok(!json.includes(token), `serialized result must not contain "${token}"`);
    }
    // Excluded VALUES from the fixtures.
    for (const value of ['excluded@example.invalid', '5551234', 'SINTETICA', 'CENTRO', '01000000']) {
      assert.ok(!json.includes(value), `serialized result must not contain value "${value}"`);
    }
  });
});

describe('buildBrReceitaCnpjSnapshotRows — fail-closed rejections', () => {
  it('rejects invalid CNPJ, duplicate identity, and missing root company', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    assert.equal(result.summary.rejectedInvalidCnpj, 1);
    assert.equal(result.summary.rejectedDuplicateRecordIdentity, 1);
    assert.equal(result.summary.rejectedMissingRootCompany, 1);
    assert.equal(result.rejected.length, 3);
    for (const r of result.rejected) {
      // safe identifier is an execution-local ordinal (RB-2, BR-SOURCE-GATE-ROUND-1) — never a
      // CNPJ, and never a hash, truncation or fingerprint of one.
      assert.match(r.safeIdentifier, /^row-\d+$/);
      assert.equal(r.safeIdentifier, `row-${r.sourceRowIndex}`);
    }
  });

  it('🔴 RB-2 (BR-SOURCE-GATE-ROUND-1): the rejection diagnostic carries no CNPJ-derived material', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    assert.ok(result.rejected.length > 0, 'fixture must actually produce rejections');
    const json = JSON.stringify(result.rejected);

    // No full or básico CNPJ digit run of the shapes GATE-1 R4 forbids.
    assert.equal(/(?<!\d)\d{14}(?!\d)/.test(json), false, 'rejected rows must carry no 14-digit run');
    assert.equal(/(?<!\d)\d{8}(?!\d)/.test(json), false, 'rejected rows must carry no 8-digit run');

    // Not a hash, truncation or fingerprint shape: buildBrazilCnpjHash12 always returns exactly 12
    // lowercase hex characters, and a `row-<n>` ordinal can never collide with that shape.
    for (const r of result.rejected) {
      assert.equal(/^[0-9a-f]{12}$/.test(r.safeIdentifier), false);
    }

    // The diagnostic stays useful: reason code plus ordinal is enough to locate and classify a
    // rejection without a second, CNPJ-shaped identifier alongside it.
    for (const r of result.rejected) {
      assert.ok(r.reasonCode.length > 0);
      assert.equal(r.safeIdentifier, `row-${r.sourceRowIndex}`);
    }
  });

  it('rejects establishments of an incompatible duplicate root', () => {
    const empresas = empresasFixture();
    const conflicting = { ...empresas[0]!, razao_social: 'Synthetic Tecnologia OUTRA Ltda' };
    const result = buildBrReceitaCnpjSnapshotRows({
      sourceYear: SAMPLE_SOURCE_YEAR,
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      empresasRows: [...empresas, conflicting],
      estabelecimentosRows: [
        {
          cnpj_basico: RAIZ_TECNOLOGIA,
          cnpj_ordem: '0001',
          cnpj_dv: sampleFullCnpj(RAIZ_TECNOLOGIA, '0001').slice(12),
        },
      ],
    });
    assert.equal(result.snapshots.length, 0);
    assert.equal(result.summary.rejectedIncompatibleRootCompany, 1);
  });

  it('throws (fail-closed) when a SOCIOS/QSA/CPF source is supplied', () => {
    const withSocios = { ...sampleParserInput(), sociosRows: [{ cpf_socio: 'REDACTED' }] };
    assert.throws(
      () => buildBrReceitaCnpjSnapshotRows(withSocios as never),
      BrReceitaCnpjForbiddenSourceError,
    );
  });

  it('throws when a row carries a forbidden personal-data key', () => {
    const input = sampleParserInput();
    const poisoned = {
      ...input,
      empresasRows: [{ ...input.empresasRows[0]!, nome_socio: 'X' } as never],
    };
    assert.throws(
      () => buildBrReceitaCnpjSnapshotRows(poisoned as never),
      BrReceitaCnpjForbiddenSourceError,
    );
  });

  it('throws on invalid sourceYear (never hardcoded)', () => {
    assert.throws(
      () => buildBrReceitaCnpjSnapshotRows({ ...sampleParserInput(), sourceYear: 0 }),
      BrReceitaCnpjForbiddenSourceError,
    );
  });
});

describe('buildBrReceitaCnpjSnapshotRows — summary invariants', () => {
  it('reports zero writes / downloads and a CNPJ-free summary', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    assert.equal(result.summary.db_writes, 0);
    assert.equal(result.summary.snapshot_writes, 0);
    assert.equal(result.summary.dataset_downloads, 0);
    assert.equal(result.summary.acceptedRows, 3);
    assert.equal(result.summary.distinctRecordIdentityKeys, 3);
    assert.equal(result.summary.meiFlaggedRows, 1);

    // The summary object must not embed a full CNPJ.
    const summaryJson = JSON.stringify(result.summary);
    assert.ok(!summaryJson.includes(sampleFullCnpj(RAIZ_TECNOLOGIA, '0001')));
    assert.ok(!summaryJson.includes(sampleFullCnpj(RAIZ_EDUCACAO, '0001')));
  });
});

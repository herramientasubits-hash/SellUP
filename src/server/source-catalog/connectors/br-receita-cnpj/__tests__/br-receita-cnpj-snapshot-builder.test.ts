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
  'matrix_branch_flag',
  'legal_nature_code',
  'legal_nature_label',
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
  'simples_opt_in',
  'simei_opt_in',
  'mei_flag',
]);

/**
 * Locates a snapshot WITHOUT using a CNPJ. Post-GATE-3 hardening the rows carry no
 * identity column at all, so the tests address them the way any consumer now has
 * to: by non-identifying registral attributes.
 */
function bySnapshotAttributes(
  rows: BrReceitaCnpjSnapshotRow[],
  legalName: string,
  matrixBranchFlag: string,
): BrReceitaCnpjSnapshotRow {
  const found = rows.find(
    (r) => r.legal_name === legalName && r.raw_data.matrix_branch_flag === matrixBranchFlag,
  );
  assert.ok(found, `expected a snapshot for ${legalName} (branch ${matrixBranchFlag})`);
  return found;
}

const TECNOLOGIA_MATRIZ = ['Synthetic Tecnologia Ltda', '1'] as const;
const EDUCACAO_MATRIZ = ['Synthetic Educação S.A.', '1'] as const;

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

  it('carries NO CNPJ identity column and NO CNPJ parts (GATE-3 hardening)', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const snap = bySnapshotAttributes(result.snapshots, ...TECNOLOGIA_MATRIZ);
    const row = snap as unknown as Record<string, unknown>;
    const rawData = snap.raw_data as unknown as Record<string, unknown>;
    for (const removed of ['tax_id', 'normalized_tax_id', 'record_identity_key']) {
      assert.ok(!(removed in row), `snapshot row must not carry "${removed}"`);
    }
    for (const removed of ['cnpj_root', 'cnpj_order', 'cnpj_dv']) {
      assert.ok(!(removed in rawData), `raw_data must not carry "${removed}"`);
    }
  });

  it('still dedups on the internal tax identity (mechanism unchanged)', () => {
    // Fixture row 5 is a byte-duplicate of row 1's full CNPJ. Identity resolution
    // is internal now, so the only observable proof is the rejection + the count.
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    assert.equal(result.summary.rejectedDuplicateRecordIdentity, 1);
    assert.equal(result.summary.distinctRecordIdentityKeys, 3);
  });

  it('joins EMPRESAS + ESTABELECIMENTOS by CNPJ básico (legal_name, natureza, porte)', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const snap = bySnapshotAttributes(result.snapshots, ...TECNOLOGIA_MATRIZ);
    assert.equal(snap.legal_name, 'Synthetic Tecnologia Ltda');
    assert.equal(snap.raw_data.legal_nature_code, '2062');
    assert.equal(snap.raw_data.legal_nature_label, 'Sociedade Empresária Limitada');
    assert.equal(snap.raw_data.company_size_code, '03');
    assert.equal(snap.raw_data.capital_social_value, '100000.00');
  });

  it('adds município (code + name) and UF', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const snap = bySnapshotAttributes(result.snapshots, ...TECNOLOGIA_MATRIZ);
    assert.equal(snap.raw_data.municipality_code, '7107');
    assert.equal(snap.raw_data.municipality_name, 'Synthetic City');
    assert.equal(snap.raw_data.uf, 'SP');
  });

  it('adds CNAE (main code + label + secondary codes)', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const snap = bySnapshotAttributes(result.snapshots, ...TECNOLOGIA_MATRIZ);
    assert.equal(snap.raw_data.cnae_main_code, '6201501');
    assert.equal(
      snap.raw_data.cnae_main_label,
      'Desenvolvimento de programas de computador sob encomenda',
    );
    assert.deepEqual(snap.raw_data.cnae_secondary_codes, ['6202300', '6209100']);
  });

  it('adds SIMPLES/SIMEI flags and sets mei_flag from opcao_mei', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const tec = bySnapshotAttributes(result.snapshots, ...TECNOLOGIA_MATRIZ);
    assert.equal(tec.raw_data.simples_opt_in, true);
    assert.equal(tec.raw_data.simei_opt_in, false);
    assert.equal(tec.raw_data.mei_flag, false);

    const edu = bySnapshotAttributes(result.snapshots, ...EDUCACAO_MATRIZ);
    assert.equal(edu.raw_data.simei_opt_in, true);
    assert.equal(edu.raw_data.mei_flag, true);
  });

  it('accepts the alphanumeric establishment (post-July-2026 format)', () => {
    // The alphanumeric row is the one whose raiz carries letters. It is ACCEPTED —
    // proved by its presence — while carrying none of its own identifier.
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const edu = bySnapshotAttributes(result.snapshots, ...EDUCACAO_MATRIZ);
    assert.equal(edu.raw_data.cnae_main_code, '8599604');
    const serialized = JSON.stringify(edu);
    assert.ok(!serialized.includes(RAIZ_EDUCACAO));
    assert.ok(!serialized.includes(sampleFullCnpj(RAIZ_EDUCACAO, '0001')));
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
      // GATE-3 hardening: a rejection names the reason and the row, never the
      // record — not even as the 12-char truncated hash it used to carry.
      const row = r as unknown as Record<string, unknown>;
      assert.ok(!('safeIdentifier' in row), 'rejection must not carry safeIdentifier');
      assert.equal(typeof r.sourceRowIndex, 'number');
      assert.ok(r.reasonCode.length > 0);
    }
  });

  it('rejects establishments of an incompatible duplicate root', () => {
    const empresas = empresasFixture();
    const conflicting = { ...empresas[0]!, razao_social: 'Synthetic Tecnologia OUTRA Ltda' };
    const result = buildBrReceitaCnpjSnapshotRows({
      sourceYear: SAMPLE_SOURCE_YEAR,
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

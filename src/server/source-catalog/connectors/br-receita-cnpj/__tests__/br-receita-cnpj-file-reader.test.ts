/**
 * Tests — BR Receita CNPJ sanitized local CSV fixture reader (BR-SOURCE-4).
 *
 * The reader turns SYNTHETIC CSV files into a sanitized `BrReceitaCnpjParserInput`.
 * These tests prove it:
 *   - reads the internal synthetic CSV fixtures and yields a valid parser input;
 *   - feeds cleanly into the merged offline parser (3 accepted / 3 rejected);
 *   - validates required headers and fails closed when one is missing;
 *   - enforces the row-count limit (both `maxRows > 10` and rows > maxRows);
 *   - blocks SOCIOS/QSA/CPF columns and unknown sensitive columns;
 *   - never exposes contact (telefone/fax/correio) or fine-address
 *     (logradouro/numero/complemento/bairro/cep) fields in its output;
 *   - never preserves a raw CSV row and never emits a full 14-position CNPJ.
 *
 * 100% synthetic. No real dataset, no Supabase, no network, no runtime.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseBrReceitaCnpjCsvFixtureContents,
  readBrReceitaCnpjSyntheticCsvFixture,
  parseCsvContent,
  BR_RECEITA_CNPJ_FILE_READER_MAX_ROWS,
  BR_RECEITA_CNPJ_SYNTHETIC_CSV_FIXTURE,
  BrReceitaCnpjMissingHeaderError,
  BrReceitaCnpjForbiddenColumnError,
  BrReceitaCnpjUnknownColumnError,
  BrReceitaCnpjRowLimitError,
  type BrReceitaCnpjCsvFixtureContents,
} from '../br-receita-cnpj-file-reader';
import { buildBrReceitaCnpjSnapshotRows } from '../br-receita-cnpj-snapshot-builder';

const FULL_CNPJ_PATTERN = /\b[A-Z0-9]{14}\b/;
const FOURTEEN_DIGITS_PATTERN = /\b\d{14}\b/;
const CONTACT_TOKENS = /telefone|correio|\bfax\b|ddd/i;
const ADDRESS_TOKENS = /logradouro|complemento|bairro|\bcep\b|tipo_logradouro/i;

const VALID_EMPRESAS = [
  'cnpj_basico,razao_social,natureza_juridica,capital_social,porte_empresa',
  '11222333,Synthetic Tecnologia Ltda,2062,100000.00,03',
].join('\n');

const VALID_ESTAB = [
  'cnpj_basico,cnpj_ordem,cnpj_dv,identificador_matriz_filial,situacao_cadastral,data_inicio_atividade,cnae_fiscal_principal,uf,municipio',
  '11222333,0001,81,1,02,2015-03-10,6201501,SP,7107',
].join('\n');

function contents(overrides: Partial<BrReceitaCnpjCsvFixtureContents> = {}): BrReceitaCnpjCsvFixtureContents {
  return {
    sourceYear: 2026,
    empresasCsv: VALID_EMPRESAS,
    estabelecimentosCsv: VALID_ESTAB,
    ...overrides,
  };
}

// ─── CSV parsing ────────────────────────────────────────────────────────────

describe('parseCsvContent', () => {
  it('parses headers + rows and tolerates trailing newline', () => {
    const rows = parseCsvContent('a,b\n1,2\n');
    assert.deepEqual(rows, [
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quoted fields with embedded commas and escaped quotes', () => {
    const rows = parseCsvContent('a,b\n"x,y","he said ""hi"""');
    assert.deepEqual(rows, [
      ['a', 'b'],
      ['x,y', 'he said "hi"'],
    ]);
  });
});

// ─── Disk reader: end-to-end over the committed synthetic fixtures ────────────

describe('readBrReceitaCnpjSyntheticCsvFixture — internal synthetic CSV', () => {
  it('produces a valid parser input from the fixed fixture directory', () => {
    const input = readBrReceitaCnpjSyntheticCsvFixture({
      fixture: BR_RECEITA_CNPJ_SYNTHETIC_CSV_FIXTURE,
    });
    assert.equal(input.sourceYear, 2026);
    assert.equal(input.empresasRows.length, 2);
    assert.equal(input.estabelecimentosRows.length, 6);
    assert.equal(input.simplesRows?.length, 2);
    assert.equal(input.cnaesRows?.length, 2);
    assert.equal(input.municipiosRows?.length, 1);
    assert.equal(input.naturezasRows?.length, 2);
  });

  it('feeds the merged parser: 3 accepted, 3 rejected (invalid/dup/missing-root)', () => {
    const input = readBrReceitaCnpjSyntheticCsvFixture();
    const result = buildBrReceitaCnpjSnapshotRows(input);
    assert.equal(result.summary.acceptedRows, 3);
    assert.equal(result.summary.rejectedRows, 3);
    const reasons = result.rejected.map((r) => r.reasonCode).sort();
    assert.deepEqual(reasons, [
      'duplicate_record_identity_key',
      'invalid_cnpj',
      'missing_root_company',
    ]);
    assert.equal(result.summary.meiFlaggedRows, 1);
  });

  it('rejects a fixture value that is not "synthetic-csv"', () => {
    assert.throws(
      // @ts-expect-error — intentionally wrong fixture value
      () => readBrReceitaCnpjSyntheticCsvFixture({ fixture: 'real' }),
      /only fixture "synthetic-csv"/,
    );
  });
});

// ─── Header validation ────────────────────────────────────────────────────────

describe('required-header validation', () => {
  it('accepts a layout carrying every required header', () => {
    assert.doesNotThrow(() => parseBrReceitaCnpjCsvFixtureContents(contents()));
  });

  it('fails closed when a required establishment header is missing', () => {
    const estabMissingDv = [
      'cnpj_basico,cnpj_ordem,situacao_cadastral,uf,municipio',
      '11222333,0001,02,SP,7107',
    ].join('\n');
    assert.throws(
      () => parseBrReceitaCnpjCsvFixtureContents(contents({ estabelecimentosCsv: estabMissingDv })),
      BrReceitaCnpjMissingHeaderError,
    );
  });

  it('fails closed when a required empresas header is missing', () => {
    const empresasNoBasico = ['razao_social,natureza_juridica', 'Synthetic Ltda,2062'].join('\n');
    assert.throws(
      () => parseBrReceitaCnpjCsvFixtureContents(contents({ empresasCsv: empresasNoBasico })),
      BrReceitaCnpjMissingHeaderError,
    );
  });
});

// ─── Row limits ─────────────────────────────────────────────────────────────

describe('row limits', () => {
  it('fails closed when maxRows exceeds the hard limit of 10', () => {
    assert.throws(
      () =>
        parseBrReceitaCnpjCsvFixtureContents(
          contents({ maxRows: BR_RECEITA_CNPJ_FILE_READER_MAX_ROWS + 1 }),
        ),
      BrReceitaCnpjRowLimitError,
    );
  });

  it('fails closed when establishment rows exceed maxRows', () => {
    const threeRows = [
      'cnpj_basico,cnpj_ordem,cnpj_dv,uf,municipio',
      '11222333,0001,81,SP,7107',
      '11222333,0002,62,SP,7107',
      '12ABC345,0001,88,SP,7107',
    ].join('\n');
    assert.throws(
      () =>
        parseBrReceitaCnpjCsvFixtureContents(contents({ estabelecimentosCsv: threeRows, maxRows: 2 })),
      BrReceitaCnpjRowLimitError,
    );
  });

  it('accepts establishment rows at exactly maxRows', () => {
    const twoRows = [
      'cnpj_basico,cnpj_ordem,cnpj_dv,uf,municipio',
      '11222333,0001,81,SP,7107',
      '11222333,0002,62,SP,7107',
    ].join('\n');
    assert.doesNotThrow(() =>
      parseBrReceitaCnpjCsvFixtureContents(contents({ estabelecimentosCsv: twoRows, maxRows: 2 })),
    );
  });
});

// ─── Forbidden / sensitive columns ────────────────────────────────────────────

describe('forbidden and sensitive columns', () => {
  for (const token of ['socio', 'socios', 'qsa', 'cpf', 'representante']) {
    it(`blocks a "${token}" column (SOCIOS/QSA/CPF are never processed)`, () => {
      const empresasWithForbidden = [
        `cnpj_basico,razao_social,${token}_campo`,
        '11222333,Synthetic Ltda,x',
      ].join('\n');
      assert.throws(
        () => parseBrReceitaCnpjCsvFixtureContents(contents({ empresasCsv: empresasWithForbidden })),
        BrReceitaCnpjForbiddenColumnError,
      );
    });
  }

  it('blocks an unknown sensitive column (contact token where it does not belong)', () => {
    const empresasWithPhone = [
      'cnpj_basico,razao_social,telefone_contato',
      '11222333,Synthetic Ltda,5551234',
    ].join('\n');
    assert.throws(
      () => parseBrReceitaCnpjCsvFixtureContents(contents({ empresasCsv: empresasWithPhone })),
      BrReceitaCnpjForbiddenColumnError,
    );
  });

  it('accepts recognized establishment contact/address columns (they are stripped, not blocked)', () => {
    const estabWithContact = [
      'cnpj_basico,cnpj_ordem,cnpj_dv,uf,municipio,telefone_1,logradouro,cep,correio_eletronico',
      '11222333,0001,81,SP,7107,5551234,SINTETICA,01000000,x@example.invalid',
    ].join('\n');
    const input = parseBrReceitaCnpjCsvFixtureContents(
      contents({ estabelecimentosCsv: estabWithContact }),
    );
    const keys = Object.keys(input.estabelecimentosRows[0]!);
    assert.ok(!keys.some((k) => CONTACT_TOKENS.test(k)), 'contact column leaked into row');
    assert.ok(!keys.some((k) => ADDRESS_TOKENS.test(k)), 'address column leaked into row');
  });

  it('ignores unknown non-sensitive columns by default, but fails closed under strict', () => {
    const empresasWithExtra = [
      'cnpj_basico,razao_social,algum_campo_extra',
      '11222333,Synthetic Ltda,valor',
    ].join('\n');
    assert.doesNotThrow(() =>
      parseBrReceitaCnpjCsvFixtureContents(contents({ empresasCsv: empresasWithExtra })),
    );
    assert.throws(
      () =>
        parseBrReceitaCnpjCsvFixtureContents(
          contents({ empresasCsv: empresasWithExtra, strict: true }),
        ),
      BrReceitaCnpjUnknownColumnError,
    );
  });
});

// ─── Sanitized output guarantees ──────────────────────────────────────────────

describe('sanitized output', () => {
  it('does not expose contact fields in the produced input or snapshots', () => {
    const input = readBrReceitaCnpjSyntheticCsvFixture();
    const result = buildBrReceitaCnpjSnapshotRows(input);
    const serialized = JSON.stringify({ input, result });
    assert.doesNotMatch(serialized, CONTACT_TOKENS);
  });

  it('does not expose fine-grained address fields in the produced input or snapshots', () => {
    const input = readBrReceitaCnpjSyntheticCsvFixture();
    const result = buildBrReceitaCnpjSnapshotRows(input);
    const serialized = JSON.stringify({ input, result });
    assert.doesNotMatch(serialized, ADDRESS_TOKENS);
  });

  it('maps only allow-listed establishment keys — no raw original row is kept', () => {
    const input = readBrReceitaCnpjSyntheticCsvFixture();
    const allowedKeys = new Set([
      'cnpj_basico',
      'cnpj_ordem',
      'cnpj_dv',
      'identificador_matriz_filial',
      'situacao_cadastral',
      'cnae_fiscal_principal',
      'cnae_fiscal_secundaria',
      'data_inicio_atividade',
      'municipio',
      'uf',
    ]);
    for (const row of input.estabelecimentosRows) {
      for (const key of Object.keys(row)) {
        assert.ok(allowedKeys.has(key), `unexpected raw key "${key}" preserved on establishment row`);
      }
    }
  });

  it('never contains a full 14-position CNPJ literal in its output', () => {
    const input = readBrReceitaCnpjSyntheticCsvFixture();
    const serialized = JSON.stringify(input);
    assert.doesNotMatch(serialized, FULL_CNPJ_PATTERN);
    assert.doesNotMatch(serialized, FOURTEEN_DIGITS_PATTERN);
  });
});

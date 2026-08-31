/**
 * BR Receita CNPJ — synthetic local/sample fixtures.
 *
 * Hito: BR-SOURCE-2 — Receita CNPJ local/sample parser.
 *
 * 100% SYNTHETIC. No real company, no real CNPJ, no real person, no CPF, no
 * SOCIOS/QSA. CNPJs are assembled FROM PARTS (raiz + ordem + computed DV) so no
 * 14-digit literal ever appears in source. Valid DVs are computed with the
 * proven check-digit helper — the algorithm itself is anchored to public
 * ground-truth CNPJs in br-cnpj.test.ts, not to these fixtures.
 *
 * Contact fields and fine-grained address are DELIBERATELY populated on some
 * establishment rows so the parser tests can prove they never reach the output.
 */

import { computeBrazilCnpjCheckDigits } from './br-cnpj';
import type {
  BrReceitaCnpjParserInput,
  BrReceitaEmpresaRow,
  BrReceitaEstabelecimentoRow,
  BrReceitaSimplesRow,
  BrReceitaLookupRow,
} from './br-receita-cnpj-types';
import { BR_RECEITA_CNPJ_PARSER_VERSION } from './br-receita-cnpj-types';
import type { BrReceitaRunProvenance } from './br-receita-cnpj-compact-storage';

/**
 * The run-level provenance a test build hands to `planBrReceitaMonthlySnapshotWrite`.
 *
 * 🔴 No `source_file_name` here. A real national run reads 24 per-table files; naming any ONE of
 * them here would be exactly the "one file stands for the whole dataset" lie this fixture must not
 * tell. There is no dataset-level manifest identifier in this repository yet, so the honest value
 * is absent, not invented.
 */
export function sampleBrReceitaRunProvenance(): BrReceitaRunProvenance {
  return {
    parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
    // 🔴 Deliberately NOT a 2026-MM-shaped string. Several suites assert that one period's plan
    // mentions no OTHER period anywhere in its serialized operations — a provenance value that
    // happened to spell a real sample period (this file uses 2026-06 through 2026-12 throughout)
    // would read as a cross-period leak that was never there.
    source_downloaded_at: '2099-01-01T00:00:00.000Z',
    import_batch_id: 'sample-provenance-batch',
  };
}

export const SAMPLE_SOURCE_YEAR = 2026; // Example only — always an explicit input, never hardcoded.
export const SAMPLE_SOURCE_PERIOD = '2026-07';

// Synthetic raiz (raiz + ordem assembled into a full CNPJ at read time).
export const RAIZ_TECNOLOGIA = '11222333'; // legacy all-numeric
export const RAIZ_EDUCACAO = '12ABC345'; // alphanumeric (post-July-2026 format)
export const RAIZ_NO_ROOT = '99XYZ000'; // has NO EMPRESAS row → missing_root_company

/** Builds a DV-valid full CNPJ string from raiz(8) + ordem(4). */
export function sampleFullCnpj(raiz: string, ordem: string): string {
  const dv = computeBrazilCnpjCheckDigits(`${raiz}${ordem}`);
  return `${raiz}${ordem}${dv}`;
}

export function empresasFixture(): BrReceitaEmpresaRow[] {
  return [
    {
      cnpj_basico: RAIZ_TECNOLOGIA,
      razao_social: 'Synthetic Tecnologia Ltda',
      natureza_juridica: '2062',
      porte_empresa: '03',
      capital_social: '100000.00',
    },
    {
      cnpj_basico: RAIZ_EDUCACAO,
      razao_social: 'Synthetic Educação S.A.',
      natureza_juridica: '2054',
      porte_empresa: '05',
      capital_social: '500000.00',
    },
  ];
}

export function estabelecimentosFixture(): BrReceitaEstabelecimentoRow[] {
  const ordem = { matriz: '0001', filial: '0002', third: '0003' };
  return [
    // 1 — valid legacy numeric matriz, WITH fine-grained address in input (must be excluded).
    {
      cnpj_basico: RAIZ_TECNOLOGIA,
      cnpj_ordem: ordem.matriz,
      cnpj_dv: computeBrazilCnpjCheckDigits(`${RAIZ_TECNOLOGIA}${ordem.matriz}`),
      identificador_matriz_filial: '1',
      situacao_cadastral: '02',
      cnae_fiscal_principal: '6201501',
      cnae_fiscal_secundaria: '6202300,6209100',
      data_inicio_atividade: '2015-03-10',
      municipio: '7107',
      uf: 'SP',
      // Fine-grained street address — EXCLUDED from output.
      tipo_logradouro: 'RUA',
      logradouro: 'SINTETICA',
      numero: '100',
      complemento: 'SALA 1',
      bairro: 'CENTRO',
      cep: '01000000',
    },
    // 2 — valid legacy numeric filial (second valid establishment of same root).
    {
      cnpj_basico: RAIZ_TECNOLOGIA,
      cnpj_ordem: ordem.filial,
      cnpj_dv: computeBrazilCnpjCheckDigits(`${RAIZ_TECNOLOGIA}${ordem.filial}`),
      identificador_matriz_filial: '2',
      situacao_cadastral: '02',
      cnae_fiscal_principal: '6201501',
      municipio: '7107',
      uf: 'SP',
    },
    // 3 — valid ALPHANUMERIC matriz, WITH contact fields in input (must be excluded).
    {
      cnpj_basico: RAIZ_EDUCACAO,
      cnpj_ordem: ordem.matriz,
      cnpj_dv: computeBrazilCnpjCheckDigits(`${RAIZ_EDUCACAO}${ordem.matriz}`),
      identificador_matriz_filial: '1',
      situacao_cadastral: '02',
      cnae_fiscal_principal: '8599604',
      municipio: '7107',
      uf: 'SP',
      // Contact fields — EXCLUDED from output.
      ddd_1: '11',
      telefone_1: '5551234',
      ddd_fax: '11',
      fax: '5551235',
      correio_eletronico: 'excluded@example.invalid',
    },
    // 4 — DV-invalid row (deliberately wrong DV) → rejected invalid_cnpj.
    {
      cnpj_basico: RAIZ_TECNOLOGIA,
      cnpj_ordem: ordem.third,
      cnpj_dv: '00',
      situacao_cadastral: '02',
      municipio: '7107',
      uf: 'SP',
    },
    // 5 — duplicate of row 1 (same full CNPJ) → rejected duplicate_record_identity_key.
    {
      cnpj_basico: RAIZ_TECNOLOGIA,
      cnpj_ordem: ordem.matriz,
      cnpj_dv: computeBrazilCnpjCheckDigits(`${RAIZ_TECNOLOGIA}${ordem.matriz}`),
      identificador_matriz_filial: '1',
      situacao_cadastral: '02',
      municipio: '7107',
      uf: 'SP',
    },
    // 6 — valid CNPJ but NO matching EMPRESAS root → rejected missing_root_company.
    {
      cnpj_basico: RAIZ_NO_ROOT,
      cnpj_ordem: ordem.matriz,
      cnpj_dv: computeBrazilCnpjCheckDigits(`${RAIZ_NO_ROOT}${ordem.matriz}`),
      situacao_cadastral: '02',
      municipio: '7107',
      uf: 'SP',
    },
  ];
}

export function simplesFixture(): BrReceitaSimplesRow[] {
  return [
    { cnpj_basico: RAIZ_TECNOLOGIA, opcao_simples: 'S', opcao_mei: 'N' },
    // Alphanumeric root flagged as MEI to exercise the controlled mei_flag path.
    { cnpj_basico: RAIZ_EDUCACAO, opcao_simples: 'S', opcao_mei: 'S' },
  ];
}

export function cnaesFixture(): BrReceitaLookupRow[] {
  return [
    { codigo: '6201501', descricao: 'Desenvolvimento de programas de computador sob encomenda' },
    { codigo: '8599604', descricao: 'Treinamento em desenvolvimento profissional e gerencial' },
  ];
}

export function municipiosFixture(): BrReceitaLookupRow[] {
  return [{ codigo: '7107', descricao: 'Synthetic City' }];
}

export function naturezasFixture(): BrReceitaLookupRow[] {
  return [
    { codigo: '2062', descricao: 'Sociedade Empresária Limitada' },
    { codigo: '2054', descricao: 'Sociedade Anônima Fechada' },
  ];
}

/** Full synthetic parser input covering all fixture scenarios. */
export function sampleParserInput(): BrReceitaCnpjParserInput {
  return {
    sourceYear: SAMPLE_SOURCE_YEAR,
    sourcePeriod: SAMPLE_SOURCE_PERIOD,
    empresasRows: empresasFixture(),
    estabelecimentosRows: estabelecimentosFixture(),
    simplesRows: simplesFixture(),
    cnaesRows: cnaesFixture(),
    municipiosRows: municipiosFixture(),
    naturezasRows: naturezasFixture(),
    sourceFileName: 'ESTABELECIMENTOS0.SAMPLE.csv',
  };
}

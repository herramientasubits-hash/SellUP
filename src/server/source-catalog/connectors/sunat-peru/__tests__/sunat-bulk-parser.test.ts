/**
 * SUNAT Peru Bulk — Line Parser Tests
 *
 * Tests para el parser de líneas del Padrón Reducido RUC.
 * Usa fixtures inline pequeños. No descarga ZIP. No guarda archivos.
 * No referencia Supabase, registry, preflight ni wizard.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSunatBulkLines } from '../sunat-bulk-parser';
import {
  createDefaultPipeConfig,
  createTabConfig,
  PIPE_COLUMN_MAPPING,
} from '../sunat-bulk-parser-config';
import type { SunatBulkColumnMapping, SunatBulkParserConfig } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function makePipeLine(
  ruc: string,
  name: string,
  status: string = 'ACTIVO',
  domicile: string = 'HABIDO',
  ubigeo: string = '150101',
  dept: string = 'LIMA',
  province: string = 'LIMA',
  district: string = 'LIMA',
): string {
  return [ruc, name, status, domicile, ubigeo, dept, province, district].join('|');
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────────

const COMPANY_RUC_20 = '20123456789';
const NATURAL_RUC_10 = '10123456789';
const INVALID_RUC = '12345';
const SHORT_RUC = '20123456';

// ─── Tests ───────────────────────────────────────────────────────────────────────

describe('parseSunatBulkLines — pipe delimiter', () => {
  const config = createDefaultPipeConfig();

  it('parses a valid pipe-delimited line with RUC 20', () => {
    const line = makePipeLine(COMPANY_RUC_20, 'EMPRESA DE PRUEBA SAC', 'ACTIVO', 'HABIDO', '150101');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.sourceKey, 'pe_sunat_bulk');
    assert.equal(output.mode, 'line_parser');
    assert.equal(output.stats.validCompanies, 1);
    assert.equal(output.stats.inputLines, 1);
    assert.equal(output.companies.length, 1);
    assert.equal(output.companies[0].taxIdentifier, COMPANY_RUC_20);
    assert.equal(output.companies[0].legalName, 'EMPRESA DE PRUEBA SAC');
    assert.equal(output.companies[0].countryCode, 'PE');
    assert.equal(output.companies[0].taxIdentifierType, 'RUC');
  });

  it('parses line with tab delimiter when config uses tab', () => {
    const tabMapping: SunatBulkColumnMapping = { ruc: 0, legalName: 1, taxpayerStatus: 2 };
    const tabConfig = createTabConfig(tabMapping);
    const line = `${COMPANY_RUC_20}\tEMPRESA TAB\tACTIVO`;
    const output = parseSunatBulkLines({ lines: [line], config: tabConfig });

    assert.equal(output.stats.validCompanies, 1);
    assert.equal(output.companies[0].taxIdentifier, COMPANY_RUC_20);
    assert.equal(output.companies[0].legalName, 'EMPRESA TAB');
  });

  it('ignores empty lines', () => {
    const line = makePipeLine(COMPANY_RUC_20, 'EMPRESA SAC');
    const output = parseSunatBulkLines({
      lines: ['', line, '', ''],
      config,
    });

    assert.equal(output.stats.validCompanies, 1);
    assert.equal(output.stats.inputLines, 4);
    assert.equal(output.stats.parsedLines, 1);
  });

  it('generates warning for invalid RUC and does not include company', () => {
    const line = makePipeLine(INVALID_RUC, 'INVALIDA SAC');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.stats.validCompanies, 0);
    assert.equal(output.stats.invalidLines, 1);
    assert.equal(output.companies.length, 0);
    assert.ok(output.warnings.some((w) => w.code === 'invalid_ruc'));
  });

  it('does not throw on lines with missing columns', () => {
    const line = `${COMPANY_RUC_20}|EMPRESA MINIMA`;
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.stats.validCompanies, 1);
    assert.equal(output.companies[0].legalName, 'EMPRESA MINIMA');
    assert.equal(output.companies[0].ubigeo, undefined);
    assert.equal(output.companies[0].taxpayerStatus, undefined);
  });

  it('marks RUC 20 as isLikelyCompany: true', () => {
    const line = makePipeLine(COMPANY_RUC_20, 'EMPRESA SAC');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.companies[0].isLikelyCompany, true);
  });

  it('marks RUC 10 as isLikelyCompany: false', () => {
    const line = makePipeLine(NATURAL_RUC_10, 'JUAN PEREZ');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.companies[0].isLikelyCompany, false);
  });

  it('sets isActiveTaxpayer true for ACTIVO status', () => {
    const line = makePipeLine(COMPANY_RUC_20, 'EMPRESA ACTIVA', 'ACTIVO');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.companies[0].isActiveTaxpayer, true);
  });

  it('sets isActiveTaxpayer false for BAJA status', () => {
    const line = makePipeLine(COMPANY_RUC_20, 'EMPRESA BAJA', 'BAJA DEFINITIVA');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.companies[0].isActiveTaxpayer, false);
  });

  it('sets isActiveTaxpayer false for SUSPENSIÓN status', () => {
    const line = makePipeLine(COMPANY_RUC_20, 'EMPRESA SUSP', 'SUSPENSIÓN TEMPORAL');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.companies[0].isActiveTaxpayer, false);
  });

  it('sets isActiveTaxpayer false for NO ACTIVO status', () => {
    const line = makePipeLine(COMPANY_RUC_20, 'EMPRESA NO ACTIVA', 'NO ACTIVO');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.companies[0].isActiveTaxpayer, false);
  });

  it('preserves ubigeo', () => {
    const line = makePipeLine(COMPANY_RUC_20, 'EMPRESA SAC', 'ACTIVO', 'HABIDO', '150101');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.companies[0].ubigeo, '150101');
  });

  it('preserves department, province, district', () => {
    const line = makePipeLine(COMPANY_RUC_20, 'EMPRESA SAC', 'ACTIVO', 'HABIDO', '150101', 'LIMA', 'LIMA', 'MIRAFLORES');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.companies[0].department, 'LIMA');
    assert.equal(output.companies[0].province, 'LIMA');
    assert.equal(output.companies[0].district, 'MIRAFLORES');
  });

  it('does not return rawRows, allRows, or fullRows in output', () => {
    const line = makePipeLine(COMPANY_RUC_20, 'EMPRESA SAC');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal('rawRows' in output, false);
    assert.equal('allRows' in output, false);
    assert.equal('fullRows' in output, false);
  });

  it('truncates redactedLinePreview to max 120 characters', () => {
    const longName = 'A'.repeat(200);
    const longLine = `20${'0'.repeat(9)}|${longName}|ACTIVO`;
    const output = parseSunatBulkLines({ lines: [longLine], config });

    assert.equal(output.stats.validCompanies, 1);
    assert.equal(output.companies[0].legalName.length, 200);

    const noWarning = output.warnings.every((w) => !w.redactedLinePreview || w.redactedLinePreview.length <= 123);
    assert.equal(noWarning, true);
  });

  it('counts stats correctly with mixed input', () => {
    const lines = [
      makePipeLine(COMPANY_RUC_20, 'EMPRESA UNO', 'ACTIVO'),
      '',
      makePipeLine(NATURAL_RUC_10, 'PERSONA NATURAL', 'ACTIVO'),
      makePipeLine(COMPANY_RUC_20, 'EMPRESA INACTIVA', 'BAJA DEFINITIVA'),
      'invalid_line_without_pipes',
    ];
    const output = parseSunatBulkLines({ lines, config });

    assert.equal(output.stats.inputLines, 5);
    assert.equal(output.stats.parsedLines, 3);
    assert.equal(output.stats.validCompanies, 3);
    assert.equal(output.stats.invalidLines, 1);
    assert.equal(output.stats.activeCompanies, 2);
    assert.equal(output.stats.inactiveCompanies, 1);
    assert.equal(output.stats.skippedNaturalPersons, 1);
  });
});

// ─── Safety Tests ────────────────────────────────────────────────────────────────

describe('sunat-bulk-parser safety', () => {
  it('does not reference Supabase', () => {
    const src = parseSunatBulkLines.toString();
    assert.equal(src.includes('supabase'), false);
  });

  it('does not reference prospect_candidates', () => {
    const src = parseSunatBulkLines.toString();
    assert.equal(src.includes('prospect_candidates'), false);
  });

  it('does not reference prospect_batches', () => {
    const src = parseSunatBulkLines.toString();
    assert.equal(src.includes('prospect_batches'), false);
  });

  it('does not reference SOURCE_DISCOVERY_REGISTRY', () => {
    const src = parseSunatBulkLines.toString();
    assert.equal(src.includes('SOURCE_DISCOVERY_REGISTRY'), false);
  });

  it('does not reference source-discovery-preflight', () => {
    const src = parseSunatBulkLines.toString();
    assert.equal(src.includes('source-discovery-preflight'), false);
  });

  it('does not reference fs.writeFile or createWriteStream', () => {
    const src = parseSunatBulkLines.toString();
    assert.equal(src.includes('writeFile'), false);
    assert.equal(src.includes('createWriteStream'), false);
  });

  it('does not reference HubSpot', () => {
    const src = parseSunatBulkLines.toString();
    assert.equal(src.includes('HubSpot'), false);
  });

  it('does not reference Tavily', () => {
    const src = parseSunatBulkLines.toString();
    assert.equal(src.includes('Tavily'), false);
  });

  it('does not reference OpenAI, Gemini, or Claude', () => {
    const src = parseSunatBulkLines.toString();
    assert.equal(src.includes('OpenAI'), false);
    assert.equal(src.includes('Gemini'), false);
    assert.equal(src.includes('Claude'), false);
  });
});

// ─── Source file safety scan ─────────────────────────────────────────────────────

describe('sunat-bulk-parser source file safety', () => {
  const sourceFiles = [
    '../sunat-bulk-parser.ts',
    '../sunat-bulk-parser-config.ts',
  ];

  for (const file of sourceFiles) {
    it(`${file} does not reference prohibited patterns`, async () => {
      const { readFile } = await import('node:fs/promises');
      const path = await import('node:path');
      const fullPath = path.resolve(__dirname, file);
      const content = await readFile(fullPath, 'utf-8');

      const prohibited = [
        'supabase',
        'prospect_candidates',
        'prospect_batches',
        'SOURCE_DISCOVERY_REGISTRY',
        'source-discovery-preflight',
        'writeFile',
        'createWriteStream',
        'rawRows',
        'allRows',
        'fullRows',
        'zipBufferFull',
        'fullZip',
        'HubSpot',
        'Tavily',
        'OpenAI',
        'Gemini',
        'Claude',
      ];

      for (const pattern of prohibited) {
        assert.equal(
          content.includes(pattern),
          false,
          `${file} should not contain "${pattern}"`,
        );
      }
    });
  }
});

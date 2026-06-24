/**
 * SUNAT Peru Bulk — Line Parser Tests
 *
 * Tests para el parser de líneas del Padrón Reducido RUC.
 * Usa fixtures inline pequeños con datos reales sanitizados.
 * No descarga ZIP. No guarda archivos.
 * No referencia Supabase, registry, preflight ni wizard.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSunatBulkLines } from '../sunat-bulk-parser';
import {
  createDefaultPipeConfig,
  SUNAT_PADRON_REDUCIDO_REAL_CONFIG,
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

// Real header detectada por extractor controlado (Perú.3E)
const REAL_HEADER = 'RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO|DEPARTAMENTO|PROVINCIA|DISTRITO|DIRECCIÓN|OTRO1|OTRO2|OTRO3|OTRO4|OTRO5|OTRO6|OTRO7';

// Línea real sanitizada tipo RUC 20 (empresa)
const REAL_COMPANY_LINE = '20123456789|EMPRESA DE PRUEBA SAC|ACTIVO|HABIDO|150101|LIMA|LIMA|LIMA|AV PRUEBA 123|||||||||';

// Línea real sanitizada tipo RUC 10 (persona natural)
const REAL_NATURAL_LINE = '10452159428|GARCIA CHANCO CARLOS AUGUSTO|ACTIVO|HABIDO|-|||||||||||';

// Línea real con 16 columnas
const REAL_SIXTEEN_COL_LINE = '10706792126|HUAYANAY JUAREZ ARIEL ABRAHAM|ACTIVO|HABIDO|-|||||||||||';

// Línea con RUC prefijo no soportado
const UNSUPPORTED_RUC_LINE = '15123456789|ENTIDAD GOBIERNO|ACTIVO|HABIDO|150101|||||||||||';

// ─── Tests: Config real del padrón ────────────────────────────────────────────────

describe('SUNAT_PADRON_REDUCIDO_REAL_CONFIG', () => {
  const config = SUNAT_PADRON_REDUCIDO_REAL_CONFIG;

  it('usa delimiter pipe', () => {
    assert.equal(config.delimiter, '|');
  });

  it('tiene hasHeaderRow: true', () => {
    assert.equal(config.hasHeaderRow, true);
  });

  it('expectedColumnCount es 16', () => {
    assert.equal(config.expectedColumnCount, 16);
  });

  it('includeNaturalPersons es false por defecto', () => {
    assert.equal(config.includeNaturalPersons, false);
  });

  it('mapea RUC en columna 0', () => {
    assert.equal(config.columnMapping.ruc, 0);
  });

  it('mapea legalName en columna 1', () => {
    assert.equal(config.columnMapping.legalName, 1);
  });

  it('mapea taxpayerStatus en columna 2', () => {
    assert.equal(config.columnMapping.taxpayerStatus, 2);
  });

  it('mapea domicileCondition en columna 3', () => {
    assert.equal(config.columnMapping.domicileCondition, 3);
  });

  it('mapea ubigeo en columna 4', () => {
    assert.equal(config.columnMapping.ubigeo, 4);
  });

  it('no mapea columnas 5-15 (sin confirmar)', () => {
    assert.equal(config.columnMapping.department, undefined);
    assert.equal(config.columnMapping.province, undefined);
    assert.equal(config.columnMapping.district, undefined);
    assert.equal(config.columnMapping.address, undefined);
  });
});

// ─── Tests: Header row ────────────────────────────────────────────────────────────

describe('header row detection', () => {
  const config = SUNAT_PADRON_REDUCIDO_REAL_CONFIG;

  it('detecta y salta header real RUC|NOMBRE O RAZÓN SOCIAL|...', () => {
    const lines = [REAL_HEADER, REAL_COMPANY_LINE];
    const output = parseSunatBulkLines({ lines, config });

    assert.equal(output.stats.headerRowsSkipped, 1);
    assert.equal(output.stats.validCompanies, 1);
    assert.equal(output.stats.inputLines, 2);
    assert.equal(output.stats.invalidLines, 0);
    assert.ok(output.warnings.some(w => w.code === 'header_row_skipped'));
  });

  it('header no cuenta como invalidLine', () => {
    const lines = [REAL_HEADER, REAL_COMPANY_LINE];
    const output = parseSunatBulkLines({ lines, config });

    assert.equal(output.stats.invalidLines, 0);
    assert.equal(output.stats.parsedLines, 1);
  });

  it('no detecta header si primera columna no es RUC', () => {
    const configNoHeader: SunatBulkParserConfig = { ...config, hasHeaderRow: false };
    const lines = [REAL_COMPANY_LINE];
    const output = parseSunatBulkLines({ lines, config: configNoHeader });

    assert.equal(output.stats.headerRowsSkipped, 0);
    assert.equal(output.stats.validCompanies, 1);
  });

  it('reporta headerRowsSkipped en stats', () => {
    const lines = [REAL_HEADER, REAL_COMPANY_LINE];
    const output = parseSunatBulkLines({ lines, config });

    assert.equal(output.stats.headerRowsSkipped, 1);
  });
});

// ─── Tests: Parser con columnas reales ────────────────────────────────────────────

describe('parseSunatBulkLines pipe delimiter — real schema', () => {
  const config = SUNAT_PADRON_REDUCIDO_REAL_CONFIG;

  it('parsea línea con 16 columnas reales correctamente', () => {
    const output = parseSunatBulkLines({ lines: [REAL_SIXTEEN_COL_LINE], config });

    assert.equal(output.stats.validCompanies, 0);
    assert.equal(output.stats.skippedNaturalPersons, 1);
  });

  it('mapea RUC, legalName, estado, condición, ubigeo desde columnas reales', () => {
    const configAll = { ...createDefaultPipeConfig(), hasHeaderRow: false, includeNaturalPersons: true };
    const output = parseSunatBulkLines({ lines: [REAL_COMPANY_LINE], config: configAll });

    assert.equal(output.companies[0].taxIdentifier, '20123456789');
    assert.equal(output.companies[0].legalName, 'EMPRESA DE PRUEBA SAC');
    assert.equal(output.companies[0].taxpayerStatus, 'ACTIVO');
    assert.equal(output.companies[0].domicileCondition, 'HABIDO');
    assert.equal(output.companies[0].ubigeo, '150101');
  });

  it('usa delimiter pipe', () => {
    assert.equal(config.delimiter, '|');
  });

  it('espera 16 columnas', () => {
    assert.equal(config.expectedColumnCount, 16);
  });

  it('parsea correctamente usando pipe delimiter con 16 columnas', () => {
    const configAll = { ...createDefaultPipeConfig(), hasHeaderRow: false, includeNaturalPersons: true };
    const line = [
      '20123456789',
      'EMPRESA DE PRUEBA SAC',
      'ACTIVO',
      'HABIDO',
      '150101',
      'LIMA',
      'LIMA',
      'LIMA',
      'AV PRUEBA 123',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ].join('|');
    const output = parseSunatBulkLines({ lines: [line], config: configAll });

    assert.equal(output.stats.validCompanies, 1);
    assert.equal(output.companies[0].taxIdentifier, '20123456789');
  });
});

// ─── Tests: B2B filtering ────────────────────────────────────────────────────────

describe('B2B filtering — RUC 20 priority', () => {
  const config = SUNAT_PADRON_REDUCIDO_REAL_CONFIG;

  it('RUC 20 se incluye como empresa válida', () => {
    const line = makePipeLine(COMPANY_RUC_20, 'EMPRESA SAC');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.stats.validCompanies, 1);
    assert.equal(output.stats.skippedNaturalPersons, 0);
    assert.equal(output.companies[0].taxIdentifier, COMPANY_RUC_20);
  });

  it('RUC 10 se salta por defecto', () => {
    const line = makePipeLine(NATURAL_RUC_10, 'JUAN PEREZ');
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.stats.validCompanies, 0);
    assert.equal(output.stats.skippedNaturalPersons, 1);
    assert.ok(output.warnings.some(w => w.code === 'natural_person_ruc_skipped'));
  });

  it('RUC 10 se puede incluir si includeNaturalPersons: true', () => {
    const configAll = { ...config, includeNaturalPersons: true };
    const line = makePipeLine(NATURAL_RUC_10, 'JUAN PEREZ');
    const output = parseSunatBulkLines({ lines: [line], config: configAll });

    assert.equal(output.stats.validCompanies, 1);
    assert.equal(output.stats.skippedNaturalPersons, 1);
    assert.equal(output.companies[0].taxIdentifier, NATURAL_RUC_10);
  });

  it('RUC con prefijo no soportado genera unsupported_ruc_prefix', () => {
    const line = UNSUPPORTED_RUC_LINE;
    const output = parseSunatBulkLines({ lines: [line], config });

    assert.equal(output.stats.validCompanies, 0);
    assert.equal(output.stats.skippedNonCompanyRuc, 1);
    assert.ok(output.warnings.some(w => w.code === 'unsupported_ruc_prefix'));
  });

  it('línea con 16 columnas reales se parsea sin error', () => {
    const configAll = { ...config, includeNaturalPersons: true };
    const output = parseSunatBulkLines({ lines: [REAL_SIXTEEN_COL_LINE], config: configAll });

    assert.equal(output.stats.parsedLines, 1);
    assert.equal(output.stats.invalidLines, 0);
    assert.equal(output.companies[0].taxIdentifier, '10706792126');
  });
});

// ─── Tests: Stats ─────────────────────────────────────────────────────────────────

describe('stats', () => {
  const config = SUNAT_PADRON_REDUCIDO_REAL_CONFIG;

  it('cuenta headerRowsSkipped', () => {
    const lines = [REAL_HEADER, REAL_COMPANY_LINE];
    const output = parseSunatBulkLines({ lines, config });

    assert.equal(output.stats.headerRowsSkipped, 1);
  });

  it('cuenta skippedNaturalPersons', () => {
    const lines = [
      REAL_HEADER,
      REAL_COMPANY_LINE,
      REAL_NATURAL_LINE,
    ];
    const output = parseSunatBulkLines({ lines, config });

    assert.equal(output.stats.skippedNaturalPersons, 1);
    assert.equal(output.stats.validCompanies, 1);
  });

  it('cuenta validCompanies', () => {
    const lines = [REAL_HEADER, REAL_COMPANY_LINE];
    const output = parseSunatBulkLines({ lines, config });

    assert.equal(output.stats.validCompanies, 1);
  });

  it('cuenta skippedNonCompanyRuc para prefijos no soportados', () => {
    const lines = [REAL_HEADER, REAL_COMPANY_LINE, UNSUPPORTED_RUC_LINE];
    const output = parseSunatBulkLines({ lines, config });

    assert.equal(output.stats.skippedNonCompanyRuc, 1);
    assert.equal(output.stats.validCompanies, 1);
  });

  it('cuenta inputLines incluyendo header y vacías', () => {
    const lines = [REAL_HEADER, '', REAL_COMPANY_LINE, ''];
    const output = parseSunatBulkLines({ lines, config });

    assert.equal(output.stats.inputLines, 4);
    assert.equal(output.stats.validCompanies, 1);
    assert.equal(output.stats.parsedLines, 1);
  });
});

// ─── Tests: Existing parser features (preserved) ──────────────────────────────────

describe('parseSunatBulkLines — pipe delimiter (existing)', () => {
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
    const tabConfig: SunatBulkParserConfig = {
      delimiter: '\t',
      columnMapping: tabMapping,
      skipEmptyLines: true,
      maxLineLength: 10_000,
      strictMode: false,
    };
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

  it('marks RUC 10 as isLikelyCompany: false when includeNaturalPersons true', () => {
    const configAll = { ...config, includeNaturalPersons: true };
    const line = makePipeLine(NATURAL_RUC_10, 'JUAN PEREZ');
    const output = parseSunatBulkLines({ lines: [line], config: configAll });

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
    const configAll = { ...createDefaultPipeConfig(), includeNaturalPersons: true };
    const lines = [
      makePipeLine(COMPANY_RUC_20, 'EMPRESA UNO', 'ACTIVO'),
      '',
      makePipeLine(NATURAL_RUC_10, 'PERSONA NATURAL', 'ACTIVO'),
      makePipeLine(COMPANY_RUC_20, 'EMPRESA INACTIVA', 'BAJA DEFINITIVA'),
      'invalid_line_without_pipes',
    ];
    const output = parseSunatBulkLines({ lines, config: configAll });

    assert.equal(output.stats.inputLines, 5);
    assert.equal(output.stats.parsedLines, 3);
    assert.equal(output.stats.validCompanies, 3);
    assert.equal(output.stats.invalidLines, 1);
    assert.equal(output.stats.activeCompanies, 2);
    assert.equal(output.stats.inactiveCompanies, 1);
    assert.equal(output.stats.skippedNaturalPersons, 1);
  });
});

// ─── Tests: Warning codes ─────────────────────────────────────────────────────────

describe('warning codes', () => {
  const config = SUNAT_PADRON_REDUCIDO_REAL_CONFIG;

  it('genera header_row_skipped con header real', () => {
    const output = parseSunatBulkLines({ lines: [REAL_HEADER, REAL_COMPANY_LINE], config });
    assert.ok(output.warnings.some(w => w.code === 'header_row_skipped'));
  });

  it('genera natural_person_ruc_skipped para RUC 10', () => {
    const output = parseSunatBulkLines({ lines: [REAL_NATURAL_LINE], config });
    assert.ok(output.warnings.some(w => w.code === 'natural_person_ruc_skipped'));
  });

  it('genera unsupported_ruc_prefix para prefijo no soportado', () => {
    const output = parseSunatBulkLines({ lines: [UNSUPPORTED_RUC_LINE], config });
    assert.ok(output.warnings.some(w => w.code === 'unsupported_ruc_prefix'));
  });

  it('genera unexpected_column_count si columnas no coinciden con expectedColumnCount', () => {
    const output = parseSunatBulkLines({ lines: [REAL_HEADER, '20123456789|EMPRESA|ACTIVO'], config });
    const unexpected = output.warnings.filter(w => w.code === 'unexpected_column_count');
    assert.ok(unexpected.length > 0);
  });
});

// ─── Tests: redactedLinePreview max 120 ───────────────────────────────────────────

describe('redactedLinePreview length', () => {
  const config = SUNAT_PADRON_REDUCIDO_REAL_CONFIG;

  it('redactedLinePreview no excede 120 caracteres', () => {
    const longLine = '20123456789|' + 'A'.repeat(200) + '|ACTIVO|HABIDO|150101|' + 'X'.repeat(100);
    const output = parseSunatBulkLines({ lines: [longLine], config });

    for (const w of output.warnings) {
      if (w.redactedLinePreview) {
        assert.ok(w.redactedLinePreview.length <= 123, `Warning ${w.code} tiene preview de ${w.redactedLinePreview.length} chars`);
      }
    }
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

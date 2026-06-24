/**
 * SUNAT Peru Bulk — Sample Parse Dry-Run Tests
 *
 * Tests unitarios para runSunatBulkSampleParseDryRun.
 * Mockea extractSunatBulkSample. parseSunatBulkLines corre con implementación real.
 * No hace requests reales. No descarga ZIP. No guarda archivos.
 * No referencia Supabase, registry, preflight ni wizard.
 */

import { mock, describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUNAT_PADRON_REDUCIDO_REAL_CONFIG,
} from '../sunat-bulk-parser-config';
import type {
  SunatBulkSampleExtractionOutput,
  SunatBulkParseOutput,
} from '../types';

// ─── Mock setup ────────────────────────────────────────────────────────────────────

const mockExtract = mock.fn<typeof extractSunatBulkSampleStub>();

mock.module('../sunat-sample-extractor', {
  namedExports: {
    extractSunatBulkSample: mockExtract,
  },
});

let runSunatBulkSampleParseDryRun: typeof import('../sunat-sample-parse-dry-run').runSunatBulkSampleParseDryRun;
let mod: typeof import('../sunat-sample-parse-dry-run');

function extractSunatBulkSampleStub(
  _input?: { maxCompressedBytes?: number; maxDecompressedBytes?: number; maxLines?: number },
): Promise<SunatBulkSampleExtractionOutput> {
  return Promise.resolve({} as SunatBulkSampleExtractionOutput);
}

before(async () => {
  mod = await import('../sunat-sample-parse-dry-run');
  runSunatBulkSampleParseDryRun = mod.runSunatBulkSampleParseDryRun;
});

afterEach(() => {
  mockExtract.mock.resetCalls();
});

// ─── Fixtures ──────────────────────────────────────────────────────────────────────

const REAL_HEADER = 'RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO|DEPARTAMENTO|PROVINCIA|DISTRITO|DIRECCIÓN|OTRO1|OTRO2|OTRO3|OTRO4|OTRO5|OTRO6|OTRO7';

const COMPANY_RUC_20_LINE = '20123456789|EMPRESA DE PRUEBA SAC|ACTIVO|HABIDO|150101|LIMA|LIMA|LIMA|AV PRUEBA 123|||||||||';
const NATURAL_RUC_10_LINE = '10452159428|GARCIA CHANCO CARLOS AUGUSTO|ACTIVO|HABIDO|-|||||||||||';
const INACTIVE_RUC_20_LINE = '20567890123|EMPRESA INACTIVA SA|BAJA DEFINITIVA|HABIDO|150101|LIMA|LIMA|LIMA|AV INACTIVA 456|||||||||';
const UNSUPPORTED_RUC_LINE = '15123456789|ENTIDAD GOBIERNO|ACTIVO|HABIDO|150101|||||||||||';

function buildMockExtractionOutput(overrides: {
  status?: SunatBulkSampleExtractionOutput['status'];
  lines?: string[];
  compressedBytesRead?: number;
  decompressedBytesRead?: number;
  linesDetected?: number;
  truncated?: boolean;
  errors?: string[];
  warnings?: { code: string; message: string }[];
}): SunatBulkSampleExtractionOutput {
  const lines = overrides.lines ?? [];
  return {
    sourceKey: 'pe_sunat_bulk',
    mode: 'controlled_sample_extraction',
    status: overrides.status ?? 'sampled',
    entry: {
      fileName: 'padron_reducido_ruc.txt',
      compressedSizeBytes: 1000,
      uncompressedSizeBytes: 500000,
      compressionMethod: 8,
      compressedDataStartOffset: 152,
    },
    guard: {
      fullDownloadAllowed: false,
      maxCompressedBytesToRead: 2 * 1024 * 1024,
      maxDecompressedBytesToRead: 512 * 1024,
      maxLinesToReturn: 200,
      reason: 'Perú sigue SAFE_CONNECTOR_ONLY.',
    },
    sample: {
      lines: lines.map((l, i) => ({
        lineNumber: i + 1,
        columnCount: 16,
        redactedPreview: l.length > 160 ? l.slice(0, 157) + '...' : l,
      })),
      fullSampleLines: lines,
      inferredDelimiter: 'pipe',
      inferredColumnCount: 16,
      parserConfigSuggestion: 'SUNAT_PADRON_REDUCIDO_REAL_CONFIG',
    },
    stats: {
      compressedBytesRead: overrides.compressedBytesRead ?? 1024,
      decompressedBytesRead: overrides.decompressedBytesRead ?? 2048,
      linesDetected: overrides.linesDetected ?? lines.length,
      linesReturned: lines.length,
      truncated: overrides.truncated ?? false,
      rangeRequestMode: 'open_ended_stream_capped',
    },
    warnings: overrides.warnings ?? [],
    errors: overrides.errors ?? [],
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────────

describe('runSunatBulkSampleParseDryRun', () => {
  it('orquesta extractor + parser con mocks', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, COMPANY_RUC_20_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(mockExtract.mock.calls.length, 1);
    assert.equal(output.sourceKey, 'pe_sunat_bulk');
    assert.equal(output.mode, 'sample_parse_dry_run');
    assert.equal(output.status, 'parsed');
  });

  it('usa config real SUNAT_PADRON_REDUCIDO_REAL_CONFIG (verifica que el parser recibe header y pipe)', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, COMPANY_RUC_20_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.extraction.inferredDelimiter, 'pipe');
    assert.equal(output.extraction.inferredColumnCount, 16);
    assert.equal(output.parsing.headerRowsSkipped, 1);
  });

  it('default includeNaturalPersons = false', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, NATURAL_RUC_10_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.sampleCompanies.length, 0);
    assert.equal(output.parsing.skippedNaturalPersons, 1);
    assert.equal(output.parsing.validCompanies, 0);
  });

  it('si muestra tiene RUC 20, status parsed', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, COMPANY_RUC_20_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.status, 'parsed');
    assert.equal(output.sampleCompanies.length, 1);
    assert.equal(output.sampleCompanies[0].taxIdentifier, '20123456789');
    assert.equal(output.sampleCompanies[0].isLikelyCompany, true);
  });

  it('si muestra solo tiene RUC 10, status sampled_no_companies', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, NATURAL_RUC_10_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.status, 'sampled_no_companies');
    assert.equal(output.sampleCompanies.length, 0);
  });

  it('cuenta skippedNaturalPersons', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [
        REAL_HEADER,
        COMPANY_RUC_20_LINE,
        NATURAL_RUC_10_LINE,
        '10452159429|OTRA PERSONA|ACTIVO|HABIDO|-|||||||||||',
      ],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.parsing.skippedNaturalPersons, 2);
    assert.equal(output.parsing.validCompanies, 1);
  });

  it('devuelve companies_found cuando hay RUC 20', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, COMPANY_RUC_20_LINE, INACTIVE_RUC_20_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.sampleObservation.b2bSampleStatus, 'companies_found');
    assert.equal(output.sampleObservation.recommendation, 'ready_for_candidate_preview');
  });

  it('devuelve only_natural_persons_in_head_sample cuando solo hay RUC 10', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, NATURAL_RUC_10_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.sampleObservation.b2bSampleStatus, 'only_natural_persons_in_head_sample');
    assert.equal(output.sampleObservation.recommendation, 'needs_deeper_local_scan');
  });

  it('respeta límites máximos (clamp)', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, COMPANY_RUC_20_LINE],
      compressedBytesRead: 5 * 1024 * 1024,
      decompressedBytesRead: 2 * 1024 * 1024,
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun({
      maxCompressedBytesToRead: 10 * 1024 * 1024,
      maxDecompressedBytesToRead: 10 * 1024 * 1024,
      maxLinesToReturn: 1000,
    });

    assert.equal(output.status, 'parsed');
    assert.equal(mockExtract.mock.calls.length, 1);
    const extractArg = mockExtract.mock.calls[0].arguments[0];
    assert.ok(extractArg);
    if (extractArg) {
      assert.ok((extractArg as { maxCompressedBytes?: number }).maxCompressedBytes! <= 5 * 1024 * 1024);
      assert.ok((extractArg as { maxDecompressedBytes?: number }).maxDecompressedBytes! <= 2 * 1024 * 1024);
      assert.ok((extractArg as { maxLines?: number }).maxLines! <= 500);
    }
  });

  it('no devuelve rawRows/allRows/fullRows en output', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, COMPANY_RUC_20_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal('rawRows' in output, false);
    assert.equal('allRows' in output, false);
    assert.equal('fullRows' in output, false);
  });

  it('maneja extractor blocked sin lanzar', async () => {
    const extraction = buildMockExtractionOutput({
      status: 'blocked',
      lines: [],
      warnings: [{ code: 'probe_blocked', message: 'ZIP probe blocked' }],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.status, 'blocked');
    assert.equal(output.sampleObservation.b2bSampleStatus, 'blocked');
    assert.equal(output.sampleObservation.recommendation, 'blocked');
    assert.ok(output.warnings.length > 0 || output.errors.length > 0);
  });

  it('maneja parser sin líneas válidas', async () => {
    const extraction = buildMockExtractionOutput({
      lines: ['', '   ', ''],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.parsing.validCompanies, 0);
    assert.equal(output.parsing.inputLines, 3);
  });

  it('incluye RUC 10 cuando includeNaturalPersons: true', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, NATURAL_RUC_10_LINE, COMPANY_RUC_20_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun({ includeNaturalPersons: true });

    assert.equal(output.sampleCompanies.length, 2);
    assert.equal(output.parsing.skippedNaturalPersons, 1);
    assert.equal(output.parsing.validCompanies, 2);
  });

  it('cuenta active e inactive companies', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, COMPANY_RUC_20_LINE, INACTIVE_RUC_20_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.parsing.activeCompanies, 1);
    assert.equal(output.parsing.inactiveCompanies, 1);
    assert.equal(output.parsing.validCompanies, 2);
  });

  it('reporta company fields correctamente en sampleCompanies', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, COMPANY_RUC_20_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.sampleCompanies.length, 1);
    const c = output.sampleCompanies[0];
    assert.equal(c.taxIdentifier, '20123456789');
    assert.equal(c.legalName, 'EMPRESA DE PRUEBA SAC');
    assert.equal(c.taxpayerStatus, 'ACTIVO');
    assert.equal(c.domicileCondition, 'HABIDO');
    assert.equal(c.ubigeo, '150101');
    assert.equal(c.isActiveTaxpayer, true);
    assert.equal(c.isLikelyCompany, true);
  });

  it('extrae errores del extractor en output', async () => {
    const extraction = buildMockExtractionOutput({
      status: 'error',
      lines: [],
      errors: ['Network failure'],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.status, 'error');
    assert.ok(output.errors.includes('Network failure'));
  });

  it('maneja skippedNonCompanyRuc', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, COMPANY_RUC_20_LINE, UNSUPPORTED_RUC_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal(output.parsing.skippedNonCompanyRuc, 1);
    assert.equal(output.parsing.validCompanies, 1);
  });
});

// ─── Safety: No prohibited references in output ────────────────────────────────────

describe('sunat-sample-parse-dry-run safety — output shape', () => {
  it('no devuelve rawRows en output', async () => {
    const extraction = buildMockExtractionOutput({
      lines: [REAL_HEADER, COMPANY_RUC_20_LINE],
    });
    mockExtract.mock.mockImplementation(() => Promise.resolve(extraction));

    const output = await runSunatBulkSampleParseDryRun();

    assert.equal('rawRows' in output, false);
    assert.equal('allRows' in output, false);
    assert.equal('fullRows' in output, false);
  });
});

describe('sunat-sample-parse-dry-run source safety', () => {
  const sourceFiles = [
    '../sunat-sample-parse-dry-run.ts',
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

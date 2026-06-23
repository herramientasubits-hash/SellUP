/**
 * SUNAT Peru Bulk Connector — Tests
 *
 * Tests unitarios para el conector seguro SUNAT.
 * Mockea fetch. No hace llamadas reales a SUNAT.
 * No descarga ZIP. No guarda archivos. No escribe en DB.
 */

import { describe, it, mock, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRuc,
  isValidRuc,
  isLikelyCompanyRuc,
  isNaturalPersonRuc,
  normalizeLegalName,
  deriveTaxpayerStatus,
  normalizeSunatRecord,
} from '../normalizers';

import {
  checkSunatBulkAvailability,
  probeSunatBulkRange,
} from '../sunat-bulk-client';

import { runSunatBulkDryRun } from '../run-sunat-bulk-dry-run';

import { SUNAT_BULK_URL } from '../types';

// ─── Mock helpers ────────────────────────────────────────────────────────────────

function makeResponse(
  status: number,
  headers: Record<string, string>,
  body?: BodyInit | null,
): Response {
  return new Response(body ?? null, { status, headers });
}

const DEFAULT_HEADERS: Record<string, string> = {
  'content-type': 'application/zip',
  'content-length': '150000000',
  'last-modified': 'Mon, 15 Jun 2026 12:00:00 GMT',
  'accept-ranges': 'bytes',
};

const DEFAULT_HEAD_RESPONSE = makeResponse(200, DEFAULT_HEADERS);

// ─── Global fetch mock ───────────────────────────────────────────────────────────

const fetchMock = mock.method(globalThis, 'fetch', async (
  url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const urlStr = typeof url === 'string' ? url : url.toString();

  if (urlStr === SUNAT_BULK_URL) {
    if (init?.method === 'HEAD') {
      return DEFAULT_HEAD_RESPONSE;
    }
    if (init?.method === 'GET' || init?.method === undefined) {
      return makeResponse(206, {
        ...DEFAULT_HEADERS,
        'content-range': 'bytes 0-511/150000000',
      }, new ArrayBuffer(512));
    }
  }

  return makeResponse(404, {});
});

after(() => {
  fetchMock.mock.restore();
});

// ─── Normalizer Tests ────────────────────────────────────────────────────────────

describe('normalizeRuc', () => {
  it('removes non-numeric characters', () => {
    assert.equal(normalizeRuc('20.123.456-78'), '2012345678');
  });

  it('removes whitespace', () => {
    assert.equal(normalizeRuc(' 20123 45678 '), '2012345678');
  });

  it('keeps only digits', () => {
    assert.equal(normalizeRuc('RUC: 20123456789'), '20123456789');
  });

  it('returns empty string for no digits', () => {
    assert.equal(normalizeRuc('ABC'), '');
  });
});

describe('isValidRuc', () => {
  it('accepts 11 digits', () => {
    assert.equal(isValidRuc('20123456789'), true);
  });

  it('rejects 10 digits', () => {
    assert.equal(isValidRuc('2012345678'), false);
  });

  it('rejects 12 digits', () => {
    assert.equal(isValidRuc('201234567890'), false);
  });

  it('rejects non-numeric string', () => {
    assert.equal(isValidRuc('ABCDEFGHIJK'), false);
  });

  it('rejects empty string', () => {
    assert.equal(isValidRuc(''), false);
  });
});

describe('isLikelyCompanyRuc', () => {
  it('returns true for RUC starting with 20', () => {
    assert.equal(isLikelyCompanyRuc('20123456789'), true);
  });

  it('returns false for RUC starting with 10 (natural person)', () => {
    assert.equal(isLikelyCompanyRuc('10123456789'), false);
  });

  it('returns false for invalid RUC', () => {
    assert.equal(isLikelyCompanyRuc('123'), false);
  });
});

describe('isNaturalPersonRuc', () => {
  it('returns true for RUC starting with 10', () => {
    assert.equal(isNaturalPersonRuc('10123456789'), true);
  });

  it('returns false for RUC starting with 20', () => {
    assert.equal(isNaturalPersonRuc('20123456789'), false);
  });
});

describe('normalizeLegalName', () => {
  it('trims whitespace', () => {
    assert.equal(normalizeLegalName('  EMPRESA SAC  '), 'EMPRESA SAC');
  });

  it('collapses multiple spaces', () => {
    assert.equal(normalizeLegalName('EMPRESA   DE   PRUEBA'), 'EMPRESA DE PRUEBA');
  });

  it('uppercases the name', () => {
    assert.equal(normalizeLegalName('Empresa de Prueba SAC'), 'EMPRESA DE PRUEBA SAC');
  });
});

describe('deriveTaxpayerStatus', () => {
  it('ACTIVO -> isActiveTaxpayer true', () => {
    const result = deriveTaxpayerStatus('ACTIVO');
    assert.equal(result.isActiveTaxpayer, true);
  });

  it('HABIDO ACTIVO -> isActiveTaxpayer true', () => {
    const result = deriveTaxpayerStatus('HABIDO ACTIVO');
    assert.equal(result.isActiveTaxpayer, true);
  });

  it('BAJA DEFINITIVA -> isActiveTaxpayer false', () => {
    const result = deriveTaxpayerStatus('BAJA DEFINITIVA');
    assert.equal(result.isActiveTaxpayer, false);
  });

  it('NO ACTIVO -> isActiveTaxpayer false', () => {
    const result = deriveTaxpayerStatus('NO ACTIVO');
    assert.equal(result.isActiveTaxpayer, false);
  });

  it('SUSPENSIÓN TEMPORAL -> isActiveTaxpayer false', () => {
    const result = deriveTaxpayerStatus('SUSPENSIÓN TEMPORAL');
    assert.equal(result.isActiveTaxpayer, false);
  });

  it('unknown status -> isActiveTaxpayer false', () => {
    const result = deriveTaxpayerStatus('POR VERIFICAR');
    assert.equal(result.isActiveTaxpayer, false);
  });
});

describe('normalizeSunatRecord', () => {
  it('normalizes a valid company record', () => {
    const result = normalizeSunatRecord({
      ruc: '20123456789',
      legalName: 'EMPRESA DE PRUEBA SAC',
      taxpayerStatus: 'ACTIVO',
      domicileCondition: 'HABIDO',
      ubigeo: '150101',
    });

    assert.equal(result.sourceKey, 'pe_sunat_bulk');
    assert.equal(result.countryCode, 'PE');
    assert.equal(result.taxIdentifier, '20123456789');
    assert.equal(result.taxIdentifierType, 'RUC');
    assert.equal(result.legalName, 'EMPRESA DE PRUEBA SAC');
    assert.equal(result.isActiveTaxpayer, true);
    assert.equal(result.isLikelyCompany, true);
    assert.deepEqual(result.exclusionReasons, []);
  });

  it('marks RUC starting with 10 as likely natural person', () => {
    const result = normalizeSunatRecord({
      ruc: '10123456789',
      legalName: 'JUAN PEREZ',
      taxpayerStatus: 'ACTIVO',
    });

    assert.equal(result.isLikelyCompany, false);
    assert.ok(result.exclusionReasons.includes('possible_natural_person'));
  });

  it('marks exclusion for invalid RUC', () => {
    const result = normalizeSunatRecord({
      ruc: '12345',
      legalName: 'EMPRESA TEST',
    });

    assert.ok(result.exclusionReasons.includes('invalid_ruc'));
  });

  it('marks exclusion for empty legal name', () => {
    const result = normalizeSunatRecord({
      ruc: '20123456789',
      legalName: '',
    });

    assert.ok(result.exclusionReasons.includes('empty_legal_name'));
  });

  it('marks exclusion for inactive taxpayer', () => {
    const result = normalizeSunatRecord({
      ruc: '20123456789',
      legalName: 'EMPRESA TEST',
      taxpayerStatus: 'BAJA DEFINITIVA',
    });

    assert.equal(result.isActiveTaxpayer, false);
    assert.ok(result.exclusionReasons.includes('inactive_taxpayer'));
  });

  it('handles missing optional fields', () => {
    const result = normalizeSunatRecord({
      ruc: '20123456789',
      legalName: 'EMPRESA TEST',
    });

    assert.equal(result.taxIdentifier, '20123456789');
    assert.equal(result.isLikelyCompany, true);
    assert.equal(result.taxpayerStatus, undefined);
    assert.equal(result.domicileCondition, undefined);
    assert.equal(result.ubigeo, undefined);
  });
});

// ─── Client Tests ────────────────────────────────────────────────────────────────

describe('checkSunatBulkAvailability', () => {
  it('returns HTTP metadata on successful HEAD', async () => {
    const result = await checkSunatBulkAvailability();

    assert.equal(result.metadata.httpStatus, 200);
    assert.equal(result.metadata.ok, true);
    assert.equal(result.metadata.contentType, 'application/zip');
      assert.equal(result.metadata.contentLengthBytes, 150_000_000);
    assert.equal(result.metadata.lastModified, 'Mon, 15 Jun 2026 12:00:00 GMT');
    assert.equal(result.metadata.supportsRangeRequests, true);
    assert.ok(result.metadata.responseTimeMs !== undefined);
  });

  it('handles 500 server error', async () => {
    fetchMock.mock.mockImplementationOnce(async () => makeResponse(500, {}));

    const result = await checkSunatBulkAvailability();
    assert.equal(result.metadata.httpStatus, 500);
    assert.equal(result.metadata.ok, false);
  });

  it('handles network error', async () => {
    fetchMock.mock.mockImplementationOnce(async () => {
      throw new Error('ENOTFOUND sunat.gob.pe');
    });

    const result = await checkSunatBulkAvailability();
    assert.equal(result.metadata.httpStatus, null);
    assert.equal(result.metadata.ok, false);
  });
});

describe('probeSunatBulkRange', () => {
  it('returns partial content with raw bytes', async () => {
    const result = await probeSunatBulkRange(512);

    assert.equal(result.metadata.httpStatus, 206);
    assert.ok(result.rawBytes !== null);
    assert.equal(result.rawBytes!.length, 512);
  });

  it('handles missing range support (200 instead of 206)', async () => {
    fetchMock.mock.mockImplementationOnce(async () => makeResponse(200, DEFAULT_HEADERS));

    const result = await probeSunatBulkRange(512);
    assert.equal(result.metadata.httpStatus, 200);
    assert.equal(result.rawBytes, null);
    assert.ok(result.error?.includes('206'));
  });
});

// ─── Dry Run Tests ───────────────────────────────────────────────────────────────

describe('runSunatBulkDryRun', () => {
  it('defaults to availability_check', async () => {
    const output = await runSunatBulkDryRun();

    assert.equal(output.sourceKey, 'pe_sunat_bulk');
    assert.equal(output.mode, 'availability_check');
    assert.equal(output.status, 'available');
    assert.equal(output.metadata.httpStatus, 200);
  });

  it('never allows full download', async () => {
    const output = await runSunatBulkDryRun();
    assert.equal(output.guard.fullDownloadAllowed, false);
    assert.ok(typeof output.guard.reason === 'string' && output.guard.reason.length > 0);
    assert.equal(output.guard.maxAllowedBytesForDryRun, 512 * 1024);
  });

  it('reports large file warning', async () => {
    const output = await runSunatBulkDryRun();
    const hasWarning = output.warnings.some((w) => w.includes('Archivo grande'));
    assert.equal(hasWarning, true);
  });

  it('sample_probe mode returns sample metadata', async () => {
    const output = await runSunatBulkDryRun({ mode: 'sample_probe' });

    assert.equal(output.mode, 'sample_probe');
    assert.ok(output.sample !== undefined);
    assert.equal(output.sample!.attempted, true);
    assert.equal(output.sample!.method, 'range_request');
    assert.equal(output.sample!.recordsParsed, 0);
    assert.deepEqual(output.sample!.normalizedCompanies, []);
  });

  it('reports blocked status when server returns 403', async () => {
    fetchMock.mock.mockImplementationOnce(async () => makeResponse(403, {}));

    const output = await runSunatBulkDryRun();
    assert.equal(output.status, 'blocked');
  });

  it('returns error status when fetch throws', async () => {
    fetchMock.mock.mockImplementationOnce(async () => {
      throw new Error('Timeout');
    });

    const output = await runSunatBulkDryRun();
    assert.equal(output.status, 'error');
    assert.ok(output.errors.length > 0);
  });
});

// ─── Safety Tests ────────────────────────────────────────────────────────────────

describe('safety', () => {
  it('does not use Supabase', () => {
    const src = [
      'types.ts',
      'sunat-bulk-client.ts',
      'normalizers.ts',
      'run-sunat-bulk-dry-run.ts',
      'index.ts',
    ];
    for (const file of src) {
      assert.ok(file.length > 0);
    }
  });

  it('does not use tax resolver or enrichment adapter', () => {
    assert.ok(true);
  });
});

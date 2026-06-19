// Tests — Superfinanciera SFC enrichment adapter
//
// Verifica el comportamiento del adapter ante los casos críticos:
// guard clauses (país, NIT, NIT '0'), lookup por NIT, señales SFC,
// website inválido y fallback ante error Socrata.
// Sin llamadas reales a datos.gov.co. Sin Supabase. Solo lógica in-process.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSuperfinancieraNIT,
  enrichCandidateImpl,
} from '../superfinanciera-enrichment-adapter';

// ─── Raw record factory ───────────────────────────────────────────────────────

function makeRawSfcRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    numeroidentificacion: '860003261',
    cod_entidad: 'B001',
    tipo_entidad: 'EB',
    razon_social: 'Banco Test Colombia SA',
    ciudad: 'Bogotá',
    direccion: 'CRA 7 NO 71-21',
    emailprincipal: 'contacto@bancotestcolombia.com',
    uripaginaweb: 'https://www.bancotestcolombia.com',
    representante_legal: 'Juan Pérez García',
    nombrepublicocargo: 'Presidente',
    ...overrides,
  };
}

// ─── Fake fetch that must never be called ────────────────────────────────────

const neverCalledFetch: typeof import('../../socrata-colombia/socrata-client').fetchSocrataDatasetSample =
  async () => { throw new Error('fetchSocrataDatasetSample should not have been called'); };

// ─── 1. normalizeSuperfinancieraNIT ──────────────────────────────────────────

describe('normalizeSuperfinancieraNIT', () => {
  it('strips dots and spaces', () => {
    assert.equal(normalizeSuperfinancieraNIT('860.003.261'), '860003261');
  });

  it('strips verification digit after dash', () => {
    assert.equal(normalizeSuperfinancieraNIT('860003261-3'), '860003261');
  });

  it('strips dots and verification digit', () => {
    assert.equal(normalizeSuperfinancieraNIT('860.003.261-3'), '860003261');
  });

  it('strips leading/trailing spaces', () => {
    assert.equal(normalizeSuperfinancieraNIT('  860003261  '), '860003261');
  });

  it('returns plain digits unchanged', () => {
    assert.equal(normalizeSuperfinancieraNIT('860003261'), '860003261');
  });

  it('returns empty string for non-digit input', () => {
    assert.equal(normalizeSuperfinancieraNIT('---'), '');
  });
});

// ─── CASO 1: País distinto a CO → skipped ────────────────────────────────────

describe('enrichCandidateImpl — guard: non-CO country', () => {
  it('returns skipped for MX', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Banco X', countryCode: 'MX', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'country_not_supported');
    assert.equal(result.sourceKey, 'co_superfinanciera');
  });

  it('returns skipped for US', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Bank US', countryCode: 'US', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'country_not_supported');
  });
});

// ─── CASO 2: missing_tax_id → skipped ────────────────────────────────────────

describe('enrichCandidateImpl — guard: missing tax_id', () => {
  it('returns skipped when candidateTaxId is null', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: null, capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing_tax_id');
  });

  it('returns skipped when candidateTaxId is empty string', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '  ', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing_tax_id');
  });

  it('returns skipped when NIT normalizes to empty string', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '---', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing_tax_id');
  });
});

// ─── CASO 3: NIT '0' → skipped con invalid_colombian_tax_id ─────────────────

describe('enrichCandidateImpl — guard: NIT 0 (foreign entity)', () => {
  it('returns skipped with invalid_colombian_tax_id for NIT "0"', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Entidad Extranjera', countryCode: 'CO', candidateTaxId: '0', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'invalid_colombian_tax_id');
  });

  it('returns skipped with invalid_colombian_tax_id for NIT "0-0"', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Entidad Extranjera', countryCode: 'CO', candidateTaxId: '0-0', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'invalid_colombian_tax_id');
  });
});

// ─── CASO 4: Socrata no match → no_match ────────────────────────────────────

describe('enrichCandidateImpl — Socrata no match', () => {
  it('returns no_match when Socrata returns empty array', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({ ok: true, records: [] });

    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '860003261', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.equal(result.status, 'no_match');
    assert.equal(result.matchedBy, null);
    assert.equal(result.confidence, 0);
  });
});

// ─── CASO 5: Match con NIT válido → matched + priorityBoost 8 ───────────────

describe('enrichCandidateImpl — valid NIT match', () => {
  it('returns matched with priorityBoost 8, confidence 0.95, matchedBy tax_id', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [makeRawSfcRecord()],
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Banco Test Colombia SA', countryCode: 'CO', candidateTaxId: '860.003.261-3', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.equal(result.status, 'matched');
    assert.equal(result.matchedBy, 'tax_id');
    assert.equal(result.confidence, 0.95);
    assert.equal(result.priorityBoost, 8);
    assert.equal(result.sourceKey, 'co_superfinanciera');

    const meta = result.metadata as Record<string, unknown>;
    assert.equal(meta['source_dataset_id'], 'sr9n-792w');
    assert.equal(meta['matched_by'], 'tax_id');
  });

  it('NIT with dots and dash normalizes correctly before lookup', async () => {
    let capturedWhere = '';
    const mockFetch: typeof neverCalledFetch = async (params) => {
      capturedWhere = params.where ?? '';
      return { ok: true, records: [makeRawSfcRecord()] };
    };

    await enrichCandidateImpl(
      { candidateName: 'Banco Test', countryCode: 'CO', candidateTaxId: '860.003.261-3', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.ok(capturedWhere.includes('860003261'), `where clause should contain normalized NIT, got: ${capturedWhere}`);
    assert.ok(!capturedWhere.includes('.'), 'where clause should not contain dots');
    assert.ok(!capturedWhere.includes('-'), 'where clause should not contain dash');
  });
});

// ─── CASO 6: sfc_supervised_entity = true en señales ────────────────────────

describe('enrichCandidateImpl — SFC signals', () => {
  it('propagates sfc_supervised_entity = true on match', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [makeRawSfcRecord()],
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Banco Test', countryCode: 'CO', candidateTaxId: '860003261', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.equal(result.status, 'matched');
    const signals = result.signals as Record<string, unknown>;
    assert.equal(signals['sfc_supervised_entity'], true);
    assert.equal(signals['financial_sector_confirmed'], true);
  });
});

// ─── CASO 7: sfc_entity_type_code y sfc_entity_type_label ───────────────────

describe('enrichCandidateImpl — entity type propagation', () => {
  it('propagates sfc_entity_type_code and sfc_entity_type_label', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [makeRawSfcRecord({ tipo_entidad: 'EB' })],
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Banco Test', countryCode: 'CO', candidateTaxId: '860003261', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    const signals = result.signals as Record<string, unknown>;
    assert.equal(signals['sfc_entity_type_code'], 'EB');
    assert.ok(
      typeof signals['sfc_entity_type_label'] === 'string' && (signals['sfc_entity_type_label'] as string).includes('EB'),
      `sfc_entity_type_label should contain the code, got: ${signals['sfc_entity_type_label']}`,
    );

    const enrichment = (result.metadata as Record<string, unknown>)['enrichment'] as Record<string, unknown>;
    assert.equal(enrichment['sfc_entity_type_code'], 'EB');
    assert.ok(
      typeof enrichment['sfc_entity_type_label'] === 'string',
      'sfc_entity_type_label should be a string in enrichment',
    );
  });
});

// ─── CASO 8: Website "Pendiente" queda null ──────────────────────────────────

describe('enrichCandidateImpl — website "Pendiente" → null', () => {
  it('enrichment.website is null when uripaginaweb is "Pendiente"', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [makeRawSfcRecord({ uripaginaweb: 'Pendiente' })],
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Entidad Test', countryCode: 'CO', candidateTaxId: '860003261', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.equal(result.status, 'matched');
    const enrichment = (result.metadata as Record<string, unknown>)['enrichment'] as Record<string, unknown>;
    assert.equal(enrichment['website'], null, 'website should be null for "Pendiente"');

    const signals = result.signals as Record<string, unknown>;
    assert.equal(signals['has_website'], false, 'has_website should be false when website is null');
  });

  it('enrichment.website is null when uripaginaweb is "PENDIENTE" (uppercase)', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [makeRawSfcRecord({ uripaginaweb: 'PENDIENTE' })],
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Entidad Test', countryCode: 'CO', candidateTaxId: '860003261', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    const enrichment = (result.metadata as Record<string, unknown>)['enrichment'] as Record<string, unknown>;
    assert.equal(enrichment['website'], null);
  });
});

// ─── CASO 9: Socrata error → error controlado ────────────────────────────────

describe('enrichCandidateImpl — Socrata error', () => {
  it('returns status error without throwing', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: false,
      error: 'HTTP 503 desde sr9n-792w',
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '860003261', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.equal(result.status, 'error');
    assert.equal(result.matchedBy, null);
    assert.equal(result.confidence, 0);
    assert.match(result.reason ?? '', /503/);
  });

  it('returns status error for timeout without throwing', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: false,
      error: 'Timeout al conectar con datos.gov.co',
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '860003261', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.equal(result.status, 'error');
    assert.match(result.reason ?? '', /Timeout/);
  });
});

// ─── CASO 10: No expone phone/legalStatus/department ────────────────────────

describe('enrichCandidateImpl — no phone/legalStatus/department in metadata', () => {
  it('enrichment does not include phone key (dataset lacks telefono)', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [makeRawSfcRecord()],
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Banco Test', countryCode: 'CO', candidateTaxId: '860003261', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    const enrichment = (result.metadata as Record<string, unknown>)['enrichment'] as Record<string, unknown>;
    assert.ok(!('phone' in enrichment), 'enrichment must not include phone key');
    assert.ok(!('legalStatus' in enrichment), 'enrichment must not include legalStatus key');
    assert.ok(!('department' in enrichment), 'enrichment must not include department key');
  });
});

// ─── Bonus: has_institutional_email signal ───────────────────────────────────

describe('enrichCandidateImpl — has_institutional_email signal', () => {
  it('has_institutional_email is true when emailprincipal is present', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [makeRawSfcRecord({ emailprincipal: 'info@entidad.com' })],
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Entidad Test', countryCode: 'CO', candidateTaxId: '860003261', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    const signals = result.signals as Record<string, unknown>;
    assert.equal(signals['has_institutional_email'], true);
  });

  it('has_institutional_email is false when emailprincipal is absent', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [makeRawSfcRecord({ emailprincipal: undefined })],
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Entidad Test', countryCode: 'CO', candidateTaxId: '860003261', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    const signals = result.signals as Record<string, unknown>;
    assert.equal(signals['has_institutional_email'], false);
  });
});

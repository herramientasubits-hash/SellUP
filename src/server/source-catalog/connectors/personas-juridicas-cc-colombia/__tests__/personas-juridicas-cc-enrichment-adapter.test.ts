// Tests — Personas Jurídicas Cámaras de Comercio enrichment adapter
//
// Verifica el comportamiento ante los casos críticos:
// NIT normalizado, missing_tax_id, no_match, match ACTIVA con/sin renovación reciente,
// registro CANCELADA, error Socrata, país distinto a CO.
// Sin llamadas reales a datos.gov.co. Solo lógica in-process.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePersonasJuridicasTaxId,
  isActiveRegistrationStatus,
  calculateRegistrationSignals,
  calculateRegistrationPriorityBoost,
  buildMatchResultFromCCRecord,
  enrichCandidateImpl,
} from '../personas-juridicas-cc-enrichment-adapter';

const FIXED_YEAR = 2026;

// ─── 1. NIT normalizer ────────────────────────────────────────────────────────

describe('normalizePersonasJuridicasTaxId', () => {
  it('strips dots and spaces', () => {
    assert.equal(normalizePersonasJuridicasTaxId('900.123.456'), '900123456');
  });

  it('strips verification digit after dash', () => {
    assert.equal(normalizePersonasJuridicasTaxId('900123456-1'), '900123456');
  });

  it('strips dots and verification digit', () => {
    assert.equal(normalizePersonasJuridicasTaxId('900.123.456-1'), '900123456');
  });

  it('strips leading/trailing spaces', () => {
    assert.equal(normalizePersonasJuridicasTaxId('  900123456  '), '900123456');
  });

  it('returns plain digits unchanged', () => {
    assert.equal(normalizePersonasJuridicasTaxId('900123456'), '900123456');
  });

  it('returns empty string for non-digit input', () => {
    assert.equal(normalizePersonasJuridicasTaxId('---'), '');
  });
});

// ─── 2. isActiveRegistrationStatus ───────────────────────────────────────────

describe('isActiveRegistrationStatus', () => {
  it('returns true for "ACTIVA"', () => assert.equal(isActiveRegistrationStatus('ACTIVA'), true));
  it('returns true for "activa" (case-insensitive)', () => assert.equal(isActiveRegistrationStatus('activa'), true));
  it('returns true for "  ACTIVA  " (with spaces)', () => assert.equal(isActiveRegistrationStatus('  ACTIVA  '), true));
  it('returns false for "CANCELADA"', () => assert.equal(isActiveRegistrationStatus('CANCELADA'), false));
  it('returns false for "INACTIVA"', () => assert.equal(isActiveRegistrationStatus('INACTIVA'), false));
  it('returns false for empty string', () => assert.equal(isActiveRegistrationStatus(''), false));
  it('returns false for null', () => assert.equal(isActiveRegistrationStatus(null), false));
  it('returns false for undefined', () => assert.equal(isActiveRegistrationStatus(undefined), false));
});

// ─── 3. calculateRegistrationSignals ─────────────────────────────────────────

describe('calculateRegistrationSignals', () => {
  it('detects active registration and recent renewal (current year)', () => {
    const signals = calculateRegistrationSignals(
      { estado_matricula: 'ACTIVA', ultimo_ano_renovado: String(FIXED_YEAR) },
      FIXED_YEAR,
    );
    assert.equal(signals.active_registration, true);
    assert.equal(signals.recent_renewal, true);
    assert.equal(signals.last_renewal_year, FIXED_YEAR);
  });

  it('detects recent renewal for prior year', () => {
    const signals = calculateRegistrationSignals(
      { estado_matricula: 'ACTIVA', ultimo_ano_renovado: String(FIXED_YEAR - 1) },
      FIXED_YEAR,
    );
    assert.equal(signals.recent_renewal, true);
    assert.equal(signals.last_renewal_year, FIXED_YEAR - 1);
  });

  it('returns recent_renewal=false for old renewal year', () => {
    const signals = calculateRegistrationSignals(
      { estado_matricula: 'ACTIVA', ultimo_ano_renovado: '2020' },
      FIXED_YEAR,
    );
    assert.equal(signals.recent_renewal, false);
    assert.equal(signals.last_renewal_year, 2020);
  });

  it('returns recent_renewal=null when ultimo_ano_renovado is missing', () => {
    const signals = calculateRegistrationSignals(
      { estado_matricula: 'ACTIVA' },
      FIXED_YEAR,
    );
    assert.equal(signals.recent_renewal, null);
    assert.equal(signals.last_renewal_year, null);
  });

  it('parses ultimo_ano_renovado as number type', () => {
    const signals = calculateRegistrationSignals(
      { estado_matricula: 'ACTIVA', ultimo_ano_renovado: FIXED_YEAR },
      FIXED_YEAR,
    );
    assert.equal(signals.last_renewal_year, FIXED_YEAR);
    assert.equal(signals.recent_renewal, true);
  });

  it('extracts camara_comercio and primary_ciiu_code', () => {
    const signals = calculateRegistrationSignals({
      estado_matricula: 'ACTIVA',
      camara_comercio: 'BOGOTA',
      codigo_ciiu_act_econ_pri: '6201',
    }, FIXED_YEAR);
    assert.equal(signals.chamber_of_commerce, 'BOGOTA');
    assert.equal(signals.primary_ciiu_code, '6201');
  });

  it('falls back to cod_ciiu_act_econ_pri if codigo_ variant absent', () => {
    const signals = calculateRegistrationSignals({
      estado_matricula: 'ACTIVA',
      cod_ciiu_act_econ_pri: '4651',
    }, FIXED_YEAR);
    assert.equal(signals.primary_ciiu_code, '4651');
  });

  it('sets active_registration=false for CANCELADA', () => {
    const signals = calculateRegistrationSignals(
      { estado_matricula: 'CANCELADA' },
      FIXED_YEAR,
    );
    assert.equal(signals.active_registration, false);
  });
});

// ─── 4. calculateRegistrationPriorityBoost ───────────────────────────────────

describe('calculateRegistrationPriorityBoost', () => {
  it('returns 6 for active + recent renewal', () => {
    assert.equal(
      calculateRegistrationPriorityBoost({ active_registration: true, recent_renewal: true, legal_registry_match: true, last_renewal_year: FIXED_YEAR, chamber_of_commerce: null, primary_ciiu_code: null }),
      6,
    );
  });

  it('returns 4 for active + no recent renewal', () => {
    assert.equal(
      calculateRegistrationPriorityBoost({ active_registration: true, recent_renewal: false, legal_registry_match: true, last_renewal_year: 2020, chamber_of_commerce: null, primary_ciiu_code: null }),
      4,
    );
  });

  it('returns 4 for active + renewal unknown (null)', () => {
    assert.equal(
      calculateRegistrationPriorityBoost({ active_registration: true, recent_renewal: null, legal_registry_match: true, last_renewal_year: null, chamber_of_commerce: null, primary_ciiu_code: null }),
      4,
    );
  });

  it('returns 0 for inactive registration', () => {
    assert.equal(
      calculateRegistrationPriorityBoost({ active_registration: false, recent_renewal: null, legal_registry_match: true, last_renewal_year: null, chamber_of_commerce: null, primary_ciiu_code: null }),
      0,
    );
  });
});

// ─── 5. buildMatchResultFromCCRecord ─────────────────────────────────────────

describe('buildMatchResultFromCCRecord', () => {
  it('builds matched result with priorityBoost 6 for active + recent renewal', () => {
    const result = buildMatchResultFromCCRecord({
      numero_identificacion: '900123456',
      razon_social: 'Empresa Activa SAS',
      estado_matricula: 'ACTIVA',
      ultimo_ano_renovado: String(FIXED_YEAR),
      camara_comercio: 'BOGOTA',
      organizacion_juridica: 'SOCIEDAD POR ACCIONES SIMPLIFICADA',
      categoria_matricula: 'PRINCIPAL',
      codigo_ciiu_act_econ_pri: '6201',
    }, FIXED_YEAR);

    assert.equal(result.status, 'matched');
    assert.equal(result.matchedBy, 'tax_id');
    assert.equal(result.confidence, 0.85);
    assert.equal(result.priorityBoost, 6);
    assert.equal(result.sourceKey, 'co_personas_juridicas_cc');

    const signals = result.signals as Record<string, unknown>;
    assert.equal(signals['legal_registry_match'], true);
    assert.equal(signals['active_registration'], true);
    assert.equal(signals['recent_renewal'], true);
    assert.equal(signals['chamber_of_commerce'], 'BOGOTA');
    assert.equal(signals['primary_ciiu_code'], '6201');

    const meta = result.metadata as Record<string, unknown>;
    assert.equal(meta['source_dataset_id'], 'c82u-588k');
    const enrich = meta['enrichment'] as Record<string, unknown>;
    assert.equal(enrich['legal_name'], 'Empresa Activa SAS');
    assert.equal(enrich['registration_status'], 'ACTIVA');
    assert.equal(enrich['legal_organization'], 'SOCIEDAD POR ACCIONES SIMPLIFICADA');
    assert.equal(enrich['primary_ciiu_code'], '6201');
  });

  it('builds matched result with priorityBoost 4 for active without recent renewal', () => {
    const result = buildMatchResultFromCCRecord({
      estado_matricula: 'ACTIVA',
      ultimo_ano_renovado: '2020',
    }, FIXED_YEAR);
    assert.equal(result.priorityBoost, 4);
    const signals = result.signals as Record<string, unknown>;
    assert.equal(signals['recent_renewal'], false);
  });

  it('returns null for missing optional enrichment fields', () => {
    const result = buildMatchResultFromCCRecord({ estado_matricula: 'ACTIVA' }, FIXED_YEAR);
    const meta = result.metadata as Record<string, unknown>;
    const enrich = meta['enrichment'] as Record<string, unknown>;
    assert.equal(enrich['legal_name'], null);
    assert.equal(enrich['cancellation_date'], null);
    assert.equal(enrich['primary_ciiu_code'], null);
  });
});

// ─── 6. enrichCandidateImpl — guard clauses ───────────────────────────────────

const neverCalledFetch: typeof import('../../socrata-colombia/socrata-client').fetchSocrataDatasetSample =
  async () => { throw new Error('fetchSocrataDatasetSample should not have been called'); };

describe('enrichCandidateImpl — guard clauses', () => {
  it('returns skipped for non-CO country', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'MX', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
      FIXED_YEAR,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'country_not_supported');
  });

  it('returns skipped when candidateTaxId is null', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: null, capability: 'enrichment_after_discovery' },
      neverCalledFetch,
      FIXED_YEAR,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing_tax_id');
  });

  it('returns skipped when candidateTaxId is empty string', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '  ', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
      FIXED_YEAR,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing_tax_id');
  });

  it('returns skipped when NIT normalizes to empty', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '---', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
      FIXED_YEAR,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing_tax_id');
  });
});

// ─── 7. enrichCandidateImpl — Socrata paths ───────────────────────────────────

describe('enrichCandidateImpl — Socrata paths', () => {
  it('returns no_match when Socrata returns empty array', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({ ok: true, records: [] });
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '900123456', capability: 'enrichment_after_discovery' },
      mockFetch,
      FIXED_YEAR,
    );
    assert.equal(result.status, 'no_match');
    assert.equal(result.matchedBy, null);
  });

  it('returns matched with priorityBoost 6 for ACTIVA + recent renewal', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [{
        numero_identificacion: '900123456',
        razon_social: 'TechCo SAS',
        estado_matricula: 'ACTIVA',
        ultimo_ano_renovado: String(FIXED_YEAR),
        camara_comercio: 'MEDELLIN',
        organizacion_juridica: 'SOCIEDAD POR ACCIONES SIMPLIFICADA',
        categoria_matricula: 'PRINCIPAL',
        codigo_ciiu_act_econ_pri: '6201',
      }],
    });
    const result = await enrichCandidateImpl(
      { candidateName: 'TechCo SAS', countryCode: 'CO', candidateTaxId: '900.123.456-1', capability: 'enrichment_after_discovery' },
      mockFetch,
      FIXED_YEAR,
    );
    assert.equal(result.status, 'matched');
    assert.equal(result.matchedBy, 'tax_id');
    assert.equal(result.confidence, 0.85);
    assert.equal(result.priorityBoost, 6);
    assert.equal((result.signals as Record<string, unknown>)['active_registration'], true);
    assert.equal((result.signals as Record<string, unknown>)['recent_renewal'], true);
  });

  it('returns matched with priorityBoost 4 for ACTIVA without recent renewal', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [{
        numero_identificacion: '900123456',
        razon_social: 'Empresa Antigua SAS',
        estado_matricula: 'ACTIVA',
        ultimo_ano_renovado: '2019',
        camara_comercio: 'CALI',
      }],
    });
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa Antigua SAS', countryCode: 'CO', candidateTaxId: '900123456', capability: 'enrichment_after_discovery' },
      mockFetch,
      FIXED_YEAR,
    );
    assert.equal(result.status, 'matched');
    assert.equal(result.priorityBoost, 4);
    assert.equal((result.signals as Record<string, unknown>)['recent_renewal'], false);
  });

  it('returns no_match for CANCELADA record (safety check after WHERE filter)', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [{
        numero_identificacion: '900123456',
        estado_matricula: 'CANCELADA',
      }],
    });
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '900123456', capability: 'enrichment_after_discovery' },
      mockFetch,
      FIXED_YEAR,
    );
    assert.equal(result.status, 'no_match');
    assert.equal(result.reason, 'registration_not_active');
  });

  it('returns error when Socrata fetch fails', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: false,
      error: 'Timeout al conectar con datos.gov.co',
    });
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '900123456', capability: 'enrichment_after_discovery' },
      mockFetch,
      FIXED_YEAR,
    );
    assert.equal(result.status, 'error');
    assert.match(result.reason ?? '', /Timeout/);
    assert.equal(result.confidence, 0);
  });

  it('enrichment metadata is populated correctly on match', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [{
        numero_identificacion: '830000001',
        razon_social: 'Empresa Registrada LTDA',
        estado_matricula: 'ACTIVA',
        camara_comercio: 'BOGOTA',
        organizacion_juridica: 'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
        categoria_matricula: 'PRINCIPAL',
        codigo_ciiu_act_econ_pri: '7110',
        fecha_matricula: '2010-03-15T00:00:00.000',
        fecha_vigencia: '2026-12-31T00:00:00.000',
        ultimo_ano_renovado: String(FIXED_YEAR),
      }],
    });
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa Registrada LTDA', countryCode: 'CO', candidateTaxId: '830000001', capability: 'enrichment_after_discovery' },
      mockFetch,
      FIXED_YEAR,
    );
    const meta = result.metadata as Record<string, unknown>;
    assert.equal(meta['source_dataset_id'], 'c82u-588k');
    const enrich = meta['enrichment'] as Record<string, unknown>;
    assert.equal(enrich['legal_name'], 'Empresa Registrada LTDA');
    assert.equal(enrich['chamber_of_commerce'], 'BOGOTA');
    assert.equal(enrich['legal_organization'], 'SOCIEDAD DE RESPONSABILIDAD LIMITADA');
    assert.equal(enrich['registration_status'], 'ACTIVA');
    assert.equal(enrich['primary_ciiu_code'], '7110');
    assert.equal(enrich['last_renewal_year'], FIXED_YEAR);
    assert.equal(enrich['registration_date'], '2010-03-15T00:00:00.000');
    assert.equal(enrich['validity_date'], '2026-12-31T00:00:00.000');
  });
});

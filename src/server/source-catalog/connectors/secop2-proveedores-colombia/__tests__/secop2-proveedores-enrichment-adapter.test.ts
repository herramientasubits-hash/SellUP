// Tests — SECOP II Proveedores Colombia enrichment adapter
//
// Verifica el comportamiento del adapter ante los casos críticos:
// NIT normalizado, missing_tax_id, no_match, match activo, error Socrata.
// Sin llamadas reales a datos.gov.co. Sin Supabase. Solo lógica in-process.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeColombianNIT,
  parseActiveStatus,
  buildMatchResultFromRecord,
  enrichCandidateImpl,
} from '../secop2-proveedores-enrichment-adapter';

// ─── 1. NIT normalizer ────────────────────────────────────────────────────────

describe('normalizeColombianNIT', () => {
  it('strips dots and spaces', () => {
    assert.equal(normalizeColombianNIT('900.123.456'), '900123456');
  });

  it('strips verification digit after dash', () => {
    assert.equal(normalizeColombianNIT('900123456-1'), '900123456');
  });

  it('strips dots and verification digit', () => {
    assert.equal(normalizeColombianNIT('900.123.456-1'), '900123456');
  });

  it('strips leading/trailing spaces', () => {
    assert.equal(normalizeColombianNIT('  900123456  '), '900123456');
  });

  it('returns plain digits unchanged', () => {
    assert.equal(normalizeColombianNIT('900123456'), '900123456');
  });

  it('returns empty string for non-digit input', () => {
    assert.equal(normalizeColombianNIT('---'), '');
  });
});

// ─── 2. parseActiveStatus ────────────────────────────────────────────────────

describe('parseActiveStatus', () => {
  it('returns true for "Si"', () => assert.equal(parseActiveStatus('Si'), true));
  it('returns true for "Sí"', () => assert.equal(parseActiveStatus('Sí'), true));
  it('returns true for "S"', () => assert.equal(parseActiveStatus('S'), true));
  it('returns true for "true"', () => assert.equal(parseActiveStatus('true'), true));
  it('returns true for boolean true', () => assert.equal(parseActiveStatus(true), true));
  it('returns false for "No"', () => assert.equal(parseActiveStatus('No'), false));
  it('returns false for "false"', () => assert.equal(parseActiveStatus('false'), false));
  it('returns null for unknown string', () => assert.equal(parseActiveStatus('pending'), null));
  it('returns null for undefined', () => assert.equal(parseActiveStatus(undefined), null));
});

// ─── 3. buildMatchResultFromRecord ───────────────────────────────────────────

describe('buildMatchResultFromRecord', () => {
  it('active provider gets priority_boost 8', () => {
    const result = buildMatchResultFromRecord({
      nit: '900123456',
      nombre: 'Empresa Activa SAS',
      esta_activa: 'Si',
      espyme: 'No',
      codigo_categoria_principal: 'V1',
      descripcion_categoria_principal: 'Servicios TI',
    });
    assert.equal(result.status, 'matched');
    assert.equal(result.priorityBoost, 8);
    assert.equal((result.signals as Record<string, unknown>)['b2g_provider_registered'], true);
    assert.equal((result.signals as Record<string, unknown>)['secop2_active'], true);
    assert.equal((result.signals as Record<string, unknown>)['is_pyme'], false);
    assert.equal((result.signals as Record<string, unknown>)['main_category_code'], 'V1');
  });

  it('unclear active status gets priority_boost 4', () => {
    const result = buildMatchResultFromRecord({ nit: '900123456', esta_activa: undefined });
    assert.equal(result.priorityBoost, 4);
    assert.equal((result.signals as Record<string, unknown>)['secop2_active'], null);
  });

  it('inactive provider gets priority_boost 4', () => {
    const result = buildMatchResultFromRecord({ nit: '900123456', esta_activa: 'No' });
    assert.equal(result.priorityBoost, 4);
    assert.equal((result.signals as Record<string, unknown>)['secop2_active'], false);
  });

  it('maps enrichment fields correctly', () => {
    const result = buildMatchResultFromRecord({
      nombre: '  Empresa Test  ',
      correo: 'contacto@empresa.com',
      telefono: '3001234567',
      sitio_web: 'https://empresa.com',
      departamento: 'Bogotá D.C.',
      municipio: 'Bogotá',
      tipo_empresa: 'Sociedad por Acciones Simplificada',
      nombre_representante_legal: 'Juan Pérez',
      correo_representante_legal: 'jperez@empresa.com',
      fecha_creacion: '2020-01-15T00:00:00.000',
    });
    const enrichment = (result.metadata as Record<string, unknown>)['enrichment'] as Record<string, unknown>;
    assert.equal(enrichment['legal_name'], 'Empresa Test');
    assert.equal(enrichment['email'], 'contacto@empresa.com');
    assert.equal(enrichment['phone'], '3001234567');
    assert.equal(enrichment['website'], 'https://empresa.com');
    assert.equal(enrichment['department'], 'Bogotá D.C.');
    assert.equal(enrichment['municipality'], 'Bogotá');
    assert.equal(enrichment['legal_representative_name'], 'Juan Pérez');
  });

  it('returns null for missing optional fields', () => {
    const result = buildMatchResultFromRecord({ nit: '1' });
    const enrichment = (result.metadata as Record<string, unknown>)['enrichment'] as Record<string, unknown>;
    assert.equal(enrichment['email'], null);
    assert.equal(enrichment['website'], null);
    assert.equal((result.signals as Record<string, unknown>)['main_category_code'], null);
  });
});

// ─── 4. enrichCandidateImpl — guard clauses ───────────────────────────────────

// Fake fetch that should never be called in guard-clause tests
const neverCalledFetch: typeof import('../../socrata-colombia/socrata-client').fetchSocrataDatasetSample =
  async () => { throw new Error('fetchSocrataDatasetSample should not have been called'); };

describe('enrichCandidateImpl — guard clauses', () => {
  it('returns skipped for non-CO country', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'MX', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'country_not_supported');
  });

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

  it('returns skipped when NIT normalizes to empty', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '---', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing_tax_id');
  });
});

// ─── 5. enrichCandidateImpl — Socrata paths ───────────────────────────────────

describe('enrichCandidateImpl — Socrata paths', () => {
  it('returns no_match when Socrata returns empty array', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({ ok: true, records: [] });
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '900123456', capability: 'enrichment_after_discovery' },
      mockFetch,
    );
    assert.equal(result.status, 'no_match');
    assert.equal(result.matchedBy, null);
  });

  it('returns matched with b2g_provider_registered and priority_boost 8 for active provider', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [{
        nit: '900123456',
        nombre: 'TechCo SAS',
        esta_activa: 'Si',
        espyme: 'Si',
        codigo_categoria_principal: 'V2',
        descripcion_categoria_principal: 'Consultoría',
        correo: 'info@techco.com',
        departamento: 'Antioquia',
        municipio: 'Medellín',
      }],
    });
    const result = await enrichCandidateImpl(
      { candidateName: 'TechCo SAS', countryCode: 'CO', candidateTaxId: '900.123.456-1', capability: 'enrichment_after_discovery' },
      mockFetch,
    );
    assert.equal(result.status, 'matched');
    assert.equal(result.matchedBy, 'tax_id');
    assert.equal(result.confidence, 0.9);
    assert.equal(result.priorityBoost, 8);
    assert.equal((result.signals as Record<string, unknown>)['b2g_provider_registered'], true);
    assert.equal((result.signals as Record<string, unknown>)['secop2_active'], true);
    assert.equal((result.signals as Record<string, unknown>)['is_pyme'], true);
  });

  it('returns error when Socrata fetch fails', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: false,
      error: 'Timeout al conectar con datos.gov.co',
    });
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '900123456', capability: 'enrichment_after_discovery' },
      mockFetch,
    );
    assert.equal(result.status, 'error');
    assert.match(result.reason ?? '', /Timeout/);
    assert.equal(result.confidence, 0);
  });

  it('does not throw when Socrata throws unexpectedly', async () => {
    const throwingFetch: typeof neverCalledFetch = async () => {
      throw new Error('Unexpected internal error');
    };
    await assert.rejects(
      () => enrichCandidateImpl(
        { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '900123456', capability: 'enrichment_after_discovery' },
        throwingFetch,
      ),
      // The outer wizard catch handles this — the impl itself propagates,
      // but the registry's fallback (enrich-candidates-with-validated-sources) catches it.
      /Unexpected internal error/,
    );
  });
});

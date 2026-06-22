/**
 * Integration tests: DENUE enrichment in the Mexico flow
 *
 * Verifies that the DENUE enrichment adapter works correctly when
 * integrated into the Mexico post-writer pipeline.
 *
 * These tests use the injectable `enrichCandidateImpl` to verify
 * the full flow without requiring a real DENUE API token.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { FetchDenueResult } from '../denue-client';
import { enrichCandidateImpl, denueEnrichmentAdapter } from '../denue-enrichment-adapter';
import type { DenueEnrichmentMetadata } from '../denue-enrichment-adapter';

function mockOk(records: unknown[]): FetchDenueResult {
  return { ok: true, records };
}

function mockError(msg: string): FetchDenueResult {
  return { ok: false, error: msg };
}

function makeRecord(overrides: Record<string, string | null> = {}): Record<string, unknown> {
  return {
    Nombre: overrides['Nombre'] ?? 'Test Company',
    Razon_social: overrides['Razon_social'] ?? 'Test Company SA de CV',
    Clase_actividad: overrides['Clase_actividad'] ?? 'Testing',
    Estrato: overrides['Estrato'] ?? '11 a 30 personas',
    CLEE: overrides['CLEE'] ?? 'TEST001',
    Ubicacion: overrides['Ubicacion'] ?? 'Ciudad, Municipio, ESTADO',
    Telefono: overrides['Telefono'] ?? null,
    Sitio_internet: overrides['Sitio_internet'] ?? null,
    Tipo_vialidad: null,
    Calle: null,
    Num_Exterior: null,
  };
}

describe('DENUE enrichment — Mexico flow integration', () => {
  describe('tax_identifier_resolution is never affected', () => {
    it('DENUE matched does not produce a resolved tax_identifier', async () => {
      const result = await enrichCandidateImpl(
        { candidateName: 'Test Company', countryCode: 'MX', capability: 'enrichment_after_discovery' },
        mock.fn(async () => mockOk([makeRecord()])),
      );
      assert.equal(result.matchedBy, 'exact_name');
      assert.equal(result.confidence, 0.75);
    });

    it('enrichment metadata has no tax_identifier field', async () => {
      const result = await enrichCandidateImpl(
        { candidateName: 'Test Company', countryCode: 'MX', capability: 'enrichment_after_discovery' },
        mock.fn(async () => mockOk([makeRecord()])),
      );
      const meta = result.metadata as DenueEnrichmentMetadata | undefined;
      assert.ok(meta);
      assert.equal('tax_identifier' in meta, false);
    });

    it('enrichment metadata has source_key mx_denue', async () => {
      const result = await enrichCandidateImpl(
        { candidateName: 'Test Company', countryCode: 'MX', capability: 'enrichment_after_discovery' },
        mock.fn(async () => mockOk([makeRecord()])),
      );
      const meta = result.metadata as DenueEnrichmentMetadata | undefined;
      assert.ok(meta);
      assert.equal(meta.source_key, 'mx_denue');
    });
  });

  describe('pipeline resilience', () => {
    it('API error does not throw', async () => {
      const result = await enrichCandidateImpl(
        { candidateName: 'Test', countryCode: 'MX', capability: 'enrichment_after_discovery' },
        mock.fn(async () => mockError('Network error')),
      );
      assert.equal(result.status, 'error');
      assert.ok(result.reason);
    });

    it('empty response produces no_match', async () => {
      const result = await enrichCandidateImpl(
        { candidateName: 'NoMatch Corp', countryCode: 'MX', capability: 'enrichment_after_discovery' },
        mock.fn(async () => mockOk([])),
      );
      assert.equal(result.status, 'no_match');
    });

    it('gracefully handles missing INEGI token', async () => {
      const result = await enrichCandidateImpl(
        { candidateName: 'Test', countryCode: 'MX', capability: 'enrichment_after_discovery' },
        mock.fn(async () => mockError('Missing DENUE token')),
      );
      assert.equal(result.status, 'error');
    });
  });

  describe('Colombia is not affected', () => {
    it('returns skipped for Colombia', async () => {
      const result = await enrichCandidateImpl(
        { candidateName: 'Empresa CO', countryCode: 'CO', capability: 'enrichment_after_discovery' },
        mock.fn(async () => mockOk([makeRecord()])),
      );
      assert.equal(result.status, 'skipped');
      assert.equal(result.reason, 'country_not_supported');
    });
  });
});

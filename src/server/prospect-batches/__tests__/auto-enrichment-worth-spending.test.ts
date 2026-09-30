/**
 * Tests — AGENT1-IMPORT-PARITY-9: la IA sólo se gasta en empresas importadas
 * que pasan los filtros, y nunca en más de `maxCandidatesPerBatch` por archivo.
 *
 * Puro. Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTO_ENRICH_BATCH_CAP_REASON,
  AUTO_ENRICH_BLOCKING_REVIEW_FLAGS,
  applyAutoEnrichmentBatchCap,
  evaluateAutoEnrichmentEligibility,
} from '../candidate-enrichment-eligibility';
import { AUTO_ENRICH_CONFIG } from '@/modules/prospect-batches/auto-enrich-config';

/** Fila importada viva e incompleta: la que SÍ merece IA. */
function worthIt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'needs_review',
    duplicate_status: 'no_match',
    name: 'Empresa Nueva SAS',
    website: 'https://empresanueva.co',
    review_flags: [],
    metadata: {},
    ...overrides,
  };
}

describe('evaluateAutoEnrichmentEligibility — sólo empresas que valen la pena', () => {
  it('viva, sin avisos e incompleta → se encola', () => {
    assert.equal(evaluateAutoEnrichmentEligibility(worthIt()).status, 'pending');
  });

  for (const flag of AUTO_ENRICH_BLOCKING_REVIEW_FLAGS) {
    it(`con aviso «${flag}» → NO se gasta IA`, () => {
      const r = evaluateAutoEnrichmentEligibility(worthIt({ review_flags: [flag] }));
      assert.equal(r.eligible, false);
      assert.match(r.reason ?? '', /filtros de calidad/);
    });
  }

  it('los cuatro avisos que bloquean son país, plataforma, tamaño y dominio no verificado', () => {
    assert.deepEqual([...AUTO_ENRICH_BLOCKING_REVIEW_FLAGS].sort(), [
      'import_below_icp_size',
      'import_country_mismatch',
      'import_external_platform',
      'ownership_unverified',
    ]);
  });

  it('duplicada, posible duplicada o ya en SellUp/HubSpot → NO (se conserva)', () => {
    assert.equal(evaluateAutoEnrichmentEligibility(worthIt({ status: 'duplicate' })).eligible, false);
    assert.equal(evaluateAutoEnrichmentEligibility(worthIt({ duplicate_status: 'possible_duplicate' })).eligible, false);
    assert.equal(evaluateAutoEnrichmentEligibility(worthIt({ matched_hubspot_company_id: 'hs-1' })).eligible, false);
  });

  it('descartada después de importar → NO (el worker revalida antes de gastar)', () => {
    assert.equal(evaluateAutoEnrichmentEligibility(worthIt({ status: 'discarded' })).eligible, false);
  });
});

describe('applyAutoEnrichmentBatchCap — el tope por importación se cumple', () => {
  const pending = evaluateAutoEnrichmentEligibility(worthIt());

  it('por debajo del tope → se mantiene pendiente', () => {
    assert.equal(applyAutoEnrichmentBatchCap(pending, 99, 100).status, 'pending');
  });

  it('al llegar al tope → se omite con motivo explícito', () => {
    const r = applyAutoEnrichmentBatchCap(pending, 100, 100);
    assert.equal(r.eligible, false);
    assert.equal(r.reason, AUTO_ENRICH_BATCH_CAP_REASON);
  });

  it('una fila ya no elegible no se toca', () => {
    const dup = evaluateAutoEnrichmentEligibility(worthIt({ status: 'duplicate' }));
    assert.deepEqual(applyAutoEnrichmentBatchCap(dup, 500, 100), dup);
  });

  it('simulación: 150 filas elegibles → exactamente maxCandidatesPerBatch encoladas', () => {
    let queued = 0;
    for (let i = 0; i < 150; i++) {
      const r = applyAutoEnrichmentBatchCap(pending, queued, AUTO_ENRICH_CONFIG.maxCandidatesPerBatch);
      if (r.status === 'pending') queued++;
    }
    assert.equal(queued, AUTO_ENRICH_CONFIG.maxCandidatesPerBatch);
  });
});

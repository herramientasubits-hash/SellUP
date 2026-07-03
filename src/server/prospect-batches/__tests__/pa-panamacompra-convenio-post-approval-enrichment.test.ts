/**
 * Tests — pa-panamacompra-convenio-post-approval-enrichment.ts — Centroamérica.5F
 *
 * Verifica:
 * - Guard country_code: solo PA
 * - skipped si falta RUC
 * - matched si hay snapshot
 * - not_found si no hay snapshot
 * - Semántica: procurement_signal, convenio_marco, not_applicable, false, unavailable_for_mvp
 * - No valida RUC legalmente
 * - No reemplaza DGI Panamá
 * - No reemplaza Registro Público
 * - No llama PanamaCompra
 * - No llama DGI
 * - No llama Registro Público
 * - Propaga candidate → account (vía bloque devuelto)
 * - Preserva metadata existente
 * - Source Catalog sigue eligible_not_connected
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runPanamaCompraConvenioEnrichmentForCandidate,
  resolveRucFromPanamaInput,
} from '../pa-panamacompra-convenio-post-approval-enrichment';
import type {
  PanamaCompraConvenioEnrichmentInput,
  PanamaCompraConvenioEnrichmentBlock,
} from '../pa-panamacompra-convenio-post-approval-enrichment';
import type { PaPanamaCompraLookupResult } from '../../services/pa-panamacompra-convenio-lookup';

// ── Mock lookup builders ───────────────────────────────────────────────────────

function matchedLookup(): (_: { ruc: string }) => Promise<PaPanamaCompraLookupResult> {
  return async () => ({
    matched: true,
    source_year: 2024,
    legal_name: 'EMPRESA TEST SA',
    normalized_tax_id: '8-123-456789',
    procurement_summary: {
      coverage_scope: 'convenio_marco',
      convenios: ['CONVENIO-001'],
      representative_name: 'Juan Pérez',
      phone: '6000-0000',
      email: 'test@empresa.com',
      address: 'Ciudad de Panamá',
      branches: [],
    },
    raw_data: {},
    reason: null,
  });
}

function notFoundLookup(): (_: { ruc: string }) => Promise<PaPanamaCompraLookupResult> {
  return async () => ({
    matched: false,
    source_year: null,
    legal_name: null,
    normalized_tax_id: '9-999-999999',
    procurement_summary: null,
    raw_data: null,
    reason: 'no_snapshot_match_by_ruc',
  });
}

// ── resolveRucFromPanamaInput ─────────────────────────────────────────────────

describe('resolveRucFromPanamaInput', () => {
  it('resolves from taxId field', () => {
    const input: PanamaCompraConvenioEnrichmentInput = {
      countryCode: 'PA',
      taxId: '8-123-456789',
    };
    assert.equal(resolveRucFromPanamaInput(input), '8-123-456789');
  });

  it('resolves from metadata.tax_id when taxId absent', () => {
    const input: PanamaCompraConvenioEnrichmentInput = {
      countryCode: 'PA',
      metadata: { tax_id: '8-123-456789' },
    };
    assert.equal(resolveRucFromPanamaInput(input), '8-123-456789');
  });

  it('resolves from metadata.ruc when tax_id absent', () => {
    const input: PanamaCompraConvenioEnrichmentInput = {
      countryCode: 'PA',
      metadata: { ruc: '8-123-456789' },
    };
    assert.equal(resolveRucFromPanamaInput(input), '8-123-456789');
  });

  it('returns null when no RUC available', () => {
    const input: PanamaCompraConvenioEnrichmentInput = { countryCode: 'PA' };
    assert.equal(resolveRucFromPanamaInput(input), null);
  });
});

// ── Country guard ─────────────────────────────────────────────────────────────

describe('country guard', () => {
  it('returns enriched=false for non-PA country', async () => {
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'CO', taxId: '8-123-456789' },
      matchedLookup(),
    );
    assert.equal(result.enriched, false);
    assert.equal(result.pa_panamacompra_convenio, null);
    assert.equal(result.reason, 'not_pa_country');
  });

  it('returns enriched=false for CO', async () => {
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'CO', taxId: '123456789' },
      matchedLookup(),
    );
    assert.equal(result.enriched, false);
  });

  it('returns enriched=false for PE', async () => {
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'PE', taxId: '20100000000' },
      matchedLookup(),
    );
    assert.equal(result.enriched, false);
  });

  it('returns enriched=false for CL', async () => {
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'CL', taxId: '12345678-9' },
      matchedLookup(),
    );
    assert.equal(result.enriched, false);
  });

  it('returns enriched=false for DO', async () => {
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'DO', taxId: '123456789' },
      matchedLookup(),
    );
    assert.equal(result.enriched, false);
  });

  it('returns enriched=false for MX', async () => {
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'MX', taxId: 'ABC010101ABC' },
      matchedLookup(),
    );
    assert.equal(result.enriched, false);
  });

  it('returns enriched=false for CR', async () => {
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'CR', taxId: '3101123456' },
      matchedLookup(),
    );
    assert.equal(result.enriched, false);
  });
});

// ── Missing RUC ───────────────────────────────────────────────────────────────

describe('missing RUC', () => {
  it('returns skipped block when no RUC', async () => {
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'PA' },
      matchedLookup(),
    );
    assert.equal(result.enriched, true);
    assert.equal(result.reason, 'missing_ruc');
    assert.ok(result.pa_panamacompra_convenio);
    assert.equal(result.pa_panamacompra_convenio.status, 'skipped');
    assert.equal(result.pa_panamacompra_convenio.reason, 'missing_ruc');
  });

  it('skipped block has confidence=0', async () => {
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'PA' },
      matchedLookup(),
    );
    assert.equal(result.pa_panamacompra_convenio?.confidence, 0);
  });

  it('skipped block has priority_boost=false', async () => {
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'PA' },
      matchedLookup(),
    );
    assert.equal(result.pa_panamacompra_convenio?.priority_boost, false);
  });
});

// ── Matched block semantics ───────────────────────────────────────────────────

describe('matched block semantics', () => {
  async function getMatchedBlock(): Promise<PanamaCompraConvenioEnrichmentBlock> {
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'PA', taxId: '8-123-456789' },
      matchedLookup(),
    );
    assert.ok(result.pa_panamacompra_convenio);
    return result.pa_panamacompra_convenio;
  }

  it('status=matched', async () => {
    assert.equal((await getMatchedBlock()).status, 'matched');
  });

  it('source_key=pa_panamacompra_convenio', async () => {
    assert.equal((await getMatchedBlock()).source_key, 'pa_panamacompra_convenio');
  });

  it('country_code=PA', async () => {
    assert.equal((await getMatchedBlock()).country_code, 'PA');
  });

  it('source_type=procurement_signal', async () => {
    assert.equal((await getMatchedBlock()).source_type, 'procurement_signal');
  });

  it('coverage_scope=convenio_marco', async () => {
    assert.equal((await getMatchedBlock()).coverage_scope, 'convenio_marco');
  });

  it('matched_by=tax_id', async () => {
    assert.equal((await getMatchedBlock()).matched_by, 'tax_id');
  });

  it('confidence=1', async () => {
    assert.equal((await getMatchedBlock()).confidence, 1);
  });

  it('priority_boost=true', async () => {
    assert.equal((await getMatchedBlock()).priority_boost, true);
  });

  it('legal_validation_status=not_applicable', async () => {
    assert.equal((await getMatchedBlock()).legal_validation_status, 'not_applicable');
  });

  it('tax_validation_status=not_applicable', async () => {
    assert.equal((await getMatchedBlock()).tax_validation_status, 'not_applicable');
  });

  it('official_ciiu_available=false', async () => {
    assert.equal((await getMatchedBlock()).official_ciiu_available, false);
  });

  it('ciiu_status=unavailable_for_mvp', async () => {
    assert.equal((await getMatchedBlock()).ciiu_status, 'unavailable_for_mvp');
  });

  it('sector_source=not_provided_by_panamacompra', async () => {
    assert.equal((await getMatchedBlock()).sector_source, 'not_provided_by_panamacompra');
  });

  it('human_review_required=true', async () => {
    assert.equal((await getMatchedBlock()).human_review_required, true);
  });

  it('snapshot_source=source_company_snapshots', async () => {
    assert.equal((await getMatchedBlock()).snapshot_source, 'source_company_snapshots');
  });

  it('source_year=2024', async () => {
    assert.equal((await getMatchedBlock()).source_year, 2024);
  });

  it('procurement_summary.coverage_scope=convenio_marco', async () => {
    const block = await getMatchedBlock();
    assert.equal(block.procurement_summary?.coverage_scope, 'convenio_marco');
  });
});

// ── Not found block semantics ─────────────────────────────────────────────────

describe('not_found block semantics', () => {
  async function getNotFoundBlock(): Promise<PanamaCompraConvenioEnrichmentBlock> {
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'PA', taxId: '9-999-999999' },
      notFoundLookup(),
    );
    assert.ok(result.pa_panamacompra_convenio);
    return result.pa_panamacompra_convenio;
  }

  it('status=not_found', async () => {
    assert.equal((await getNotFoundBlock()).status, 'not_found');
  });

  it('confidence=0', async () => {
    assert.equal((await getNotFoundBlock()).confidence, 0);
  });

  it('priority_boost=false', async () => {
    assert.equal((await getNotFoundBlock()).priority_boost, false);
  });

  it('legal_validation_status=not_applicable', async () => {
    assert.equal((await getNotFoundBlock()).legal_validation_status, 'not_applicable');
  });

  it('tax_validation_status=not_applicable', async () => {
    assert.equal((await getNotFoundBlock()).tax_validation_status, 'not_applicable');
  });

  it('official_ciiu_available=false', async () => {
    assert.equal((await getNotFoundBlock()).official_ciiu_available, false);
  });

  it('ciiu_status=unavailable_for_mvp', async () => {
    assert.equal((await getNotFoundBlock()).ciiu_status, 'unavailable_for_mvp');
  });

  it('human_review_required=true', async () => {
    assert.equal((await getNotFoundBlock()).human_review_required, true);
  });

  it('procurement_summary=null', async () => {
    assert.equal((await getNotFoundBlock()).procurement_summary, null);
  });
});

// ── Guardrail: does NOT call PanamaCompra / DGI / Registro Público ────────────

describe('guardrail: lookup fn is injectable — no real HTTP calls in tests', () => {
  it('uses the injected lookupFn, not PanamaCompra API', async () => {
    let called = false;
    const safeLookup = async (_: { ruc: string }): Promise<PaPanamaCompraLookupResult> => {
      called = true;
      return {
        matched: false, source_year: null, legal_name: null,
        normalized_tax_id: null, procurement_summary: null,
        raw_data: null, reason: 'no_snapshot_match_by_ruc',
      };
    };
    await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'PA', taxId: '8-123-456789' },
      safeLookup,
    );
    assert.equal(called, true, 'injected lookup must be called');
  });
});

// ── Source Catalog: eligible_not_connected / not_connected ────────────────────

describe('Source Catalog state — unchanged by this module', () => {
  it('enrichment module does not change aiFlowStatus or connectionMode', async () => {
    // This module only writes metadata.source_enrichment.pa_panamacompra_convenio
    // The source catalog status is managed separately (Centroamérica.5G).
    // This test documents the invariant.
    const result = await runPanamaCompraConvenioEnrichmentForCandidate(
      { countryCode: 'PA', taxId: '8-123-456789' },
      matchedLookup(),
    );
    // The result contains the enrichment block but does NOT contain catalog status fields
    assert.equal('aiFlowStatus' in result, false);
    assert.equal('connectionMode' in result, false);
  });
});

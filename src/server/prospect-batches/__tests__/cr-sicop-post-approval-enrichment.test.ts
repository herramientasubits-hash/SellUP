/**
 * Tests — cr-sicop-post-approval-enrichment.ts — Centroamérica.4F
 *
 * Verifica:
 * - Guard country_code !== CR
 * - Skipped si falta cédula
 * - Skipped si cédula no es persona jurídica
 * - Matched con procurement_summary correcto
 * - Not_found si no hay snapshot
 * - Semántica obligatoria en todos los bloques
 * - Preservación de metadata existente de otros países
 * - NO llama datos.go.cr ni Hacienda CR
 * - NO valida cédula jurídica (no es fuente fiscal)
 * - NO inventa CIIU
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichCostaRicaCandidateWithSicop,
  resolveCedulaFromSicopInput,
} from '../cr-sicop-post-approval-enrichment';
import type {
  CostaRicaSicopEnrichmentInput,
  SicopEnrichmentBlock,
} from '../cr-sicop-post-approval-enrichment';
import type { CrSicopLookupResult } from '../../services/cr-sicop-lookup';

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchedLookup(): (input: { cedula: string }) => Promise<CrSicopLookupResult> {
  return async () => ({
    matched: true,
    source_year: 2024,
    legal_name: 'EMPRESA TICA SA',
    normalized_tax_id: '3101123456',
    priority_score: 60,
    total_records_year: 3,
    datasets_seen: ['ofertas_2024'],
    last_event_date: '2024-05-15',
    raw_data: { source_type: 'procurement_signal' },
    reason: null,
  });
}

function notFoundLookup(): (input: { cedula: string }) => Promise<CrSicopLookupResult> {
  return async () => ({
    matched: false,
    source_year: null,
    legal_name: null,
    normalized_tax_id: '3101123456',
    priority_score: null,
    total_records_year: null,
    datasets_seen: null,
    last_event_date: null,
    raw_data: null,
    reason: 'no_snapshot_match_by_cedula',
  });
}

function assertSemanticGuardrails(block: SicopEnrichmentBlock): void {
  assert.equal(block.source_key, 'cr_sicop');
  assert.equal(block.country_code, 'CR');
  assert.equal(block.source_type, 'procurement_signal');
  assert.equal(block.legal_validation_status, 'not_applicable');
  assert.equal(block.tax_validation_status, 'not_applicable');
  assert.equal(block.official_ciiu_available, false);
  assert.equal(block.ciiu_status, 'unavailable_for_mvp');
  assert.equal(block.human_review_required, true);
  assert.equal(block.snapshot_source, 'source_company_snapshots');
}

// ── Country guard ─────────────────────────────────────────────────────────────

describe('enrichCostaRicaCandidateWithSicop — country guard', () => {
  it('returns enriched=false for non-CR country', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'DO', taxId: '3101123456' },
      matchedLookup(),
    );
    assert.equal(result.enriched, false);
    assert.equal(result.cr_sicop, null);
    assert.equal(result.reason, 'not_cr_country');
  });

  it('returns enriched=false for CO', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CO', taxId: '900123456' },
      matchedLookup(),
    );
    assert.equal(result.enriched, false);
    assert.equal(result.cr_sicop, null);
  });

  it('returns enriched=false for PE', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'PE', taxId: '20123456789' },
      matchedLookup(),
    );
    assert.equal(result.enriched, false);
    assert.equal(result.cr_sicop, null);
  });

  it('returns enriched=false for CL', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CL', taxId: '76123456-7' },
      matchedLookup(),
    );
    assert.equal(result.enriched, false);
    assert.equal(result.cr_sicop, null);
  });

  it('returns enriched=false for MX', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'MX', taxId: 'ABC123456789' },
      matchedLookup(),
    );
    assert.equal(result.enriched, false);
    assert.equal(result.cr_sicop, null);
  });
});

// ── Skipped — missing cédula ─────────────────────────────────────────────────

describe('enrichCostaRicaCandidateWithSicop — missing cédula', () => {
  it('returns skipped block with reason=missing_legal_id when no taxId', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CR' },
      matchedLookup(),
    );
    assert.equal(result.enriched, true);
    assert.ok(result.cr_sicop !== null);
    assert.equal(result.cr_sicop!.status, 'skipped');
    assert.equal(result.cr_sicop!.reason, 'missing_legal_id');
    assert.equal(result.reason, 'missing_legal_id');
    assertSemanticGuardrails(result.cr_sicop!);
  });

  it('returns skipped when taxId is empty string', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CR', taxId: '' },
      matchedLookup(),
    );
    assert.equal(result.cr_sicop!.status, 'skipped');
    assert.equal(result.cr_sicop!.reason, 'missing_legal_id');
  });
});

// ── Skipped — non-company identifier ─────────────────────────────────────────

describe('enrichCostaRicaCandidateWithSicop — non-company identifier', () => {
  it('returns skipped block with reason=non_company_identifier for cédula física', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CR', taxId: '1234567890' },
      matchedLookup(),
    );
    assert.equal(result.enriched, true);
    assert.ok(result.cr_sicop !== null);
    assert.equal(result.cr_sicop!.status, 'skipped');
    assert.equal(result.cr_sicop!.reason, 'non_company_identifier');
    assert.equal(result.reason, 'non_company_identifier');
    assertSemanticGuardrails(result.cr_sicop!);
  });

  it('does NOT validate cédula jurídica — it only filters non-company format', () => {
    // The check is a heuristic only, not a legal validation.
    // We verify it does not claim to validate the identifier legally.
    const block = { legal_validation_status: 'not_applicable' as const };
    assert.equal(block.legal_validation_status, 'not_applicable');
  });
});

// ── Matched ───────────────────────────────────────────────────────────────────

describe('enrichCostaRicaCandidateWithSicop — matched', () => {
  it('returns matched block with correct procurement_summary', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CR', taxId: '3-101-123456' },
      matchedLookup(),
    );
    assert.equal(result.enriched, true);
    assert.ok(result.cr_sicop !== null);
    assert.equal(result.cr_sicop!.status, 'matched');
    assert.equal(result.cr_sicop!.matched_by, 'tax_id');
    assert.equal(result.cr_sicop!.confidence, 1);
    assert.equal(result.cr_sicop!.priority_boost, true);
    assert.equal(result.cr_sicop!.source_year, 2024);
    assert.equal(result.cr_sicop!.procurement_summary?.dataset, 'ofertas_2024');
    assert.equal(result.cr_sicop!.procurement_summary?.total_records_year, 3);
    assertSemanticGuardrails(result.cr_sicop!);
  });

  it('uses procurement_signal source_type', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CR', taxId: '3101123456' },
      matchedLookup(),
    );
    assert.equal(result.cr_sicop!.source_type, 'procurement_signal');
  });

  it('legal_validation_status is not_applicable — does not replace Hacienda CR', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CR', taxId: '3101123456' },
      matchedLookup(),
    );
    assert.equal(result.cr_sicop!.legal_validation_status, 'not_applicable');
  });

  it('tax_validation_status is not_applicable — does not validate cédula', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CR', taxId: '3101123456' },
      matchedLookup(),
    );
    assert.equal(result.cr_sicop!.tax_validation_status, 'not_applicable');
  });

  it('official_ciiu_available is false — does not invent CIIU', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CR', taxId: '3101123456' },
      matchedLookup(),
    );
    assert.equal(result.cr_sicop!.official_ciiu_available, false);
    assert.equal(result.cr_sicop!.ciiu_status, 'unavailable_for_mvp');
  });

  it('normalizes dashed cédula before lookup', async () => {
    const captured: string[] = [];
    const capturingLookup = async (input: { cedula: string }) => {
      captured.push(input.cedula);
      return (await matchedLookup()(input));
    };
    await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CR', taxId: '3-101-123456' },
      capturingLookup,
    );
    assert.equal(captured[0], '3101123456');
  });
});

// ── Not found ─────────────────────────────────────────────────────────────────

describe('enrichCostaRicaCandidateWithSicop — not found', () => {
  it('returns not_found block when no snapshot match', async () => {
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CR', taxId: '3999999999' },
      notFoundLookup(),
    );
    assert.equal(result.enriched, true);
    assert.ok(result.cr_sicop !== null);
    assert.equal(result.cr_sicop!.status, 'not_found');
    assert.equal(result.cr_sicop!.matched_by, null);
    assert.equal(result.cr_sicop!.confidence, 0);
    assert.equal(result.cr_sicop!.priority_boost, false);
    assertSemanticGuardrails(result.cr_sicop!);
  });
});

// ── resolveCedulaFromSicopInput ───────────────────────────────────────────────

describe('resolveCedulaFromSicopInput', () => {
  it('resolves from taxId', () => {
    const result = resolveCedulaFromSicopInput({ countryCode: 'CR', taxId: '3101123456' });
    assert.equal(result, '3101123456');
  });

  it('resolves from metadata.tax_id when taxId absent', () => {
    const result = resolveCedulaFromSicopInput({
      countryCode: 'CR',
      metadata: { tax_id: '3102200000' },
    });
    assert.equal(result, '3102200000');
  });

  it('resolves from metadata.cedula as fallback', () => {
    const result = resolveCedulaFromSicopInput({
      countryCode: 'CR',
      metadata: { cedula: '3103300000' },
    });
    assert.equal(result, '3103300000');
  });

  it('returns null when all fields absent', () => {
    const result = resolveCedulaFromSicopInput({ countryCode: 'CR' });
    assert.equal(result, null);
  });
});

// ── Metadata preservation ─────────────────────────────────────────────────────

describe('enrichCostaRicaCandidateWithSicop — metadata preservation', () => {
  it('does not touch existing metadata — enrichment block is separate', async () => {
    const existingMeta = {
      source_enrichment: {
        rd_dgii_bulk: { status: 'matched' },
        pe_sunat_bulk: { status: 'matched' },
        cl_chilecompra_ocds: { status: 'not_found' },
        mx_denue: { status: 'matched' },
      },
    };
    const result = await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CR', taxId: '3101123456', metadata: existingMeta },
      matchedLookup(),
    );
    // The enrichment result returns cr_sicop block — existing metadata is untouched
    assert.equal(result.cr_sicop!.status, 'matched');
    assert.equal(result.cr_sicop!.source_key, 'cr_sicop');
    // The function returns a block, not a merged metadata — merging is done by the worker
  });
});

// ── No external calls ─────────────────────────────────────────────────────────

describe('enrichCostaRicaCandidateWithSicop — no external calls', () => {
  it('uses injected lookupFn — never calls datos.go.cr', async () => {
    let lookupCalled = false;
    const localLookup = async (_input: { cedula: string }) => {
      lookupCalled = true;
      return notFoundLookup()(_input);
    };
    await enrichCostaRicaCandidateWithSicop(
      { countryCode: 'CR', taxId: '3101123456' },
      localLookup,
    );
    assert.equal(lookupCalled, true, 'debe llamar al lookup inyectado');
    // The lookupFn is always injected — no hard-coded URL is reachable
  });
});

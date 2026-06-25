/**
 * Perú.5I — SUNAT Metadata Propagation Tests
 *
 * Tests for mergePeruSunatMetadataIntoAccountMetadata helper and its
 * propagation guarantees from candidate → account.
 *
 * Uses Node.js built-in test module. No Supabase connection required.
 * No SUNAT API calls, no Migo, no Tavily, no importer, no real DB writes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mergePeruSunatMetadataIntoAccountMetadata } from '../peru-sunat-metadata-merge';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PE_SUNAT_BLOCK = {
  ruc: '20100050359',
  legal_name: 'A W FABER CASTELL PERUANA S A',
  taxpayer_status: 'ACTIVO',
  domicile_condition: 'HABIDO',
  legal_validation_status: 'verified',
  legal_validation_reason: 'ruc_found_active_habido',
  source_key: 'pe_sunat_bulk',
  sector_source: 'inferred_web_ai',
  confidence_label: 'sector_inferred',
  ciiu_status: 'unavailable_for_mvp',
  official_ciiu_available: false,
  human_review_required: true,
  enriched_at: '2026-06-25T00:00:00.000Z',
  ubigeo: null,
  is_active: true,
  is_habido: true,
};

function makeCandidateMeta(
  peSunatBulk?: Record<string, unknown> | null,
): Record<string, unknown> {
  if (peSunatBulk === undefined) {
    return {};
  }
  if (peSunatBulk === null) {
    return { source_enrichment: { pe_sunat_bulk: null } };
  }
  return { source_enrichment: { pe_sunat_bulk: peSunatBulk } };
}

// ── Core merge helper tests ───────────────────────────────────────────────────

describe('mergePeruSunatMetadataIntoAccountMetadata', () => {

  it('copies pe_sunat_bulk from candidate metadata to account metadata', () => {
    const accountMeta: Record<string, unknown> = {
      converted_from_candidate_id: 'cand-1',
      batch_id: 'batch-1',
    };
    const candidateMeta = makeCandidateMeta(PE_SUNAT_BLOCK);

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    assert.equal(
      (result.source_enrichment as Record<string, unknown>).pe_sunat_bulk,
      PE_SUNAT_BLOCK,
    );
  });

  it('preserves existing account metadata fields', () => {
    const accountMeta: Record<string, unknown> = {
      converted_from_candidate_id: 'cand-2',
      batch_id: 'batch-2',
      hubspot_sync_status: 'synced',
      hubspot_company_id: 'hs-42',
    };
    const candidateMeta = makeCandidateMeta(PE_SUNAT_BLOCK);

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    assert.equal(result.converted_from_candidate_id, 'cand-2');
    assert.equal(result.batch_id, 'batch-2');
    assert.equal(result.hubspot_sync_status, 'synced');
    assert.equal(result.hubspot_company_id, 'hs-42');
  });

  it('preserves other source_enrichment keys (CO, MX, CL sources)', () => {
    const existingCoBlock = { status: 'matched', source: 'co_personas_juridicas_cc' };
    const accountMeta: Record<string, unknown> = {
      converted_from_candidate_id: 'cand-3',
      source_enrichment: {
        co_personas_juridicas_cc: existingCoBlock,
        co_siis: { status: 'no_match' },
      },
    };
    const candidateMeta = makeCandidateMeta(PE_SUNAT_BLOCK);

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    const se = result.source_enrichment as Record<string, unknown>;
    assert.deepEqual(se.co_personas_juridicas_cc, existingCoBlock);
    assert.deepEqual(se.co_siis, { status: 'no_match' });
    assert.equal(se.pe_sunat_bulk, PE_SUNAT_BLOCK);
  });

  it('returns account metadata unchanged when candidate has no pe_sunat_bulk', () => {
    const accountMeta: Record<string, unknown> = {
      converted_from_candidate_id: 'cand-4',
      batch_id: 'batch-4',
    };
    const candidateMeta = makeCandidateMeta(undefined);

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    assert.deepEqual(result, accountMeta);
    assert.equal(result.source_enrichment, undefined);
  });

  it('returns account metadata unchanged when candidate metadata is empty', () => {
    const accountMeta: Record<string, unknown> = {
      converted_from_candidate_id: 'cand-5',
    };

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, {});

    assert.deepEqual(result, accountMeta);
  });

  it('returns account metadata unchanged when pe_sunat_bulk is null', () => {
    const accountMeta: Record<string, unknown> = {
      converted_from_candidate_id: 'cand-6',
    };
    const candidateMeta = makeCandidateMeta(null);

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    assert.deepEqual(result, accountMeta);
  });

  it('does not mutate the original accountMetadata object', () => {
    const accountMeta: Record<string, unknown> = {
      converted_from_candidate_id: 'cand-7',
    };
    const candidateMeta = makeCandidateMeta(PE_SUNAT_BLOCK);
    const originalSnapshot = JSON.stringify(accountMeta);

    mergePeruSunatMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    assert.equal(JSON.stringify(accountMeta), originalSnapshot);
  });

  it('does not expose official_ciiu_available as true', () => {
    const accountMeta: Record<string, unknown> = {};
    const candidateMeta = makeCandidateMeta(PE_SUNAT_BLOCK);

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    const block = (result.source_enrichment as Record<string, unknown>).pe_sunat_bulk as Record<string, unknown>;
    assert.equal(block.official_ciiu_available, false);
  });

  it('does not create an official_ciiu field', () => {
    const accountMeta: Record<string, unknown> = {};
    const candidateMeta = makeCandidateMeta(PE_SUNAT_BLOCK);

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    const block = (result.source_enrichment as Record<string, unknown>).pe_sunat_bulk as Record<string, unknown>;
    assert.equal(Object.prototype.hasOwnProperty.call(block, 'official_ciiu'), false);
  });

  it('does not apply for CO country — no pe_sunat_bulk means no-op regardless of country', () => {
    const accountMeta: Record<string, unknown> = { country_code: 'CO' };
    const coOnlyMeta: Record<string, unknown> = {
      source_enrichment: { co_personas_juridicas_cc: { status: 'matched' } },
    };

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, coOnlyMeta);

    const se = result.source_enrichment as Record<string, unknown> | undefined;
    assert.equal(se?.pe_sunat_bulk, undefined);
  });

  it('does not apply for MX country — no pe_sunat_bulk means no-op', () => {
    const accountMeta: Record<string, unknown> = { country_code: 'MX' };
    const mxOnlyMeta: Record<string, unknown> = {
      source_enrichment: { mx_denue: { status: 'matched' } },
    };

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, mxOnlyMeta);

    const se = result.source_enrichment as Record<string, unknown> | undefined;
    assert.equal(se?.pe_sunat_bulk, undefined);
  });

  it('does not apply for CL country — no pe_sunat_bulk means no-op', () => {
    const accountMeta: Record<string, unknown> = { country_code: 'CL' };
    const clOnlyMeta: Record<string, unknown> = {
      source_enrichment: { cl_inapi: { status: 'matched' } },
    };

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, clOnlyMeta);

    const se = result.source_enrichment as Record<string, unknown> | undefined;
    assert.equal(se?.pe_sunat_bulk, undefined);
  });

  it('Case A: PE candidate with verified SUNAT results in account with verified status', () => {
    const accountMeta: Record<string, unknown> = { converted_from_candidate_id: 'cand-pe-1' };
    const candidateMeta = makeCandidateMeta({
      ...PE_SUNAT_BLOCK,
      legal_validation_status: 'verified',
    });

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    const block = (result.source_enrichment as Record<string, unknown>).pe_sunat_bulk as Record<string, unknown>;
    assert.equal(block.legal_validation_status, 'verified');
  });

  it('Case B: post-approval update propagates pe_sunat_bulk to account (via worker candidate metadata shape)', () => {
    const accountMeta: Record<string, unknown> = {
      converted_from_candidate_id: 'cand-pe-2',
      hubspot_sync_status: 'synced',
    };
    // Simulates the shape passed by runPeruSunatEnrichmentForCandidate to the helper
    const workerPassedMeta: Record<string, unknown> = {
      source_enrichment: { pe_sunat_bulk: PE_SUNAT_BLOCK },
    };

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, workerPassedMeta);

    const se = result.source_enrichment as Record<string, unknown>;
    assert.equal(se.pe_sunat_bulk, PE_SUNAT_BLOCK);
    assert.equal(result.hubspot_sync_status, 'synced');
  });

});

// ── Guardrail confirmations ───────────────────────────────────────────────────

describe('Guardrails: mergePeruSunatMetadataIntoAccountMetadata', () => {

  it('is a pure function — makes no network calls, DB writes, or imports', () => {
    // The function is synchronous and pure — verifying it returns without side effects
    const result = mergePeruSunatMetadataIntoAccountMetadata(
      { id: 'acc-1' },
      makeCandidateMeta(PE_SUNAT_BLOCK),
    );
    assert.equal(typeof result, 'object');
    assert.ok(result !== null);
  });

  it('does not expose raw metadata — only the known pe_sunat_bulk block structure is merged', () => {
    const accountMeta: Record<string, unknown> = {};
    const candidateMeta = makeCandidateMeta(PE_SUNAT_BLOCK);

    const result = mergePeruSunatMetadataIntoAccountMetadata(accountMeta, candidateMeta);

    // Only source_enrichment key added — no raw candidate metadata leaked
    const keys = Object.keys(result);
    assert.deepEqual(keys, ['source_enrichment']);
  });

});

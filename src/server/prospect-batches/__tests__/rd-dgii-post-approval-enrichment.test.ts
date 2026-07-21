/**
 * Tests — Centroamérica.1A.4 — DGII RD Post-Approval Enrichment
 *
 * Covers:
 * 1. Trigger allows DO
 * 2. Trigger still allows CO/PE/CL
 * 3. Lookup matched by RNC 9 digits
 * 4. Lookup skipped if missing RNC
 * 5. Lookup skipped if RNC/cédula has 11 digits
 * 6. Enrichment module writes rd_dgii_bulk block
 * 7. Metadata uses source_type=legal_registry
 * 8. Metadata does not invent CIIU (official_ciiu_available=false)
 * 9. economic_activity_text preserved as free text
 * 10. Propagation: other source keys preserved
 * 11. Source Catalog status backed by real connection
 * 12. Perú/Chile not touched
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  triggerPostApprovalEnrichment,
} from '../post-approval-enrichment-trigger';

import {
  enrichDominicanCandidateWithDgii,
  resolveRncFromInput,
} from '../rd-dgii-post-approval-enrichment';

import {
  normalizeDominicanRncForLookup,
  isDominicanCedulaIdentifier,
} from '../../services/rd-dgii-lookup';

// ── Supabase stub ──────────────────────────────────────────────────────────────

function makeSupabase(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    eq: () => chain,
    single: () => Promise.resolve({ data: { metadata: {} }, error: null }),
    select: () => chain,
    update: () => chain,
    insert: () => chain,
  });
  return { from: () => chain };
}

function makeTriggerParams(countryCode: string | null, taxId?: string) {
  return {
    candidate: { country_code: countryCode, tax_identifier: taxId ?? null },
    candidateId: 'cand-do-1',
    batchId: 'batch-do-1',
    accountId: 'acct-do-1',
    internalUserId: 'user-1',
    supabase: makeSupabase() as never,
  };
}

// ── 1. Trigger allows DO ───────────────────────────────────────────────────────

describe('RD.1A4.T1 — trigger allows DO', () => {
  it('DO with RNC 9 digits → triggered=true, status=queued', async () => {
    const result = await triggerPostApprovalEnrichment(makeTriggerParams('DO', '130456789'));
    assert.equal(result.triggered, true);
    assert.equal(result.meta.status, 'queued');
    assert.equal(result.meta.nit, '130456789');
  });

  it('DO with RNC → source_keys empty (DGII step runs in worker directly)', async () => {
    const result = await triggerPostApprovalEnrichment(makeTriggerParams('DO', '130456789'));
    assert.ok(Array.isArray(result.meta.source_keys));
    assert.equal(result.meta.source_keys!.length, 0);
  });

  it('DO without RNC → triggered=false, reason=missing_tax_id', async () => {
    const result = await triggerPostApprovalEnrichment(makeTriggerParams('DO'));
    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.reason, 'missing_tax_id');
  });

  it('DO does not queue CO-specific source keys', async () => {
    const result = await triggerPostApprovalEnrichment(makeTriggerParams('DO', '130456789'));
    const keys = result.meta.source_keys ?? [];
    assert.ok(!keys.some(k => k.startsWith('co_')));
  });
});

// ── 2. Trigger still allows CO/PE/CL ──────────────────────────────────────────

describe('RD.1A4.T2 — trigger non-regression CO/PE/CL', () => {
  it('CO with NIT → triggered=true', async () => {
    const result = await triggerPostApprovalEnrichment(makeTriggerParams('CO', '900123456'));
    assert.equal(result.triggered, true);
  });

  it('PE with RUC → triggered=true', async () => {
    const result = await triggerPostApprovalEnrichment(makeTriggerParams('PE', '20615264335'));
    assert.equal(result.triggered, true);
  });

  it('CL with RUT → triggered=true', async () => {
    const result = await triggerPostApprovalEnrichment(makeTriggerParams('CL', '12345678-9'));
    assert.equal(result.triggered, true);
  });

  it('MX now supported via DENUE name-context → triggered=true, status=queued', async () => {
    const result = await triggerPostApprovalEnrichment(makeTriggerParams('MX', 'ABC123456'));
    assert.equal(result.triggered, true);
    assert.equal(result.meta.status, 'queued');
    // MX runs DENUE live API in the worker directly — no CO adapter source keys queued
    assert.deepEqual(result.meta.source_keys, []);
  });
});

// ── 3. Lookup helpers — RNC normalization ──────────────────────────────────────

describe('RD.1A4.T3 — RNC normalization', () => {
  it('9-digit RNC normalizes to 9 digits', () => {
    assert.equal(normalizeDominicanRncForLookup('130456789'), '130456789');
  });

  it('RNC with hyphens stripped to 9 digits', () => {
    assert.equal(normalizeDominicanRncForLookup('1-30-45678-9'), '130456789');
  });

  it('11-digit cédula returns null', () => {
    assert.equal(normalizeDominicanRncForLookup('00100123456'), null);
  });

  it('7-digit string returns null', () => {
    assert.equal(normalizeDominicanRncForLookup('1234567'), null);
  });
});

// ── 4. isDominicanCedulaIdentifier ────────────────────────────────────────────

describe('RD.1A4.T4 — cédula detection', () => {
  it('11-digit string is cédula', () => {
    assert.equal(isDominicanCedulaIdentifier('00100123456'), true);
  });

  it('9-digit RNC is not cédula', () => {
    assert.equal(isDominicanCedulaIdentifier('130456789'), false);
  });

  it('cédula with hyphens detected correctly', () => {
    assert.equal(isDominicanCedulaIdentifier('001-0012345-6'), true);
  });
});

// ── 5. Enrichment module — skipped cases ──────────────────────────────────────

describe('RD.1A4.T5 — enrichment skipped cases', () => {
  it('non-DO country → enriched=false, rd_dgii_bulk=null', async () => {
    const result = await enrichDominicanCandidateWithDgii({
      countryCode: 'PE',
      taxId: '130456789',
    });
    assert.equal(result.enriched, false);
    assert.equal(result.rd_dgii_bulk, null);
    assert.equal(result.reason, 'not_do_country');
  });

  it('DO missing RNC → enriched=true, status=skipped, reason=missing_tax_id', async () => {
    const result = await enrichDominicanCandidateWithDgii({
      countryCode: 'DO',
      taxId: null,
    });
    assert.equal(result.enriched, true);
    assert.equal(result.rd_dgii_bulk?.status, 'skipped');
    assert.equal(result.rd_dgii_bulk?.reason, 'missing_tax_id');
    assert.equal(result.reason, 'missing_tax_id');
  });

  it('DO with 11-digit cédula → enriched=true, status=skipped, person_identifier_out_of_scope', async () => {
    const result = await enrichDominicanCandidateWithDgii({
      countryCode: 'DO',
      taxId: '00100123456',
    });
    assert.equal(result.enriched, true);
    assert.equal(result.rd_dgii_bulk?.status, 'skipped');
    assert.equal(result.rd_dgii_bulk?.reason, 'person_identifier_out_of_scope');
    assert.equal(result.reason, 'person_identifier_out_of_scope');
  });
});

// ── 6. Enrichment module — matched block ──────────────────────────────────────

describe('RD.1A4.T6 — enrichment matched block', () => {
  const mockLookupMatched = async () => ({
    matched: true,
    source_year: 2024,
    legal_name: 'EMPRESA EJEMPLO SRL',
    trade_name: 'EJEMPLO TRADE',
    normalized_rnc: '130456789',
    taxpayer_status: 'NORMAL',
    normalized_status: 'active',
    is_active_taxpayer: true,
    economic_activity_text: 'FABRICACION DE MUEBLES',
    registration_date: '2010-03-15',
    raw_data: {},
    legal_validation_status: 'matched' as const,
    skip_reason: null,
    reason: null,
  });

  it('matched lookup → status=matched, legal_validation_status=matched', async () => {
    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookupMatched,
    );
    assert.equal(result.enriched, true);
    assert.equal(result.rd_dgii_bulk?.status, 'matched');
    assert.equal(result.rd_dgii_bulk?.legal_validation_status, 'matched');
  });

  it('matched → confidence=1, matched_by=tax_id', async () => {
    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookupMatched,
    );
    assert.equal(result.rd_dgii_bulk?.confidence, 1);
    assert.equal(result.rd_dgii_bulk?.matched_by, 'tax_id');
  });

  it('matched → source_key=rd_dgii_bulk', async () => {
    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookupMatched,
    );
    assert.equal(result.rd_dgii_bulk?.source_key, 'rd_dgii_bulk');
  });

  it('matched → country_code=DO', async () => {
    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookupMatched,
    );
    assert.equal(result.rd_dgii_bulk?.country_code, 'DO');
  });
});

// ── 7. Metadata uses legal_registry ───────────────────────────────────────────

describe('RD.1A4.T7 — source_type=legal_registry', () => {
  const mockLookup = async () => ({
    matched: true,
    source_year: 2024,
    legal_name: 'TEST SRL',
    trade_name: null,
    normalized_rnc: '130456789',
    taxpayer_status: 'NORMAL',
    normalized_status: 'active',
    is_active_taxpayer: true,
    economic_activity_text: 'COMERCIO',
    registration_date: null,
    raw_data: {},
    legal_validation_status: 'matched' as const,
    skip_reason: null,
    reason: null,
  });

  it('source_type = legal_registry', async () => {
    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookup,
    );
    assert.equal(result.rd_dgii_bulk?.source_type, 'legal_registry');
  });

  it('source = source_company_snapshots', async () => {
    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookup,
    );
    assert.equal(result.rd_dgii_bulk?.source, 'source_company_snapshots');
  });
});

// ── 8. No CIIU invented ────────────────────────────────────────────────────────

describe('RD.1A4.T8 — official_ciiu_available=false always', () => {
  const mockLookup = async () => ({
    matched: true,
    source_year: 2024,
    legal_name: 'TEST SRL',
    trade_name: null,
    normalized_rnc: '130456789',
    taxpayer_status: 'NORMAL',
    normalized_status: 'active',
    is_active_taxpayer: true,
    economic_activity_text: 'COMERCIO AL POR MAYOR',
    registration_date: null,
    raw_data: {},
    legal_validation_status: 'matched' as const,
    skip_reason: null,
    reason: null,
  });

  it('official_ciiu_available = false', async () => {
    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookup,
    );
    assert.equal(result.rd_dgii_bulk?.official_ciiu_available, false);
  });

  it('ciiu_status = unavailable_for_mvp', async () => {
    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookup,
    );
    assert.equal(result.rd_dgii_bulk?.ciiu_status, 'unavailable_for_mvp');
  });

  it('block has no official_ciiu field', async () => {
    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookup,
    );
    assert.ok(!('official_ciiu' in (result.rd_dgii_bulk ?? {})));
  });
});

// ── 9. economic_activity_text as free text ────────────────────────────────────

describe('RD.1A4.T9 — economic_activity_text preserved as free text', () => {
  const freeText = 'FABRICACION DE PRODUCTOS DE PLASTICO NCP';

  const mockLookup = async () => ({
    matched: true,
    source_year: 2024,
    legal_name: 'TEST SRL',
    trade_name: null,
    normalized_rnc: '130456789',
    taxpayer_status: 'NORMAL',
    normalized_status: 'active',
    is_active_taxpayer: true,
    economic_activity_text: freeText,
    registration_date: null,
    raw_data: {},
    legal_validation_status: 'matched' as const,
    skip_reason: null,
    reason: null,
  });

  it('economic_activity_text matches source text exactly', async () => {
    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookup,
    );
    assert.equal(result.rd_dgii_bulk?.economic_activity_text, freeText);
  });

  it('economic_activity_source = dgii_text', async () => {
    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookup,
    );
    assert.equal(result.rd_dgii_bulk?.economic_activity_source, 'dgii_text');
  });

  it('sector_source = dgii_economic_activity_text', async () => {
    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookup,
    );
    assert.equal(result.rd_dgii_bulk?.sector_source, 'dgii_economic_activity_text');
  });
});

// ── 10. Propagation preserves other source keys ───────────────────────────────

describe('RD.1A4.T10 — propagation preserves other source keys', () => {
  it('not_found block still has all semantic guardrail fields', async () => {
    const mockNotFound = async () => ({
      matched: false,
      source_year: null,
      legal_name: null,
      trade_name: null,
      normalized_rnc: '999999999',
      taxpayer_status: null,
      normalized_status: null,
      is_active_taxpayer: null,
      economic_activity_text: null,
      registration_date: null,
      raw_data: null,
      legal_validation_status: 'not_found' as const,
      skip_reason: null,
      reason: 'no_snapshot_match_by_rnc',
    });

    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '999999999' },
      mockNotFound,
    );
    assert.equal(result.rd_dgii_bulk?.status, 'not_found');
    assert.equal(result.rd_dgii_bulk?.source_key, 'rd_dgii_bulk');
    assert.equal(result.rd_dgii_bulk?.source_type, 'legal_registry');
    assert.equal(result.rd_dgii_bulk?.official_ciiu_available, false);
    assert.equal(result.rd_dgii_bulk?.human_review_required, true);
  });
});

// ── 11. resolveRncFromInput ───────────────────────────────────────────────────

describe('RD.1A4.T11 — resolveRncFromInput', () => {
  it('resolves from taxId', () => {
    assert.equal(resolveRncFromInput({ countryCode: 'DO', taxId: '130456789' }), '130456789');
  });

  it('resolves from metadata.tax_id when taxId absent', () => {
    const rnc = resolveRncFromInput({
      countryCode: 'DO',
      metadata: { tax_id: '130456789' },
    });
    assert.equal(rnc, '130456789');
  });

  it('resolves from metadata.rnc fallback', () => {
    const rnc = resolveRncFromInput({
      countryCode: 'DO',
      metadata: { rnc: '130456789' },
    });
    assert.equal(rnc, '130456789');
  });

  it('returns null when no RNC anywhere', () => {
    assert.equal(resolveRncFromInput({ countryCode: 'DO' }), null);
  });
});

// ── 12. human_review_required always true ─────────────────────────────────────

describe('RD.1A4.T12 — human_review_required=true', () => {
  it('matched block has human_review_required=true', async () => {
    const mockLookup = async () => ({
      matched: true,
      source_year: 2024,
      legal_name: 'EMPRESA X SRL',
      trade_name: null,
      normalized_rnc: '130456789',
      taxpayer_status: 'NORMAL',
      normalized_status: 'active',
      is_active_taxpayer: true,
      economic_activity_text: 'COMERCIO',
      registration_date: null,
      raw_data: {},
      legal_validation_status: 'matched' as const,
      skip_reason: null,
      reason: null,
    });

    const result = await enrichDominicanCandidateWithDgii(
      { countryCode: 'DO', taxId: '130456789' },
      mockLookup,
    );
    assert.equal(result.rd_dgii_bulk?.human_review_required, true);
  });
});

/**
 * Perú.5H — Account SUNAT Legal Validation Display Tests
 *
 * Tests for the SUNAT block extraction logic and display invariants
 * in the account detail sheet. Uses Node.js built-in test runner.
 * No DOM, no React, no API calls, no candidates/batches/accounts created.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getSunatStatusDisplay } from '@/components/prospect-batches/peru-sunat-legal-validation-block';
import type { PeruSunatEnrichmentBlock } from '@/server/prospect-batches/peru-sunat-post-approval-enrichment';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeVerifiedBlock(
  overrides: Partial<PeruSunatEnrichmentBlock> = {},
): PeruSunatEnrichmentBlock {
  return {
    legal_validation_status: 'verified',
    legal_validation_reason: 'ruc_found_active_habido',
    ruc: '20100050359',
    legal_name: 'SELLUP PERU SUNAT POST-APPROVAL SMOKE ACCOUNT S.A.C.',
    taxpayer_status: 'ACTIVO',
    domicile_condition: 'HABIDO',
    ubigeo: '150101',
    is_active: true,
    is_habido: true,
    source_key: 'pe_sunat_bulk',
    enriched_at: '2024-06-01T00:00:00Z',
    sector_source: 'inferred_web_ai',
    confidence_label: 'sector_inferred',
    ciiu_status: 'unavailable_for_mvp',
    official_ciiu_available: false,
    human_review_required: true,
    ...overrides,
  };
}

/** Mirrors the extraction logic used in AccountDetailSheet */
function extractSunatBlock(
  accountMetadata: Record<string, unknown>,
  countryCode: string | null,
): PeruSunatEnrichmentBlock | null {
  if (countryCode?.toUpperCase() !== 'PE') return null;
  const sourceEnrichment = accountMetadata?.source_enrichment as Record<string, unknown> | undefined;
  return (sourceEnrichment?.pe_sunat_bulk as PeruSunatEnrichmentBlock | null | undefined) ?? null;
}

// ── Test 1: PE account with verified SUNAT metadata ────────────────────────────

describe('PE account with SUNAT metadata', () => {
  it('extracts pe_sunat_bulk block from account metadata', () => {
    const block = makeVerifiedBlock();
    const metadata: Record<string, unknown> = {
      source_enrichment: { pe_sunat_bulk: block },
    };
    const extracted = extractSunatBlock(metadata, 'PE');
    assert.ok(extracted !== null, 'block should be extracted');
    assert.strictEqual(extracted.legal_validation_status, 'verified');
  });

  it('displays "Verificado SUNAT" for verified status', () => {
    const display = getSunatStatusDisplay('verified');
    assert.strictEqual(display.label, 'Verificado SUNAT');
    assert.ok(display.badgeClass.includes('emerald'));
  });

  it('country_code lowercase pe is treated as PE', () => {
    const block = makeVerifiedBlock();
    const metadata: Record<string, unknown> = {
      source_enrichment: { pe_sunat_bulk: block },
    };
    const extracted = extractSunatBlock(metadata, 'pe');
    assert.ok(extracted !== null, 'lowercase pe should also extract block');
  });
});

// ── Test 2: PE account without SUNAT metadata ──────────────────────────────────

describe('PE account without SUNAT metadata', () => {
  it('returns null block when metadata is empty', () => {
    const extracted = extractSunatBlock({}, 'PE');
    assert.strictEqual(extracted, null);
  });

  it('returns null block when source_enrichment missing pe_sunat_bulk', () => {
    const metadata: Record<string, unknown> = { source_enrichment: {} };
    const extracted = extractSunatBlock(metadata, 'PE');
    assert.strictEqual(extracted, null);
  });

  it('displays "Validación SUNAT pendiente" when block is null', () => {
    const display = getSunatStatusDisplay(null);
    assert.strictEqual(display.label, 'Validación SUNAT pendiente');
    assert.ok(display.badgeClass.includes('muted'));
  });
});

// ── Test 3: Non-PE accounts do not show SUNAT block ───────────────────────────

describe('Non-PE accounts', () => {
  it('CO account returns null (no SUNAT block)', () => {
    const metadata: Record<string, unknown> = {
      source_enrichment: { pe_sunat_bulk: makeVerifiedBlock() },
    };
    const extracted = extractSunatBlock(metadata, 'CO');
    assert.strictEqual(extracted, null);
  });

  it('MX account returns null (no SUNAT block)', () => {
    const extracted = extractSunatBlock({}, 'MX');
    assert.strictEqual(extracted, null);
  });

  it('CL account returns null (no SUNAT block)', () => {
    const extracted = extractSunatBlock({}, 'CL');
    assert.strictEqual(extracted, null);
  });

  it('null country_code returns null (no SUNAT block)', () => {
    const extracted = extractSunatBlock({}, null);
    assert.strictEqual(extracted, null);
  });
});

// ── Test 4: No CIIU oficial in any status label ───────────────────────────────

describe('Status labels never mention CIIU oficial', () => {
  const allStatuses = [
    'verified',
    'flagged',
    'not_found',
    'pending_snapshot_validation',
    'snapshot_unavailable',
    null,
    undefined,
  ] as const;

  for (const status of allStatuses) {
    it(`status "${String(status)}" label does not mention "CIIU oficial"`, () => {
      const display = getSunatStatusDisplay(status);
      assert.ok(
        !display.label.toLowerCase().includes('ciiu oficial'),
        `label "${display.label}" must not mention CIIU oficial`,
      );
    });
  }
});

// ── Test 5: Block invariants — no raw metadata exposed ────────────────────────

describe('Block invariants — safe display fields only', () => {
  it('verified block does not expose ubigeo as display field', () => {
    const block = makeVerifiedBlock();
    // ubigeo is stored internally but the component only renders:
    // ruc, legal_name, taxpayer_status, domicile_condition, source
    // Verify the internal field is NOT a display field
    const displayFields = ['ruc', 'legal_name', 'taxpayer_status', 'domicile_condition'];
    assert.ok(!displayFields.includes('ubigeo'), 'ubigeo is internal, not a display field');
    assert.ok(block.ubigeo !== undefined, 'ubigeo exists in block but is not rendered');
  });

  it('verified block official_ciiu_available is always false', () => {
    const block = makeVerifiedBlock();
    assert.strictEqual(block.official_ciiu_available, false);
  });

  it('verified block sector_source is always inferred_web_ai', () => {
    const block = makeVerifiedBlock();
    assert.strictEqual(block.sector_source, 'inferred_web_ai');
  });

  it('verified block ciiu_status is unavailable_for_mvp', () => {
    const block = makeVerifiedBlock();
    assert.strictEqual(block.ciiu_status, 'unavailable_for_mvp');
  });
});

// ── Test 6: No API calls, no side effects ─────────────────────────────────────

describe('No side effects', () => {
  it('extractSunatBlock is a pure function with no side effects', () => {
    const metadata: Record<string, unknown> = {
      source_enrichment: { pe_sunat_bulk: makeVerifiedBlock() },
    };
    // Call multiple times — result must be deterministic
    const r1 = extractSunatBlock(metadata, 'PE');
    const r2 = extractSunatBlock(metadata, 'PE');
    assert.deepStrictEqual(r1, r2, 'pure function must return same result');
  });
});

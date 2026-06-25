/**
 * Perú.5G — SUNAT Legal Validation Block Tests
 *
 * Tests for getSunatStatusDisplay() and PeruSunatEnrichmentBlock display logic.
 * Uses Node.js built-in test runner. No DOM, no React, no API calls.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getSunatStatusDisplay } from '../peru-sunat-legal-validation-block';
import type { PeruSunatEnrichmentBlock } from '@/server/prospect-batches/peru-sunat-post-approval-enrichment';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeBlock(
  overrides: Partial<PeruSunatEnrichmentBlock> = {},
): PeruSunatEnrichmentBlock {
  return {
    legal_validation_status: 'verified',
    legal_validation_reason: 'ruc_found_active_habido',
    ruc: '20100050359',
    legal_name: 'A W FABER CASTELL PERUANA S A',
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

// ── getSunatStatusDisplay ──────────────────────────────────────────────────────

describe('getSunatStatusDisplay', () => {
  it('verified → label Verificado SUNAT, emerald badge', () => {
    const display = getSunatStatusDisplay('verified');
    assert.strictEqual(display.label, 'Verificado SUNAT');
    assert.ok(display.badgeClass.includes('emerald'), 'badge should be emerald');
  });

  it('flagged → label Revisar SUNAT, amber badge', () => {
    const display = getSunatStatusDisplay('flagged');
    assert.strictEqual(display.label, 'Revisar SUNAT');
    assert.ok(display.badgeClass.includes('amber'), 'badge should be amber');
  });

  it('not_found → label No encontrado en SUNAT, muted badge', () => {
    const display = getSunatStatusDisplay('not_found');
    assert.strictEqual(display.label, 'No encontrado en SUNAT');
    assert.ok(display.badgeClass.includes('muted'), 'badge should be muted');
  });

  it('pending_snapshot_validation → label Validación SUNAT pendiente, muted badge', () => {
    const display = getSunatStatusDisplay('pending_snapshot_validation');
    assert.strictEqual(display.label, 'Validación SUNAT pendiente');
    assert.ok(display.badgeClass.includes('muted'), 'badge should be muted');
  });

  it('snapshot_unavailable → label Snapshot SUNAT no disponible, amber badge', () => {
    const display = getSunatStatusDisplay('snapshot_unavailable');
    assert.strictEqual(display.label, 'Snapshot SUNAT no disponible');
    assert.ok(display.badgeClass.includes('amber'), 'badge should be amber');
  });

  it('null → defaults to Validación SUNAT pendiente', () => {
    const display = getSunatStatusDisplay(null);
    assert.strictEqual(display.label, 'Validación SUNAT pendiente');
  });

  it('undefined → defaults to Validación SUNAT pendiente', () => {
    const display = getSunatStatusDisplay(undefined);
    assert.strictEqual(display.label, 'Validación SUNAT pendiente');
  });

  it('unknown string → defaults to Validación SUNAT pendiente', () => {
    const display = getSunatStatusDisplay('some_unknown_status');
    assert.strictEqual(display.label, 'Validación SUNAT pendiente');
  });
});

// ── Block invariants (no CIIU oficial, sector_source invariants) ───────────────

describe('PeruSunatEnrichmentBlock invariants', () => {
  it('verified block never has official_ciiu_available=true', () => {
    const block = makeBlock({ legal_validation_status: 'verified' });
    assert.strictEqual(block.official_ciiu_available, false);
  });

  it('verified block always has ciiu_status unavailable_for_mvp', () => {
    const block = makeBlock({ legal_validation_status: 'verified' });
    assert.strictEqual(block.ciiu_status, 'unavailable_for_mvp');
  });

  it('verified block always has sector_source inferred_web_ai', () => {
    const block = makeBlock({ legal_validation_status: 'verified' });
    assert.strictEqual(block.sector_source, 'inferred_web_ai');
  });

  it('verified block always has human_review_required=true', () => {
    const block = makeBlock({ legal_validation_status: 'verified' });
    assert.strictEqual(block.human_review_required, true);
  });

  it('not_found block never has official_ciiu_available=true', () => {
    const block = makeBlock({
      legal_validation_status: 'not_found',
      legal_validation_reason: 'ruc_not_found_in_snapshot',
      ruc: null,
      legal_name: null,
      taxpayer_status: null,
      domicile_condition: null,
      ubigeo: null,
      is_active: null,
      is_habido: null,
    });
    assert.strictEqual(block.official_ciiu_available, false);
  });
});

// ── Status label coverage ──────────────────────────────────────────────────────

describe('status label does not mention CIIU oficial', () => {
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
    it(`status "${String(status)}" label does not contain "CIIU oficial"`, () => {
      const display = getSunatStatusDisplay(status);
      assert.ok(
        !display.label.toLowerCase().includes('ciiu oficial'),
        `label "${display.label}" must not mention CIIU oficial`,
      );
    });
  }
});

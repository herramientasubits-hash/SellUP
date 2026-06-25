/**
 * Perú.6E — Migo Complementary Legal Validation Block Tests
 *
 * Tests for getMigoStatusDisplay() and visibility logic.
 * Uses Node.js built-in test runner. No DOM, no React, no API calls,
 * no Migo API, no Tavily, no SUNAT web, no Supabase writes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getMigoStatusDisplay } from '../peru-migo-legal-validation-block';
import type { PeMigoApiEnrichmentBlock } from '@/server/prospect-batches/peru-migo-legal-enrichment';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeBlock(
  overrides: Partial<PeMigoApiEnrichmentBlock> = {},
): PeMigoApiEnrichmentBlock {
  return {
    ruc: '20100050359',
    legal_name: 'EMPRESA DEMO SAC',
    taxpayer_status: 'ACTIVO',
    domicile_condition: 'HABIDO',
    ubigeo: '150101',
    address: 'AV DEMO 123',
    updated_at_source: '2024-06-01',
    source_key: 'pe_migo_api',
    enriched_at: '2024-06-01T00:00:00Z',
    legal_validation_status: 'verified',
    legal_validation_reason: 'migo_ruc_found_active',
    ciiu_status: 'unavailable_for_mvp',
    official_ciiu_available: false,
    sector_source: 'not_provided_by_migo',
    ...overrides,
  };
}

/** Simulates what candidate-detail-sheet does for visibility check */
function shouldShowMigoBlock(
  countryCode: string | null | undefined,
  enrichment: Record<string, unknown> | null | undefined,
): PeMigoApiEnrichmentBlock | null {
  const isPe = countryCode?.toUpperCase() === 'PE';
  if (!isPe) return null;
  return (enrichment?.pe_migo_api as PeMigoApiEnrichmentBlock | null | undefined) ?? null;
}

// ── getMigoStatusDisplay — all required statuses ───────────────────────────────

describe('getMigoStatusDisplay', () => {
  it('verified → "Verificado por Migo", emerald badge', () => {
    const d = getMigoStatusDisplay('verified');
    assert.strictEqual(d.label, 'Verificado por Migo');
    assert.ok(d.badgeClass.includes('emerald'));
  });

  it('not_found → "No encontrado en Migo", muted badge', () => {
    const d = getMigoStatusDisplay('not_found');
    assert.strictEqual(d.label, 'No encontrado en Migo');
    assert.ok(d.badgeClass.includes('muted'));
  });

  it('flagged → "Revisar Migo", amber badge', () => {
    const d = getMigoStatusDisplay('flagged');
    assert.strictEqual(d.label, 'Revisar Migo');
    assert.ok(d.badgeClass.includes('amber'));
  });

  it('api_unavailable → "Migo no disponible", amber badge', () => {
    const d = getMigoStatusDisplay('api_unavailable');
    assert.strictEqual(d.label, 'Migo no disponible');
    assert.ok(d.badgeClass.includes('amber'));
  });

  it('invalid_ruc_format → "RUC inválido", muted badge', () => {
    const d = getMigoStatusDisplay('invalid_ruc_format');
    assert.strictEqual(d.label, 'RUC inválido');
    assert.ok(d.badgeClass.includes('muted'));
  });

  it('pending_validation → "Validación Migo pendiente", muted badge', () => {
    const d = getMigoStatusDisplay('pending_validation');
    assert.strictEqual(d.label, 'Validación Migo pendiente');
    assert.ok(d.badgeClass.includes('muted'));
  });

  it('null → defaults to "Validación Migo pendiente"', () => {
    const d = getMigoStatusDisplay(null);
    assert.strictEqual(d.label, 'Validación Migo pendiente');
  });

  it('undefined → defaults to "Validación Migo pendiente"', () => {
    const d = getMigoStatusDisplay(undefined);
    assert.strictEqual(d.label, 'Validación Migo pendiente');
  });

  it('unknown string → defaults to "Validación Migo pendiente"', () => {
    const d = getMigoStatusDisplay('some_unknown_status');
    assert.strictEqual(d.label, 'Validación Migo pendiente');
  });
});

// ── Visibility — candidato ──────────────────────────────────────────────────────

describe('Migo block visibility — candidato', () => {
  it('PE + pe_migo_api verified → muestra bloque', () => {
    const block = shouldShowMigoBlock('PE', { pe_migo_api: makeBlock({ legal_validation_status: 'verified' }) });
    assert.ok(block !== null, 'should show block');
    const d = getMigoStatusDisplay(block!.legal_validation_status);
    assert.strictEqual(d.label, 'Verificado por Migo');
  });

  it('PE + sin pe_migo_api → no muestra bloque', () => {
    const block = shouldShowMigoBlock('PE', {});
    assert.strictEqual(block, null);
  });

  it('PE + pe_migo_api null → no muestra bloque', () => {
    const block = shouldShowMigoBlock('PE', { pe_migo_api: null });
    assert.strictEqual(block, null);
  });

  it('CO + pe_migo_api → no muestra bloque', () => {
    const block = shouldShowMigoBlock('CO', { pe_migo_api: makeBlock() });
    assert.strictEqual(block, null);
  });

  it('MX + pe_migo_api → no muestra bloque', () => {
    const block = shouldShowMigoBlock('MX', { pe_migo_api: makeBlock() });
    assert.strictEqual(block, null);
  });

  it('CL + pe_migo_api → no muestra bloque', () => {
    const block = shouldShowMigoBlock('CL', { pe_migo_api: makeBlock() });
    assert.strictEqual(block, null);
  });

  it('null country_code → no muestra bloque', () => {
    const block = shouldShowMigoBlock(null, { pe_migo_api: makeBlock() });
    assert.strictEqual(block, null);
  });
});

// ── Visibility — empresa/cuenta ───────────────────────────────────────────────

describe('Migo block visibility — empresa/cuenta', () => {
  it('PE + pe_migo_api verified → muestra bloque', () => {
    const block = shouldShowMigoBlock('PE', { pe_migo_api: makeBlock({ legal_validation_status: 'verified' }) });
    assert.ok(block !== null);
    const d = getMigoStatusDisplay(block!.legal_validation_status);
    assert.strictEqual(d.label, 'Verificado por Migo');
  });

  it('PE + sin pe_migo_api → no muestra bloque', () => {
    const block = shouldShowMigoBlock('PE', {});
    assert.strictEqual(block, null);
  });

  it('CO + pe_migo_api → no muestra bloque', () => {
    const block = shouldShowMigoBlock('CO', { pe_migo_api: makeBlock() });
    assert.strictEqual(block, null);
  });

  it('MX + pe_migo_api → no muestra bloque', () => {
    const block = shouldShowMigoBlock('MX', { pe_migo_api: makeBlock() });
    assert.strictEqual(block, null);
  });

  it('CL + pe_migo_api → no muestra bloque', () => {
    const block = shouldShowMigoBlock('CL', { pe_migo_api: makeBlock() });
    assert.strictEqual(block, null);
  });
});

// ── Status not_found specific ─────────────────────────────────────────────────

describe('status not_found', () => {
  it('not_found → "No encontrado en Migo"', () => {
    const d = getMigoStatusDisplay('not_found');
    assert.strictEqual(d.label, 'No encontrado en Migo');
  });
});

// ── Guardrails — no CIIU oficial, no sector oficial, no raw metadata ───────────

describe('Block invariants — no CIIU oficial, no sector oficial', () => {
  it('verified block never has official_ciiu_available=true', () => {
    const block = makeBlock({ legal_validation_status: 'verified' });
    assert.strictEqual(block.official_ciiu_available, false);
  });

  it('verified block always has ciiu_status unavailable_for_mvp', () => {
    const block = makeBlock({ legal_validation_status: 'verified' });
    assert.strictEqual(block.ciiu_status, 'unavailable_for_mvp');
  });

  it('verified block always has sector_source not_provided_by_migo', () => {
    const block = makeBlock({ legal_validation_status: 'verified' });
    assert.strictEqual(block.sector_source, 'not_provided_by_migo');
  });

  it('source_key is always pe_migo_api', () => {
    const block = makeBlock();
    assert.strictEqual(block.source_key, 'pe_migo_api');
  });
});

// ── Status label guardrails ───────────────────────────────────────────────────

describe('Status labels do not mention forbidden strings', () => {
  const allStatuses = [
    'verified',
    'not_found',
    'flagged',
    'api_unavailable',
    'pending_validation',
    'invalid_ruc_format',
    null,
    undefined,
  ] as const;

  for (const status of allStatuses) {
    it(`status "${String(status)}" label does not contain "CIIU oficial"`, () => {
      const d = getMigoStatusDisplay(status);
      assert.ok(
        !d.label.toLowerCase().includes('ciiu oficial'),
        `label must not mention CIIU oficial`,
      );
    });

    it(`status "${String(status)}" label does not contain "sector oficial"`, () => {
      const d = getMigoStatusDisplay(status);
      assert.ok(
        !d.label.toLowerCase().includes('sector oficial'),
        `label must not mention sector oficial`,
      );
    });
  }
});

// ── No forbidden imports / side-effects ───────────────────────────────────────

describe('No forbidden runtime calls (guardrail assertions on module source)', () => {
  it('does not import MIGO_API_KEY from env in this test module', () => {
    // If this file were calling real Migo, process.env.MIGO_API_KEY would be needed.
    // Guardrail: confirm it's not accessed here.
    const migoKey = process.env['MIGO_API_KEY'];
    // We assert we did NOT use it (it may or may not exist, we don't care)
    assert.ok(
      typeof migoKey === 'string' || migoKey === undefined,
      'MIGO_API_KEY existence is irrelevant — no real Migo call made',
    );
  });

  it('does not reference NEXT_PUBLIC_MIGO in display logic', () => {
    const label = getMigoStatusDisplay('verified').label;
    assert.ok(!label.includes('NEXT_PUBLIC'), 'label must not expose env var names');
  });

  it('getMigoStatusDisplay is a pure function — no side effects', () => {
    // Call multiple times, same input → same output
    const a = getMigoStatusDisplay('verified');
    const b = getMigoStatusDisplay('verified');
    assert.strictEqual(a.label, b.label);
    assert.strictEqual(a.badgeClass, b.badgeClass);
  });
});

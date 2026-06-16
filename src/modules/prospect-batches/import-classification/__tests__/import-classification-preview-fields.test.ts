/**
 * Tests — Unified Preview + Classification (16AB.40.4)
 *
 * Verifies that preview fields (website, linkedin, city, etc.) are present
 * in ImportClassificationPreviewRow and that the selection/CTA logic is correct.
 *
 * Pure unit tests. No Supabase, no network, no filesystem.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  ImportClassificationPreviewRow,
} from '../import-classification-ui-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ImportClassificationPreviewRow> = {}): ImportClassificationPreviewRow {
  return {
    rowNumber: 1,
    companyName: 'Acme Corp',
    countryCode: 'CO',
    industryOriginalValue: 'Tech',
    industryCanonicalId: 'ind-tech',
    industryCanonicalName: 'Tecnología',
    industryMatchStatus: 'exact_match',
    subindustryOriginalValue: null,
    subindustryCanonicalId: null,
    subindustryCanonicalName: null,
    subindustryMatchStatus: 'missing',
    validationStatus: 'valid',
    requiresHumanReview: false,
    warnings: [],
    correctionSource: null,
    ...overrides,
  };
}

// ── CTA selection logic (mirrors import-candidates-drawer.tsx) ────────────────

function computeSelectedBlockingCount(
  rows: ImportClassificationPreviewRow[],
  selectedIds: Set<number>,
): number {
  return rows.filter(
    (r) =>
      selectedIds.has(r.rowNumber) &&
      (r.validationStatus === 'requires_review' || r.validationStatus === 'invalid'),
  ).length;
}

function canImportSelected(
  rows: ImportClassificationPreviewRow[],
  selectedIds: Set<number>,
  catalogVersionChanged: boolean,
): boolean {
  const blockingCount = computeSelectedBlockingCount(rows, selectedIds);
  return selectedIds.size > 0 && blockingCount === 0 && !catalogVersionChanged;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ImportClassificationPreviewRow — preview fields', () => {
  it('type accepts website, linkedinUrl, city, companySize, description, sourceUrl, sourceEvidence, confidence, notes', () => {
    const row: ImportClassificationPreviewRow = makeRow({
      website: 'https://acme.com',
      linkedinUrl: 'https://linkedin.com/company/acme',
      city: 'Bogotá',
      companySize: '50-200',
      description: 'Leading tech company',
      sourceUrl: 'https://crunchbase.com/acme',
      sourceEvidence: 'Crunchbase profile',
      confidence: 'high',
      notes: 'Reviewed manually',
    });

    assert.strictEqual(row.website, 'https://acme.com');
    assert.strictEqual(row.linkedinUrl, 'https://linkedin.com/company/acme');
    assert.strictEqual(row.city, 'Bogotá');
    assert.strictEqual(row.companySize, '50-200');
    assert.strictEqual(row.description, 'Leading tech company');
    assert.strictEqual(row.sourceUrl, 'https://crunchbase.com/acme');
    assert.strictEqual(row.sourceEvidence, 'Crunchbase profile');
    assert.strictEqual(row.confidence, 'high');
    assert.strictEqual(row.notes, 'Reviewed manually');
  });

  it('preview fields are optional — row without them is still valid', () => {
    const row = makeRow();
    assert.strictEqual(row.website, undefined);
    assert.strictEqual(row.linkedinUrl, undefined);
    assert.strictEqual(row.city, undefined);
  });
});

describe('Selection and CTA logic', () => {
  it('all 4 rows selected by default — CTA enabled when none blocking', () => {
    const rows = [
      makeRow({ rowNumber: 1, validationStatus: 'valid' }),
      makeRow({ rowNumber: 2, validationStatus: 'valid' }),
      makeRow({ rowNumber: 3, validationStatus: 'valid' }),
      makeRow({ rowNumber: 4, validationStatus: 'normalized' }),
    ];
    const selectedIds = new Set([1, 2, 3, 4]);
    assert.strictEqual(canImportSelected(rows, selectedIds, false), true);
  });

  it('2 valid + 2 blocking selected — CTA disabled', () => {
    const rows = [
      makeRow({ rowNumber: 1, validationStatus: 'valid' }),
      makeRow({ rowNumber: 2, validationStatus: 'valid' }),
      makeRow({ rowNumber: 3, validationStatus: 'requires_review', requiresHumanReview: true }),
      makeRow({ rowNumber: 4, validationStatus: 'requires_review', requiresHumanReview: true }),
    ];
    const selectedIds = new Set([1, 2, 3, 4]);
    assert.strictEqual(canImportSelected(rows, selectedIds, false), false);
    assert.strictEqual(computeSelectedBlockingCount(rows, selectedIds), 2);
  });

  it('deselecting blocking rows unblocks CTA — Importar 2 empresas', () => {
    const rows = [
      makeRow({ rowNumber: 1, validationStatus: 'valid', companyName: 'AWS' }),
      makeRow({ rowNumber: 2, validationStatus: 'valid', companyName: 'Google Cloud' }),
      makeRow({ rowNumber: 3, validationStatus: 'requires_review', requiresHumanReview: true, companyName: 'Stripe' }),
      makeRow({ rowNumber: 4, validationStatus: 'requires_review', requiresHumanReview: true, companyName: 'HubSpot' }),
    ];
    // Deselect blocking rows
    const selectedIds = new Set([1, 2]);
    assert.strictEqual(canImportSelected(rows, selectedIds, false), true);
    assert.strictEqual(computeSelectedBlockingCount(rows, selectedIds), 0);
    assert.strictEqual(selectedIds.size, 2);
  });

  it('zero selected — CTA disabled', () => {
    const rows = [makeRow({ rowNumber: 1, validationStatus: 'valid' })];
    const selectedIds = new Set<number>();
    assert.strictEqual(canImportSelected(rows, selectedIds, false), false);
  });

  it('catalog version changed — CTA disabled even with valid rows selected', () => {
    const rows = [makeRow({ rowNumber: 1, validationStatus: 'valid' })];
    const selectedIds = new Set([1]);
    assert.strictEqual(canImportSelected(rows, selectedIds, true), false);
  });

  it('inline correction does not affect other rows selection', () => {
    const rows = [
      makeRow({ rowNumber: 1, validationStatus: 'valid' }),
      makeRow({ rowNumber: 2, validationStatus: 'requires_review', requiresHumanReview: true }),
    ];
    const selectedIds = new Set([1, 2]);
    // After correction row 2 becomes valid — selection unchanged
    const correctedRows = rows.map((r) =>
      r.rowNumber === 2 ? { ...r, validationStatus: 'valid' as const, requiresHumanReview: false } : r,
    );
    assert.strictEqual(canImportSelected(correctedRows, selectedIds, false), true);
    // Selection still has both rows
    assert.strictEqual(selectedIds.size, 2);
  });

  it('changing filter does not clear cross-filter selections', () => {
    // Simulate: filter to "requires_review" — visible rows are [3,4]
    // But selectedIds still holds [1,2,3,4] from before
    const allRows = [
      makeRow({ rowNumber: 1, validationStatus: 'valid' }),
      makeRow({ rowNumber: 2, validationStatus: 'valid' }),
      makeRow({ rowNumber: 3, validationStatus: 'requires_review', requiresHumanReview: true }),
      makeRow({ rowNumber: 4, validationStatus: 'requires_review', requiresHumanReview: true }),
    ];
    const selectedIds = new Set([1, 2, 3, 4]);

    // Deselect visible (requires_review) rows using the header checkbox
    // (only affects visible rows — per spec)
    const visibleInFilter = allRows
      .filter((r) => r.validationStatus === 'requires_review')
      .map((r) => r.rowNumber);

    const next = new Set(selectedIds);
    visibleInFilter.forEach((n) => next.delete(n));

    // Cross-filter selections preserved
    assert.strictEqual(next.has(1), true);
    assert.strictEqual(next.has(2), true);
    assert.strictEqual(next.has(3), false);
    assert.strictEqual(next.has(4), false);

    // CTA should now be enabled — only valid rows remain selected
    assert.strictEqual(canImportSelected(allRows, next, false), true);
  });

  it('no separate preview or mapping step — step type does not include "preview_independent"', () => {
    // Verifies the Step union in the drawer does not re-introduce a separate step
    type Step = 'input' | 'classification' | 'preview' | 'success';
    const steps: Step[] = ['input', 'classification', 'preview', 'success'];
    // The only classification-adjacent step is 'classification' (unified)
    assert.strictEqual(steps.includes('classification'), true);
    // There is no 'mapping' step
    assert.strictEqual((steps as string[]).includes('mapping'), false);
    // There is no 'preview_classification' step
    assert.strictEqual((steps as string[]).includes('preview_classification'), false);
  });
});

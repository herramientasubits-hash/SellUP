/**
 * Tests — Backend Integration (16AB.39)
 *
 * Sections:
 *   L — Classification Service (classifyImportRows)
 *   M — Payload Builder (buildImportPersistencePayload)
 *   N — API Response Contracts
 *   O — Legacy Compatibility
 *   P — Security Constraints
 *   Q — Edge Cases
 *
 * Pure unit tests. No Supabase, no network, no filesystem.
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyImportRows } from '../../import-classification-service';
import {
  buildImportPersistencePayload,
  isPayloadJsonSafe,
} from '../../import-classification-payload-builder';
import type { ImportRow } from '../../import-candidates-parser';
import type {
  ImportClassificationCatalog,
} from '../import-classification-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_CATALOG: ImportClassificationCatalog = {
  version: '1.0.0',
  industries: [
    { id: 'ind-tech', name: 'Tecnología', slug: 'tecnologia', active: true },
    { id: 'ind-health', name: 'Salud y Healthcare', slug: 'salud-y-healthcare', active: true },
    { id: 'ind-fin', name: 'Servicios Financieros', slug: 'servicios-financieros', active: true },
    { id: 'ind-edu', name: 'Educación y EdTech', slug: 'educacion-y-edtech', active: true },
  ],
  subindustries: [
    {
      id: 'sub-cyber', industryId: 'ind-tech', name: 'Ciberseguridad',
      slug: 'ciberseguridad', applicableCountries: null, active: true,
    },
    {
      id: 'sub-saas', industryId: 'ind-tech', name: 'SaaS Empresarial',
      slug: 'saas-empresarial', applicableCountries: null, active: true,
    },
    {
      id: 'sub-plano', industryId: 'ind-health', name: 'Plano de Saúde',
      slug: 'plano-de-saude', applicableCountries: ['BR'], active: true,
    },
    {
      id: 'sub-seguro', industryId: 'ind-health', name: 'Seguro Médico',
      slug: 'seguro-medico', applicableCountries: null, active: true,
    },
    {
      id: 'sub-fintech', industryId: 'ind-fin', name: 'Fintech Pagos',
      slug: 'fintech-pagos', applicableCountries: null, active: true,
    },
  ],
  aliases: [
    { id: 'ali-1', subindustryId: 'sub-cyber', alias: 'Cyber Security', languageCode: 'en', countryCode: null, active: true },
    { id: 'ali-2', subindustryId: 'sub-cyber', alias: 'Cybersecurity', languageCode: 'en', countryCode: null, active: true },
  ],
};

const CATALOG_VERSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeRow(overrides: Partial<ImportRow> & { index: number }): ImportRow {
  return {
    raw: {
      company_name: 'Test Company',
      country: 'Chile',
      country_code: 'CL',
      website: 'https://test.com',
      industry: 'Tecnología',
      subindustry: undefined,
      city: 'Santiago',
      region: 'Metropolitana',
      tax_identifier: '123456789-0',
      tax_identifier_type: 'RUT',
      linkedin_url: undefined,
      company_size: undefined,
      description: undefined,
      notes: undefined,
      source_url: undefined,
      contact_name: undefined,
      contact_role: undefined,
      contact_email: undefined,
      owner_email: undefined,
      source_evidence: undefined,
      confidence: undefined,
    },
    status: 'valid',
    errors: [],
    warnings: [],
    resolved_country_code: 'CL',
    country_from_default: false,
    industry_from_default: false,
    industryOriginalValue: 'Tecnología',
    subindustryOriginalValue: null,
    ...overrides,
  };
}

// ── Section L — Classification Service ────────────────────────────────────────

describe('Section L — classifyImportRows', () => {
  it('L1: exact match industry with no subindustry → valid, warning status', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: null })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, true);
    assert.equal(result.catalogVersion, '1.0.0');
    assert.equal(result.catalogVersionId, CATALOG_VERSION_ID);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].classification.industryMatchStatus, 'exact_match');
    assert.equal(result.rows[0].classification.subindustryMatchStatus, 'missing');
    assert.equal(result.rows[0].validationStatus, 'warning');
    assert.equal(result.rows[0].canPersistAutomatically, true);
    assert.equal(result.summary.totalRows, 1);
    assert.equal(result.summary.warningRows, 1);
    assert.equal(result.blockingIssues.length, 0);
  });

  it('L2: exact match industry + exact match subindustry → valid', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, true);
    assert.equal(result.rows[0].validationStatus, 'valid');
    assert.equal(result.rows[0].canPersistAutomatically, true);
    assert.equal(result.rows[0].classification.industryId, 'ind-tech');
    assert.equal(result.rows[0].classification.subindustryId, 'sub-cyber');
    assert.equal(result.summary.readyRows, 1);
  });

  it('L3: alias match subindustry → normalized status', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Cyber Security' })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, true);
    assert.equal(result.rows[0].validationStatus, 'normalized');
    assert.equal(result.rows[0].canPersistAutomatically, true);
    assert.equal(result.rows[0].classification.subindustryMatchStatus, 'alias_match');
    assert.equal(result.summary.normalizedRows, 1);
  });

  it('L4: not_found industry → requires_review, valid=false', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Industria Fantasma', subindustryOriginalValue: null })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, false);
    assert.equal(result.rows[0].validationStatus, 'requires_review');
    assert.equal(result.rows[0].canPersistAutomatically, false);
    assert.equal(result.summary.reviewRows, 1);
    assert.ok(result.blockingIssues.length > 0);
  });

  it('L5: wrong_industry (subindustry belongs to different industry) → requires_review', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Seguro Médico' })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, false);
    assert.equal(result.rows[0].validationStatus, 'requires_review');
    assert.equal(result.rows[0].canPersistAutomatically, false);
    assert.equal(result.rows[0].classification.subindustryMatchStatus, 'wrong_industry');
  });

  it('L6: not_applicable_to_country → requires_review', () => {
    const rows = [makeRow({
      index: 0,
      industryOriginalValue: 'Salud y Healthcare',
      subindustryOriginalValue: 'Plano de Saúde',
      resolved_country_code: 'CO',
    })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, false);
    assert.equal(result.rows[0].validationStatus, 'requires_review');
    assert.equal(result.rows[0].classification.subindustryMatchStatus, 'not_applicable_to_country');
  });

  it('L7: subindustry absent is valid (not a blocking issue)', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: null })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, true);
    assert.equal(result.rows[0].canPersistAutomatically, true);
  });

  it('L8: preserves original row order', () => {
    const rows = [
      makeRow({ index: 0, industryOriginalValue: 'Salud y Healthcare', subindustryOriginalValue: null }),
      makeRow({ index: 1, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' }),
      makeRow({ index: 2, industryOriginalValue: 'Educación y EdTech', subindustryOriginalValue: null }),
    ];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.rows[0].rowNumber, 1);
    assert.equal(result.rows[0].classification.industryOriginalValue, 'Salud y Healthcare');
    assert.equal(result.rows[1].rowNumber, 2);
    assert.equal(result.rows[1].classification.industryOriginalValue, 'Tecnología');
    assert.equal(result.rows[2].rowNumber, 3);
    assert.equal(result.rows[2].classification.industryOriginalValue, 'Educación y EdTech');
  });

  it('L9: one failing row blocks entire batch', () => {
    const rows = [
      makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' }),
      makeRow({ index: 1, industryOriginalValue: 'Fantasma Total', subindustryOriginalValue: null }),
      makeRow({ index: 2, industryOriginalValue: 'Salud y Healthcare', subindustryOriginalValue: null }),
    ];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, false);
    assert.equal(result.summary.totalRows, 3);
    assert.equal(result.summary.readyRows, 1);
    assert.equal(result.summary.warningRows, 1);
    assert.equal(result.summary.reviewRows, 1);
    assert.ok(result.blockingIssues.some((i) => i.rowNumber === 2));
  });

  it('L10: summary counts are correct for mixed batch', () => {
    const rows = [
      makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' }),  // valid
      makeRow({ index: 1, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Cyber Security' }),   // normalized
      makeRow({ index: 2, industryOriginalValue: 'Tecnología', subindustryOriginalValue: null }),               // warning
      makeRow({ index: 3, industryOriginalValue: 'Fantasma', subindustryOriginalValue: null }),                 // requires_review
    ];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.summary.totalRows, 4);
    assert.equal(result.summary.readyRows, 1);
    assert.equal(result.summary.normalizedRows, 1);
    assert.equal(result.summary.warningRows, 1);
    assert.equal(result.summary.reviewRows, 1);
    assert.equal(result.summary.invalidRows, 0);
  });

  it('L11: empty batch produces valid result with zero rows', () => {
    const result = classifyImportRows({ rows: [], catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, true);
    assert.equal(result.summary.totalRows, 0);
    assert.equal(result.rows.length, 0);
    assert.equal(result.blockingIssues.length, 0);
  });
});

// ── Section M — Payload Builder ───────────────────────────────────────────────

describe('Section M — buildImportPersistencePayload', () => {
  it('M1: batch contains catalog_version', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    assert.equal(payload.batch.catalog_version, '1.0.0');
  });

  it('M2: candidate has catalog_version_id', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    const candidate = payload.candidates.get(1);
    assert.ok(candidate);
    assert.equal(candidate.catalog_version_id, CATALOG_VERSION_ID);
  });

  it('M3: candidate has industry_id from classification', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    const candidate = payload.candidates.get(1);
    assert.ok(candidate);
    assert.equal(candidate.industry_id, 'ind-tech');
  });

  it('M4: candidate has subindustry_id from classification', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    const candidate = payload.candidates.get(1);
    assert.ok(candidate);
    assert.equal(candidate.subindustry_id, 'sub-cyber');
  });

  it('M5: candidate subindustry is canonical name (not original value)', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Cyber Security' })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    const candidate = payload.candidates.get(1);
    assert.ok(candidate);
    assert.equal(candidate.subindustry, 'Ciberseguridad'); // canonical, not "Cyber Security"
  });

  it('M6: import_classification contains original values', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Cyber Security' })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    const candidate = payload.candidates.get(1);
    assert.ok(candidate);
    assert.ok(candidate.import_classification);
    assert.equal(candidate.import_classification.industryOriginalValue, 'Tecnología');
    assert.equal(candidate.import_classification.subindustryOriginalValue, 'Cyber Security');
  });

  it('M7: null subindustry produces null subindustry_id and null subindustry name', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: null })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    const candidate = payload.candidates.get(1);
    assert.ok(candidate);
    assert.equal(candidate.subindustry_id, null);
    assert.equal(candidate.subindustry, null);
    assert.equal(candidate.import_classification?.subindustryOriginalValue, null);
  });

  it('M8: no payload generated when valid=false (all rows require review)', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Fantasma', subindustryOriginalValue: null })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    assert.equal(payload.candidates.size, 0);
    assert.equal(payload.persistableCandidates, 0);
    assert.equal(payload.totalCandidates, 1);
  });

  it('M9: mixed batch — only valid rows get payloads', () => {
    const rows = [
      makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' }),
      makeRow({ index: 1, industryOriginalValue: 'Fantasma', subindustryOriginalValue: null }),
    ];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    assert.equal(payload.candidates.size, 1); // only row 1
    assert.equal(payload.persistableCandidates, 1);
    assert.equal(payload.totalCandidates, 2);
    assert.ok(payload.candidates.has(1));
    assert.ok(!payload.candidates.has(2));
  });

  it('M10: payload is JSON-serializable', () => {
    const rows = [
      makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' }),
      makeRow({ index: 1, industryOriginalValue: 'Tecnología', subindustryOriginalValue: null }),
    ];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    assert.equal(isPayloadJsonSafe(payload), true);

    // Verify actual serialization works
    const serialized = JSON.stringify(payload);
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.batch.catalog_version, '1.0.0');
  });

  it('M11: import_classification has correct structure for SQL constraints', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    const candidate = payload.candidates.get(1);
    assert.ok(candidate);
    assert.ok(candidate.import_classification);

    const ic = candidate.import_classification;
    // Must be an object (pc_import_classification_is_object)
    assert.equal(typeof ic, 'object');
    // requiresHumanReview must be boolean (pc_classification_review_bool)
    assert.equal(typeof ic.requiresHumanReview, 'boolean');
    // classificationWarnings must be array (pc_classification_warnings_array)
    assert.ok(Array.isArray(ic.classificationWarnings));
    // catalogVersion must be present
    assert.equal(ic.catalogVersion, '1.0.0');
  });
});

// ── Section N — API Response Contracts ────────────────────────────────────────

describe('Section N — API response contracts', () => {
  it('N1: valid classification produces success-like shape', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(classification.valid, true);
    assert.equal(classification.catalogVersion, '1.0.0');
    assert.equal(classification.catalogVersionId, CATALOG_VERSION_ID);
    assert.ok(classification.summary);
    assert.ok(Array.isArray(classification.rows));
    assert.ok(Array.isArray(classification.blockingIssues));
  });

  it('N2: review-required classification produces review shape', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Fantasma', subindustryOriginalValue: null })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(classification.valid, false);
    assert.ok(classification.blockingIssues.length > 0);
    assert.ok(classification.rows[0].classification.requiresHumanReview);
  });

  it('N3: each classified row has required fields', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: null })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    const row = classification.rows[0];
    assert.equal(typeof row.rowNumber, 'number');
    assert.ok(row.parsedRow);
    assert.ok(row.classification);
    assert.ok(row.validationStatus);
    assert.equal(typeof row.canPersistAutomatically, 'boolean');
  });

  it('N4: blocking issues have rowNumber, code, field, message', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Fantasma', subindustryOriginalValue: null })];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    for (const issue of classification.blockingIssues) {
      assert.equal(typeof issue.rowNumber, 'number');
      assert.equal(typeof issue.code, 'string');
      assert.equal(typeof issue.field, 'string');
      assert.equal(typeof issue.message, 'string');
    }
  });
});

// ── Section O — Legacy Compatibility ──────────────────────────────────────────

describe('Section O — legacy compatibility', () => {
  it('O1: file with only Sector (industry) and no Subindustria → valid', () => {
    const rows = [makeRow({
      index: 0,
      industryOriginalValue: 'Tecnología',
      subindustryOriginalValue: null,
      raw: {
        company_name: 'Legacy Corp',
        country: 'Chile',
        country_code: 'CL',
        website: 'https://legacy.cl',
        industry: 'Tecnología',
        subindustry: undefined,
      } as ImportRow['raw'],
    })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, true);
    assert.equal(result.rows[0].classification.industryMatchStatus, 'exact_match');
    assert.equal(result.rows[0].classification.subindustryMatchStatus, 'missing');
    assert.equal(result.rows[0].canPersistAutomatically, true);
  });

  it('O2: legacy sector not in catalog → requires_review', () => {
    const rows = [makeRow({
      index: 0,
      industryOriginalValue: 'Sector Legacy Inexistente',
      subindustryOriginalValue: null,
    })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, false);
    assert.equal(result.rows[0].classification.industryMatchStatus, 'not_found');
    assert.equal(result.summary.reviewRows, 1);
  });

  it('O3: empty industry and subindustry → warning (not blocking)', () => {
    const rows = [makeRow({
      index: 0,
      industryOriginalValue: null,
      subindustryOriginalValue: null,
    })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, true);
    assert.equal(result.rows[0].validationStatus, 'warning');
    assert.equal(result.rows[0].canPersistAutomatically, true);
  });
});

// ── Section P — Security Constraints ──────────────────────────────────────────

describe('Section P — security constraints', () => {
  it('P1: CSV formula injection in industry → not_found (not executed)', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: '=1+1', subindustryOriginalValue: null })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.rows[0].classification.industryMatchStatus, 'not_found');
    assert.equal(result.rows[0].classification.industryId, null);
  });

  it('P2: HTML in industry → not_found (not rendered)', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: '<script>alert(1)</script>', subindustryOriginalValue: null })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.rows[0].classification.industryMatchStatus, 'not_found');
  });

  it('P3: control characters stripped → valid match if canonical', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología\x00\x1F', subindustryOriginalValue: null })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.rows[0].classification.industryMatchStatus, 'exact_match');
    assert.equal(result.rows[0].classification.industryId, 'ind-tech');
  });

  it('P4: payload contains no Map, Set, or functions', () => {
    const rows = [
      makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' }),
      makeRow({ index: 1, industryOriginalValue: 'Fantasma', subindustryOriginalValue: null }),
    ];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    // The payload.candidates is a Map, but the serialized form should not contain Maps
    const serialized = JSON.stringify({
      batch: payload.batch,
      candidates: Object.fromEntries(payload.candidates),
    });
    assert.ok(!serialized.includes('Map'));
    assert.ok(!serialized.includes('Set'));
    assert.ok(!serialized.includes('function'));
  });
});

// ── Section Q — Edge Cases ────────────────────────────────────────────────────

describe('Section Q — edge cases', () => {
  it('Q1: very long industry value → truncated, may not match', () => {
    const longValue = 'A'.repeat(300);
    const rows = [makeRow({ index: 0, industryOriginalValue: longValue, subindustryOriginalValue: null })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    // Truncated value won't match any catalog entry
    assert.equal(result.rows[0].classification.industryMatchStatus, 'not_found');
    assert.ok(result.rows[0].classification.classificationWarnings.some((w) => w.code === 'VALUE_TRUNCATED'));
  });

  it('Q2: whitespace-only industry → missing', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: '   ', subindustryOriginalValue: null })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.rows[0].classification.industryMatchStatus, 'missing');
  });

  it('Q3: case-insensitive match works', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'TECNOLOGÍA', subindustryOriginalValue: null })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.rows[0].classification.industryMatchStatus, 'exact_match');
    assert.equal(result.rows[0].classification.industryId, 'ind-tech');
  });

  it('Q4: multiple rows with same classification → independent payloads', () => {
    const rows = [
      makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' }),
      makeRow({ index: 1, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Ciberseguridad' }),
    ];
    const classification = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });
    const payload = buildImportPersistencePayload(classification);

    assert.equal(payload.candidates.size, 2);
    const c1 = payload.candidates.get(1);
    const c2 = payload.candidates.get(2);
    assert.ok(c1);
    assert.ok(c2);
    assert.equal(c1.industry_id, 'ind-tech');
    assert.equal(c2.industry_id, 'ind-tech');
    // They should be independent objects
    assert.notEqual(c1, c2);
  });

  it('Q5: subindustry not found but industry valid → requires_review', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Tecnología', subindustryOriginalValue: 'Subindustria Fantasma' })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, false);
    assert.equal(result.rows[0].classification.subindustryMatchStatus, 'not_found');
    assert.equal(result.rows[0].validationStatus, 'requires_review');
  });

  it('Q6: normalized match (no accent) → normalized status', () => {
    const rows = [makeRow({ index: 0, industryOriginalValue: 'Educacion y EdTech', subindustryOriginalValue: null })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.rows[0].classification.industryMatchStatus, 'normalized_match');
    assert.equal(result.rows[0].validationStatus, 'normalized');
    assert.equal(result.rows[0].canPersistAutomatically, true);
  });

  it('Q7: country-applicable subindustry with correct country → valid', () => {
    const rows = [makeRow({
      index: 0,
      industryOriginalValue: 'Salud y Healthcare',
      subindustryOriginalValue: 'Plano de Saúde',
      resolved_country_code: 'BR',
    })];
    const result = classifyImportRows({ rows, catalog: MOCK_CATALOG, catalogVersionId: CATALOG_VERSION_ID });

    assert.equal(result.valid, true);
    assert.equal(result.rows[0].classification.subindustryId, 'sub-plano');
    assert.equal(result.rows[0].canPersistAutomatically, true);
  });
});

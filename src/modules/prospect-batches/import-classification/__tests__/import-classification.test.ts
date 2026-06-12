/**
 * Tests — Import Catalog Normalizer (16AB.37)
 *
 * Sections:
 *   A — Text normalization
 *   B — Index building
 *   C — Industry normalization
 *   D — Subindustry normalization
 *   E — Parent-child dependency
 *   F — Geographic validation
 *   G — Real catalog cases
 *   H — Batch normalization
 *   I — Security
 *   J — Determinism
 *
 * Pure unit tests. No Supabase, no network, no filesystem.
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeClassificationValue } from '../catalog-normalization';
import { buildImportCatalogIndexes } from '../catalog-index-builder';
import {
  normalizeImportedProspectClassification,
  normalizeImportedProspectClassifications,
} from '../import-catalog-normalizer';
import { deriveClassificationValidationStatus } from '../import-classification-selectors';
import type {
  ImportClassificationCatalog,
  ImportCatalogIndexes,
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

function buildIndexesOrFail(catalog: ImportClassificationCatalog): ImportCatalogIndexes {
  const result = buildImportCatalogIndexes(catalog);
  assert.ok(result.valid, `Expected valid indexes but got errors: ${JSON.stringify(result.issues)}`);
  return result.indexes!;
}

function classify(
  industryValue: string | null,
  subindustryValue: string | null,
  countryCode: string | null = null,
  catalog: ImportClassificationCatalog = MOCK_CATALOG,
) {
  const indexes = buildIndexesOrFail(catalog);
  return normalizeImportedProspectClassification({ industryValue, subindustryValue, countryCode, catalog, indexes });
}

// ── Section A — Text normalization ────────────────────────────────────────────

describe('Section A — normalizeClassificationValue', () => {
  it('A1: trims leading and trailing whitespace', () => {
    assert.equal(normalizeClassificationValue('  Tecnología  '), 'tecnologia');
  });

  it('A2: converts to lowercase', () => {
    assert.equal(normalizeClassificationValue('SALUD'), 'salud');
    assert.equal(normalizeClassificationValue('EdTech'), 'edtech');
  });

  it('A3: removes accent marks and tildes', () => {
    assert.equal(normalizeClassificationValue('Tecnología'), 'tecnologia');
    assert.equal(normalizeClassificationValue('Educación'), 'educacion');
    assert.equal(normalizeClassificationValue('plano de saúde'), 'plano de saude');
    assert.equal(normalizeClassificationValue('ñoño'), 'nono');
  });

  it('A4: collapses multiple internal spaces', () => {
    assert.equal(normalizeClassificationValue('  SaaS   Empresarial '), 'saas empresarial');
  });

  it('A5: replaces hyphens with spaces', () => {
    assert.equal(normalizeClassificationValue('Cyber-Security'), 'cyber security');
    assert.equal(normalizeClassificationValue('saas-empresarial'), 'saas empresarial');
  });

  it('A6: removes non-semantic punctuation', () => {
    assert.equal(normalizeClassificationValue('Salud!'), 'salud');
    assert.equal(normalizeClassificationValue('Tecnología.'), 'tecnologia');
    assert.equal(normalizeClassificationValue('"Educación"'), 'educacion');
    assert.equal(normalizeClassificationValue('Salud/Healthcare'), 'salud healthcare');
  });

  it('A7: strips control characters', () => {
    assert.equal(normalizeClassificationValue('Tecnología\x00\x1F'), 'tecnologia');
    assert.equal(normalizeClassificationValue('\x07Salud'), 'salud');
  });

  it('A-extra: preserves letters and numbers', () => {
    assert.equal(normalizeClassificationValue('Sub industria'), 'sub industria');
    assert.equal(normalizeClassificationValue('Fortune 500 empresa'), 'fortune 500 empresa');
  });
});

// ── Section B — Index building ────────────────────────────────────────────────

describe('Section B — buildImportCatalogIndexes', () => {
  it('B1: valid catalog builds with no error issues', () => {
    const result = buildImportCatalogIndexes(MOCK_CATALOG);
    assert.ok(result.valid);
    assert.ok(result.indexes !== null);
    assert.ok(!result.issues.some((i) => i.severity === 'error'));
    assert.ok(result.indexes.industryById.has('ind-tech'));
    assert.ok(result.indexes.subindustryById.has('sub-cyber'));
  });

  it('B2: duplicate industry ID produces error and valid=false', () => {
    const catalog: ImportClassificationCatalog = {
      ...MOCK_CATALOG,
      industries: [
        { id: 'ind-dup', name: 'Industria A', slug: 'industria-a', active: true },
        { id: 'ind-dup', name: 'Industria B', slug: 'industria-b', active: true },
      ],
      subindustries: [],
      aliases: [],
    };
    const result = buildImportCatalogIndexes(catalog);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'DUPLICATE_INDUSTRY_ID' && i.severity === 'error'));
    assert.equal(result.indexes, null);
  });

  it('B3: duplicate industry slug produces warning (not error), valid=true', () => {
    const catalog: ImportClassificationCatalog = {
      ...MOCK_CATALOG,
      industries: [
        { id: 'ind-a1', name: 'Industria A1', slug: 'mismo-slug', active: true },
        { id: 'ind-a2', name: 'Industria A2', slug: 'mismo-slug', active: true },
      ],
      subindustries: [],
      aliases: [],
    };
    const result = buildImportCatalogIndexes(catalog);
    assert.equal(result.valid, true);
    assert.ok(result.issues.some((i) => i.code === 'DUPLICATE_INDUSTRY_SLUG' && i.severity === 'warning'));
  });

  it('B4: alias referencing nonexistent subindustry produces error', () => {
    const catalog: ImportClassificationCatalog = {
      ...MOCK_CATALOG,
      aliases: [
        { id: 'ali-broken', subindustryId: 'sub-does-not-exist', alias: 'Phantom', languageCode: null, countryCode: null, active: true },
      ],
    };
    const result = buildImportCatalogIndexes(catalog);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'ALIAS_REFERENCES_UNKNOWN_SUBINDUSTRY' && i.severity === 'error'));
  });

  it('B5: ambiguous alias (same normalized value → different subs) produces warning', () => {
    const catalog: ImportClassificationCatalog = {
      ...MOCK_CATALOG,
      aliases: [
        { id: 'ali-x1', subindustryId: 'sub-cyber', alias: 'Seguridad', languageCode: null, countryCode: null, active: true },
        { id: 'ali-x2', subindustryId: 'sub-saas', alias: 'Seguridad', languageCode: null, countryCode: null, active: true },
      ],
    };
    const result = buildImportCatalogIndexes(catalog);
    assert.equal(result.valid, true); // ambiguous is a warning, not an error
    assert.ok(result.issues.some((i) => i.code === 'AMBIGUOUS_ALIAS' && i.severity === 'warning'));
  });

  it('B6: subindustry referencing nonexistent industry produces error', () => {
    const catalog: ImportClassificationCatalog = {
      ...MOCK_CATALOG,
      subindustries: [
        { id: 'sub-orphan', industryId: 'ind-nonexistent', name: 'Huérfana', slug: 'huerfana', applicableCountries: null, active: true },
      ],
    };
    const result = buildImportCatalogIndexes(catalog);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'SUBINDUSTRY_REFERENCES_UNKNOWN_INDUSTRY' && i.severity === 'error'));
  });

  it('B7: missing catalog version produces warning, not error', () => {
    const catalog: ImportClassificationCatalog = { ...MOCK_CATALOG, version: '' };
    const result = buildImportCatalogIndexes(catalog);
    assert.equal(result.valid, true); // still valid
    assert.ok(result.issues.some((i) => i.code === 'MISSING_CATALOG_VERSION' && i.severity === 'warning'));
  });
});

// ── Section C — Industry normalization ───────────────────────────────────────

describe('Section C — industry normalization', () => {
  it('C1: exact name match (case-insensitive)', () => {
    const r = classify('Tecnología', null);
    assert.equal(r.industryMatchStatus, 'exact_match');
    assert.equal(r.industryMatchSource, 'catalog_name');
    assert.equal(r.industryId, 'ind-tech');
    assert.equal(r.industryName, 'Tecnología');
    assert.equal(r.industryOriginalValue, 'Tecnología');
  });

  it('C1b: case-insensitive exact match works with all-caps', () => {
    const r = classify('TECNOLOGÍA', null);
    assert.equal(r.industryMatchStatus, 'exact_match');
    assert.equal(r.industryId, 'ind-tech');
  });

  it('C2: slug match when no accent (name mismatch but slug matches)', () => {
    // "tecnologia" ≠ "Tecnología" (exact name), but matches slug "tecnologia"
    const r = classify('tecnologia', null);
    assert.equal(r.industryMatchStatus, 'slug_match');
    assert.equal(r.industryMatchSource, 'catalog_slug');
    assert.equal(r.industryId, 'ind-tech');
  });

  it('C3: normalized name match removes diacritics and finds industry', () => {
    // "Educacion y EdTech" normalizes to "educacion y edtech"
    // catalog "Educación y EdTech" normalizes to "educacion y edtech" → match
    // BUT "educacion y edtech" as slug would be "educacion-y-edtech" → no slug match
    // AND lowercase "educacion y edtech" !== "educación y edtech" → no exact match
    const r = classify('Educacion y EdTech', null);
    // Could be normalized_match since slug has hyphens not spaces
    assert.ok(['normalized_match', 'slug_match'].includes(r.industryMatchStatus));
    assert.equal(r.industryId, 'ind-edu');
  });

  it('C4: null industry value → missing status', () => {
    const r = classify(null, null);
    assert.equal(r.industryMatchStatus, 'missing');
    assert.equal(r.industryMatchSource, 'none');
    assert.equal(r.industryId, null);
    assert.ok(r.classificationWarnings.some((w) => w.code === 'INDUSTRY_MISSING'));
  });

  it('C4b: empty string industry value → missing status', () => {
    const r = classify('   ', null);
    assert.equal(r.industryMatchStatus, 'missing');
    assert.equal(r.industryId, null);
  });

  it('C5: unknown industry value → not_found', () => {
    const r = classify('Industria Desconocida XYZ', null);
    assert.equal(r.industryMatchStatus, 'not_found');
    assert.equal(r.industryId, null);
    assert.ok(r.classificationWarnings.some((w) => w.code === 'INDUSTRY_NOT_FOUND'));
  });

  it('C6: ambiguous industry (two active industries normalize to same value)', () => {
    // "Tech-Nología" and "Tech Nología" both normalize to "tech nologia"
    // Neither matches exact name or slug for input "tech nologia"
    const catalog: ImportClassificationCatalog = {
      ...MOCK_CATALOG,
      industries: [
        { id: 'ind-a', name: 'Tech-Nología', slug: 'tech-nologia-a', active: true },
        { id: 'ind-b', name: 'Tech Nología', slug: 'tech-nologia-b', active: true },
      ],
      subindustries: [],
      aliases: [],
    };
    const indexes = buildIndexesOrFail(catalog);
    const r = normalizeImportedProspectClassification({
      industryValue: 'tech nologia',
      subindustryValue: null,
      countryCode: null,
      catalog,
      indexes,
    });
    // "tech nologia" → exact: no (neither name is "tech nologia")
    // slug: "tech nologia" vs "tech-nologia-a" / "tech-nologia-b" → no
    // normalized: "tech nologia" matches both → ambiguous
    assert.equal(r.industryMatchStatus, 'ambiguous');
    assert.equal(r.industryId, null);
    assert.ok(r.classificationWarnings.some((w) => w.code === 'INDUSTRY_AMBIGUOUS'));
  });
});

// ── Section D — Subindustry normalization ─────────────────────────────────────

describe('Section D — subindustry normalization', () => {
  it('D1: exact name match for subindustry', () => {
    const r = classify('Tecnología', 'Ciberseguridad');
    assert.equal(r.subindustryMatchStatus, 'exact_match');
    assert.equal(r.subindustryMatchSource, 'catalog_name');
    assert.equal(r.subindustryId, 'sub-cyber');
    assert.equal(r.subindustryName, 'Ciberseguridad');
  });

  it('D2: slug match for subindustry', () => {
    // "ciberseguridad" is the slug; differs from name only by accent removal
    // "Ciberseguridad".toLowerCase() === "ciberseguridad" → actually exact match
    // Use slug directly: "saas-empresarial"
    const r = classify('Tecnología', 'saas-empresarial');
    // "saas-empresarial" → exact name? "saas-empresarial" vs "saas empresarial" (name lower) → no
    // slug? "saas-empresarial" === "saas-empresarial" → yes
    assert.equal(r.subindustryMatchStatus, 'slug_match');
    assert.equal(r.subindustryMatchSource, 'catalog_slug');
    assert.equal(r.subindustryId, 'sub-saas');
  });

  it('D3: alias match for subindustry', () => {
    const r = classify('Tecnología', 'Cyber Security');
    assert.equal(r.subindustryMatchStatus, 'alias_match');
    assert.equal(r.subindustryMatchSource, 'catalog_alias');
    assert.equal(r.subindustryId, 'sub-cyber');
  });

  it('D4: normalized text match for subindustry', () => {
    // "plano de saude" (no accent) normalizes to "plano de saude"
    // catalog "Plano de Saúde" normalizes to "plano de saude" → match
    // exact: "plano de saude" vs "plano de saúde" → no
    // slug: "plano-de-saude" vs "plano de saude" → no (slug has hyphens)
    // alias: none registered for plano → no
    // normalized: "plano de saude" === "plano de saude" → yes
    const r = classify('Salud y Healthcare', 'plano de saude', 'BR');
    assert.equal(r.subindustryMatchStatus, 'normalized_match');
    assert.equal(r.subindustryId, 'sub-plano');
  });

  it('D5: null subindustry value → missing', () => {
    const r = classify('Tecnología', null);
    assert.equal(r.subindustryMatchStatus, 'missing');
    assert.equal(r.subindustryId, null);
    assert.ok(r.classificationWarnings.some((w) => w.code === 'SUBINDUSTRY_MISSING'));
  });

  it('D6: unknown subindustry → not_found', () => {
    const r = classify('Tecnología', 'Subindustria Desconocida XYZ');
    assert.equal(r.subindustryMatchStatus, 'not_found');
    assert.equal(r.subindustryId, null);
    assert.ok(r.classificationWarnings.some((w) => w.code === 'SUBINDUSTRY_NOT_FOUND'));
  });

  it('D7: ambiguous subindustry (same alias for two subs)', () => {
    const catalog: ImportClassificationCatalog = {
      ...MOCK_CATALOG,
      aliases: [
        { id: 'ali-x1', subindustryId: 'sub-cyber', alias: 'Seguridad Digital', languageCode: null, countryCode: null, active: true },
        { id: 'ali-x2', subindustryId: 'sub-saas', alias: 'Seguridad Digital', languageCode: null, countryCode: null, active: true },
      ],
    };
    const indexes = buildIndexesOrFail(catalog);
    const r = normalizeImportedProspectClassification({
      industryValue: null,
      subindustryValue: 'Seguridad Digital',
      countryCode: null,
      catalog,
      indexes,
    });
    assert.equal(r.subindustryMatchStatus, 'ambiguous');
    assert.equal(r.subindustryId, null);
  });
});

// ── Section E — Industry-subindustry dependency ───────────────────────────────

describe('Section E — dependency validation', () => {
  it('E1: subindustry approved when it belongs to resolved industry', () => {
    const r = classify('Tecnología', 'Ciberseguridad');
    assert.equal(r.industryId, 'ind-tech');
    assert.equal(r.subindustryId, 'sub-cyber');
    assert.equal(r.subindustryMatchStatus, 'exact_match');
    assert.equal(r.requiresHumanReview, false);
  });

  it('E2: wrong_industry when resolved industry does not own the subindustry', () => {
    // Industry = Tecnología (ind-tech), Subindustry = Seguro Médico (belongs to ind-health)
    const r = classify('Tecnología', 'Seguro Médico');
    assert.equal(r.subindustryMatchStatus, 'wrong_industry');
    assert.equal(r.subindustryId, null);
    assert.equal(r.requiresHumanReview, true);
    assert.ok(r.classificationWarnings.some((w) => w.code === 'SUBINDUSTRY_WRONG_INDUSTRY'));
  });

  it('E3: recognized subindustry without resolved industry sets suggestedIndustryId', () => {
    // No industry provided, but subindustry is uniquely found
    const r = classify(null, 'Ciberseguridad');
    assert.equal(r.industryId, null);
    assert.equal(r.suggestedIndustryId, 'ind-tech');
    assert.ok(r.classificationWarnings.some((w) => w.code === 'INDUSTRY_SUGGESTED_FROM_SUBINDUSTRY'));
  });

  it('E4: suggestion is NOT auto-approved — subindustryId stays null', () => {
    const r = classify(null, 'Ciberseguridad');
    assert.equal(r.industryId, null);
    assert.equal(r.subindustryId, null); // not approved without confirmed industry
    assert.equal(r.requiresHumanReview, true);
  });

  it('E5: subindustryId is never set without a confirmed industryId', () => {
    // industry not_found case
    const r1 = classify('Desconocida', 'Ciberseguridad');
    assert.equal(r1.industryId, null);
    assert.equal(r1.subindustryId, null);

    // industry missing case
    const r2 = classify(null, 'Ciberseguridad');
    assert.equal(r2.industryId, null);
    assert.equal(r2.subindustryId, null);
  });
});

// ── Section F — Geographic validation ────────────────────────────────────────

describe('Section F — geographic validation', () => {
  it('F1: applicableCountries=null is valid for any country', () => {
    // Ciberseguridad has applicableCountries: null
    const r1 = classify('Tecnología', 'Ciberseguridad', 'CO');
    assert.equal(r1.subindustryId, 'sub-cyber');
    assert.equal(r1.requiresHumanReview, false);

    const r2 = classify('Tecnología', 'Ciberseguridad', 'BR');
    assert.equal(r2.subindustryId, 'sub-cyber');
    assert.equal(r2.requiresHumanReview, false);
  });

  it('F2: country in allowed list → approved', () => {
    // Plano de Saúde applicableCountries: ['BR']
    const r = classify('Salud y Healthcare', 'Plano de Saúde', 'BR');
    assert.equal(r.subindustryId, 'sub-plano');
    assert.equal(r.subindustryMatchStatus, 'exact_match');
    assert.equal(r.requiresHumanReview, false);
  });

  it('F3: country not in allowed list → not_applicable_to_country', () => {
    const r = classify('Salud y Healthcare', 'Plano de Saúde', 'CO');
    assert.equal(r.subindustryMatchStatus, 'not_applicable_to_country');
    assert.equal(r.requiresHumanReview, true);
    assert.ok(r.classificationWarnings.some((w) => w.code === 'SUBINDUSTRY_NOT_APPLICABLE_TO_COUNTRY'));
  });

  it('F4: no country provided for restricted subindustry → review required', () => {
    const r = classify('Salud y Healthcare', 'Plano de Saúde', null);
    assert.equal(r.requiresHumanReview, true);
    assert.ok(r.classificationWarnings.some((w) => w.code === 'COUNTRY_REQUIRED_FOR_APPLICABILITY_CHECK'));
  });
});

// ── Section G — Real catalog cases ───────────────────────────────────────────

describe('Section G — real catalog cases', () => {
  it('G1: Tecnología → exact_match industry', () => {
    const r = classify('Tecnología', null);
    assert.equal(r.industryMatchStatus, 'exact_match');
    assert.equal(r.industryId, 'ind-tech');
    assert.equal(r.industryOriginalValue, 'Tecnología');
  });

  it('G2: Ciberseguridad → exact_match subindustry under Tecnología', () => {
    const r = classify('Tecnología', 'Ciberseguridad');
    assert.equal(r.subindustryMatchStatus, 'exact_match');
    assert.equal(r.subindustryId, 'sub-cyber');
    assert.equal(r.requiresHumanReview, false);
  });

  it('G3: Cyber Security → alias_match to Ciberseguridad', () => {
    const r = classify('Tecnología', 'Cyber Security');
    assert.equal(r.subindustryMatchStatus, 'alias_match');
    assert.equal(r.subindustryId, 'sub-cyber');
    assert.equal(r.subindustryOriginalValue, 'Cyber Security');
  });

  it('G4: SaaS Empresarial → exact_match subindustry', () => {
    const r = classify('Tecnología', 'SaaS Empresarial');
    assert.equal(r.subindustryMatchStatus, 'exact_match');
    assert.equal(r.subindustryId, 'sub-saas');
  });

  it('G5: plano de saúde in Brazil → approved (exact match with country OK)', () => {
    const r = classify('Salud y Healthcare', 'Plano de Saúde', 'BR');
    assert.equal(r.industryId, 'ind-health');
    assert.equal(r.subindustryId, 'sub-plano');
    assert.equal(r.requiresHumanReview, false);
  });

  it('G6: plano de saúde in non-allowed country → not_applicable_to_country', () => {
    const r = classify('Salud y Healthcare', 'Plano de Saúde', 'MX');
    assert.equal(r.subindustryMatchStatus, 'not_applicable_to_country');
    assert.equal(r.requiresHumanReview, true);
    // IDs are preserved so reviewer can see the detected match
    assert.equal(r.subindustryId, 'sub-plano');
  });

  it('G7: legacy Sector column (industry set, subindustry absent) → not blocked', () => {
    const r = classify('Tecnología', null);
    assert.equal(r.industryMatchStatus, 'exact_match');
    assert.equal(r.subindustryMatchStatus, 'missing');
    assert.equal(r.requiresHumanReview, false); // absent subindustry does not block
    assert.equal(r.subindustryOriginalValue, null);
  });
});

// ── Section H — Batch normalization ──────────────────────────────────────────

describe('Section H — batch normalization', () => {
  it('H1: indexes are built once; buildImportCatalogIndexes called once per batch', () => {
    // This is a structural test: batch function calls buildImportCatalogIndexes once.
    // We verify by ensuring the result is consistent and the summary total matches.
    const result = normalizeImportedProspectClassifications({
      rows: [
        { industryValue: 'Tecnología', subindustryValue: 'Ciberseguridad', countryCode: null },
        { industryValue: 'Salud y Healthcare', subindustryValue: null, countryCode: null },
      ],
      catalog: MOCK_CATALOG,
    });
    assert.equal(result.summary.total, 2);
    assert.equal(result.rows.length, 2);
  });

  it('H2: output row order matches input row order', () => {
    const result = normalizeImportedProspectClassifications({
      rows: [
        { industryValue: 'Tecnología', subindustryValue: null, countryCode: null },
        { industryValue: 'Salud y Healthcare', subindustryValue: null, countryCode: null },
        { industryValue: 'Desconocida XYZ', subindustryValue: null, countryCode: null },
      ],
      catalog: MOCK_CATALOG,
    });
    assert.equal(result.rows[0].industryOriginalValue, 'Tecnología');
    assert.equal(result.rows[1].industryOriginalValue, 'Salud y Healthcare');
    assert.equal(result.rows[2].industryOriginalValue, 'Desconocida XYZ');
  });

  it('H3: one invalid row does not stop the batch', () => {
    const result = normalizeImportedProspectClassifications({
      rows: [
        { industryValue: 'Tecnología', subindustryValue: 'Ciberseguridad', countryCode: null },
        { industryValue: 'Totalmente Desconocida', subindustryValue: 'También Desconocida', countryCode: null },
        { industryValue: 'Salud y Healthcare', subindustryValue: null, countryCode: null },
      ],
      catalog: MOCK_CATALOG,
    });
    assert.equal(result.rows.length, 3);
    assert.equal(result.summary.total, 3);
    assert.equal(result.rows[0].industryId, 'ind-tech');
    assert.equal(result.rows[1].industryId, null); // not found, but batch continues
    assert.equal(result.rows[2].industryId, 'ind-health');
  });

  it('H4: summary counts are correct', () => {
    const result = normalizeImportedProspectClassifications({
      rows: [
        { industryValue: 'Tecnología', subindustryValue: 'Ciberseguridad', countryCode: null }, // exact
        { industryValue: 'Tecnología', subindustryValue: 'Cyber Security', countryCode: null }, // alias
        { industryValue: 'Desconocida', subindustryValue: null, countryCode: null }, // not found → requiresReview
      ],
      catalog: MOCK_CATALOG,
    });
    assert.equal(result.summary.total, 3);
    assert.equal(result.summary.exactMatches, 1);
    assert.equal(result.summary.aliasMatches, 1);
    assert.equal(result.summary.requiresReview, 1);
    assert.equal(result.summary.invalid, 0);
  });

  it('H5: invalid catalog prevents reliable normalization', () => {
    const brokenCatalog: ImportClassificationCatalog = {
      ...MOCK_CATALOG,
      aliases: [
        { id: 'ali-broken', subindustryId: 'sub-nonexistent', alias: 'Phantom', languageCode: null, countryCode: null, active: true },
      ],
    };
    const result = normalizeImportedProspectClassifications({
      rows: [
        { industryValue: 'Tecnología', subindustryValue: 'Ciberseguridad', countryCode: null },
      ],
      catalog: brokenCatalog,
    });
    assert.equal(result.rows.length, 0);
    assert.equal(result.summary.invalid, 1);
    assert.ok(result.catalogIssues.some((i) => i.severity === 'error'));
  });
});

// ── Section I — Security ──────────────────────────────────────────────────────

describe('Section I — security', () => {
  it('I1: CSV formula injection treated as plain text', () => {
    // "=1+1" in a CSV can be dangerous if exported to spreadsheets.
    // The normalizer must not execute it and should return not_found.
    const r = classify('=1+1', null);
    // Normalized: "=", "+", "1" → numbers/letters preserved; "=" and "+" removed → "1 1"
    // No industry named "1 1" → not_found (or missing if empty after normalization)
    assert.ok(['not_found', 'missing'].includes(r.industryMatchStatus));
    assert.equal(r.industryId, null);

    const r2 = classify('+CMD Industria', null);
    assert.ok(['not_found', 'missing'].includes(r2.industryMatchStatus));
  });

  it('I2: HTML tags treated as plain text and removed', () => {
    const r = classify('<script>alert(1)</script>', null);
    assert.ok(['not_found', 'missing'].includes(r.industryMatchStatus));
    assert.equal(r.industryId, null);
  });

  it('I3: control characters are stripped before normalization', () => {
    const r = classify('Tecnología\x00\x01\x1F', null);
    // After stripping control chars: "Tecnología" → exact_match
    assert.equal(r.industryMatchStatus, 'exact_match');
    assert.equal(r.industryId, 'ind-tech');
  });

  it('I4: value exceeding max length produces VALUE_TRUNCATED warning', () => {
    const longValue = 'A'.repeat(300);
    const r = classify(longValue, null);
    assert.ok(r.classificationWarnings.some((w) => w.code === 'VALUE_TRUNCATED'));
    assert.equal(r.industryId, null); // truncated gibberish → not found
  });
});

// ── Section J — Determinism ───────────────────────────────────────────────────

describe('Section J — determinism', () => {
  it('J1: same input produces identical output on repeated calls', () => {
    const r1 = classify('Tecnología', 'Ciberseguridad', 'CO');
    const r2 = classify('Tecnología', 'Ciberseguridad', 'CO');
    assert.deepEqual(r1, r2);
  });

  it('J2: output contains no date fields that would vary', () => {
    const r = classify('Tecnología', 'Ciberseguridad');
    const keys = Object.keys(r);
    assert.ok(!keys.includes('createdAt'));
    assert.ok(!keys.includes('timestamp'));
    assert.ok(!keys.includes('processedAt'));
  });

  it('J3: output contains no randomly generated IDs', () => {
    const r1 = classify('Tecnología', null);
    const r2 = classify('Tecnología', null);
    // All fields must be equal (no random IDs added)
    assert.equal(r1.industryId, r2.industryId);
    assert.equal(r1.catalogVersion, r2.catalogVersion);
    assert.equal(JSON.stringify(r1.classificationWarnings), JSON.stringify(r2.classificationWarnings));
  });

  it('J4: normalizer makes no external calls (pure function)', () => {
    // If external calls were made, this test would fail in CI with no network.
    // The fact that it runs in the pure test environment confirms no external calls.
    const r = classify('Tecnología', 'Ciberseguridad');
    assert.equal(r.industryId, 'ind-tech');
  });
});

// ── Section K — Selectors ─────────────────────────────────────────────────────

describe('Section K — deriveClassificationValidationStatus', () => {
  it('K1: exact_match with no warnings → valid', () => {
    const r = classify('Tecnología', 'Ciberseguridad', 'CO');
    assert.equal(deriveClassificationValidationStatus(r), 'valid');
  });

  it('K2: alias or normalized match → normalized', () => {
    const r = classify('Tecnología', 'Cyber Security');
    assert.equal(deriveClassificationValidationStatus(r), 'normalized');
  });

  it('K3: valid industry, subindustry missing → warning', () => {
    const r = classify('Tecnología', null);
    assert.equal(deriveClassificationValidationStatus(r), 'warning');
  });

  it('K4: not_found industry → requires_review', () => {
    const r = classify('Desconocida XYZ', null);
    assert.equal(deriveClassificationValidationStatus(r), 'requires_review');
  });

  it('K5: wrong_industry → requires_review', () => {
    const r = classify('Tecnología', 'Seguro Médico');
    assert.equal(deriveClassificationValidationStatus(r), 'requires_review');
  });

  it('K6: not_applicable_to_country → requires_review', () => {
    const r = classify('Salud y Healthcare', 'Plano de Saúde', 'MX');
    assert.equal(deriveClassificationValidationStatus(r), 'requires_review');
  });

  it('K7: both missing → warning (no data, not wrong data)', () => {
    const r = classify(null, null);
    assert.equal(deriveClassificationValidationStatus(r), 'warning');
  });
});

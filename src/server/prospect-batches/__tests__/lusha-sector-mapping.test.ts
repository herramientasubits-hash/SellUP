import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildLushaCompanyIndustryFilter,
  resolveLushaMainIndustryMapping,
} from '../lusha-sector-mapping';

// ─── Healthcare ──────────────────────────────────────────────────────────────

test('1. "Salud" resolves to [11], healthcare, high confidence', () => {
  const result = resolveLushaMainIndustryMapping({ sector: 'Salud' });
  assert.deepEqual(result.mainIndustriesIds, [11]);
  assert.equal(result.matchedSector, 'healthcare');
  assert.equal(result.confidence, 'high');
});

test('2. "Healthcare" resolves to [11]', () => {
  const result = resolveLushaMainIndustryMapping({ sector: 'Healthcare' });
  assert.deepEqual(result.mainIndustriesIds, [11]);
  assert.equal(result.matchedSector, 'healthcare');
});

test('3. "clínicas" resolves to [11]', () => {
  const result = resolveLushaMainIndustryMapping({ sector: 'clínicas' });
  assert.deepEqual(result.mainIndustriesIds, [11]);
  assert.equal(result.matchedSector, 'healthcare');
});

test('4. "EPS" resolves to [11]', () => {
  const result = resolveLushaMainIndustryMapping({ sector: 'EPS' });
  assert.deepEqual(result.mainIndustriesIds, [11]);
  assert.equal(result.matchedSector, 'healthcare');
});

// ─── Education ────────────────────────────────────────────────────────────────

test('5. "Educación" resolves to [6], education, high confidence', () => {
  const result = resolveLushaMainIndustryMapping({ sector: 'Educación' });
  assert.deepEqual(result.mainIndustriesIds, [6]);
  assert.equal(result.matchedSector, 'education');
  assert.equal(result.confidence, 'high');
});

test('6. "universidades" resolves to [6]', () => {
  const result = resolveLushaMainIndustryMapping({ sector: 'universidades' });
  assert.deepEqual(result.mainIndustriesIds, [6]);
  assert.equal(result.matchedSector, 'education');
});

test('7. "e-learning" resolves to [6]', () => {
  const result = resolveLushaMainIndustryMapping({ sector: 'e-learning' });
  assert.deepEqual(result.mainIndustriesIds, [6]);
  assert.equal(result.matchedSector, 'education');
});

// ─── Technology ──────────────────────────────────────────────────────────────

test('8. "Tecnología" resolves to [17], technology, high confidence', () => {
  const result = resolveLushaMainIndustryMapping({ sector: 'Tecnología' });
  assert.deepEqual(result.mainIndustriesIds, [17]);
  assert.equal(result.matchedSector, 'technology');
  assert.equal(result.confidence, 'high');
});

test('9. "software" resolves to [17]', () => {
  const result = resolveLushaMainIndustryMapping({ sector: 'software' });
  assert.deepEqual(result.mainIndustriesIds, [17]);
  assert.equal(result.matchedSector, 'technology');
});

test('10. "ciberseguridad" resolves to [17]', () => {
  const result = resolveLushaMainIndustryMapping({ sector: 'ciberseguridad' });
  assert.deepEqual(result.mainIndustriesIds, [17]);
  assert.equal(result.matchedSector, 'technology');
});

// ─── No match ────────────────────────────────────────────────────────────────

test('11. Unknown sector resolves to [], none', () => {
  const result = resolveLushaMainIndustryMapping({ sector: 'agricultura ganadera' });
  assert.deepEqual(result.mainIndustriesIds, []);
  assert.equal(result.matchedSector, null);
  assert.equal(result.confidence, 'none');
  assert.ok(result.warnings.includes('no_sector_match'));
});

test('11b. Empty / null input resolves to [], none', () => {
  assert.equal(resolveLushaMainIndustryMapping({}).confidence, 'none');
  assert.equal(resolveLushaMainIndustryMapping({ sector: null }).confidence, 'none');
  assert.equal(
    resolveLushaMainIndustryMapping({ sector: '', subsegments: [] }).confidence,
    'none',
  );
});

// ─── Case / accent insensitivity ─────────────────────────────────────────────

test('12. Matching is case-insensitive', () => {
  assert.deepEqual(resolveLushaMainIndustryMapping({ sector: 'SALUD' }).mainIndustriesIds, [11]);
  assert.deepEqual(resolveLushaMainIndustryMapping({ sector: 'SoFtWaRe' }).mainIndustriesIds, [17]);
});

test('13. Matching is accent-insensitive', () => {
  assert.deepEqual(
    resolveLushaMainIndustryMapping({ sector: 'educacion' }).mainIndustriesIds,
    [6],
  );
  assert.deepEqual(
    resolveLushaMainIndustryMapping({ sector: 'Educación' }).mainIndustriesIds,
    [6],
  );
  assert.deepEqual(
    resolveLushaMainIndustryMapping({ sector: 'tecnologia' }).mainIndustriesIds,
    [17],
  );
});

// ─── Mixed sectors ────────────────────────────────────────────────────────────

test('14. Mixed clear aliases "salud y educación" resolves to [11, 6] with warning', () => {
  const result = resolveLushaMainIndustryMapping({ sector: 'salud y educación' });
  assert.deepEqual(result.mainIndustriesIds, [11, 6]);
  assert.equal(result.matchedSector, null);
  assert.ok(
    result.warnings.some((warning) => warning.startsWith('multiple_sectors_matched')),
    'expected multiple_sectors_matched warning',
  );
});

// ─── buildLushaCompanyIndustryFilter ─────────────────────────────────────────

test('15. buildLushaCompanyIndustryFilter returns mainIndustriesIds only', () => {
  const mapping = resolveLushaMainIndustryMapping({ sector: 'Educación' });
  const filter = buildLushaCompanyIndustryFilter(mapping);
  assert.deepEqual(filter, { mainIndustriesIds: [6] });
});

test('16. build filter never emits industriesLabels', () => {
  const mapping = resolveLushaMainIndustryMapping({ sector: 'Salud' });
  const filter = buildLushaCompanyIndustryFilter(mapping);
  assert.ok(!('industriesLabels' in filter));
});

test('17. build filter never emits subIndustriesIds', () => {
  const mapping = resolveLushaMainIndustryMapping({ sector: 'Tecnología' });
  const filter = buildLushaCompanyIndustryFilter(mapping);
  assert.ok(!('subIndustriesIds' in filter));
});

test('15b. build filter returns empty object (no empty array) when no match', () => {
  const mapping = resolveLushaMainIndustryMapping({ sector: 'agricultura' });
  const filter = buildLushaCompanyIndustryFilter(mapping);
  assert.deepEqual(filter, {});
  assert.ok(!('mainIndustriesIds' in filter));
});

// ─── suggestedSubIndustries are informational only ────────────────────────────

test('18. suggestedSubIndustries are informational and excluded from the filter', () => {
  const mapping = resolveLushaMainIndustryMapping({ sector: 'Salud' });
  assert.ok(mapping.suggestedSubIndustries.length > 0);
  assert.deepEqual(
    mapping.suggestedSubIndustries.find((sub) => sub.value === 'Hospitals & Clinics'),
    { value: 'Hospitals & Clinics', id: 59 },
  );
  // The filter builder must ignore them entirely.
  const filter = buildLushaCompanyIndustryFilter(mapping);
  assert.deepEqual(filter, { mainIndustriesIds: [11] });
});

// ─── Subsegment-driven match (informational coverage) ────────────────────────

test('19. Subsegment-only match yields low confidence with warning', () => {
  const result = resolveLushaMainIndustryMapping({
    sector: 'organizaciones grandes',
    subsegments: ['hospitales'],
  });
  assert.deepEqual(result.mainIndustriesIds, [11]);
  assert.equal(result.matchedSector, 'healthcare');
  assert.equal(result.confidence, 'low');
  assert.ok(
    result.warnings.some((warning) => warning.startsWith('sector_matched_via_subsegment_only')),
  );
});

test('20. Whole-word matching avoids false positives inside larger words', () => {
  // "epson" contains "eps" as a substring but must NOT match healthcare.
  const result = resolveLushaMainIndustryMapping({ sector: 'epson printers' });
  assert.deepEqual(result.mainIndustriesIds, []);
  assert.equal(result.confidence, 'none');
});

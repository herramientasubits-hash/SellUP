/**
 * Tests — Agent 1 v1.16K — No-Cost Employee Size Extraction from Source Snippets
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * F1  — "201-500 employees"                          → "201-500"
 * F2  — "51-200 empleados"                           → "51-200"
 * F3  — "500 empleados"                              → "201-500"
 * F4  — "1.000 empleados"                            → "501-1000"
 * F5  — "10.000 colaboradores"                       → "5001-10000"
 * F6  — "más de 200 empleados"                       → "201-500"
 * F7  — "over 1000 employees"                        → "1001-5000"
 * F8  — "500+ employees"                             → "501-1000"
 * F9  — "entre 200 y 500 empleados"                  → "201-500"
 * F10 — "$200-500 USD"                               → null
 * F11 — "500 clientes"                               → null
 * F12 — "10.000 usuarios"                            → null
 * F13 — "1.500 m²"                                   → null
 * F14 — rich profile sourceSnippet "más de 500 col…" → estimated, source_snippet, no size in missing
 * F15 — rich profile no size evidence                → null range, size in missing_fields
 * F16 — sourceTitle only has size signal             → still detected
 * F17 — parser is pure: no external calls, no mutation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseEmployeeSizeFromText } from '../employee-size-text-parser';
import { buildCandidateRichProfileV1 } from '../candidate-rich-profile';

// ─── Parser unit tests ────────────────────────────────────────────────────────

describe('v1.16K — parseEmployeeSizeFromText', () => {

  // Positive fixtures

  it('F1 — explicit range EN: "201-500 employees" → "201-500"', () => {
    assert.equal(parseEmployeeSizeFromText('201-500 employees'), '201-500');
  });

  it('F2 — explicit range ES: "51-200 empleados" → "51-200"', () => {
    assert.equal(parseEmployeeSizeFromText('51-200 empleados'), '51-200');
  });

  it('F3 — single number ES: "500 empleados" → "201-500"', () => {
    assert.equal(parseEmployeeSizeFromText('500 empleados'), '201-500');
  });

  it('F4 — Spanish thousands separator: "1.000 empleados" → "501-1000"', () => {
    assert.equal(parseEmployeeSizeFromText('1.000 empleados'), '501-1000');
  });

  it('F5 — Spanish thousands separator large: "10.000 colaboradores" → "5001-10000"', () => {
    assert.equal(parseEmployeeSizeFromText('10.000 colaboradores'), '5001-10000');
  });

  it('F6 — más de: "más de 200 empleados" → "201-500"', () => {
    assert.equal(parseEmployeeSizeFromText('más de 200 empleados'), '201-500');
  });

  it('F7 — over: "over 1000 employees" → "1001-5000"', () => {
    assert.equal(parseEmployeeSizeFromText('over 1000 employees'), '1001-5000');
  });

  it('F8 — plus: "500+ employees" → "501-1000"', () => {
    assert.equal(parseEmployeeSizeFromText('500+ employees'), '501-1000');
  });

  it('F9 — entre/and: "entre 200 y 500 empleados" → "201-500"', () => {
    assert.equal(parseEmployeeSizeFromText('entre 200 y 500 empleados'), '201-500');
  });

  // Negative fixtures (false-positive guard)

  it('F10 — currency range: "$200-500 USD" → null', () => {
    assert.equal(parseEmployeeSizeFromText('$200-500 USD'), null);
  });

  it('F11 — wrong keyword: "500 clientes" → null', () => {
    assert.equal(parseEmployeeSizeFromText('500 clientes'), null);
  });

  it('F12 — wrong keyword: "10.000 usuarios" → null', () => {
    assert.equal(parseEmployeeSizeFromText('10.000 usuarios'), null);
  });

  it('F13 — unit suffix: "1.500 m²" → null', () => {
    assert.equal(parseEmployeeSizeFromText('1.500 m²'), null);
  });

  // Additional false-positive guards from spec

  it('FP1 — "200 cursos" → null', () => {
    assert.equal(parseEmployeeSizeFromText('200 cursos'), null);
  });

  it('FP2 — "300 empresas atendidas" → null', () => {
    assert.equal(parseEmployeeSizeFromText('300 empresas atendidas'), null);
  });

  it('FP3 — "más de 200 clientes" → null', () => {
    assert.equal(parseEmployeeSizeFromText('más de 200 clientes'), null);
  });

  it('FP4 — "500 vacantes" → null', () => {
    assert.equal(parseEmployeeSizeFromText('500 vacantes'), null);
  });

  // Edge cases for additional pattern coverage

  it('1,000 EN thousands separator: "1,000 employees" → "501-1000"', () => {
    assert.equal(parseEmployeeSizeFromText('1,000 employees'), '501-1000');
  });

  it('more than: "more than 10000 employees" → "10001+"', () => {
    assert.equal(parseEmployeeSizeFromText('more than 10000 employees'), '10001+');
  });

  it('plus boundary: "10000+ employees" → "10001+"', () => {
    assert.equal(parseEmployeeSizeFromText('10000+ employees'), '10001+');
  });

  it('más de 500: "más de 500 colaboradores" → "501-1000"', () => {
    assert.equal(parseEmployeeSizeFromText('más de 500 colaboradores'), '501-1000');
  });

  it('between EN: "between 200 and 500 employees" → "201-500"', () => {
    assert.equal(parseEmployeeSizeFromText('between 200 and 500 employees'), '201-500');
  });

  it('null input → null', () => {
    assert.equal(parseEmployeeSizeFromText(null), null);
  });

  it('undefined input → null', () => {
    assert.equal(parseEmployeeSizeFromText(undefined), null);
  });

  it('empty string → null', () => {
    assert.equal(parseEmployeeSizeFromText(''), null);
  });
});

// ─── Integration tests (buildCandidateRichProfileV1) ─────────────────────────

describe('v1.16K — buildCandidateRichProfileV1 size integration', () => {

  it('F14 — sourceSnippet "Somos más de 500 colaboradores" → estimated, source_snippet, no size in missing', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Acme Corp',
      sourceSnippet: 'Somos más de 500 colaboradores',
      clockFn: () => '2026-06-24T00:00:00.000Z',
    });

    assert.equal(profile.size.estimated_range, '501-1000');
    assert.equal(profile.size.status, 'estimated');
    assert.equal(profile.size.source, 'source_snippet');
    assert.ok(
      profile.notes.missing_fields && !profile.notes.missing_fields.includes('size'),
      'missing_fields should NOT contain "size"',
    );
  });

  it('F15 — no size evidence → null range, size in missing_fields', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Acme Corp',
      sourceSnippet: 'Empresa líder en soluciones para retail.',
      clockFn: () => '2026-06-24T00:00:00.000Z',
    });

    assert.equal(profile.size.estimated_range, null);
    assert.equal(profile.size.status, 'unknown');
    assert.ok(
      profile.notes.missing_fields && profile.notes.missing_fields.includes('size'),
      'missing_fields should contain "size"',
    );
  });

  it('F16 — size only in sourceTitle is still detected', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Tech Inc',
      sourceTitle: 'Empresa con 1.000 trabajadores en Colombia',
      sourceSnippet: 'Soluciones innovadoras para el sector industrial.',
      clockFn: () => '2026-06-24T00:00:00.000Z',
    });

    assert.equal(profile.size.estimated_range, '501-1000');
    assert.equal(profile.size.status, 'estimated');
    assert.equal(profile.size.source, 'source_snippet');
  });

  it('F16b — size only in sourceSnippet when title has no signal', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Tech Inc',
      sourceTitle: 'Empresa de software en Bogotá',
      sourceSnippet: 'Contamos con 5.000 empleados en toda la región.',
      clockFn: () => '2026-06-24T00:00:00.000Z',
    });

    assert.equal(profile.size.estimated_range, '1001-5000');
    assert.equal(profile.size.status, 'estimated');
  });

  it('F17 — parser is pure: same input always returns same output, no side effects', () => {
    const input = '500+ employees';

    const result1 = parseEmployeeSizeFromText(input);
    const result2 = parseEmployeeSizeFromText(input);

    assert.equal(result1, '501-1000');
    assert.equal(result2, '501-1000');
    assert.equal(result1, result2);

    // The input string itself must not be mutated
    assert.equal(input, '500+ employees');
  });

  it('no size → missing_fields includes "size", missing_fields always includes "city"', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'No Signal Corp',
      clockFn: () => '2026-06-24T00:00:00.000Z',
    });

    assert.ok(profile.notes.missing_fields?.includes('city'), 'city always in missing_fields for basic profile');
    assert.ok(profile.notes.missing_fields?.includes('size'), 'size in missing_fields when no snippet');
  });

  it('with size detected → missing_fields still includes "city" but NOT "size"', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Big Corp',
      sourceSnippet: 'Más de 200 empleados en LATAM.',
      clockFn: () => '2026-06-24T00:00:00.000Z',
    });

    assert.ok(profile.notes.missing_fields?.includes('city'), 'city still in missing_fields');
    assert.ok(!profile.notes.missing_fields?.includes('size'), 'size removed from missing_fields');
    assert.equal(profile.size.estimated_range, '201-500');
  });
});

/**
 * Tests — Agent 1 v1.16H-E.2 — Argentina Country Evidence Gate
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * F1  — AR explicit "Argentina" in snippet → strong
 * F2  — AR "Buenos Aires" in snippet → strong
 * F3  — AR "Córdoba, Argentina" in snippet → strong
 * F4  — AR .com.ar domain → strong
 * F5  — AR /argentina/ path → strong
 * F6  — AR /ar-es/ path → strong
 * F7  — AR target country only, no textual/url evidence → weak
 * F8  — AR target, snippet mentions Colombia only → weak (not strong)
 * F9  — CO behavior unchanged (Colombia regression)
 * F10 — AR strong + fit medium → evidence policy NOT blocked
 * F11 — AR weak + fit medium → evidence policy blocked
 * F12 — Globant synthetic fixture (write smoke equivalent) → strong, not blocked
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateCountryEvidence } from '../country-evidence-gate';
import { computeEvidencePersistencePolicy } from '../evidence-persistence-policy';
import type { BusinessFitResult } from '../business-fit-gate';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBusinessFit(fit: 'high' | 'medium' | 'low'): BusinessFitResult {
  return {
    fit,
    rankingBonus: 0,
    reasons: [],
    matchedSignals: [],
    missingSignals: [],
  };
}

// ─── F1 — AR explicit "Argentina" in snippet ─────────────────────────────────

describe('F1 — AR "Argentina" explícita en snippet → strong', () => {
  it('snippet contiene "Argentina" → evidenceLevel=strong, source=text_country_mention_argentina', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.example.com',
      domain: 'example.com',
      sourceSnippet: 'Company with offices in Argentina and Brazil.',
      sourceTitle: 'Example Corp — About',
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(
      result.evidenceSources.includes('text_country_mention_argentina'),
      `evidenceSources debe incluir text_country_mention_argentina, got: ${JSON.stringify(result.evidenceSources)}`,
    );
    assert.equal(result.warning, null);
  });

  it('title contiene "Argentina" → evidenceLevel=strong', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.example.com',
      domain: 'example.com',
      sourceSnippet: null,
      sourceTitle: 'Globant Argentina | About us',
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(result.evidenceSources.includes('text_country_mention_argentina'));
  });
});

// ─── F2 — AR "Buenos Aires" in snippet ───────────────────────────────────────

describe('F2 — AR "Buenos Aires" en snippet → strong', () => {
  it('snippet contiene "Buenos Aires" → evidenceLevel=strong, source=argentina_city_mention', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.company.com',
      domain: 'company.com',
      sourceSnippet: 'Globant was founded in Buenos Aires by four entrepreneurs.',
      sourceTitle: 'About Globant',
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(
      result.evidenceSources.includes('argentina_city_mention'),
      `evidenceSources debe incluir argentina_city_mention, got: ${JSON.stringify(result.evidenceSources)}`,
    );
    assert.equal(result.warning, null);
  });

  it('"buenos aires" en minúsculas → strong (case insensitive)', () => {
    const result = evaluateCountryEvidence({
      website: null,
      domain: null,
      sourceSnippet: 'headquarters in buenos aires since 2003',
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(result.evidenceSources.includes('argentina_city_mention'));
  });
});

// ─── F3 — AR "Córdoba, Argentina" in snippet ─────────────────────────────────

describe('F3 — AR "Córdoba, Argentina" en snippet → strong', () => {
  it('snippet contiene "Córdoba, Argentina" (con acento) → strong via argentina mention', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.empresa.com',
      domain: 'empresa.com',
      sourceSnippet: 'Empresa fundada en Córdoba, Argentina en 2010.',
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(result.evidenceSources.includes('text_country_mention_argentina'));
  });

  it('snippet contiene "Cordoba, Argentina" (sin acento) → strong', () => {
    const result = evaluateCountryEvidence({
      website: null,
      domain: null,
      sourceSnippet: 'Office located in Cordoba, Argentina.',
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
  });

  it('snippet contiene "Rosario, Argentina" → strong', () => {
    const result = evaluateCountryEvidence({
      website: null,
      domain: null,
      sourceSnippet: 'Our development center is in Rosario, Argentina.',
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(result.evidenceSources.includes('text_country_mention_argentina'));
  });
});

// ─── F4 — AR .com.ar domain ──────────────────────────────────────────────────

describe('F4 — AR dominio .com.ar → strong', () => {
  it('website con .com.ar → evidenceLevel=strong, source=argentina_domain_com_ar', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.empresa.com.ar',
      domain: 'empresa.com.ar',
      sourceSnippet: null,
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(
      result.evidenceSources.includes('argentina_domain_com_ar'),
      `evidenceSources debe incluir argentina_domain_com_ar, got: ${JSON.stringify(result.evidenceSources)}`,
    );
    assert.equal(result.warning, null);
  });

  it('domain .com.ar sin website → strong', () => {
    const result = evaluateCountryEvidence({
      website: null,
      domain: 'mercadolibre.com.ar',
      sourceSnippet: null,
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(result.evidenceSources.includes('argentina_domain_com_ar'));
  });

  it('domain .net.ar → strong', () => {
    const result = evaluateCountryEvidence({
      website: 'https://company.net.ar',
      domain: 'company.net.ar',
      sourceSnippet: null,
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(result.evidenceSources.includes('argentina_domain_com_ar'));
  });
});

// ─── F5 — AR /argentina/ path ────────────────────────────────────────────────

describe('F5 — AR /argentina/ en URL path → strong', () => {
  it('website con /argentina/ path → evidenceLevel=strong, source=argentina_path_signal', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.company.com/argentina/about',
      domain: 'company.com',
      sourceSnippet: null,
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(
      result.evidenceSources.includes('argentina_path_signal'),
      `evidenceSources debe incluir argentina_path_signal, got: ${JSON.stringify(result.evidenceSources)}`,
    );
    assert.equal(result.warning, null);
  });

  it('/argentina path sin trailing slash también detectado', () => {
    const result = evaluateCountryEvidence({
      website: 'https://company.com/argentina',
      domain: 'company.com',
      sourceSnippet: null,
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(result.evidenceSources.includes('argentina_path_signal'));
  });
});

// ─── F6 — AR /ar-es/ path ────────────────────────────────────────────────────

describe('F6 — AR /ar-es/ en URL path → strong', () => {
  it('website con /ar-es/ → evidenceLevel=strong', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.company.com/ar-es/about',
      domain: 'company.com',
      sourceSnippet: null,
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(result.evidenceSources.includes('argentina_path_signal'));
  });

  it('website con /es-ar/ → evidenceLevel=strong', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.company.com/es-ar/home',
      domain: 'company.com',
      sourceSnippet: null,
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(result.evidenceSources.includes('argentina_path_signal'));
  });
});

// ─── F7 — AR solo targetCountryCode, sin evidencia textual/url → weak ────────

describe('F7 — AR solo targetCountryCode, sin evidencia → weak', () => {
  it('solo countryCode=AR, sin snippet/title/url/domain AR → weak', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.company.com',
      domain: 'company.com',
      sourceSnippet: 'We provide software services worldwide.',
      sourceTitle: 'Company — Software Services',
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'weak');
    assert.equal(result.evidenceSources.length, 0);
    assert.notEqual(result.warning, null);
  });

  it('todo null con targetCountryCode=AR → weak', () => {
    const result = evaluateCountryEvidence({
      website: null,
      domain: null,
      sourceSnippet: null,
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'weak');
    assert.equal(result.evidenceSources.length, 0);
  });

  it('targetCountryCode=AR solo NO sube a strong — regla conservadora central', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.globant.com',
      domain: 'globant.com',
      sourceSnippet: 'Leading technology company with global presence.',
      sourceTitle: 'Globant — Technology',
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.notEqual(
      result.evidenceLevel,
      'strong',
      'countryCode=AR solo no debe producir evidencia strong',
    );
  });
});

// ─── F8 — AR target, snippet only mentions Colombia → weak ───────────────────

describe('F8 — AR target, snippet menciona solo Colombia → weak (no confusión cross-country)', () => {
  it('snippet con Colombia, target=AR → weak (no strong por Colombia)', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.sofka.com.co',
      domain: 'sofka.com.co',
      sourceSnippet: 'Sofka es una empresa de tecnología colombiana con sede en Medellín, Colombia.',
      sourceTitle: 'Sofka Technologies — Colombia',
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'weak');
    assert.ok(
      !result.evidenceSources.some(s => s.includes('argentina')),
      'No deben aparecer fuentes de Argentina para un candidato de Colombia',
    );
  });
});

// ─── F9 — CO behavior unchanged (regresión Colombia) ─────────────────────────

describe('F9 — CO behavior sin cambios (regresión Colombia)', () => {
  it('CO con dominio .com.co → strong', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.sofka.com.co',
      domain: 'sofka.com.co',
      sourceSnippet: null,
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'CO',
    });
    assert.equal(result.evidenceLevel, 'strong');
  });

  it('CO con "Colombia" en snippet → strong', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.company.com',
      domain: 'company.com',
      sourceSnippet: 'Empresa tecnológica en Colombia con presencia en Bogotá.',
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'CO',
    });
    assert.equal(result.evidenceLevel, 'strong');
  });

  it('CO sin evidencia → weak (no afectado por AR)', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.company.com',
      domain: 'company.com',
      sourceSnippet: 'Global software company.',
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'CO',
    });
    assert.equal(result.evidenceLevel, 'weak');
  });

  it('CO query_only → query_only', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.company.com',
      domain: 'company.com',
      sourceSnippet: null,
      sourceTitle: null,
      queryText: 'empresa software colombia b2b',
      targetCountryCode: 'CO',
    });
    assert.equal(result.evidenceLevel, 'query_only');
  });
});

// ─── F10 — AR strong + fit medium → evidence policy NOT blocked ───────────────

describe('F10 — AR strong + fit medium → evidence policy no bloquea', () => {
  it('strong + medium → decision != blocked', () => {
    const countryEvidence = evaluateCountryEvidence({
      website: 'https://www.globant.com',
      domain: 'globant.com',
      sourceSnippet: 'Globant was founded in Buenos Aires, Argentina in 2003.',
      sourceTitle: 'About Globant',
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(countryEvidence.evidenceLevel, 'strong', 'Precondición: evidenceLevel debe ser strong');

    const policy = computeEvidencePersistencePolicy({
      countryEvidence,
      businessFit: makeBusinessFit('medium'),
    });

    assert.notEqual(
      policy.decision,
      'blocked',
      `AR strong + fit medium NO debe bloquearse. Decision: ${policy.decision}, reason: ${policy.primaryReason}`,
    );
  });

  it('AR strong + fit medium → primaryReason != no_country_evidence_with_weak_fit', () => {
    const countryEvidence = evaluateCountryEvidence({
      website: null,
      domain: null,
      sourceSnippet: 'Company with offices in Argentina.',
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });

    const policy = computeEvidencePersistencePolicy({
      countryEvidence,
      businessFit: makeBusinessFit('medium'),
    });

    assert.notEqual(
      policy.primaryReason,
      'no_country_evidence_with_weak_fit',
      'no debe bloquearse con razón no_country_evidence_with_weak_fit',
    );
  });
});

// ─── F11 — AR weak + fit medium → evidence policy blocked ────────────────────

describe('F11 — AR weak + fit medium → evidence policy bloqueado', () => {
  it('AR sin evidencia + fit medium → blocked', () => {
    const countryEvidence = evaluateCountryEvidence({
      website: 'https://www.company.com',
      domain: 'company.com',
      sourceSnippet: 'Global software solutions.',
      sourceTitle: 'Company — About',
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(countryEvidence.evidenceLevel, 'weak', 'Precondición: evidenceLevel debe ser weak');

    const policy = computeEvidencePersistencePolicy({
      countryEvidence,
      businessFit: makeBusinessFit('medium'),
    });

    assert.equal(
      policy.decision,
      'blocked',
      `AR weak + fit medium debe bloquearse. Decision: ${policy.decision}`,
    );
    assert.equal(policy.primaryReason, 'no_country_evidence_with_weak_fit');
  });

  it('AR weak + fit low → blocked', () => {
    const countryEvidence = evaluateCountryEvidence({
      website: 'https://www.company.com',
      domain: 'company.com',
      sourceSnippet: null,
      sourceTitle: null,
      queryText: null,
      targetCountryCode: 'AR',
    });

    const policy = computeEvidencePersistencePolicy({
      countryEvidence,
      businessFit: makeBusinessFit('low'),
    });

    assert.equal(policy.decision, 'blocked');
    assert.equal(policy.primaryReason, 'no_country_evidence_with_weak_fit');
  });
});

// ─── F12 — Globant synthetic fixture (write smoke equivalent) ────────────────

describe('F12 — Globant synthetic fixture → strong, not blocked', () => {
  it('snippet con "Buenos Aires, Argentina" → evidenceLevel=strong', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.globant.com',
      domain: 'globant.com',
      sourceSnippet: 'Globant was founded in Buenos Aires, Argentina by Martin Migoya, Guibert Englebienne, Martin Umaran and Nestor Nocetti.',
      sourceTitle: 'About Us - Globant',
      queryText: 'Globant Argentina empresa tecnología B2B',
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.equal(result.warning, null);
    assert.ok(result.evidenceSources.length > 0, 'Debe haber al menos una fuente de evidencia');
  });

  it('Globant fixture → evidence policy NOT blocked con fit=medium', () => {
    const countryEvidence = evaluateCountryEvidence({
      website: 'https://www.globant.com',
      domain: 'globant.com',
      sourceSnippet: 'Globant was founded in Buenos Aires, Argentina by Martin Migoya.',
      sourceTitle: 'About Us - Globant',
      queryText: null,
      targetCountryCode: 'AR',
    });

    assert.equal(countryEvidence.evidenceLevel, 'strong');

    const policy = computeEvidencePersistencePolicy({
      countryEvidence,
      businessFit: makeBusinessFit('medium'),
    });

    assert.notEqual(
      policy.decision,
      'blocked',
      `Globant con evidence=strong + fit=medium NO debe bloquearse. Reason: ${policy.primaryReason}`,
    );
  });

  it('Globant fixture con sourceTitle que menciona Argentina → strong via title', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.globant.com',
      domain: 'globant.com',
      sourceSnippet: 'Leading technology and cognitive company.',
      sourceTitle: 'Globant Argentina | About us',
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(result.evidenceLevel, 'strong');
    assert.ok(result.evidenceSources.includes('text_country_mention_argentina'));
  });

  it('Globant fixture sin Argentina en snippet/title → weak (conservador)', () => {
    const result = evaluateCountryEvidence({
      website: 'https://www.globant.com',
      domain: 'globant.com',
      sourceSnippet: 'Globant is a technology company. We help organizations stay relevant.',
      sourceTitle: 'About Us - Globant',
      queryText: null,
      targetCountryCode: 'AR',
    });
    assert.equal(
      result.evidenceLevel,
      'weak',
      'Sin mención de Argentina en snippet/title/url → debe ser weak (no se asume por countryCode)',
    );
  });
});

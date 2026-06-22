/**
 * Tests — Search Quality v1.11 — Commercial Fit Scoring Calibration
 *
 * Verifica que el scorer diferencia candidatos por encaje comercial real,
 * usando sourceSnippet + sourceTitle + countryEvidenceLevel como señales.
 *
 * Fixtures:
 *   F1: Loggro Enterprise  — ERP Colombia       → fitScore >= 65, fit_label medium/high
 *   F2: Softland           — HR/nómina Colombia  → fitScore >= 60, HR signal visible
 *   F3: ACTI               — Implementación ERP  → fitScore 50–65
 *   F4: Cegid              — RRHH, query_only    → fitScore <= 55, needs_review
 *   F5: Kaizen Digital     — agencia web, dup    → fitScore <= 50, needs_review, dup penalty
 *   F6: Portal ERP         — portal/agregador    → businessFit blocked (regresión)
 *   F7: Capterra/G2/GetApp — directorios pagos   → externalPlatformGate blocked (regresión)
 *   F8: Rolavsp            — señales freelance   → businessFit blocked (regresión)
 *
 * Sin Supabase. Sin LLM. Sin Tavily. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { scoreCandidate } from '../candidate-scorer';
import { evaluateBusinessFit, isBlockedByBusinessFit } from '../business-fit-gate';
import { evaluateExternalPlatformGate } from '../external-platform-blocklist';
import type { DuplicateCheckResult, CandidateScoringInput } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newCandidate(name: string): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 90,
    input: { name, website: null, domain: null, country: null, countryCode: null },
    matches: [],
    summary: 'No duplicados encontrados.',
    checkedSources: ['hubspot'],
  };
}

function possibleDuplicate(name: string): DuplicateCheckResult {
  return {
    status: 'possible_duplicate',
    confidence: 60,
    input: { name, website: null, domain: null, country: null, countryCode: null },
    matches: [],
    summary: 'Posible duplicado detectado.',
    checkedSources: ['hubspot'],
  };
}

// ─── F1: Loggro Enterprise — ERP Colombia ────────────────────────────────────

describe('F1 — Loggro Enterprise: ERP Colombia → fitScore >= 65, fit_label medium o high', () => {
  const input: CandidateScoringInput = {
    name: 'Loggro',
    industry: 'Software empresarial',
    subsector: 'ERP',
    sourcePriority: 'P1',
    countryCode: 'CO',
    country: 'Colombia',
    sourceTitle: 'Loggro | Software ERP para empresas en Colombia',
    sourceSnippet: 'Loggro es el software ERP líder para empresas en Colombia. Plataforma ERP en la nube.',
    countryEvidenceLevel: 'strong',
    duplicateCheck: newCandidate('Loggro'),
  };

  it('fitScore debe ser >= 65', () => {
    const result = scoreCandidate(input);
    assert.ok(
      result.fitScore >= 65,
      `fitScore debe ser >= 65, got: ${result.fitScore}`,
    );
  });

  it('fitBreakdown.fit_label debe ser "medium" o "high"', () => {
    const result = scoreCandidate(input);
    assert.ok(result.fitBreakdown != null, 'fitBreakdown debe estar presente');
    assert.ok(
      result.fitBreakdown!.fit_label === 'medium' || result.fitBreakdown!.fit_label === 'high',
      `fit_label debe ser medium o high, got: ${result.fitBreakdown!.fit_label}`,
    );
  });

  it('fitBreakdown.fit_reasons incluye señal ERP', () => {
    const result = scoreCandidate(input);
    const hasErp = result.fitBreakdown?.fit_reasons.some((r) => r.includes('erp'));
    assert.ok(hasErp, `fit_reasons debe incluir señal ERP, got: ${JSON.stringify(result.fitBreakdown?.fit_reasons)}`);
  });

  it('fitBreakdown incluye señal de país strong', () => {
    const result = scoreCandidate(input);
    const hasCountry = result.fitBreakdown?.fit_reasons.some((r) => r.includes('country'));
    assert.ok(hasCountry, `fit_reasons debe incluir señal country_strong, got: ${JSON.stringify(result.fitBreakdown?.fit_reasons)}`);
  });
});

// ─── F2: Softland — HR/nómina Colombia ───────────────────────────────────────

describe('F2 — Softland: software nómina Colombia → fitScore >= 60, señal HR visible', () => {
  const input: CandidateScoringInput = {
    name: 'Softland Colombia',
    industry: 'Software de RRHH',
    subsector: 'Nómina',
    sourcePriority: 'P1',
    countryCode: 'CO',
    country: 'Colombia',
    sourceTitle: 'Softland | Software de nómina y RRHH para empresas',
    sourceSnippet: 'Softland ofrece software de nómina empresarial y plataforma RRHH para empresas en Colombia.',
    countryEvidenceLevel: 'strong',
    duplicateCheck: newCandidate('Softland Colombia'),
  };

  it('fitScore debe ser >= 60', () => {
    const result = scoreCandidate(input);
    assert.ok(
      result.fitScore >= 60,
      `fitScore debe ser >= 60, got: ${result.fitScore}`,
    );
  });

  it('fitBreakdown.product_fit corresponde a señal HR (>= 20)', () => {
    const result = scoreCandidate(input);
    assert.ok(result.fitBreakdown != null, 'fitBreakdown debe estar presente');
    assert.ok(
      result.fitBreakdown!.product_fit >= 20,
      `product_fit debe ser >= 20 (HR_HIGH), got: ${result.fitBreakdown!.product_fit}`,
    );
  });

  it('fitBreakdown.fit_reasons incluye señal HR o nómina', () => {
    const result = scoreCandidate(input);
    const hasHr = result.fitBreakdown?.fit_reasons.some(
      (r) => r.includes('hr') || r.includes('nomina') || r.includes('rrhh'),
    );
    assert.ok(hasHr, `fit_reasons debe incluir señal HR/nómina, got: ${JSON.stringify(result.fitBreakdown?.fit_reasons)}`);
  });
});

// ─── F3: ACTI — Implementación ERP ───────────────────────────────────────────

describe('F3 — ACTI: implementación ERP → fitScore 50–65', () => {
  const input: CandidateScoringInput = {
    name: 'ACTI',
    industry: 'Tecnología',
    subsector: 'Implementación ERP',
    sourcePriority: 'P1',
    countryCode: 'CO',
    country: 'Colombia',
    sourceTitle: 'ACTI - Implementacion y consultoria de software empresarial',
    sourceSnippet: 'ACTI ofrece servicios de implementacion de software y consultoria especializada. Software administrativo para empresas en Colombia.',
    countryEvidenceLevel: 'strong',
    duplicateCheck: newCandidate('ACTI'),
  };

  it('fitScore debe estar entre 50 y 65 inclusive', () => {
    const result = scoreCandidate(input);
    assert.ok(
      result.fitScore >= 50 && result.fitScore <= 65,
      `fitScore debe estar en rango [50, 65], got: ${result.fitScore}`,
    );
  });

  it('fitBreakdown.product_fit corresponde a implementación (>= 10, < 22)', () => {
    const result = scoreCandidate(input);
    assert.ok(result.fitBreakdown != null, 'fitBreakdown debe estar presente');
    assert.ok(
      result.fitBreakdown!.product_fit >= 10 && result.fitBreakdown!.product_fit < 22,
      `product_fit debe ser de implementación [10, 22), got: ${result.fitBreakdown!.product_fit}`,
    );
  });

  it('fitBreakdown.fit_reasons incluye señal de implementación', () => {
    const result = scoreCandidate(input);
    const hasImpl = result.fitBreakdown?.fit_reasons.some((r) => r.includes('implementation'));
    assert.ok(hasImpl, `fit_reasons debe incluir señal implementation_services, got: ${JSON.stringify(result.fitBreakdown?.fit_reasons)}`);
  });
});

// ─── F4: Cegid — RRHH con country query_only ─────────────────────────────────

describe('F4 — Cegid: plataforma RRHH, country=query_only → fitScore <= 55, needs_review', () => {
  const input: CandidateScoringInput = {
    name: 'Cegid',
    industry: 'Software empresarial',
    sourcePriority: 'P1',
    countryCode: 'CO',
    country: 'Colombia',
    sourceTitle: 'Cegid | Plataforma RRHH y gestion del talento',
    sourceSnippet: 'Cegid es una plataforma RRHH B2B para la gestion de recursos humanos y nomina corporativa.',
    countryEvidenceLevel: 'query_only',
    duplicateCheck: newCandidate('Cegid'),
  };

  it('fitScore debe ser <= 55', () => {
    const result = scoreCandidate(input);
    assert.ok(
      result.fitScore <= 55,
      `fitScore debe ser <= 55, got: ${result.fitScore}`,
    );
  });

  it('qualityLabel debe ser "needs_review"', () => {
    const result = scoreCandidate(input);
    assert.equal(
      result.qualityLabel,
      'needs_review',
      `qualityLabel debe ser needs_review, got: ${result.qualityLabel}`,
    );
  });

  it('fitBreakdown.country_evidence_penalty debe ser 15 (query_only)', () => {
    const result = scoreCandidate(input);
    assert.ok(result.fitBreakdown != null, 'fitBreakdown debe estar presente');
    assert.equal(
      result.fitBreakdown!.country_evidence_penalty,
      15,
      `country_evidence_penalty debe ser 15, got: ${result.fitBreakdown!.country_evidence_penalty}`,
    );
  });

  it('fitBreakdown.fit_penalties incluye "country_evidence_query_only"', () => {
    const result = scoreCandidate(input);
    const hasPenalty = result.fitBreakdown?.fit_penalties.some((p) => p.includes('query_only'));
    assert.ok(hasPenalty, `fit_penalties debe incluir query_only, got: ${JSON.stringify(result.fitBreakdown?.fit_penalties)}`);
  });
});

// ─── F5: Kaizen Digital — agencia web, posible duplicado ─────────────────────

describe('F5 — Kaizen Digital: agencia web + posible duplicado → fitScore <= 50, needs_review', () => {
  const input: CandidateScoringInput = {
    name: 'Kaizen Digital',
    industry: 'Tecnología',
    sourcePriority: 'P1',
    countryCode: 'CO',
    country: 'Colombia',
    sourceTitle: 'Kaizen Digital - Desarrollo web y soluciones digitales',
    sourceSnippet: 'Kaizen Digital ofrece soluciones digitales y desarrollo web para empresas en Colombia. Servicios de marketing digital.',
    countryEvidenceLevel: 'strong',
    duplicateCheck: possibleDuplicate('Kaizen Digital'),
  };

  it('fitScore debe ser <= 50', () => {
    const result = scoreCandidate(input);
    assert.ok(
      result.fitScore <= 50,
      `fitScore debe ser <= 50, got: ${result.fitScore}`,
    );
  });

  it('qualityLabel debe ser "needs_review" (posible duplicado)', () => {
    const result = scoreCandidate(input);
    assert.equal(
      result.qualityLabel,
      'needs_review',
      `qualityLabel debe ser needs_review, got: ${result.qualityLabel}`,
    );
  });

  it('fitBreakdown.duplicate_penalty debe ser 5', () => {
    const result = scoreCandidate(input);
    assert.ok(result.fitBreakdown != null, 'fitBreakdown debe estar presente');
    assert.equal(
      result.fitBreakdown!.duplicate_penalty,
      5,
      `duplicate_penalty debe ser 5, got: ${result.fitBreakdown!.duplicate_penalty}`,
    );
  });

  it('fitBreakdown.generic_agency_penalty debe ser > 0 (desarrollo web / marketing digital)', () => {
    const result = scoreCandidate(input);
    assert.ok(result.fitBreakdown != null, 'fitBreakdown debe estar presente');
    assert.ok(
      result.fitBreakdown!.generic_agency_penalty > 0,
      `generic_agency_penalty debe ser > 0, got: ${result.fitBreakdown!.generic_agency_penalty}`,
    );
  });
});

// ─── F6: Portal ERP — businessFit bloqueado (regresión) ──────────────────────

describe('F6 — Portal ERP: portal/agregador → businessFit bloqueado (regresión)', () => {
  it('evaluateBusinessFit devuelve reject para nombre "Portal ERP"', () => {
    const result = evaluateBusinessFit({
      name: 'Portal ERP',
      website: 'https://portalerp.com',
      domain: 'portalerp.com',
      sourceSnippet: 'El mayor portal de noticias y análisis sobre ERP, CRM y software empresarial en Latinoamérica.',
      sourceTitle: 'Portal ERP - Noticias, análisis y comparativas de ERP',
    });
    assert.equal(
      result.fit,
      'reject',
      `fit debe ser reject para portal/agregador, got: ${result.fit}`,
    );
    assert.ok(
      isBlockedByBusinessFit(result),
      'isBlockedByBusinessFit debe ser true para Portal ERP',
    );
  });
});

// ─── F7: Capterra / G2 / GetApp — externalPlatformGate bloqueado (regresión) ─

describe('F7 — Capterra / G2 / GetApp: directorios pagos → externalPlatformGate blocked (regresión)', () => {
  it('capterra.com → blocked', () => {
    const result = evaluateExternalPlatformGate('https://www.capterra.com/erp-software/');
    assert.equal(result.allowed, false, 'capterra.com debe ser bloqueado');
  });

  it('g2.com → blocked', () => {
    const result = evaluateExternalPlatformGate('https://www.g2.com/categories/crm');
    assert.equal(result.allowed, false, 'g2.com debe ser bloqueado');
  });

  it('getapp.com → blocked', () => {
    const result = evaluateExternalPlatformGate('https://www.getapp.com/finance-accounting-software/p/1234');
    assert.equal(result.allowed, false, 'getapp.com debe ser bloqueado');
  });
});

// ─── F8: Rolavsp — señales freelance → businessFit bloqueado (regresión) ─────

describe('F8 — Rolavsp: señales freelance → businessFit bloqueado (regresión)', () => {
  it('snippet con "desarrolladores freelancer" → fit reject o low → isBlockedByBusinessFit', () => {
    const result = evaluateBusinessFit({
      name: 'Rolavsp',
      website: 'https://www.rolavsp.com',
      domain: 'rolavsp.com',
      sourceSnippet: 'desarrolladores freelancer disponibles para tu proyecto de software a medida',
      sourceTitle: 'Rolavsp - Software a la medida',
    });
    assert.ok(
      result.fit === 'reject' || result.fit === 'low',
      `fit debe ser reject o low para freelance, got: ${result.fit}`,
    );
    assert.ok(
      isBlockedByBusinessFit(result),
      'isBlockedByBusinessFit debe ser true para Rolavsp con señales freelance',
    );
  });
});

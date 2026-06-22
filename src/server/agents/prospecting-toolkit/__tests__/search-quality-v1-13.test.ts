/**
 * Tests — Search Quality v1.13 — Duplicate Identity Guard + Implementation Partner Scoring
 *
 * Verifica:
 *   - Duplicate Identity Guard: candidato con mismo dominio/inferred identity activo → no_match bloqueado
 *   - qa_cleanup/discarded histórico NO bloquea
 *   - rejected (no activo por guard) → guard no bloquea (novelty lo maneja)
 *   - Implementation Partner Scoring: Odoo Partner, Zoho Partner, Manufacturing ERP
 *   - Regresiones: Portal ERP, Capterra/G2/GetApp, Rolavsp, v1.12, v1.11, v1.10
 *
 * Sin Supabase. Sin LLM. Sin Tavily. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkActiveCandidateDuplicate } from '../active-candidate-identity-guard';
import type { ActiveCandidateRecord } from '../active-candidate-identity-guard';
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

function activeDuplicate(name: string, domain: string): DuplicateCheckResult {
  return {
    status: 'existing_in_sellup',
    confidence: 95,
    input: { name, website: null, domain, country: null, countryCode: null },
    matches: [{ source: 'sellup', status: 'existing_in_sellup', confidence: 95, matchedName: name, matchedDomain: domain, reason: 'same_active_domain' }],
    summary: `"${name}" ya existe en SellUp (dominio activo).`,
    checkedSources: ['sellup'],
  };
}

function activeSoftland(): ActiveCandidateRecord {
  return {
    id: 'existing-softland-001',
    name: 'Softland',
    domain: 'softland.com',
    status: 'needs_review',
  };
}

// ─── F1: Softland — active duplicate by domain ────────────────────────────────

describe('F1 — Softland active duplicate by domain', () => {
  const activeCandidates: ActiveCandidateRecord[] = [activeSoftland()];

  it('checkActiveCandidateDuplicate detecta same_active_domain', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com', inferredCompanyName: 'Softland' },
      activeCandidates,
    );
    assert.ok(result.matched, 'El guard debe detectar duplicado por dominio activo');
    assert.equal(result.reason, 'same_active_domain', `reason debe ser same_active_domain, got: ${result.reason}`);
    assert.equal(result.matchedName, 'Softland', `matchedName debe ser Softland, got: ${result.matchedName}`);
    assert.equal(result.matchedDomain, 'softland.com', `matchedDomain debe ser softland.com, got: ${result.matchedDomain}`);
  });

  it('El candidato softland.com no queda como no_match cuando el guard detecta activo', () => {
    const guard = checkActiveCandidateDuplicate(
      { domain: 'softland.com', inferredCompanyName: 'Softland' },
      activeCandidates,
    );
    assert.ok(guard.matched, 'guard debe retornar matched=true');

    // Traducir el resultado del guard a DuplicateCheckResult para el scorer
    const duplicateCheckWithGuard: DuplicateCheckResult = activeDuplicate('Softland', 'softland.com');

    const input: CandidateScoringInput = {
      name: 'Software ERP CRM y RRHH en Colombia',
      industry: 'Tecnología',
      sourcePriority: 'P1',
      countryCode: 'CO',
      country: 'Colombia',
      sourceTitle: 'Software ERP CRM y RRHH en Colombia | Softland',
      sourceSnippet: 'Softland ofrece ERP, CRM y RRHH para empresas en Colombia.',
      countryEvidenceLevel: 'strong',
      domain: 'softland.com',
      duplicateCheck: duplicateCheckWithGuard,
    };

    const result = scoreCandidate(input);
    assert.notEqual(
      result.qualityLabel,
      'high_quality_new',
      'qualityLabel no debe ser high_quality_new cuando hay duplicado activo',
    );
    assert.equal(
      result.qualityLabel,
      'duplicate',
      `qualityLabel debe ser "duplicate", got: ${result.qualityLabel}`,
    );
  });

  it('metadata.duplicateStatus no es "no_match" (refleja existing_in_sellup)', () => {
    const duplicateCheckWithGuard: DuplicateCheckResult = activeDuplicate('Softland', 'softland.com');
    const input: CandidateScoringInput = {
      name: 'Software ERP CRM y RRHH en Colombia',
      industry: 'Tecnología',
      sourcePriority: 'P1',
      countryCode: 'CO',
      country: 'Colombia',
      domain: 'softland.com',
      duplicateCheck: duplicateCheckWithGuard,
    };
    const result = scoreCandidate(input);
    assert.notEqual(result.metadata?.duplicateStatus, 'no_match', 'duplicateStatus no debe ser no_match');
    assert.equal(result.metadata?.duplicateStatus, 'existing_in_sellup', `duplicateStatus debe ser existing_in_sellup, got: ${result.metadata?.duplicateStatus}`);
  });
});

// ─── F2: Softland — active duplicate by inferred identity ─────────────────────

describe('F2 — Softland active duplicate by inferred identity', () => {
  const activeCandidates: ActiveCandidateRecord[] = [activeSoftland()];

  it('checkActiveCandidateDuplicate detecta same_inferred_identity cuando dominio es null', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: null, inferredCompanyName: 'Softland' },
      activeCandidates,
    );
    assert.ok(result.matched, 'El guard debe detectar duplicado por inferred identity');
    assert.equal(result.reason, 'same_inferred_identity', `reason debe ser same_inferred_identity, got: ${result.reason}`);
    assert.equal(result.matchedName, 'Softland');
  });

  it('Inferred identity es case-insensitive y acent-insensitive', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: null, inferredCompanyName: 'SOFTLAND' },
      activeCandidates,
    );
    assert.ok(result.matched, 'El guard debe ser insensible a mayúsculas');
  });

  it('Nombre diferente con mismo dominio sigue siendo detectado por domain (prioridad 1)', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com', inferredCompanyName: 'Software ERP RRHH Colombia' },
      activeCandidates,
    );
    assert.ok(result.matched, 'guard debe detectar por dominio aunque el nombre sea diferente');
    assert.equal(result.reason, 'same_active_domain', 'domain tiene prioridad sobre inferred identity');
  });
});

// ─── F3: Softland qa_cleanup — histórico no bloquea ──────────────────────────

describe('F3 — Softland qa_cleanup historical does not block', () => {
  it('status=qa_cleanup no bloquea al guard', () => {
    const qaCandidates: ActiveCandidateRecord[] = [{
      id: 'qa-softland-001',
      name: 'Softland',
      domain: 'softland.com',
      status: 'qa_cleanup',
    }];
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com', inferredCompanyName: 'Softland' },
      qaCandidates,
    );
    assert.equal(result.matched, false, 'qa_cleanup no debe bloquear al nuevo candidato');
    assert.equal(result.reason, null, 'reason debe ser null cuando no hay match activo');
  });

  it('status=discarded no bloquea al guard', () => {
    const discardedCandidates: ActiveCandidateRecord[] = [{
      id: 'discarded-softland-001',
      name: 'Softland',
      domain: 'softland.com',
      status: 'discarded',
    }];
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com' },
      discardedCandidates,
    );
    assert.equal(result.matched, false, 'discarded no debe bloquear al nuevo candidato');
  });

  it('mix de qa_cleanup y nuevo activo — solo el activo bloquea', () => {
    const mixedCandidates: ActiveCandidateRecord[] = [
      { id: 'qa-old', name: 'Softland Old', domain: 'softland.com', status: 'qa_cleanup' },
      { id: 'active-new', name: 'Softland', domain: 'softland.com', status: 'needs_review' },
    ];
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com' },
      mixedCandidates,
    );
    // The active one (needs_review) should trigger the block
    assert.ok(result.matched, 'El candidato activo debe bloquear aunque haya qa_cleanup también');
    assert.equal(result.reason, 'same_active_domain');
  });
});

// ─── F4: Hard negative — mecanismos existentes siguen bloqueando ──────────────

describe('F4 — Hard negative recent: mecanismos existentes siguen bloqueando', () => {
  it('guard con status=rejected NO bloquea (lo maneja el novelty checker)', () => {
    const rejectedCandidates: ActiveCandidateRecord[] = [{
      id: 'rejected-001',
      name: 'Softland',
      domain: 'softland.com',
      status: 'rejected',
    }];
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com' },
      rejectedCandidates,
    );
    assert.equal(result.matched, false, 'rejected no es estado activo para el guard');
  });

  it('Portal ERP sigue siendo bloqueado por evaluateBusinessFit (businessFit regresión)', () => {
    const result = evaluateBusinessFit({
      name: 'Portal ERP',
      website: 'https://portalerp.com',
      domain: 'portalerp.com',
      sourceSnippet: 'El mayor portal de noticias y análisis sobre ERP, CRM y software empresarial en Latinoamérica.',
      sourceTitle: 'Portal ERP - Noticias, análisis y comparativas de ERP',
    });
    assert.ok(
      isBlockedByBusinessFit(result),
      `Portal ERP debe seguir bloqueado, got fit=${result.fit}`,
    );
  });

  it('Rolavsp freelance sigue siendo bloqueado por evaluateBusinessFit', () => {
    const result = evaluateBusinessFit({
      name: 'Rolavsp',
      website: 'https://www.rolavsp.com',
      domain: 'rolavsp.com',
      sourceSnippet: 'desarrolladores freelancer disponibles para tu proyecto de software a medida',
      sourceTitle: 'Rolavsp - Software a la medida',
    });
    assert.ok(
      isBlockedByBusinessFit(result),
      `Rolavsp debe seguir bloqueado por señal freelance, got fit=${result.fit}`,
    );
  });
});

// ─── F5: Mi-ERP — Odoo Partner → fitScore 55–65 ──────────────────────────────

describe('F5 — Mi-ERP: Odoo Partner Colombia → fitScore 55–65', () => {
  const input: CandidateScoringInput = {
    name: 'Mi-ERP',
    industry: 'Tecnología',
    subsector: 'ERP',
    sourcePriority: 'P1',
    countryCode: 'CO',
    country: 'Colombia',
    sourceTitle: 'Mi-ERP | Odoo Partner Colombia',
    sourceSnippet: 'Odoo Partner, consulting, implementation and development Odoo en Colombia.',
    countryEvidenceLevel: 'strong',
    duplicateCheck: newCandidate('Mi-ERP'),
  };

  it('fitScore debe estar entre 55 y 65 inclusive', () => {
    const result = scoreCandidate(input);
    assert.ok(
      result.fitScore >= 55 && result.fitScore <= 65,
      `fitScore debe estar en [55, 65], got: ${result.fitScore}`,
    );
  });

  it('fit_label debe ser "medium"', () => {
    const result = scoreCandidate(input);
    assert.ok(result.fitBreakdown != null, 'fitBreakdown debe estar presente');
    assert.equal(
      result.fitBreakdown!.fit_label,
      'medium',
      `fit_label debe ser medium, got: ${result.fitBreakdown!.fit_label}`,
    );
  });

  it('fit_reasons incluye señal odoo_partner', () => {
    const result = scoreCandidate(input);
    const hasOdoo = result.fitBreakdown?.fit_reasons.some((r) => r.includes('odoo_partner'));
    assert.ok(hasOdoo, `fit_reasons debe incluir odoo_partner, got: ${JSON.stringify(result.fitBreakdown?.fit_reasons)}`);
  });

  it('fit_reasons incluye señal country_strong', () => {
    const result = scoreCandidate(input);
    const hasCountry = result.fitBreakdown?.fit_reasons.some((r) => r.includes('country'));
    assert.ok(hasCountry, `fit_reasons debe incluir country_strong, got: ${JSON.stringify(result.fitBreakdown?.fit_reasons)}`);
  });

  it('product_fit debe ser 20 (odoo_partner tier)', () => {
    const result = scoreCandidate(input);
    assert.ok(result.fitBreakdown != null, 'fitBreakdown debe estar presente');
    assert.equal(
      result.fitBreakdown!.product_fit,
      20,
      `product_fit debe ser 20 para odoo_partner, got: ${result.fitBreakdown!.product_fit}`,
    );
  });
});

// ─── F6: Factory — ERP manufactura → fitScore 60–70 ──────────────────────────

describe('F6 — Factory: ERP manufactura → fitScore 60–70', () => {
  const input: CandidateScoringInput = {
    name: 'Factory',
    industry: 'Manufactura',
    subsector: 'ERP Industrial',
    sourcePriority: 'P1',
    countryCode: 'CO',
    country: 'Colombia',
    sourceTitle: 'Factory ERP | Software de manufactura industrial',
    sourceSnippet: 'Factory ERP, módulo de manufactura para planta industrial en Colombia. 38 años de experiencia.',
    countryEvidenceLevel: 'strong',
    duplicateCheck: newCandidate('Factory'),
  };

  it('fitScore debe estar entre 60 y 70 inclusive', () => {
    const result = scoreCandidate(input);
    assert.ok(
      result.fitScore >= 60 && result.fitScore <= 70,
      `fitScore debe estar en [60, 70], got: ${result.fitScore}`,
    );
  });

  it('fit_label debe ser "medium" o "high"', () => {
    const result = scoreCandidate(input);
    assert.ok(result.fitBreakdown != null, 'fitBreakdown debe estar presente');
    assert.ok(
      result.fitBreakdown!.fit_label === 'medium' || result.fitBreakdown!.fit_label === 'high',
      `fit_label debe ser medium o high, got: ${result.fitBreakdown!.fit_label}`,
    );
  });

  it('fit_reasons incluye señal product_erp (manufacturing)', () => {
    const result = scoreCandidate(input);
    const hasErp = result.fitBreakdown?.fit_reasons.some((r) => r.includes('product_erp'));
    assert.ok(hasErp, `fit_reasons debe incluir product_erp, got: ${JSON.stringify(result.fitBreakdown?.fit_reasons)}`);
  });

  it('product_fit debe ser 25 (ERP_HIGH tier — Factory ERP)', () => {
    const result = scoreCandidate(input);
    assert.ok(result.fitBreakdown != null, 'fitBreakdown debe estar presente');
    assert.equal(
      result.fitBreakdown!.product_fit,
      25,
      `product_fit debe ser 25 para Factory ERP, got: ${result.fitBreakdown!.product_fit}`,
    );
  });
});

// ─── F7: Visiontecno — Zoho Partner → fitScore 50–60 ─────────────────────────

describe('F7 — Visiontecno: Zoho Partner → fitScore 50–60', () => {
  const input: CandidateScoringInput = {
    name: 'Visiontecno',
    industry: 'Tecnología',
    sourcePriority: 'P1',
    countryCode: 'CO',
    country: 'Colombia',
    sourceTitle: 'Visiontecno | Premium Partners de Zoho',
    sourceSnippet: 'Premium Partners de Zoho, desarrollo e implementación de soluciones, software y consultoría para entornos empresariales en Colombia.',
    countryEvidenceLevel: 'strong',
    duplicateCheck: newCandidate('Visiontecno'),
  };

  it('fitScore debe estar entre 50 y 60 inclusive', () => {
    const result = scoreCandidate(input);
    assert.ok(
      result.fitScore >= 50 && result.fitScore <= 60,
      `fitScore debe estar en [50, 60], got: ${result.fitScore}`,
    );
  });

  it('fit_label debe ser "medium"', () => {
    const result = scoreCandidate(input);
    assert.ok(result.fitBreakdown != null, 'fitBreakdown debe estar presente');
    assert.equal(
      result.fitBreakdown!.fit_label,
      'medium',
      `fit_label debe ser medium, got: ${result.fitBreakdown!.fit_label}`,
    );
  });

  it('fit_reasons incluye señal zoho_partner', () => {
    const result = scoreCandidate(input);
    const hasZoho = result.fitBreakdown?.fit_reasons.some((r) => r.includes('zoho_partner'));
    assert.ok(hasZoho, `fit_reasons debe incluir zoho_partner, got: ${JSON.stringify(result.fitBreakdown?.fit_reasons)}`);
  });

  it('product_fit debe ser 18 (zoho_partner tier)', () => {
    const result = scoreCandidate(input);
    assert.ok(result.fitBreakdown != null, 'fitBreakdown debe estar presente');
    assert.equal(
      result.fitBreakdown!.product_fit,
      18,
      `product_fit debe ser 18 para zoho_partner, got: ${result.fitBreakdown!.product_fit}`,
    );
  });
});

// ─── F8: SYCA — country query_only → fitScore ≤55 ────────────────────────────

describe('F8 — SYCA: query_only country → fitScore ≤55, confidence cap se mantiene', () => {
  const input: CandidateScoringInput = {
    name: 'SYCA',
    industry: 'Tecnología',
    subsector: 'Software Empresarial',
    sourcePriority: 'P1',
    countryCode: 'CO',
    country: 'Colombia',
    sourceTitle: 'SYCA - Software empresarial',
    sourceSnippet: 'SYCA, empresa de software empresarial y consultoría especializada. Implementación de sistemas para empresas.',
    countryEvidenceLevel: 'query_only',
    duplicateCheck: newCandidate('SYCA'),
  };

  it('fitScore debe ser <= 55 (penalización query_only)', () => {
    const result = scoreCandidate(input);
    assert.ok(
      result.fitScore <= 55,
      `fitScore debe ser <= 55 con country_evidence=query_only, got: ${result.fitScore}`,
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

  it('fit_penalties incluye "country_evidence_query_only"', () => {
    const result = scoreCandidate(input);
    const hasPenalty = result.fitBreakdown?.fit_penalties.some((p) => p.includes('query_only'));
    assert.ok(hasPenalty, `fit_penalties debe incluir query_only, got: ${JSON.stringify(result.fitBreakdown?.fit_penalties)}`);
  });

  it('qualityLabel debe ser needs_review (no high_quality_new por query_only)', () => {
    const result = scoreCandidate(input);
    assert.notEqual(
      result.qualityLabel,
      'high_quality_new',
      'SYCA con query_only no puede ser high_quality_new',
    );
  });
});

// ─── F9: Portal ERP — bloqueado (regresión v1.11) ────────────────────────────

describe('F9 — Portal ERP: portal/agregador → bloqueado (regresión)', () => {
  it('evaluateBusinessFit devuelve reject para Portal ERP', () => {
    const result = evaluateBusinessFit({
      name: 'Portal ERP',
      website: 'https://portalerp.com',
      domain: 'portalerp.com',
      sourceSnippet: 'El mayor portal de noticias y análisis sobre ERP, CRM y software empresarial en Latinoamérica.',
      sourceTitle: 'Portal ERP - Noticias, análisis y comparativas de ERP',
    });
    assert.equal(result.fit, 'reject', `fit debe ser reject, got: ${result.fit}`);
    assert.ok(isBlockedByBusinessFit(result), 'isBlockedByBusinessFit debe ser true');
  });
});

// ─── F10: Capterra / G2 / GetApp — bloqueados (regresión) ────────────────────

describe('F10 — Capterra / G2 / GetApp: directorios → bloqueados (regresión)', () => {
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

// ─── F11: Rolavsp — bloqueado (regresión) ────────────────────────────────────

describe('F11 — Rolavsp: señales freelance → bloqueado (regresión)', () => {
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
    assert.ok(isBlockedByBusinessFit(result), 'isBlockedByBusinessFit debe ser true para Rolavsp');
  });
});

// ─── Validaciones cruzadas: Odoo/Zoho no afectan candidatos no-partner ────────

describe('Validación cruzada — señales nuevas no afectan candidatos sin partner signal', () => {
  it('Loggro ERP Colombia sigue en fitScore >= 65 (regresión v1.11 F1)', () => {
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
    const result = scoreCandidate(input);
    assert.ok(
      result.fitScore >= 65,
      `Loggro fitScore debe ser >= 65, got: ${result.fitScore}`,
    );
    const hasErp = result.fitBreakdown?.fit_reasons.some((r) => r.includes('product_erp'));
    assert.ok(hasErp, 'Loggro debe seguir teniendo product_erp');
  });

  it('ACTI implementación ERP sigue en fitScore [50, 65] (regresión v1.11 F3)', () => {
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
    const result = scoreCandidate(input);
    assert.ok(
      result.fitScore >= 50 && result.fitScore <= 65,
      `ACTI fitScore debe estar en [50, 65], got: ${result.fitScore}`,
    );
    const hasImpl = result.fitBreakdown?.fit_reasons.some((r) => r.includes('implementation'));
    assert.ok(hasImpl, 'ACTI debe seguir teniendo implementation_services');
  });

  it('duplicate_status existing_in_sellup → qualityLabel=duplicate (Softland regression end-to-end)', () => {
    const input: CandidateScoringInput = {
      name: 'Software ERP CRM y RRHH en Colombia',
      industry: 'Tecnología',
      sourcePriority: 'P1',
      countryCode: 'CO',
      country: 'Colombia',
      domain: 'softland.com',
      duplicateCheck: activeDuplicate('Softland', 'softland.com'),
    };
    const result = scoreCandidate(input);
    assert.equal(
      result.qualityLabel,
      'duplicate',
      `El candidato Softland duplicado debe quedar como "duplicate", got: ${result.qualityLabel}`,
    );
    assert.notEqual(result.metadata?.duplicateStatus, 'no_match');
  });
});

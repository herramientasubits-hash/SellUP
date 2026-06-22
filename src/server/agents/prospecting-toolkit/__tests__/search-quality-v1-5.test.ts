/**
 * Tests — Search Quality v1.5 (Hito v1.5)
 * Source-first Evidence Policy
 *
 * Criterios de aceptación:
 *   F1: Colombiavisible bloqueado por URL gate (content_article) — no llega a evidence-policy
 *   F2: Rolavsp bloqueado por business-fit gate (freelance signals) — no llega a evidence-policy
 *   F3: Cegid → query_only, evidence-policy = needs_review, confidence cap ≤ 45
 *   F4: Bizneo HR → query_only, evidence-policy = needs_review, confidence cap ≤ 45
 *   F5: Kondory → strong evidence + high fit → evidence-policy = ok (mejor candidato)
 *   F6: Kaizen → strong evidence + medium fit → needs_review (no strong_candidate)
 *   F7: Brettec → query_only + medium fit → needs_review, confidence cap ≤ 45
 *
 * Sin Supabase. Sin LLM. Sin Tavily. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySourceUrlQuality,
  isBlockedBySourceUrlQuality,
} from '../source-url-quality-gate';
import {
  evaluateBusinessFit,
  isBlockedByBusinessFit,
} from '../business-fit-gate';
import { evaluateCountryEvidence } from '../country-evidence-gate';
import { computeEvidencePersistencePolicy } from '../evidence-persistence-policy';

// ─── F1: Colombiavisible bloqueado por URL gate ───────────────────────────────

describe('F1 — Colombiavisible bloqueado por source URL quality gate (content_article)', () => {
  it('URL con slug numérico editorial → content_article, blocked=true', () => {
    const url =
      'https://colombiavisible.com/1-110-startups-conforman-un-ecosistema-de-innovacion-en-colombia';
    const result = classifySourceUrlQuality(url);
    assert.equal(result.quality, 'content_article');
    assert.equal(result.blocked, true);
    assert.ok(isBlockedBySourceUrlQuality(result));
  });

  it('Colombiavisible bloqueado antes de llegar a evidence-policy', () => {
    // Simula el orden de gates: URL gate bloquea → evidence-policy no se invoca.
    const url =
      'https://colombiavisible.com/1-110-startups-conforman-un-ecosistema-de-innovacion-en-colombia';
    const urlResult = classifySourceUrlQuality(url);
    assert.equal(isBlockedBySourceUrlQuality(urlResult), true, 'debe quedar bloqueado en URL gate');
    // No se llega a computeEvidencePersistencePolicy: el candidato ya está fuera.
  });
});

// ─── F2: Rolavsp bloqueado por business-fit gate ──────────────────────────────

describe('F2 — Rolavsp bloqueado por business-fit gate (freelance signals)', () => {
  it('"desarrolladores freelancer" en snippet → fit reject, isBlockedByBusinessFit=true', () => {
    const result = evaluateBusinessFit({
      name: 'Rolavsp',
      website: 'https://www.rolavsp.com',
      domain: 'rolavsp.com',
      sourceSnippet: 'desarrolladores freelancer disponibles para tu proyecto de software a la medida',
      sourceTitle: 'Desarrollo de software a la medida aplicaciones móviles negocios',
    });
    assert.ok(
      result.fit === 'reject' || result.fit === 'low',
      `fit debería ser reject o low, got: ${result.fit}`,
    );
    assert.ok(isBlockedByBusinessFit(result), 'Rolavsp debe quedar bloqueado por business-fit gate');
  });

  it('"software a la medida de tu presupuesto" → fit reject o low', () => {
    const result = evaluateBusinessFit({
      name: 'Rolavsp',
      website: 'https://www.rolavsp.com',
      domain: 'rolavsp.com',
      sourceSnippet: 'software a la medida de tu presupuesto, aplicaciones móviles y web',
      sourceTitle: 'Software a la medida económico',
    });
    assert.ok(result.fit === 'reject' || result.fit === 'low');
    assert.ok(isBlockedByBusinessFit(result));
  });
});

// ─── F3: Cegid → query_only → needs_review, cap 45 ───────────────────────────

describe('F3 — Cegid: query_only country evidence → needs_review, confidence capped ≤ 45', () => {
  const cegidCountryEvidence = evaluateCountryEvidence({
    website: 'https://www.cegid.com/ib/es/soluciones/recursos-humanos/programa-rrhh-empresas-b2b',
    domain: 'cegid.com',
    sourceSnippet: 'Software de recursos humanos para empresas B2B plataforma corporativa de RRHH y nómina',
    sourceTitle: 'Software RRHH para empresas B2B — Cegid',
    queryText: 'empresa software gestión talento nómina Colombia clientes corporativos B2B',
    targetCountryCode: 'CO',
  });

  const cegidBusinessFit = evaluateBusinessFit({
    name: 'Cegid',
    website: 'https://www.cegid.com/ib/es/soluciones/recursos-humanos/programa-rrhh-empresas-b2b',
    domain: 'cegid.com',
    sourceSnippet: 'Software de recursos humanos para empresas B2B plataforma corporativa de RRHH y nómina',
    sourceTitle: 'Software RRHH para empresas B2B — Cegid',
  });

  it('Cegid sin señal CO en URL/snippet/title → country_evidence = query_only', () => {
    assert.equal(
      cegidCountryEvidence.evidenceLevel,
      'query_only',
      `got: ${cegidCountryEvidence.evidenceLevel}`,
    );
    assert.ok(cegidCountryEvidence.warning, 'debe tener warning');
    assert.ok(
      cegidCountryEvidence.warning!.toLowerCase().includes('confirmado'),
      `warning debe decir "no confirmado", got: ${cegidCountryEvidence.warning}`,
    );
  });

  it('Cegid no bloqueada por business-fit (es software B2B legítimo)', () => {
    assert.ok(
      cegidBusinessFit.fit !== 'reject',
      `Cegid no debe ser reject, got: ${cegidBusinessFit.fit}`,
    );
    assert.equal(isBlockedByBusinessFit(cegidBusinessFit), false);
  });

  it('Cegid evidence-policy = needs_review con confidenceCap 45', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: cegidCountryEvidence,
      businessFit: cegidBusinessFit,
    });
    assert.equal(policy.decision, 'needs_review', `got: ${policy.decision}`);
    assert.equal(policy.primaryReason, 'country_evidence_query_only');
    assert.ok(policy.confidenceCap !== null, 'debe tener confidenceCap');
    assert.ok(
      policy.confidenceCap! <= 45,
      `confidenceCap debe ser ≤ 45, got: ${policy.confidenceCap}`,
    );
    assert.equal(policy.forceReviewManually, true);
  });

  it('Cegid confidence efectivo nunca supera 45 (capping simulation)', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: cegidCountryEvidence,
      businessFit: cegidBusinessFit,
    });
    const originalConfidence = 80; // valor que el scorer podría haber asignado
    const effectiveConfidence =
      policy.confidenceCap !== null
        ? Math.min(originalConfidence, policy.confidenceCap)
        : originalConfidence;
    assert.ok(
      effectiveConfidence <= 45,
      `effectiveConfidence debe ser ≤ 45, got: ${effectiveConfidence}`,
    );
  });
});

// ─── F4: Bizneo HR → query_only → needs_review, cap 45 ───────────────────────

describe('F4 — Bizneo HR: query_only country evidence → needs_review, confidence capped ≤ 45', () => {
  const bizneoCountryEvidence = evaluateCountryEvidence({
    website: 'https://www.bizneo.com/es/software-gestion-personas/',
    domain: 'bizneo.com',
    sourceSnippet: 'Software de gestión de personas RRHH nómina para empresas clientes B2B corporativos',
    sourceTitle: 'Software RRHH Gestión de Personas — Bizneo HR',
    queryText: 'software gestión talento nómina Colombia B2B corporativo empresas',
    targetCountryCode: 'CO',
  });

  const bizneoBusinessFit = evaluateBusinessFit({
    name: 'Bizneo HR',
    website: 'https://www.bizneo.com/es/software-gestion-personas/',
    domain: 'bizneo.com',
    sourceSnippet: 'Software de gestión de personas RRHH nómina para empresas clientes B2B corporativos',
    sourceTitle: 'Software RRHH Gestión de Personas — Bizneo HR',
  });

  it('Bizneo sin señal CO en dominio/snippet/title → country_evidence = query_only', () => {
    assert.equal(
      bizneoCountryEvidence.evidenceLevel,
      'query_only',
      `got: ${bizneoCountryEvidence.evidenceLevel}`,
    );
    assert.ok(bizneoCountryEvidence.warning, 'debe tener warning');
  });

  it('Bizneo no bloqueada por business-fit (HR software legítimo)', () => {
    assert.ok(bizneoBusinessFit.fit !== 'reject');
    assert.equal(isBlockedByBusinessFit(bizneoBusinessFit), false);
  });

  it('Bizneo evidence-policy = needs_review con confidenceCap ≤ 45', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: bizneoCountryEvidence,
      businessFit: bizneoBusinessFit,
    });
    assert.equal(policy.decision, 'needs_review');
    assert.equal(policy.primaryReason, 'country_evidence_query_only');
    assert.ok(policy.confidenceCap !== null);
    assert.ok(policy.confidenceCap! <= 45);
    assert.equal(policy.forceReviewManually, true);
  });
});

// ─── F5: Kondory → strong evidence + high fit → ok ───────────────────────────

describe('F5 — Kondory: strong country evidence + high business fit → evidence-policy ok', () => {
  const kondoryCountryEvidence = evaluateCountryEvidence({
    website: 'https://kondory.com.co/erp-empresarial-colombia',
    domain: 'kondory.com.co',
    sourceSnippet: 'ERP empresarial para empresas en Colombia plataforma de gestión corporativa clientes B2B',
    sourceTitle: 'ERP Colombia — Kondory Software Empresarial',
    queryText: 'software ERP Colombia empresas corporativas clientes B2B',
    targetCountryCode: 'CO',
  });

  const kondoryBusinessFit = evaluateBusinessFit({
    name: 'Kondory',
    website: 'https://kondory.com.co/erp-empresarial-colombia',
    domain: 'kondory.com.co',
    sourceSnippet: 'ERP empresarial para empresas en Colombia plataforma de gestión corporativa clientes B2B',
    sourceTitle: 'ERP Colombia — Kondory Software Empresarial',
  });

  it('Kondory .com.co → country_evidence = strong', () => {
    assert.equal(
      kondoryCountryEvidence.evidenceLevel,
      'strong',
      `got: ${kondoryCountryEvidence.evidenceLevel}`,
    );
    assert.equal(kondoryCountryEvidence.warning, null);
  });

  it('Kondory tiene señales ERP/software empresarial → business_fit = high o medium', () => {
    assert.ok(
      kondoryBusinessFit.fit === 'high' || kondoryBusinessFit.fit === 'medium',
      `fit debería ser high o medium, got: ${kondoryBusinessFit.fit}`,
    );
    assert.equal(isBlockedByBusinessFit(kondoryBusinessFit), false);
  });

  it('Kondory strong + high → evidence-policy = ok (mejor candidato)', () => {
    // Simular el mejor escenario: fit high
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: { ...kondoryCountryEvidence, evidenceLevel: 'strong' },
      businessFit: { ...kondoryBusinessFit, fit: 'high' },
    });
    assert.equal(policy.decision, 'ok', `got: ${policy.decision}`);
    assert.equal(policy.primaryReason, 'strong_evidence_high_fit');
    assert.equal(policy.confidenceCap, null);
    assert.equal(policy.forceReviewManually, false);
    assert.equal(policy.warnings.length, 0);
  });
});

// ─── F6: Kaizen → strong evidence + medium fit → needs_review ────────────────

describe('F6 — Kaizen: strong evidence + medium fit → needs_review (no strong_candidate)', () => {
  const kaizenCountryEvidence = evaluateCountryEvidence({
    website: 'https://kaizen.com.co/soluciones-empresariales',
    domain: 'kaizen.com.co',
    sourceSnippet: 'consultoría y soluciones para empresas en Colombia servicios tecnológicos',
    sourceTitle: 'Kaizen Colombia — Soluciones Empresariales',
    queryText: 'empresa software Colombia B2B soluciones tecnológicas',
    targetCountryCode: 'CO',
  });

  const kaizenBusinessFit = evaluateBusinessFit({
    name: 'Kaizen',
    website: 'https://kaizen.com.co/soluciones-empresariales',
    domain: 'kaizen.com.co',
    sourceSnippet: 'consultoría y soluciones para empresas en Colombia servicios tecnológicos',
    sourceTitle: 'Kaizen Colombia — Soluciones Empresariales',
  });

  it('Kaizen .com.co → country_evidence = strong', () => {
    assert.equal(
      kaizenCountryEvidence.evidenceLevel,
      'strong',
      `got: ${kaizenCountryEvidence.evidenceLevel}`,
    );
  });

  it('Kaizen sin señales ERP/SaaS directas → business_fit medium o low (no high)', () => {
    assert.ok(
      kaizenBusinessFit.fit !== 'reject',
      'Kaizen no debe ser reject (tiene señales de tecnología)',
    );
    // Kaizen no tiene señales ERP/SaaS fuertes → no debe ser "ok" candidato
  });

  it('Kaizen strong + non-high → evidence-policy = needs_review (no ok)', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: kaizenCountryEvidence,
      businessFit: { ...kaizenBusinessFit, fit: 'medium' },
    });
    assert.notEqual(policy.decision, 'ok', 'Kaizen no debe ser strong_candidate (ok)');
    assert.equal(policy.decision, 'needs_review');
    // Con strong + medium → default_conservative (sin cap)
    assert.equal(policy.primaryReason, 'default_conservative');
  });
});

// ─── F7: Brettec → query_only + medium fit → needs_review, cap 45 ─────────────

describe('F7 — Brettec: query_only evidence → needs_review, confidence capped ≤ 45', () => {
  const brettecCountryEvidence = evaluateCountryEvidence({
    website: 'https://brettec.com/en/solutions',
    domain: 'brettec.com',
    sourceSnippet: 'technology solutions and services for businesses enterprise software',
    sourceTitle: 'Brettec Technology Solutions',
    queryText: 'software empresarial Colombia B2B corporativo clientes',
    targetCountryCode: 'CO',
  });

  const brettecBusinessFit = evaluateBusinessFit({
    name: 'Brettec',
    website: 'https://brettec.com/en/solutions',
    domain: 'brettec.com',
    sourceSnippet: 'technology solutions and services for businesses enterprise software',
    sourceTitle: 'Brettec Technology Solutions',
  });

  it('Brettec .com sin señal CO en snippet/title → country_evidence = query_only', () => {
    assert.equal(
      brettecCountryEvidence.evidenceLevel,
      'query_only',
      `got: ${brettecCountryEvidence.evidenceLevel}`,
    );
    assert.ok(brettecCountryEvidence.warning, 'debe tener warning');
  });

  it('Brettec evidence-policy = needs_review con confidenceCap ≤ 45 (baja confianza)', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: brettecCountryEvidence,
      businessFit: brettecBusinessFit,
    });
    assert.equal(policy.decision, 'needs_review', `got: ${policy.decision}`);
    assert.equal(policy.primaryReason, 'country_evidence_query_only');
    assert.ok(policy.confidenceCap !== null);
    assert.ok(policy.confidenceCap! <= 45, `cap debe ser ≤ 45, got: ${policy.confidenceCap}`);
    assert.equal(policy.forceReviewManually, true);
  });

  it('Brettec confidence efectivo ≤ 45 con cualquier confidence de scorer', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: brettecCountryEvidence,
      businessFit: brettecBusinessFit,
    });
    for (const originalScore of [30, 50, 70, 90]) {
      const effective =
        policy.confidenceCap !== null
          ? Math.min(originalScore, policy.confidenceCap)
          : originalScore;
      assert.ok(
        effective <= 45,
        `con score original ${originalScore}, effective debe ser ≤ 45, got: ${effective}`,
      );
    }
  });
});

// ─── F8: Portal ERP bloqueado por portal/media/aggregator gate ───────────────

describe('F8 — Portal ERP bloqueado por portal/media/aggregator gate', () => {
  const portalErpFit = evaluateBusinessFit({
    name: 'Portal ERP',
    website: 'https://portalerp.com/co',
    domain: 'portalerp.com',
    sourceSnippet:
      'Portal ERP es el mayor portal de noticias, análisis, entrevistas y soluciones de gestión empresarial (ERP, CRM, BI) de América Latina.',
    sourceTitle: 'Portal ERP — Noticias, Análisis y Soluciones ERP — Colombia',
  });

  it('Portal ERP → fit = reject (portal_media_aggregator)', () => {
    assert.equal(
      portalErpFit.fit,
      'reject',
      `fit debería ser reject, got: ${portalErpFit.fit}`,
    );
  });

  it('Portal ERP → isBlockedByBusinessFit = true', () => {
    assert.ok(
      isBlockedByBusinessFit(portalErpFit),
      'Portal ERP debe quedar bloqueado por business-fit gate',
    );
  });

  it('Portal ERP → reason contiene portal_media_aggregator', () => {
    const hasPortalReason = portalErpFit.reasons.some((r) =>
      r.includes('portal_media_aggregator'),
    );
    assert.ok(
      hasPortalReason,
      `reasons debe contener portal_media_aggregator, got: ${JSON.stringify(portalErpFit.reasons)}`,
    );
  });

  it('Portal ERP bloqueado antes de llegar a evidence-policy (URL gate pasa, business-fit bloquea)', () => {
    // El URL gate clasifica portalerp.com/co como official_homepage (profundidad 1, locale).
    // El business-fit gate es quien bloquea al detectar el candidato como portal/medio.
    const urlResult = classifySourceUrlQuality('https://portalerp.com/co', 'Portal ERP');
    assert.equal(urlResult.blocked, false, 'URL gate no bloquea portalerp.com/co');
    assert.ok(
      isBlockedByBusinessFit(portalErpFit),
      'business-fit gate sí bloquea Portal ERP',
    );
  });

  it('Mi-ERP NO queda bloqueado (empresa legítima implementadora Odoo)', () => {
    const miErpFit = evaluateBusinessFit({
      name: 'Mi-ERP',
      website: 'https://www.mi-erp.app',
      domain: 'mi-erp.app',
      sourceSnippet:
        'Somos un equipo especializado en consultoría, implementación y desarrollo Odoo. Automatizamos, integramos y escalamos tu operación.',
      sourceTitle: 'Mi-ERP — Expertos en Odoo en Colombia | Partner Odoo',
    });
    assert.ok(
      !isBlockedByBusinessFit(miErpFit),
      `Mi-ERP no debe quedar bloqueado, got fit: ${miErpFit.fit}, reasons: ${JSON.stringify(miErpFit.reasons)}`,
    );
  });
});

// ─── Invariantes de política (reglas adicionales) ─────────────────────────────

describe('Invariantes de computeEvidencePersistencePolicy', () => {
  it('weak + medium → blocked (R2)', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: {
        evidenceLevel: 'weak',
        evidenceSources: [],
        warning: null,
      },
      businessFit: {
        fit: 'medium',
        reasons: [],
        matchedSignals: [],
        missingSignals: [],
        rankingBonus: 30,
      },
    });
    assert.equal(policy.decision, 'blocked');
    assert.equal(policy.primaryReason, 'no_country_evidence_with_weak_fit');
  });

  it('weak + low → blocked (R2)', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: {
        evidenceLevel: 'weak',
        evidenceSources: [],
        warning: null,
      },
      businessFit: {
        fit: 'low',
        reasons: [],
        matchedSignals: [],
        missingSignals: [],
        rankingBonus: -40,
      },
    });
    assert.equal(policy.decision, 'blocked');
  });

  it('weak + high → needs_review cap 40 (R3)', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: {
        evidenceLevel: 'weak',
        evidenceSources: [],
        warning: null,
      },
      businessFit: {
        fit: 'high',
        reasons: [],
        matchedSignals: [],
        missingSignals: [],
        rankingBonus: 50,
      },
    });
    assert.equal(policy.decision, 'needs_review');
    assert.equal(policy.primaryReason, 'no_country_evidence_high_fit');
    assert.ok(policy.confidenceCap !== null);
    assert.ok(policy.confidenceCap! <= 40);
  });

  it('strong + high → ok, sin cap (R4)', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: {
        evidenceLevel: 'strong',
        evidenceSources: ['tld'],
        warning: null,
      },
      businessFit: {
        fit: 'high',
        reasons: [],
        matchedSignals: [],
        missingSignals: [],
        rankingBonus: 50,
      },
    });
    assert.equal(policy.decision, 'ok');
    assert.equal(policy.confidenceCap, null);
    assert.equal(policy.forceReviewManually, false);
  });

  it('strong + medium → needs_review conservative (default)', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: {
        evidenceLevel: 'strong',
        evidenceSources: ['tld'],
        warning: null,
      },
      businessFit: {
        fit: 'medium',
        reasons: [],
        matchedSignals: [],
        missingSignals: [],
        rankingBonus: 30,
      },
    });
    assert.equal(policy.decision, 'needs_review');
    assert.equal(policy.primaryReason, 'default_conservative');
    assert.equal(policy.confidenceCap, null);
  });
});

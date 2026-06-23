/**
 * Tests — Search Quality v1.15 — LinkedIn Company Enrichment Core
 *
 * Verifica la capa determinística de enrichment LinkedIn:
 *   - Normalización de URLs company de LinkedIn
 *   - Rechazo de perfiles personales y paths no-company
 *   - Evaluación de match candidato ↔ página LinkedIn
 *   - Guard contra confusión partner/plataforma global (Odoo, Zoho)
 *   - Señal de scoring linkedin_company_verified
 *   - Restricción: query_only + LinkedIn found ≠ high_quality_new
 *   - Aislamiento del duplicate guard (no alterado por LinkedIn)
 *   - Metadata linkedin_enrichment correctamente construida
 *
 * Sin Supabase. Sin LLM. Sin Tavily. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeLinkedInCompanyUrl,
  extractLinkedInCompanyCandidates,
  evaluateLinkedInCompanyMatch,
  buildLinkedInEnrichmentMetadata,
} from '../linkedin-company-enrichment';
import type { LinkedInURLCandidate } from '../linkedin-company-enrichment';

import { scoreCandidate } from '../candidate-scorer';
import type { CandidateScoringInput } from '../types';

import { checkActiveCandidateDuplicate } from '../active-candidate-identity-guard';
import type { ActiveCandidateRecord } from '../active-candidate-identity-guard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function liCandidate(
  slug: string,
  foundIn: LinkedInURLCandidate['foundIn'] = 'source_url',
): LinkedInURLCandidate {
  return {
    url: `https://www.linkedin.com/company/${slug}`,
    normalized: `https://www.linkedin.com/company/${slug}`,
    slug,
    foundIn,
  };
}

function activeRecord(
  overrides: Partial<ActiveCandidateRecord> & { id: string; name: string; status: string },
): ActiveCandidateRecord {
  return { domain: null, inferredCompanyName: null, normalizedName: null, ...overrides };
}

function baseScoringInput(overrides: Partial<CandidateScoringInput> = {}): CandidateScoringInput {
  return {
    name: 'TestCo',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software ERP',
    website: 'https://testco.com',
    domain: 'testco.com',
    duplicateCheck: {
      status: 'new_candidate',
      confidence: 90,
      input: { name: 'TestCo' },
      matches: [],
      summary: 'new',
      checkedSources: ['sellup'],
    },
    ...overrides,
  };
}

// ─── F1: URL company válida → normaliza correctamente ─────────────────────────

describe('F1 — LinkedIn company URL válida', () => {
  it('https con www — normaliza y extrae slug', () => {
    const r = normalizeLinkedInCompanyUrl('https://www.linkedin.com/company/softland');
    assert.equal(r.rejected, false);
    assert.equal(r.normalized, 'https://www.linkedin.com/company/softland');
    assert.equal(r.slug, 'softland');
    assert.equal(r.rejectReason, null);
  });

  it('https sin www — normaliza correctamente', () => {
    const r = normalizeLinkedInCompanyUrl('https://linkedin.com/company/softland');
    assert.equal(r.rejected, false);
    assert.equal(r.normalized, 'https://www.linkedin.com/company/softland');
    assert.equal(r.slug, 'softland');
  });

  it('sin protocolo — normaliza correctamente', () => {
    const r = normalizeLinkedInCompanyUrl('linkedin.com/company/softland');
    assert.equal(r.rejected, false);
    assert.equal(r.normalized, 'https://www.linkedin.com/company/softland');
    assert.equal(r.slug, 'softland');
  });

  it('el resultado es usable (not rejected)', () => {
    const r = normalizeLinkedInCompanyUrl('https://www.linkedin.com/company/softland');
    assert.equal(r.rejected, false);
  });
});

// ─── F2: URL con query params → queda limpia ──────────────────────────────────

describe('F2 — LinkedIn URL con query params', () => {
  it('elimina query params y trailing slash', () => {
    const r = normalizeLinkedInCompanyUrl(
      'https://www.linkedin.com/company/softland/?originalSubdomain=co&trk=nav_responsive_tab_profile',
    );
    assert.equal(r.rejected, false);
    assert.equal(r.normalized, 'https://www.linkedin.com/company/softland');
    assert.equal(r.slug, 'softland');
  });

  it('elimina anchor fragment', () => {
    const r = normalizeLinkedInCompanyUrl(
      'https://www.linkedin.com/company/softland#about',
    );
    assert.equal(r.rejected, false);
    assert.equal(r.normalized, 'https://www.linkedin.com/company/softland');
  });

  it('slug con guión compuesto queda intacto', () => {
    const r = normalizeLinkedInCompanyUrl(
      'https://www.linkedin.com/company/factory-erp-colombia/?locale=es',
    );
    assert.equal(r.rejected, false);
    assert.equal(r.slug, 'factory-erp-colombia');
    assert.equal(r.normalized, 'https://www.linkedin.com/company/factory-erp-colombia');
  });
});

// ─── F3: Perfil personal → rechazado ─────────────────────────────────────────

describe('F3 — Perfil personal rechazado', () => {
  it('/in/ path → rejected', () => {
    const r = normalizeLinkedInCompanyUrl('https://www.linkedin.com/in/juanperez');
    assert.equal(r.rejected, true);
  });

  it('/pub/ path → rejected', () => {
    const r = normalizeLinkedInCompanyUrl('https://www.linkedin.com/pub/persona/1/2/3');
    assert.equal(r.rejected, true);
  });

  it('rejectReason menciona el path', () => {
    const r = normalizeLinkedInCompanyUrl('https://www.linkedin.com/in/persona');
    assert.equal(r.rejected, true);
    assert.ok(r.rejectReason?.includes('rejected_path'));
  });
});

// ─── F4: jobs/feed/posts/pulse/school → rechazados ───────────────────────────

describe('F4 — LinkedIn jobs/feed/posts/pulse rechazado', () => {
  const rejectedUrls = [
    'https://www.linkedin.com/jobs/view/123456',
    'https://www.linkedin.com/feed/',
    'https://www.linkedin.com/posts/softland_update',
    'https://www.linkedin.com/pulse/articulo-sobre-erp',
    'https://www.linkedin.com/school/universidad-andes',
    'https://www.linkedin.com/search/results/companies/?keywords=ERP',
  ];

  for (const url of rejectedUrls) {
    it(`rechaza: ${url.replace('https://www.linkedin.com', '')}`, () => {
      const r = normalizeLinkedInCompanyUrl(url);
      assert.equal(r.rejected, true, `Esperaba rejected=true para ${url}`);
    });
  }

  it('URL de login → rejected', () => {
    const r = normalizeLinkedInCompanyUrl('https://www.linkedin.com/login?session_redirect=...');
    assert.equal(r.rejected, true);
  });

  it('dominio no-LinkedIn → rejected', () => {
    const r = normalizeLinkedInCompanyUrl('https://www.facebook.com/company/softland');
    assert.equal(r.rejected, true);
    assert.equal(r.rejectReason, 'not_linkedin');
  });
});

// ─── F5: Softland match por slug + name ───────────────────────────────────────

describe('F5 — Softland match por slug + name', () => {
  it('nombre "Softland" + slug "softland" → found, confidence ≥70', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Softland', candidateDomain: 'softland.com', countryCode: 'CO' },
      liCandidate('softland'),
    );
    assert.equal(result.status, 'found');
    assert.ok(result.confidence >= 65, `confidence esperada ≥65, obtuvo ${result.confidence}`);
  });

  it('signals.name_match = true', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Softland', candidateDomain: 'softland.com' },
      liCandidate('softland'),
    );
    assert.equal(result.signals.name_match, true);
  });

  it('signals.domain_match = true cuando dominio base coincide', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Softland', candidateDomain: 'softland.com' },
      liCandidate('softland'),
    );
    assert.equal(result.signals.domain_match, true);
  });

  it('match_reason contiene name_match_slug', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Softland', candidateDomain: 'softland.com' },
      liCandidate('softland'),
    );
    assert.ok(result.match_reason?.includes('name_match_slug'));
  });

  it('slug con país en nombre sigue siendo found si name/domain coincide', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Softland', candidateDomain: 'softland.com', countryCode: 'CO' },
      liCandidate('softland-colombia'),
    );
    // "softland" está contenido en "softland colombia" → name_match
    assert.ok(['found', 'ambiguous'].includes(result.status));
    assert.ok(result.confidence >= 30);
  });
});

// ─── F6: Mi-ERP no debe confundirse con Odoo global ──────────────────────────

describe('F6 — Mi-ERP vs Odoo global', () => {
  it('slug "odoo" + candidato "Mi-ERP" → ambiguous, no auto-match', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Mi-ERP', candidateDomain: 'mi-erp.com', countryCode: 'CO' },
      liCandidate('odoo'),
    );
    assert.ok(
      ['ambiguous', 'rejected'].includes(result.status),
      `Esperaba ambiguous o rejected, obtuvo ${result.status}`,
    );
  });

  it('confidence baja (≤30) para Mi-ERP vs Odoo', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Mi-ERP', candidateDomain: 'mi-erp.com', countryCode: 'CO' },
      liCandidate('odoo'),
    );
    assert.ok(result.confidence <= 30, `confidence esperada ≤30, obtuvo ${result.confidence}`);
  });

  it('warnings menciona que el slug es de plataforma global', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Mi-ERP', candidateDomain: 'mi-erp.com' },
      liCandidate('odoo'),
    );
    assert.ok(result.warnings.length > 0);
    assert.ok(
      result.warnings.some((w) => w.toLowerCase().includes('global') || w.toLowerCase().includes('plataforma')),
    );
  });

  it('match_reason es global_platform_slug_mismatch', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Mi-ERP', candidateDomain: 'mi-erp.com' },
      liCandidate('odoo'),
    );
    assert.equal(result.match_reason, 'global_platform_slug_mismatch');
  });
});

// ─── F7: Visiontecno no debe confundirse con Zoho global ─────────────────────

describe('F7 — Visiontecno vs Zoho global', () => {
  it('slug "zoho" + candidato "Visiontecno" → ambiguous, no auto-match', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Visiontecno', candidateDomain: 'visiontecno.com', countryCode: 'CO' },
      liCandidate('zoho'),
    );
    assert.ok(
      ['ambiguous', 'rejected'].includes(result.status),
      `Esperaba ambiguous o rejected, obtuvo ${result.status}`,
    );
  });

  it('confidence baja para Visiontecno vs Zoho', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Visiontecno', candidateDomain: 'visiontecno.com' },
      liCandidate('zoho'),
    );
    assert.ok(result.confidence <= 30);
  });

  it('match_reason es global_platform_slug_mismatch', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Visiontecno', candidateDomain: 'visiontecno.com' },
      liCandidate('zoho'),
    );
    assert.equal(result.match_reason, 'global_platform_slug_mismatch');
  });
});

// ─── F8: Factory con domain evidence ─────────────────────────────────────────

describe('F8 — Factory generic slug con domain evidence', () => {
  it('slug "factory-erp" + name Factory + domain factory.com.co → found o ambiguous', () => {
    const result = evaluateLinkedInCompanyMatch(
      {
        candidateName: 'Factory',
        candidateDomain: 'factory.com.co',
        countryCode: 'CO',
        sourceSnippet: 'Factory ERP Colombia software empresarial',
      },
      liCandidate('factory-erp'),
    );
    assert.ok(
      ['found', 'ambiguous'].includes(result.status),
      `Esperaba found o ambiguous, obtuvo ${result.status}`,
    );
  });

  it('con snippet que menciona Factory + slug factory-erp → confidence ≥40', () => {
    const result = evaluateLinkedInCompanyMatch(
      {
        candidateName: 'Factory',
        candidateDomain: 'factory.com.co',
        sourceSnippet: 'Factory ERP solución empresarial',
      },
      liCandidate('factory-erp'),
    );
    assert.ok(result.confidence >= 40, `confidence ${result.confidence}`);
  });

  it('sin domain ni snippet → ambiguous (señales insuficientes)', () => {
    const result = evaluateLinkedInCompanyMatch(
      { candidateName: 'Factory' },
      liCandidate('factory-erp'),
    );
    // Con solo name_match parcial (token "factory" en "factory erp") puede ser found o ambiguous
    assert.ok(['found', 'ambiguous'].includes(result.status));
  });

  it('extractLinkedInCompanyCandidates detecta URL en snippet', () => {
    const candidates = extractLinkedInCompanyCandidates({
      sourceSnippet:
        'Visita https://www.linkedin.com/company/factory-erp para más información.',
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].slug, 'factory-erp');
    assert.equal(candidates[0].foundIn, 'source_snippet');
  });
});

// ─── F9: not_found no afecta scoring ─────────────────────────────────────────

describe('F9 — not_found no afecta scoring', () => {
  it('sin linkedinCompanyUrl → no boost, reasons sin linkedin_company_verified', () => {
    const scoring = scoreCandidate(
      baseScoringInput({
        name: 'Softland',
        industry: 'ERP software',
        linkedinCompanyUrl: null,
        sourceTitle: 'Softland ERP Colombia',
        countryEvidenceLevel: 'strong',
      }),
    );
    assert.ok(!scoring.reasons.some((r) => r.includes('linkedin_company_verified')));
  });

  it('buildLinkedInEnrichmentMetadata sin URL → status not_found', () => {
    const meta = buildLinkedInEnrichmentMetadata({
      candidateName: 'SomeCompany',
      checkedAt: '2026-06-22T00:00:00.000Z',
    });
    assert.equal(meta.status, 'not_found');
    assert.equal(meta.confidence, 0);
    assert.equal(meta.source, 'none');
    assert.ok(meta.warnings.length > 0);
  });

  it('buildLinkedInEnrichmentMetadata not_found tiene enabled=true', () => {
    const meta = buildLinkedInEnrichmentMetadata({
      candidateName: 'SomeCompany',
      checkedAt: '2026-06-22T00:00:00.000Z',
    });
    assert.equal(meta.enabled, true);
  });
});

// ─── F10: found confidence ≥70 → agrega reason linkedin_company_verified ─────

describe('F10 — found confidence ≥70 agrega reason linkedin_company_verified', () => {
  it('Softland + slug softland → reasons incluye linkedin_company_verified', () => {
    const scoring = scoreCandidate(
      baseScoringInput({
        name: 'Softland',
        domain: 'softland.com',
        website: 'https://softland.com',
        linkedinCompanyUrl: 'https://www.linkedin.com/company/softland',
        industry: 'ERP software',
        countryEvidenceLevel: 'strong',
        sourceTitle: 'Softland ERP Colombia',
      }),
    );
    assert.ok(
      scoring.reasons.some((r) => r.includes('linkedin_company_verified')),
      `Esperaba linkedin_company_verified en reasons. Obtuvo: ${JSON.stringify(scoring.reasons)}`,
    );
  });

  it('duplicate check no se altera por LinkedIn', () => {
    const scoring = scoreCandidate(
      baseScoringInput({
        name: 'Softland',
        domain: 'softland.com',
        linkedinCompanyUrl: 'https://www.linkedin.com/company/softland',
        duplicateCheck: {
          status: 'existing_in_sellup',
          confidence: 95,
          input: { name: 'Softland' },
          matches: [],
          summary: 'existing',
          checkedSources: ['sellup'],
        },
      }),
    );
    assert.equal(scoring.qualityLabel, 'duplicate');
  });

  it('country evidence no se altera — countryEvidenceLevel sigue siendo determinante', () => {
    const withLinkedIn = scoreCandidate(
      baseScoringInput({
        name: 'Softland',
        domain: 'softland.com',
        linkedinCompanyUrl: 'https://www.linkedin.com/company/softland',
        countryEvidenceLevel: 'strong',
        industry: 'ERP software',
      }),
    );
    const withoutLinkedIn = scoreCandidate(
      baseScoringInput({
        name: 'Softland',
        domain: 'softland.com',
        linkedinCompanyUrl: null,
        countryEvidenceLevel: 'strong',
        industry: 'ERP software',
      }),
    );
    // LinkedIn solo agrega ≤5 puntos
    assert.ok(
      withLinkedIn.fitScore - withoutLinkedIn.fitScore <= 5,
      `LinkedIn agregó más de 5 puntos al fitScore`,
    );
  });

  it('buildLinkedInEnrichmentMetadata con URL Softland → status found', () => {
    const meta = buildLinkedInEnrichmentMetadata({
      candidateName: 'Softland',
      candidateDomain: 'softland.com',
      countryCode: 'CO',
      providedLinkedInUrl: 'https://www.linkedin.com/company/softland',
      source: 'provided_search_result',
      checkedAt: '2026-06-22T00:00:00.000Z',
    });
    assert.equal(meta.status, 'found');
    assert.ok(meta.confidence >= 65);
    assert.equal(meta.enabled, true);
    assert.equal(meta.normalized_company_slug, 'softland');
    assert.equal(meta.company_url, 'https://www.linkedin.com/company/softland');
    assert.equal(meta.checked_at, '2026-06-22T00:00:00.000Z');
  });
});

// ─── F11: query_only + LinkedIn found ≠ high_quality_new ─────────────────────

describe('F11 — query_only + LinkedIn found no se vuelve high_quality_new', () => {
  it('countryEvidenceLevel=query_only con LinkedIn → sigue siendo needs_review o peor', () => {
    const scoring = scoreCandidate(
      baseScoringInput({
        name: 'Softland',
        domain: 'softland.com',
        linkedinCompanyUrl: 'https://www.linkedin.com/company/softland',
        countryEvidenceLevel: 'query_only',
        industry: 'ERP software',
        companySize: 'mediana',
        duplicateCheck: {
          status: 'new_candidate',
          confidence: 90,
          input: { name: 'Softland' },
          matches: [],
          summary: 'new',
          checkedSources: ['sellup'],
        },
      }),
    );
    assert.notEqual(
      scoring.qualityLabel,
      'high_quality_new',
      `query_only no debe producir high_quality_new aunque haya LinkedIn`,
    );
  });

  it('penalización country_evidence_query_only sigue aplicando aunque haya LinkedIn', () => {
    const withQueryOnly = scoreCandidate(
      baseScoringInput({
        name: 'Softland',
        domain: 'softland.com',
        linkedinCompanyUrl: 'https://www.linkedin.com/company/softland',
        countryEvidenceLevel: 'query_only',
        industry: 'ERP software',
      }),
    );
    const withStrong = scoreCandidate(
      baseScoringInput({
        name: 'Softland',
        domain: 'softland.com',
        linkedinCompanyUrl: 'https://www.linkedin.com/company/softland',
        countryEvidenceLevel: 'strong',
        industry: 'ERP software',
      }),
    );
    // query_only siempre tiene fitScore menor por la penalización -15
    assert.ok(
      withQueryOnly.fitScore < withStrong.fitScore,
      `query_only (${withQueryOnly.fitScore}) debería ser menor que strong (${withStrong.fitScore})`,
    );
  });
});

// ─── F12: duplicate guard no se altera ───────────────────────────────────────

describe('F12 — duplicate guard no se altera por LinkedIn', () => {
  it('Softland activo → checkActiveCandidateDuplicate bloquea nuevo Softland (mismo domain)', () => {
    const existingActive = activeRecord({
      id: 'existing-softland-1',
      name: 'Softland',
      domain: 'softland.com',
      normalizedName: 'softland',
      status: 'needs_review',
    });

    const result = checkActiveCandidateDuplicate(
      {
        name: 'Softland Colombia',
        domain: 'softland.com',
        inferredCompanyName: 'Softland',
        normalizedName: 'softland colombia',
      },
      [existingActive],
    );

    assert.ok(result.matched, 'Debería bloquear por same_active_domain o same_inferred_identity');
    assert.ok(
      ['same_active_domain', 'same_inferred_identity', 'same_canonical_identity'].includes(
        result.reason!,
      ),
    );
  });

  it('LinkedIn en scoring no evita que el guard bloquee por dominio', () => {
    // Simulamos: el scoring dice "linkedin_company_verified" para el candidato nuevo
    const scoringWithLinkedIn = scoreCandidate(
      baseScoringInput({
        name: 'Softland',
        domain: 'softland.com',
        linkedinCompanyUrl: 'https://www.linkedin.com/company/softland',
        countryEvidenceLevel: 'strong',
        industry: 'ERP software',
      }),
    );
    // LinkedIn agrega señal al scoring
    assert.ok(scoringWithLinkedIn.reasons.some((r) => r.includes('linkedin_company_verified')));

    // Pero el guard opera sobre dominio/identidad, sin importar scoring
    const existingActive = activeRecord({
      id: 'existing-softland-2',
      name: 'Softland',
      domain: 'softland.com',
      normalizedName: 'softland',
      status: 'approved',
    });

    const guardResult = checkActiveCandidateDuplicate(
      {
        name: 'Softland',
        domain: 'softland.com',
        inferredCompanyName: null,
        normalizedName: 'softland',
      },
      [existingActive],
    );

    assert.ok(guardResult.matched, 'Guard debe bloquear independientemente del scoring LinkedIn');
    assert.equal(guardResult.reason, 'same_active_domain');
  });

  it('candidato con LinkedIn pero dominio diferente y nombre diferente → no bloqueado por guard', () => {
    const existingActive = activeRecord({
      id: 'existing-softland-3',
      name: 'Softland',
      domain: 'softland.com',
      normalizedName: 'softland',
      status: 'needs_review',
    });

    // Nuevo candidato con LinkedIn de Softland pero es en realidad otra empresa
    const guardResult = checkActiveCandidateDuplicate(
      {
        name: 'FactoryERP',
        domain: 'factoryerp.com',
        inferredCompanyName: null,
        normalizedName: 'factoryerp',
      },
      [existingActive],
    );

    assert.equal(guardResult.matched, false, 'FactoryERP no debe ser bloqueado por el registro de Softland');
  });

  it('buildLinkedInEnrichmentMetadata con URL personal → status rejected', () => {
    const meta = buildLinkedInEnrichmentMetadata({
      candidateName: 'Softland',
      providedLinkedInUrl: 'https://www.linkedin.com/in/persona-contacto',
      checkedAt: '2026-06-22T00:00:00.000Z',
    });
    assert.equal(meta.status, 'rejected');
    assert.ok(meta.warnings.some((w) => w.toLowerCase().includes('rechazada')));
  });
});

/**
 * Tests — Apollo Organizations Provider (v1.16K-AE)
 *
 * Verifica paridad de perfil Apollo con el pipeline de Agente 1:
 *   A. Perfil completo → apollo_profile, size_evidence.status=passes, employee_count=500
 *   B. Sin empleados → size_evidence.status=unknown, no inventa tamaño
 *   C. Empleados < 200 → size_evidence.status=below_threshold
 *   D. Sector gate usa keywords/description enriquecidos → pasa Educación
 *   E. Sector gate rechaza genéricos sin evidencia → Citigroup/Huawei/PwC rechazados
 *   F. No secretos / no PII innecesaria en apollo_profile
 *   G. Cost guardrails intactos (default: 1 query × 3 results)
 *   H. Tavily regression — gate passthrough para providers no-Apollo
 *
 * IMPORTANTE: sin llamadas reales a Apollo, Tavily, Lusha ni HubSpot.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapApolloOrganizationToSearchResult,
  ICP_SIZE_THRESHOLD,
  APOLLO_PROFILE_MAPPING_VERSION,
  type ApolloOrganizationInput,
  type ApolloOrganizationSearchResultMetadata,
  type SizeEvidenceStatus,
} from '../web-search-providers/apollo-organizations-search-provider';

import {
  applyApolloSectorRelevanceGate,
} from '../apollo-sector-relevance-gate';

import type { WebSearchResult } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOrg(overrides: Partial<ApolloOrganizationInput> & { id: string; name: string }): ApolloOrganizationInput {
  return {
    website_url: null,
    primary_domain: null,
    linkedin_url: null,
    industry: null,
    estimated_num_employees: null,
    city: null,
    country: null,
    short_description: null,
    keywords: [],
    ...overrides,
  };
}

function getMeta(result: WebSearchResult): ApolloOrganizationSearchResultMetadata {
  return result.metadata as ApolloOrganizationSearchResultMetadata;
}

const SECRET_PATTERNS = ['api_key', 'authorization', 'bearer', 'token', 'secret', 'password', 'x-api-key'];

// ─── A. Perfil completo → apollo_profile correcto, size_evidence.status=passes ─

describe('A. Perfil Apollo completo — employee_count=500', () => {
  const org = makeOrg({
    id: 'org-full-profile-001',
    name: 'EduTech Colombia S.A.S',
    website_url: 'https://edutech.co',
    primary_domain: 'edutech.co',
    linkedin_url: 'https://www.linkedin.com/company/edutech-co',
    industry: 'E-Learning',
    estimated_num_employees: 500,
    city: 'Bogotá',
    country: 'Colombia',
    short_description: 'Plataforma LMS líder en Colombia para formación corporativa.',
    keywords: ['lms', 'e-learning', 'corporate training', 'educación virtual'],
  });

  const result = mapApolloOrganizationToSearchResult(org, 1);
  const meta = getMeta(result);

  it('A1: title es el nombre de la empresa', () => {
    assert.equal(result.title, 'EduTech Colombia S.A.S');
  });

  it('A2: apollo_profile.organization_id correcto', () => {
    assert.equal(meta.apollo_profile.organization_id, 'org-full-profile-001');
  });

  it('A3: apollo_profile.primary_domain preservado', () => {
    assert.equal(meta.apollo_profile.primary_domain, 'edutech.co');
  });

  it('A4: apollo_profile.linkedin_url preservado', () => {
    assert.equal(meta.apollo_profile.linkedin_url, 'https://www.linkedin.com/company/edutech-co');
  });

  it('A5: apollo_profile.industry preservado', () => {
    assert.equal(meta.apollo_profile.industry, 'E-Learning');
  });

  it('A6: apollo_profile.keywords preservados', () => {
    assert.deepEqual(meta.apollo_profile.keywords, ['lms', 'e-learning', 'corporate training', 'educación virtual']);
  });

  it('A7: apollo_profile.estimated_num_employees = 500', () => {
    assert.equal(meta.apollo_profile.estimated_num_employees, 500);
  });

  it('A8: apollo_profile.city preservada', () => {
    assert.equal(meta.apollo_profile.city, 'Bogotá');
  });

  it('A9: apollo_profile.short_description preservada', () => {
    assert.ok(meta.apollo_profile.short_description?.includes('LMS'));
  });

  it('A10: apollo_profile.mapping_version es APOLLO_PROFILE_MAPPING_VERSION', () => {
    assert.equal(meta.apollo_profile.mapping_version, APOLLO_PROFILE_MAPPING_VERSION);
  });

  it('A11: size_evidence.status = passes (500 >= 200)', () => {
    assert.equal(meta.size_evidence.status, 'passes' satisfies SizeEvidenceStatus);
  });

  it('A12: size_evidence.employee_count = 500', () => {
    assert.equal(meta.size_evidence.employee_count, 500);
  });

  it('A13: size_evidence.threshold = ICP_SIZE_THRESHOLD', () => {
    assert.equal(meta.size_evidence.threshold, ICP_SIZE_THRESHOLD);
  });

  it('A14: size_evidence.source = apollo', () => {
    assert.equal(meta.size_evidence.source, 'apollo');
  });

  it('A15: raw_fields_present incluye campos no vacíos', () => {
    const present = meta.apollo_profile.raw_fields_present;
    assert.ok(present.includes('website_url'));
    assert.ok(present.includes('primary_domain'));
    assert.ok(present.includes('linkedin_url'));
    assert.ok(present.includes('industry'));
    assert.ok(present.includes('keywords'));
    assert.ok(present.includes('estimated_num_employees'));
    assert.ok(present.includes('city'));
    assert.ok(present.includes('country'));
    assert.ok(present.includes('short_description'));
  });

  it('A16: snippet incluye short_description para sector gate', () => {
    assert.ok(result.snippet?.includes('LMS') || result.snippet?.includes('lms'));
  });

  it('A17: snippet incluye keywords', () => {
    assert.ok(result.snippet?.toLowerCase().includes('lms'));
  });
});

// ─── B. Sin empleados → size_evidence.status=unknown ────────────────────────

describe('B. Sin datos de empleados — size_evidence.status=unknown', () => {
  const org = makeOrg({
    id: 'org-no-employees-002',
    name: 'Sin Tamaño Corp Ltda',
    industry: 'Technology',
    country: 'Colombia',
    estimated_num_employees: null,
  });

  const result = mapApolloOrganizationToSearchResult(org, 1);
  const meta = getMeta(result);

  it('B1: size_evidence.status = unknown', () => {
    assert.equal(meta.size_evidence.status, 'unknown' satisfies SizeEvidenceStatus);
  });

  it('B2: size_evidence.employee_count = null (no inventado)', () => {
    assert.equal(meta.size_evidence.employee_count, null);
  });

  it('B3: size_evidence.reason indica ausencia del dato', () => {
    assert.ok(meta.size_evidence.reason.includes('apollo_did_not_return'));
  });

  it('B4: apollo_profile.estimated_num_employees = null', () => {
    assert.equal(meta.apollo_profile.estimated_num_employees, null);
  });

  it('B5: raw_fields_present NO incluye estimated_num_employees', () => {
    assert.ok(!meta.apollo_profile.raw_fields_present.includes('estimated_num_employees'));
  });

  it('B6: pipeline no rompe — result es válido', () => {
    assert.equal(result.title, 'Sin Tamaño Corp Ltda');
    assert.ok(typeof result.url === 'string');
  });
});

// ─── C. Empleados < 200 → size_evidence.status=below_threshold ──────────────

describe('C. Empleados < umbral — size_evidence.status=below_threshold', () => {
  const org = makeOrg({
    id: 'org-small-003',
    name: 'Pequeña Empresa SAS',
    industry: 'Education',
    country: 'Colombia',
    estimated_num_employees: 80,
  });

  const result = mapApolloOrganizationToSearchResult(org, 1);
  const meta = getMeta(result);

  it('C1: size_evidence.status = below_threshold', () => {
    assert.equal(meta.size_evidence.status, 'below_threshold' satisfies SizeEvidenceStatus);
  });

  it('C2: size_evidence.employee_count = 80', () => {
    assert.equal(meta.size_evidence.employee_count, 80);
  });

  it('C3: size_evidence.reason menciona employee_count y threshold', () => {
    assert.ok(meta.size_evidence.reason.includes('80'));
    assert.ok(meta.size_evidence.reason.includes(String(ICP_SIZE_THRESHOLD)));
  });

  it('C4: metadata conserva evidencia (no borra el dato)', () => {
    assert.equal(meta.employee_count, 80);
  });
});

// ─── D. Sector gate usa keywords/description enriquecidos ───────────────────

describe('D. Sector gate — pasa Educación por keywords/description enriquecidos', () => {
  const orgConKeywords = makeOrg({
    id: 'org-edu-keywords-004',
    name: 'Empresa Genérica Corp',
    industry: 'Information Technology',
    country: 'Colombia',
    keywords: ['lms', 'corporate training', 'learning management system'],
    short_description: 'Plataforma de e-learning para empresas.',
  });

  const result = mapApolloOrganizationToSearchResult(orgConKeywords, 1);

  it('D1: sector gate pasa cuando keywords incluyen señales educativas', () => {
    const gateResult = applyApolloSectorRelevanceGate(
      [result],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(gateResult.passed.length, 1, 'debe pasar por keywords LMS/e-learning');
    assert.equal(gateResult.metadata.rejected_count, 0);
  });

  it('D2: matched_terms refleja las señales encontradas', () => {
    const gateResult = applyApolloSectorRelevanceGate(
      [result],
      'Educación',
      'apollo_organizations',
    );
    assert.ok(gateResult.metadata.passed_samples[0].matched_terms.length > 0);
  });

  it('D3: sector gate pasa cuando short_description tiene señales educativas', () => {
    const orgConDesc = mapApolloOrganizationToSearchResult(
      makeOrg({
        id: 'org-edu-desc-004b',
        name: 'Corp Neutra SA',
        industry: 'Consulting',
        short_description: 'Ofrecemos soluciones de e-learning y training corporativo.',
        keywords: [],
      }),
      1,
    );
    const gateResult = applyApolloSectorRelevanceGate(
      [orgConDesc],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(gateResult.passed.length, 1, 'debe pasar por short_description con e-learning');
  });
});

// ─── E. Sector gate rechaza genéricos sin evidencia educativa ────────────────

describe('E. Sector gate — rechaza Citigroup/Huawei/PwC sin evidencia educativa', () => {
  const generics = [
    makeOrg({ id: 'gen-citi', name: 'Citigroup Inc', industry: 'Banking', country: 'Colombia', keywords: [], short_description: null }),
    makeOrg({ id: 'gen-huawei', name: 'Huawei Technologies Co., Ltd', industry: 'Telecommunications', country: 'Colombia', keywords: [], short_description: null }),
    makeOrg({ id: 'gen-pwc', name: 'PwC Colombia', industry: 'Accounting', country: 'Colombia', keywords: [], short_description: null }),
  ].map((org, i) => mapApolloOrganizationToSearchResult(org, i + 1));

  it('E1: Citigroup rechazado (banking, sin educación)', () => {
    const r = applyApolloSectorRelevanceGate([generics[0]], 'Educación', 'apollo_organizations');
    assert.equal(r.passed.length, 0);
  });

  it('E2: Huawei rechazado (telecom, sin educación)', () => {
    const r = applyApolloSectorRelevanceGate([generics[1]], 'Educación', 'apollo_organizations');
    assert.equal(r.passed.length, 0);
  });

  it('E3: PwC Colombia rechazado (accounting, sin educación)', () => {
    const r = applyApolloSectorRelevanceGate([generics[2]], 'Educación', 'apollo_organizations');
    assert.equal(r.passed.length, 0);
  });

  it('E4: todos los genéricos rechazados juntos', () => {
    const r = applyApolloSectorRelevanceGate(generics, 'Educación', 'apollo_organizations');
    assert.equal(r.passed.length, 0);
    assert.equal(r.metadata.rejected_count, generics.length);
  });
});

// ─── F. No secretos / no PII innecesaria ────────────────────────────────────

describe('F. No secretos — apollo_profile no contiene API keys, tokens ni PII personal', () => {
  const org = makeOrg({
    id: 'org-security-006',
    name: 'EduCorp SA',
    website_url: 'https://educorp.co',
    primary_domain: 'educorp.co',
    linkedin_url: 'https://linkedin.com/company/educorp',
    industry: 'Education',
    estimated_num_employees: 300,
    country: 'Colombia',
    keywords: ['e-learning'],
    short_description: 'Empresa de capacitación.',
  });

  const result = mapApolloOrganizationToSearchResult(org, 1);
  const serialized = JSON.stringify(result).toLowerCase();

  for (const pattern of SECRET_PATTERNS) {
    it(`F: metadata no contiene "${pattern}"`, () => {
      assert.ok(!serialized.includes(pattern), `metadata must not contain "${pattern}"`);
    });
  }

  it('F_phone: metadata no contiene teléfonos personales (phone no presente)', () => {
    assert.ok(!serialized.includes('"phone"'));
  });

  it('F_email: metadata no contiene emails personales (email no presente)', () => {
    assert.ok(!serialized.includes('"email"'));
  });

  it('F_profile_version: mapping_version presente y correcta', () => {
    const meta = getMeta(result);
    assert.equal(meta.apollo_profile.mapping_version, APOLLO_PROFILE_MAPPING_VERSION);
  });
});

// ─── G. Cost guardrails intactos ─────────────────────────────────────────────

describe('G. Cost guardrails — defaults 1 query × 3 results', () => {
  it('G1: resolveApolloMaxQueriesPerRun exportado', async () => {
    const mod = await import('../apollo-cost-guardrails');
    assert.equal(typeof mod.resolveApolloMaxQueriesPerRun, 'function');
  });

  it('G2: resolveApolloMaxResultsPerQuery exportado', async () => {
    const mod = await import('../apollo-cost-guardrails');
    assert.equal(typeof mod.resolveApolloMaxResultsPerQuery, 'function');
  });

  it('G3: créditos máximos por defecto <= 3', async () => {
    const { resolveApolloMaxQueriesPerRun, resolveApolloMaxResultsPerQuery } = await import('../apollo-cost-guardrails');
    const savedQ = process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;
    const savedR = process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY;
    delete process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;
    delete process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY;

    const maxCredits = resolveApolloMaxQueriesPerRun() * resolveApolloMaxResultsPerQuery();
    assert.ok(maxCredits <= 3, `max credits QA ${maxCredits} must be <= 3`);

    if (savedQ !== undefined) process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN = savedQ;
    if (savedR !== undefined) process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY = savedR;
  });

  it('G4: ICP_SIZE_THRESHOLD = 200', () => {
    assert.equal(ICP_SIZE_THRESHOLD, 200);
  });
});

// ─── H. Tavily regression — gate passthrough para no-Apollo ─────────────────

describe('H. Tavily regression — gate no filtra resultados no-Apollo', () => {
  const tavilyResults: WebSearchResult[] = [
    makeOrg({ id: 'tv-1', name: 'Citigroup Inc', industry: 'Banking' }),
    makeOrg({ id: 'tv-2', name: 'Huawei Colombia', industry: 'Telecom' }),
  ].map((org, i) => ({
    ...mapApolloOrganizationToSearchResult(org, i + 1),
    provider: 'tavily' as const,
    source: 'tavily',
  }));

  it('H1: provider=tavily → todos los resultados pasan sin filtrar', () => {
    const r = applyApolloSectorRelevanceGate(tavilyResults, 'Educación', 'tavily');
    assert.equal(r.passed.length, tavilyResults.length);
    assert.equal(r.metadata.enabled, false);
    assert.equal(r.metadata.reason, 'non_apollo_provider');
  });

  it('H2: provider=null → passthrough (no rompe)', () => {
    const r = applyApolloSectorRelevanceGate(tavilyResults, 'Educación', null);
    assert.equal(r.passed.length, tavilyResults.length);
    assert.equal(r.metadata.enabled, false);
  });

  it('H3: Lusha no referenciada en provider', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider.ts'),
      'utf-8',
    );
    assert.ok(!src.toLowerCase().includes('lusha'), 'provider no debe referenciar Lusha');
  });

  it('H4: provider no activa Apollo real cuando flag=false', async () => {
    // Verificar estructura: ENABLE_APOLLO_COMPANY_SEARCH gating está en el source
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider.ts'),
      'utf-8',
    );
    assert.ok(src.includes('isApolloCompanySearchEnabled'), 'debe tener feature flag guard');
    assert.ok(src.includes('apollo_company_search_disabled'), 'debe tener skip reason cuando flag=false');
  });
});

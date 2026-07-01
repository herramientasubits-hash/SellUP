/**
 * Tests — Apollo Sector Relevance Gate (v1.16K-AD)
 *
 * Verifica la compuerta de relevancia sectorial para Apollo Organizations.
 *
 *   A. Educación pasa con señales sectoriales
 *   B. Educación rechaza empresas genéricas sin evidencia sectorial
 *   C. Metadata estructurada y sin secretos
 *   D. Sector no mapeado → passthrough sin bloquear
 *   E. Tavily regression — gate no aplica
 *   F. Cost safety regression — guardrails Apollo intactos
 *   G. Lusha safety — no activación desde este módulo
 *
 * IMPORTANTE: sin llamadas reales a Apollo, Tavily, Lusha ni HubSpot.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyApolloSectorRelevanceGate,
  APOLLO_SECTOR_GATE_VERSION,
} from '../apollo-sector-relevance-gate';
import type { WebSearchResult } from '../types';

// ─── Fixtures helpers ─────────────────────────────────────────────────────────

function makeResult(
  name: string,
  domain: string,
  opts: {
    snippet?: string;
    industry?: string;
    url?: string;
  } = {},
): WebSearchResult {
  const url = opts.url ?? `https://${domain}`;
  return {
    title: name,
    url,
    snippet: opts.snippet ?? `Empresa: ${name} | País: Colombia`,
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    confidence: 0.85,
    metadata: {
      apollo_organization_id: `test-${domain}`,
      domain,
      website: url,
      industry: opts.industry ?? null,
      employee_count: null,
      country: 'Colombia',
      linkedin_url: null,
      source_provider: 'apollo',
      source_key: 'apollo_organizations',
      source_type: 'structured_company_database',
    },
  };
}

// ─── Fixtures Educación — deben pasar ─────────────────────────────────────────

const EDUCATION_PASS_FIXTURES: WebSearchResult[] = [
  makeResult('Universidad de los Andes', 'uniandes.edu.co', {
    snippet: 'Empresa: Universidad de los Andes | Industria: Higher Education | País: Colombia',
    industry: 'Higher Education',
  }),
  makeResult('Platzi', 'platzi.com', {
    snippet: 'Empresa: Platzi | online learning platform | e-learning | País: Colombia',
    industry: 'E-Learning',
  }),
  makeResult('LMS Colombia', 'lmscolombia.co', {
    snippet: 'Empresa: LMS Colombia | learning management system | corporate training | País: Colombia',
  }),
  makeResult('Colegio Virtual Colombiano', 'colegiovirtual.edu.co', {
    snippet: 'Empresa: Colegio Virtual Colombiano | educación virtual | País: Colombia',
    industry: 'Education',
  }),
  makeResult('Instituto de Capacitación Empresarial', 'ince.com.co', {
    snippet: 'Empresa: Instituto de Capacitación Empresarial | formación corporativa | País: Colombia',
  }),
];

// ─── Fixtures Educación — deben rechazarse ────────────────────────────────────

const EDUCATION_REJECT_FIXTURES: WebSearchResult[] = [
  makeResult('Citigroup Inc', 'citi.com', {
    snippet: 'Empresa: Citigroup Inc | Industria: Banking | País: Colombia',
    industry: 'Banking',
  }),
  makeResult('Huawei Technologies Co., Ltd', 'huawei.com', {
    snippet: 'Empresa: Huawei Technologies Co., Ltd | Industria: Telecommunications | País: Colombia',
    industry: 'Telecommunications',
  }),
  makeResult('AstraZeneca', 'astrazeneca.com', {
    snippet: 'Empresa: AstraZeneca | Industria: Pharmaceuticals | País: Colombia',
    industry: 'Pharmaceuticals',
  }),
  makeResult('PwC Colombia', 'pwc.com', {
    snippet: 'Empresa: PwC Colombia | Industria: Accounting | País: Colombia',
    industry: 'Accounting',
  }),
];

// ─── A. Educación pasa con señales sectoriales ────────────────────────────────

describe('A. Sector Educación — candidatos con señales pasan el gate', () => {
  it('A1: Universidad de los Andes pasa (industry=Higher Education)', () => {
    const result = applyApolloSectorRelevanceGate(
      [EDUCATION_PASS_FIXTURES[0]],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1);
    assert.equal(result.metadata.rejected_count, 0);
  });

  it('A2: Platzi pasa (snippet=online learning, e-learning)', () => {
    const result = applyApolloSectorRelevanceGate(
      [EDUCATION_PASS_FIXTURES[1]],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1);
  });

  it('A3: LMS Colombia pasa (snippet=learning management system)', () => {
    const result = applyApolloSectorRelevanceGate(
      [EDUCATION_PASS_FIXTURES[2]],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1);
  });

  it('A4: Colegio Virtual pasa (title=colegio, snippet=educación virtual)', () => {
    const result = applyApolloSectorRelevanceGate(
      [EDUCATION_PASS_FIXTURES[3]],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1);
  });

  it('A5: Instituto de Capacitación pasa (snippet=formación corporativa)', () => {
    const result = applyApolloSectorRelevanceGate(
      [EDUCATION_PASS_FIXTURES[4]],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1);
  });

  it('A6: todos los fixtures de pass pasan juntos', () => {
    const result = applyApolloSectorRelevanceGate(
      EDUCATION_PASS_FIXTURES,
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, EDUCATION_PASS_FIXTURES.length);
    assert.equal(result.metadata.rejected_count, 0);
  });

  it('A7: passed_samples incluye términos encontrados', () => {
    const result = applyApolloSectorRelevanceGate(
      [EDUCATION_PASS_FIXTURES[0]],
      'Educación',
      'apollo_organizations',
    );
    assert.ok(result.metadata.passed_samples.length > 0);
    assert.ok(result.metadata.passed_samples[0].matched_terms.length > 0);
  });
});

// ─── B. Educación rechaza empresas genéricas ──────────────────────────────────

describe('B. Sector Educación — empresas genéricas rechazadas', () => {
  it('B1: Citigroup rechazado (solo banking, sin señales educativas)', () => {
    const result = applyApolloSectorRelevanceGate(
      [EDUCATION_REJECT_FIXTURES[0]],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0);
    assert.equal(result.metadata.rejected_count, 1);
  });

  it('B2: Huawei rechazado (solo telecommunications)', () => {
    const result = applyApolloSectorRelevanceGate(
      [EDUCATION_REJECT_FIXTURES[1]],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0);
    assert.equal(result.metadata.rejected_count, 1);
  });

  it('B3: AstraZeneca rechazado (solo pharmaceuticals)', () => {
    const result = applyApolloSectorRelevanceGate(
      [EDUCATION_REJECT_FIXTURES[2]],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0);
    assert.equal(result.metadata.rejected_count, 1);
  });

  it('B4: PwC Colombia rechazado (solo accounting)', () => {
    const result = applyApolloSectorRelevanceGate(
      [EDUCATION_REJECT_FIXTURES[3]],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0);
    assert.equal(result.metadata.rejected_count, 1);
  });

  it('B5: todos los fixtures de rechazo son rechazados juntos', () => {
    const result = applyApolloSectorRelevanceGate(
      EDUCATION_REJECT_FIXTURES,
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0);
    assert.equal(result.metadata.rejected_count, EDUCATION_REJECT_FIXTURES.length);
  });

  it('B6: rechazo no depende de blacklist por nombre — empresa ficticia "Generic Corp" rechazada', () => {
    const genericCorp = makeResult('Generic Corp Ltda', 'genericcorp.co', {
      snippet: 'Empresa: Generic Corp Ltda | Industria: Consulting | País: Colombia',
      industry: 'Consulting',
    });
    const result = applyApolloSectorRelevanceGate(
      [genericCorp],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0, 'empresa sin señales educativas debe rechazarse');
  });

  it('B7: país Colombia solo no es suficiente — candidato con solo Colombia rechazado', () => {
    const colombiaOnly = makeResult('Empresa Colombia SA', 'empresacolombia.co', {
      snippet: 'Empresa: Empresa Colombia SA | País: Colombia',
    });
    const result = applyApolloSectorRelevanceGate(
      [colombiaOnly],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0, 'país solo no debe ser señal sectorial');
  });

  it('B8: candidatos rechazados tienen final_skip_reason en metadata', () => {
    const result = applyApolloSectorRelevanceGate(
      [EDUCATION_REJECT_FIXTURES[0]],
      'Educación',
      'apollo_organizations',
    );
    const rejectedMeta = result.metadata.rejected_count;
    assert.ok(rejectedMeta > 0);
    // El resultado rechazado se devuelve fuera de passed — verificar en rejected_samples
    assert.ok(result.metadata.rejected_samples.length > 0);
    assert.equal(result.metadata.rejected_samples[0].reason, 'insufficient_sector_evidence');
  });
});

// ─── C. Metadata estructurada ─────────────────────────────────────────────────

describe('C. Metadata — estructura correcta y sin secretos', () => {
  const SECRET_PATTERNS = ['api_key', 'authorization', 'bearer', 'token', 'secret', 'password'];

  it('C1: metadata tiene campos obligatorios', () => {
    const result = applyApolloSectorRelevanceGate(
      [...EDUCATION_PASS_FIXTURES, ...EDUCATION_REJECT_FIXTURES],
      'Educación',
      'apollo_organizations',
    );
    const meta = result.metadata;
    assert.equal(meta.gate_version, APOLLO_SECTOR_GATE_VERSION);
    assert.equal(meta.enabled, true);
    assert.equal(meta.sector_mapped, true);
    assert.equal(meta.sector, 'Educación');
    assert.equal(meta.strategy, 'sector_evidence_required');
    assert.equal(typeof meta.checked_count, 'number');
    assert.equal(typeof meta.passed_count, 'number');
    assert.equal(typeof meta.rejected_count, 'number');
    assert.ok(Array.isArray(meta.rejected_samples));
    assert.ok(Array.isArray(meta.passed_samples));
  });

  it('C2: checked_count = passed_count + rejected_count', () => {
    const input = [...EDUCATION_PASS_FIXTURES, ...EDUCATION_REJECT_FIXTURES];
    const result = applyApolloSectorRelevanceGate(input, 'Educación', 'apollo_organizations');
    const meta = result.metadata;
    assert.equal(meta.checked_count, meta.passed_count + meta.rejected_count);
    assert.equal(meta.checked_count, input.length);
  });

  it('C3: rejected_samples max 5', () => {
    // 10 empresas rechazadas — max 5 samples
    const many = Array.from({ length: 10 }, (_, i) =>
      makeResult(`Corp ${i}`, `corp${i}.com`, {
        snippet: `Empresa: Corp ${i} | Industria: Finance | País: Colombia`,
        industry: 'Finance',
      }),
    );
    const result = applyApolloSectorRelevanceGate(many, 'Educación', 'apollo_organizations');
    assert.ok(result.metadata.rejected_samples.length <= 5);
  });

  it('C4: passed_samples max 5', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      makeResult(`Universidad ${i}`, `uni${i}.edu.co`, {
        snippet: `Empresa: Universidad ${i} | higher education | País: Colombia`,
        industry: 'Higher Education',
      }),
    );
    const result = applyApolloSectorRelevanceGate(many, 'Educación', 'apollo_organizations');
    assert.ok(result.metadata.passed_samples.length <= 5);
  });

  it('C5: metadata no contiene secretos', () => {
    const result = applyApolloSectorRelevanceGate(
      [...EDUCATION_PASS_FIXTURES, ...EDUCATION_REJECT_FIXTURES],
      'Educación',
      'apollo_organizations',
    );
    const serialized = JSON.stringify(result.metadata).toLowerCase();
    for (const pattern of SECRET_PATTERNS) {
      assert.ok(!serialized.includes(pattern), `metadata must not contain "${pattern}"`);
    }
  });

  it('C6: gate_version constante es string no vacío', () => {
    assert.equal(typeof APOLLO_SECTOR_GATE_VERSION, 'string');
    assert.ok(APOLLO_SECTOR_GATE_VERSION.length > 0);
  });
});

// ─── D. Sector no mapeado → passthrough ──────────────────────────────────────

describe('D. Sector no mapeado — passthrough sin bloquear', () => {
  it('D1: sector=Tecnología no tiene mapping → todos pasan', () => {
    const result = applyApolloSectorRelevanceGate(
      EDUCATION_REJECT_FIXTURES, // usamos los que se rechazan en Educación
      'Tecnología',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, EDUCATION_REJECT_FIXTURES.length);
    assert.equal(result.metadata.enabled, false);
    assert.equal(result.metadata.strategy, 'passthrough');
    assert.equal(result.metadata.reason, 'sector_not_mapped');
  });

  it('D2: sector ficticio no bloquea candidatos', () => {
    const result = applyApolloSectorRelevanceGate(
      EDUCATION_REJECT_FIXTURES,
      'SectorFicticio2099',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, EDUCATION_REJECT_FIXTURES.length);
    assert.equal(result.metadata.sector_mapped, false);
  });

  it('D3: sector null → passthrough', () => {
    const result = applyApolloSectorRelevanceGate(
      EDUCATION_REJECT_FIXTURES,
      null,
      'apollo_organizations',
    );
    assert.equal(result.passed.length, EDUCATION_REJECT_FIXTURES.length);
    assert.equal(result.metadata.enabled, false);
  });

  it('D4: sector vacío → passthrough', () => {
    const result = applyApolloSectorRelevanceGate(
      EDUCATION_REJECT_FIXTURES,
      '',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, EDUCATION_REJECT_FIXTURES.length);
    assert.equal(result.metadata.enabled, false);
  });
});

// ─── E. Tavily regression ─────────────────────────────────────────────────────

describe('E. Tavily regression — gate no aplica a Tavily', () => {
  const tavilyResults: WebSearchResult[] = EDUCATION_REJECT_FIXTURES.map(r => ({
    ...r,
    provider: 'tavily',
    source: 'tavily',
  }));

  it('E1: provider=tavily → todos los resultados pasan sin filtrar', () => {
    const result = applyApolloSectorRelevanceGate(
      tavilyResults,
      'Educación',
      'tavily',
    );
    assert.equal(result.passed.length, tavilyResults.length);
    assert.equal(result.metadata.enabled, false);
    assert.equal(result.metadata.reason, 'non_apollo_provider');
  });

  it('E2: provider=null → passthrough (no rompe)', () => {
    const result = applyApolloSectorRelevanceGate(
      tavilyResults,
      'Educación',
      null,
    );
    assert.equal(result.passed.length, tavilyResults.length);
    assert.equal(result.metadata.enabled, false);
  });

  it('E3: provider=undefined → passthrough', () => {
    const result = applyApolloSectorRelevanceGate(
      tavilyResults,
      'Educación',
      undefined,
    );
    assert.equal(result.passed.length, tavilyResults.length);
    assert.equal(result.metadata.enabled, false);
  });
});

// ─── F. Cost safety regression ───────────────────────────────────────────────

describe('F. Cost safety regression — guardrails Apollo intactos', () => {
  it('F1: apollo-cost-guardrails exporta resolveApolloMaxQueriesPerRun', async () => {
    const mod = await import('../apollo-cost-guardrails');
    assert.equal(typeof mod.resolveApolloMaxQueriesPerRun, 'function');
    assert.equal(typeof mod.resolveApolloMaxResultsPerQuery, 'function');
  });

  it('F2: defaults = 1 query × 3 results = máximo 3 créditos QA', async () => {
    const { resolveApolloMaxQueriesPerRun, resolveApolloMaxResultsPerQuery } = await import('../apollo-cost-guardrails');
    const savedQ = process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;
    const savedR = process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY;
    delete process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;
    delete process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY;

    const maxCredits = resolveApolloMaxQueriesPerRun() * resolveApolloMaxResultsPerQuery();
    assert.ok(maxCredits <= 3, `max credits ${maxCredits} must be <= 3`);

    if (savedQ !== undefined) process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN = savedQ;
    if (savedR !== undefined) process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY = savedR;
  });

  it('F3: sector gate no importa apollo-cost-guardrails (módulo independiente)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-sector-relevance-gate.ts'),
      'utf-8',
    );
    assert.ok(!source.includes('apollo-cost-guardrails'), 'gate debe ser independiente de guardrails');
    assert.ok(!source.includes('resolveApolloMaxQueriesPerRun'), 'gate no debe importar resolvers de créditos');
  });
});

// ─── G. Lusha safety ─────────────────────────────────────────────────────────

describe('G. Lusha safety — gate no activa Lusha', () => {
  it('G1: apollo-sector-relevance-gate no referencia Lusha', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-sector-relevance-gate.ts'),
      'utf-8',
    );
    assert.ok(!source.toLowerCase().includes('lusha'), 'gate no debe referenciar Lusha');
  });

  it('G2: gate no tiene paths de activación automática hacia enrichment de contactos', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-sector-relevance-gate.ts'),
      'utf-8',
    );
    // Lusha y people search son contactos, no discovery de empresas
    assert.ok(!source.toLowerCase().includes('people'), 'gate no debe activar people search');
    assert.ok(!source.toLowerCase().includes('contact'), 'gate no debe activar contact enrichment');
  });

  it('G3: gate no guarda API keys ni tokens en metadata', async () => {
    const result = applyApolloSectorRelevanceGate(
      EDUCATION_PASS_FIXTURES,
      'Educación',
      'apollo_organizations',
    );
    const serialized = JSON.stringify(result).toLowerCase();
    const forbidden = ['api_key', 'authorization', 'bearer', 'x-api-key'];
    for (const token of forbidden) {
      assert.ok(!serialized.includes(token), `must not contain "${token}"`);
    }
  });
});

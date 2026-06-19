/**
 * Tests — Source URL Quality Gate + Business Fit Gate (Hito 16AB.43.29)
 *
 * Fixture A — URLs bloqueadas por source URL quality gate (unit)
 * Fixture B — URLs permitidas por source URL quality gate (unit)
 * Fixture C — Business fit gate: reject/low para agencias y BPO (unit)
 * Fixture D — Business fit gate: medium/high para candidatos válidos (unit)
 * Fixture E — Integration: gates bloquean candidatos malos ANTES del target cap
 * Fixture F — Ranking: high-fit + official page rankea mejor que low-fit blog
 * Fixture G — Query cleanup: no "transformación digital" en queries R2
 *
 * Sin Supabase real. Sin LLM. Sin Tavily. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifySourceUrlQuality, isBlockedBySourceUrlQuality } from '../source-url-quality-gate';
import { evaluateBusinessFit, isBlockedByBusinessFit } from '../business-fit-gate';
import { writeProspectingCandidates } from '../candidate-writer';
import { buildExpandedMultiQueryDiscoveryQueries } from '../query-builder';
import type {
  ProspectingPipelineOutput,
  ProspectingPipelineCandidate,
} from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<ProspectingPipelineCandidate> & { name: string }): ProspectingPipelineCandidate {
  return {
    domain: 'testcompany.com.co',
    website: 'https://testcompany.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 0.85,
      fitScore: 0.8,
      dataCompletenessScore: 0.9,
      recommendedAction: 'add_to_pipeline',
      reasons: [],
      warnings: [],
      blockers: [],
    },
    websiteVerification: null,
    duplicateCheck: null,
    sourceUrl: null,
    sourceTitle: null,
    sourceSnippet: null,
    inferredNameSource: 'title',
    searchTrace: null,
    llmEvaluation: null,
    ...overrides,
  } as unknown as ProspectingPipelineCandidate;
}

function makePipelineOutput(candidates: ProspectingPipelineCandidate[]): ProspectingPipelineOutput {
  return {
    candidates,
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: candidates.length,
      searchDepth: 'standard',
    },
    summary: {
      requested: candidates.length,
      returned: candidates.length,
      highQualityNew: candidates.length,
      needsReview: 0,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
    },
    metadata: { provider: 'mock', pipelineVersion: 'test', executedAt: new Date().toISOString() },
    warnings: [],
  } as unknown as ProspectingPipelineOutput;
}

function makeFakeAdminClient(): SupabaseClient {
  let insertedCandidateCount = 0;

  const client = {
    from: (table: string) => {
      const obj: Record<string, unknown> = {};

      obj.select = () => {
        if (table === 'prospect_batches') {
          return {
            eq: () => ({
              gte: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        }
        if (table === 'prospect_candidates') {
          return {
            in: (_col: string) => {
              if (_col === 'domain') return Promise.resolve({ data: [], error: null });
              return { not: () => Promise.resolve({ data: [], error: null }) };
            },
          };
        }
        return Promise.resolve({ data: [], error: null });
      };

      obj.insert = () => {
        if (table === 'prospect_batches') {
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'test-batch-id' }, error: null }),
            }),
          };
        }
        if (table === 'prospect_candidates') {
          insertedCandidateCount++;
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: `cand-${insertedCandidateCount}` }, error: null }),
            }),
          };
        }
        return Promise.resolve({ data: null, error: null });
      };

      obj.update = () => ({
        eq: () => Promise.resolve({ data: null, error: null }),
      });

      return obj;
    },
  } as unknown as SupabaseClient;

  return client;
}

// ─── Fixture A — URLs bloqueadas por source URL quality gate ─────────────────

describe('Fixture A — Source URL quality: URLs bloqueadas', () => {
  const BLOCKED_CASES = [
    {
      label: 'Dell partner registration',
      url: 'https://www.delltechnologies.com/partner/es-co/partner/business-model.htm',
      expected: 'partner_registration',
    },
    {
      label: 'Elioplus channel-partners directory',
      url: 'https://elioplus.com/la/colombia/channel-partners/business_intelligence',
      expected: 'partner_directory',
    },
    {
      label: 'Avaya blogs (plural)',
      url: 'https://www.avaya.com/es/blogs/colombia-avanza-en-la-implementacion-de-tecnologias',
      expected: 'blog_article',
    },
    {
      label: 'Bambubpo content article (article slug)',
      url: 'https://www.bambubpo.com/la-tecnologia-es-clave-para-gestion-de-cartera-de-tu-empresa',
      expected: 'content_article',
    },
    {
      label: 'NexaTech transformacion digital',
      url: 'https://www.nexatech.org/transformacion-digital-empresas.html',
      expected: 'generic_transformation_digital_page',
    },
    {
      label: 'Marketerosagencia transformacion digital',
      url: 'https://www.marketerosagencia.com/co/agencia-transformacion-digital',
      expected: 'generic_transformation_digital_page',
    },
  ];

  for (const { label, url, expected } of BLOCKED_CASES) {
    it(`blocks ${label}`, () => {
      const result = classifySourceUrlQuality(url);
      assert.ok(
        isBlockedBySourceUrlQuality(result),
        `Must be blocked: ${label} → got quality=${result.quality}`,
      );
      assert.equal(
        result.quality,
        expected,
        `Expected quality=${expected} for ${label}, got ${result.quality}`,
      );
    });
  }
});

// ─── Fixture B — URLs permitidas por source URL quality gate ─────────────────

describe('Fixture B — Source URL quality: URLs permitidas', () => {
  const ALLOWED_CASES = [
    {
      label: 'COL2TEC homepage',
      url: 'https://col2tec.com',
      expectedQuality: 'official_homepage',
    },
    {
      label: 'GOBO implementacion CRM',
      url: 'https://gobo.com.co/implementacion-crm-empresas-colombia',
      expectedQuality: 'official_solution_page',
    },
    {
      label: 'Entelgy donde-estamos Colombia',
      url: 'https://entelgy.com/en/donde-estamos/entelgy-colombia',
      expectedQuality: 'official_location_page',
    },
    {
      label: 'GTD Colombia soluciones/servicios-ti',
      url: 'https://gtdcolombia.com/soluciones/servicios-ti',
      expectedQuality: 'official_solution_page',
    },
  ];

  for (const { label, url, expectedQuality } of ALLOWED_CASES) {
    it(`allows ${label}`, () => {
      const result = classifySourceUrlQuality(url);
      assert.ok(
        !isBlockedBySourceUrlQuality(result),
        `Must NOT be blocked: ${label} → got quality=${result.quality}, blocked=${result.blocked}`,
      );
      assert.equal(
        result.quality,
        expectedQuality,
        `Expected quality=${expectedQuality} for ${label}, got ${result.quality}`,
      );
    });
  }
});

// ─── Fixture C — Business fit gate: reject/low ───────────────────────────────

describe('Fixture C — Business fit gate: reject/low para segmentos excluidos', () => {
  it('Agencia de marketing → reject', () => {
    const result = evaluateBusinessFit({
      name: 'Marketerosagencia',
      website: 'https://www.marketerosagencia.com',
      domain: 'marketerosagencia.com',
      sourceSnippet:
        'Somos una agencia de marketing digital especializada en SEO y SEM para empresas en Colombia',
    });
    assert.ok(isBlockedByBusinessFit(result), `Must be blocked. fit=${result.fit}`);
    assert.ok(
      result.fit === 'reject' || result.fit === 'low',
      `Expected reject or low, got ${result.fit}`,
    );
  });

  it('Call center / cobranza → reject', () => {
    const result = evaluateBusinessFit({
      name: 'CallCenter Colombia BPO',
      website: null,
      domain: 'callcentercolombia.com',
      sourceSnippet:
        'Servicios de call center y recuperación de cartera para empresas financieras en Colombia',
    });
    assert.ok(isBlockedByBusinessFit(result), `Must be blocked. fit=${result.fit}`);
  });

  it('Staffing/temporal → blocked (low or reject)', () => {
    const result = evaluateBusinessFit({
      name: 'ManpowerGroup Colombia',
      website: 'https://manpowergroupcolombia.co',
      domain: 'manpowergroupcolombia.co',
      sourceSnippet:
        'Suministro de personal temporal y outsourcing de personal para empresas en Colombia',
    });
    assert.ok(
      isBlockedByBusinessFit(result),
      `ManpowerGroup staffing must be blocked. fit=${result.fit}`,
    );
  });
});

// ─── Fixture D — Business fit gate: medium/high para candidatos válidos ───────

describe('Fixture D — Business fit gate: medium/high para candidatos target', () => {
  it('GOBO CRM solution → medium or high', () => {
    const result = evaluateBusinessFit({
      name: 'GOBO',
      website: 'https://gobo.com.co/implementacion-crm-empresas-colombia',
      domain: 'gobo.com.co',
      sourceSnippet:
        'Implementación de CRM para empresas en Colombia. Plataforma para gestión de clientes corporativos',
    });
    assert.ok(!isBlockedByBusinessFit(result), `GOBO must NOT be blocked. fit=${result.fit}`);
    assert.ok(
      result.fit === 'medium' || result.fit === 'high',
      `Expected medium or high, got ${result.fit}`,
    );
  });

  it('COL2TEC ERP/software → medium or high', () => {
    const result = evaluateBusinessFit({
      name: 'COL2TEC',
      website: 'https://col2tec.com',
      domain: 'col2tec.com',
      sourceSnippet:
        'Software ERP y soluciones tecnológicas para empresas en Colombia. Sistemas de gestión empresarial',
    });
    assert.ok(!isBlockedByBusinessFit(result), `COL2TEC must NOT be blocked. fit=${result.fit}`);
    assert.ok(
      result.fit === 'medium' || result.fit === 'high',
      `Expected medium or high, got ${result.fit}`,
    );
  });

  it('Entelgy Colombia IT solutions → medium or high', () => {
    const result = evaluateBusinessFit({
      name: 'Entelgy Colombia',
      website: 'https://entelgy.com/en/donde-estamos/entelgy-colombia',
      domain: 'entelgy.com',
      sourceSnippet:
        'Servicios tecnológicos y soluciones de software para clientes corporativos en Colombia',
    });
    assert.ok(
      !isBlockedByBusinessFit(result),
      `Entelgy must NOT be blocked. fit=${result.fit}`,
    );
    assert.ok(
      result.fit === 'medium' || result.fit === 'high',
      `Expected medium or high, got ${result.fit}`,
    );
  });
});

// ─── Fixture E — Integration: gates bloquean ANTES del target cap ────────────

describe('Fixture E — Target cap se aplica DESPUÉS de source URL quality y business fit', () => {
  it('4 bloqueados por URL quality + 4 por business fit → cap de 10 respetado con 12 elegibles', async () => {
    const blocked: ProspectingPipelineCandidate[] = [
      makeCandidate({ name: 'Dell Partner', website: 'https://www.delltechnologies.com/partner/es-co/partner/business-model.htm', domain: 'delltechnologies.com' }),
      makeCandidate({ name: 'Elioplus', website: 'https://elioplus.com/la/colombia/channel-partners/bi', domain: 'elioplus.com' }),
      makeCandidate({ name: 'Avaya Blog', website: 'https://www.avaya.com/es/blogs/tech', domain: 'avaya.com' }),
      makeCandidate({ name: 'Bambubpo', website: 'https://bambubpo.com/la-tecnologia-es-clave-para-gestion-de-cartera-de-tu-empresa', domain: 'bambubpo.com' }),
      makeCandidate({ name: 'Marketerosagencia Digital', website: 'https://marketerosagencia.com', domain: 'marketerosagencia.com', sourceSnippet: 'Somos una agencia de marketing digital para empresas' }),
      makeCandidate({ name: 'CallCenter BPO', website: 'https://callcenterbpo.com.co', domain: 'callcenterbpo.com.co', sourceSnippet: 'Servicios de call center y recuperación de cartera' }),
      makeCandidate({ name: 'Temporal Personal SA', website: 'https://temporalpersonal.com.co', domain: 'temporalpersonal.com.co', sourceSnippet: 'Suministro de personal temporal y outsourcing de personal' }),
      makeCandidate({ name: 'Publicidad Digital CO', website: 'https://publicidaddigital.com.co', domain: 'publicidaddigital.com.co', sourceSnippet: 'Agencia de marketing y publicidad digital en Colombia' }),
    ];

    const eligible: ProspectingPipelineCandidate[] = [
      makeCandidate({ name: 'GOBO CRM', website: 'https://gobo.com.co/implementacion-crm-empresas-colombia', domain: 'gobo.com.co', sourceSnippet: 'Implementación CRM empresas Colombia plataforma clientes corporativos' }),
      makeCandidate({ name: 'COL2TEC', website: 'https://col2tec.com', domain: 'col2tec.com', sourceSnippet: 'Software ERP gestión empresarial Colombia sistemas corporativos' }),
      makeCandidate({ name: 'Entelgy Colombia', website: 'https://entelgy.com/servicios/software', domain: 'entelgy.com', sourceSnippet: 'Servicios tecnológicos software empresarial clientes corporativos Colombia' }),
      makeCandidate({ name: 'Siesa Software', website: 'https://siesa.com', domain: 'siesa.com', sourceSnippet: 'Software ERP para empresas medianas Colombia sistemas gestión' }),
      makeCandidate({ name: 'Novasoft', website: 'https://novasoft.net', domain: 'novasoft.net', sourceSnippet: 'Software nómina recursos humanos Colombia plataforma corporativa' }),
      makeCandidate({ name: 'Interfaz Corp', website: 'https://interfaz.com.co', domain: 'interfaz.com.co', sourceSnippet: 'Soluciones tecnológicas software empresarial clientes corporativos' }),
      makeCandidate({ name: 'Pratech Group', website: 'https://pratechgroup.com', domain: 'pratechgroup.com', sourceSnippet: 'Plataforma SaaS B2B Colombia automatización procesos empresariales' }),
      makeCandidate({ name: 'Babelgroup', website: 'https://babelgroup.com/colombia', domain: 'babelgroup.com', sourceSnippet: 'Empresa tecnología servicios TI software Colombia corporativos' }),
      makeCandidate({ name: 'GTD Colombia', website: 'https://gtdcolombia.com/soluciones/servicios-ti', domain: 'gtdcolombia.com', sourceSnippet: 'Servicios de tecnología y software empresarial Colombia' }),
      makeCandidate({ name: 'Linktic', website: 'https://linktic.com', domain: 'linktic.com', sourceSnippet: 'Software desarrollado para empresas Colombia plataforma digital' }),
      makeCandidate({ name: 'Pragma Tech', website: 'https://pragma.com.co', domain: 'pragma.com.co', sourceSnippet: 'Empresa de tecnología software clientes corporativos Colombia' }),
      makeCandidate({ name: 'Sophos Solutions', website: 'https://sophossolutions.com', domain: 'sophossolutions.com', sourceSnippet: 'Soluciones tecnológicas software empresas Colombia plataforma digital' }),
    ];

    const pipelineOutput = makePipelineOutput([...blocked, ...eligible]);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      {
        pipelineOutput,
        triggeredByUserId: null,
        ownerId: null,
        batchName: null,
        source: 'agent_1',
        dryRun: false,
        extraBatchMetadata: null,
        targetPersistibleCandidates: 10,
      },
      admin,
    );

    assert.ok(result.candidatesCreated <= 10, `Must respect cap of 10, got ${result.candidatesCreated}`);
    assert.ok(result.candidatesCreated >= 8, `Should persist most eligible candidates, got ${result.candidatesCreated}`);

    const sourceUrlSkips = result.skipped.filter((s) => s.reason.startsWith('source_url_quality:'));
    assert.ok(sourceUrlSkips.length >= 2, `Must have ≥2 source_url_quality skips, got ${sourceUrlSkips.length}`);

    const businessFitSkips = result.skipped.filter((s) => s.reason.startsWith('business_fit:'));
    assert.ok(businessFitSkips.length >= 2, `Must have ≥2 business_fit skips, got ${businessFitSkips.length}`);
  });
});

// ─── Fixture F — Ranking: fit alto rankea sobre fit bajo ─────────────────────

describe('Fixture F — Ranking: GOBO CRM (high fit + solution page) rankea primero', () => {
  it('con cap=1, GOBO CRM persiste y candidato genérico queda capped', async () => {
    const candidates: ProspectingPipelineCandidate[] = [
      makeCandidate({ name: 'GenericoCo', website: 'https://genericoco.com.co', domain: 'genericoco.com.co', sourceSnippet: null }),
      makeCandidate({ name: 'GOBO CRM', website: 'https://gobo.com.co/implementacion-crm-empresas-colombia', domain: 'gobo.com.co', sourceSnippet: 'Implementación de CRM para empresas Colombia clientes corporativos software ERP' }),
    ];

    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      {
        pipelineOutput,
        triggeredByUserId: null,
        ownerId: null,
        batchName: null,
        source: 'agent_1',
        dryRun: false,
        extraBatchMetadata: null,
        targetPersistibleCandidates: 1,
      },
      admin,
    );

    assert.equal(result.candidatesCreated, 1, 'Exactly 1 candidate persisted (cap=1)');

    const cappedSkips = result.skipped.filter((s) => s.reason === 'target_cap');
    const goboCapped = cappedSkips.some((s) => s.name === 'GOBO CRM');
    assert.ok(
      !goboCapped,
      `GOBO CRM should NOT be capped (should rank first). Capped: ${JSON.stringify(cappedSkips.map((s) => s.name))}`,
    );
  });
});

// ─── Fixture G — Query cleanup: R2 sin transformación digital ────────────────

describe('Fixture G — Query cleanup: queries R2 limpias de términos excluidos', () => {
  const FORBIDDEN_TERMS = [
    'transformacion digital',
    'transformación digital',
    'partner',
    'channel partners',
    'ecosistema',
    'registro de partners',
  ];

  function normalizeForCheck(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  it('buildExpandedMultiQueryDiscoveryQueries Colombia/Tecnología: sin términos excluidos', () => {
    const queries = buildExpandedMultiQueryDiscoveryQueries('Tecnología', 'Colombia');

    for (const query of queries) {
      const qNorm = normalizeForCheck(query);
      for (const forbidden of FORBIDDEN_TERMS) {
        const forbNorm = normalizeForCheck(forbidden);
        assert.ok(
          !qNorm.includes(forbNorm),
          `Query contiene término excluido "${forbidden}": "${query}"`,
        );
      }
    }
  });

  it('queries con subindustrias SaaS/ERP contienen términos de segmento B2B tech', () => {
    const queries = buildExpandedMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['Software Empresarial / SaaS', 'ERP / CRM']);
    const combined = queries.join(' ').toLowerCase();
    const businessTerms = ['erp', 'crm', 'lms', 'saas', 'software'];
    assert.ok(
      businessTerms.some((t) => combined.includes(t)),
      `Queries deben contener ≥1 de: ${businessTerms.join(', ')}\nQueries: ${queries.join(' | ')}`,
    );
  });

  it('queries sin subindustrias: no contienen "transformación digital"', () => {
    const queries = buildExpandedMultiQueryDiscoveryQueries('Tecnología', 'Colombia');
    const combined = normalizeForCheck(queries.join(' '));
    assert.ok(
      !combined.includes('transformacion digital'),
      `No debe contener "transformación digital".\nQueries: ${queries.join(' | ')}`,
    );
  });
});

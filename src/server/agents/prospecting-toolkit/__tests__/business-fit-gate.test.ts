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
import { compareWriterEligibleRank } from '../candidate-writer-pure-gates';
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

/**
 * 🔴 El doble de Supabase, puesto al día con el contrato REAL del writer.
 *
 * Fixtures E y F llevaban rojas desde CUT-3B4 con
 * `persistence_failed:identity_fence_snapshot_degraded` y 0 candidatas
 * persistidas. La causa NO era un defecto de producción: el writer falla
 * CERRADO cuando no puede probar el estado de la valla de identidad de lote, y
 * este doble no tenía método `rpc`, así que la forma del objeto no probaba
 * nada sobre el esquema (`batch-identity-registry-store` § 0). Fail-closed es
 * el comportamiento correcto y no se toca.
 *
 * El doble responde ahora lo que diría una base sin la migración 126 aplicada
 * —`PGRST202`—, que es lo que ya hace `canonical-identity-gate-writer.test.ts`:
 * con la ausencia de valla PROBADA, el writer recorre la ruta previa a B4. No
 * se relaja ninguna guarda: `epoch` sigue siendo `null` y sólo la conjunción
 * comprobada autoriza esa ruta.
 *
 * Se completa además la cadena de siembra del registro de identidad
 * (`.select(...).eq('batch_id', …).in('status', …)`) y la de nombres previos
 * (`.in(...).not(...).neq(...)`), que producción encadena y aquí morían antes.
 */
function makeFakeAdminClient(): {
  client: SupabaseClient;
  /** La metadata que el writer escribió en `prospect_batches`. */
  batchMetadata: () => Record<string, unknown> | null;
} {
  let insertedCandidateCount = 0;
  let writtenBatchMetadata: Record<string, unknown> | null = null;

  const client = {
    rpc: async () => ({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function read_batch_identity_snapshot in the schema cache',
      },
    }),
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
            // Siembra del registro de identidad del lote: 0 filas, lote nuevo.
            eq: () => ({
              in: () => Promise.resolve({ data: [], error: null }),
            }),
            in: (_col: string) => {
              if (_col === 'domain') return Promise.resolve({ data: [], error: null });
              // Nombres previos: la cadena real termina en `.neq(...)`.
              return {
                not: () => ({ neq: () => Promise.resolve({ data: [], error: null }) }),
              };
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

      obj.update = (row: unknown) => {
        // 🔴 La metadata del lote no viaja en el resultado del writer: se
        // ESCRIBE. Capturarla aquí es la única forma honesta de comprobar que
        // la observabilidad del evaluador sigue publicándose.
        if (table === 'prospect_batches') {
          const metadata = (row as { metadata?: Record<string, unknown> } | null)?.metadata;
          if (metadata) writtenBatchMetadata = metadata;
        }
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      };

      return obj;
    },
  } as unknown as SupabaseClient;

  return { client, batchMetadata: () => writtenBatchMetadata };
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
    const admin = makeFakeAdminClient().client;

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

    // ── 🔴 Qué sigue rechazando, nombrado uno a uno ─────────────────────────
    //
    // De los ocho que esta fixture llamaba «bloqueados», CUATRO lo siguen
    // estando, y cada uno por un filtro INDEPENDIENTE que este corte no toca.
    const porNombre = new Map(result.skipped.map((entry) => [entry.name, entry.reason]));
    assert.equal(porNombre.get('Dell Partner'), 'company_ownership:reject', 'ownership');
    assert.equal(porNombre.get('Elioplus'), 'external_platform:directory', 'plataforma externa');
    assert.equal(porNombre.get('Avaya Blog'), 'blog_content_site', 'intermediario de contenido');
    assert.equal(
      porNombre.get('Bambubpo'),
      'source_url_quality:content_article',
      'calidad de la URL de origen',
    );

    // ── 🔴 Y los otros CUATRO ya NO se rechazan ─────────────────────────────
    //
    // Agencia de marketing, call center, suministro de personal y publicidad:
    // los cuatro caían por `business_fit:{low,reject}`. Son SECTORES, y el
    // perfil comercial lo gobiernan los criterios seleccionados.
    for (const nombre of [
      'Marketerosagencia Digital',
      'CallCenter BPO',
      'Temporal Personal SA',
      'Publicidad Digital CO',
    ]) {
      assert.equal(
        porNombre.get(nombre),
        undefined,
        `🔴 ${nombre} pertenece a un sector: ya no se excluye por categoría`,
      );
    }

    const businessFitSkips = result.skipped.filter((s) => s.reason.startsWith('business_fit:'));
    assert.deepEqual(businessFitSkips, [], '🔴 el encaje ya no descarta a NADIE');

    // ── 🔴 Y el objetivo ya no es un techo (X6.13) ──────────────────────────
    //
    // Se pidieron 10 y sobrevivieron 16: las 20 menos las 4 que rechazan los
    // filtros independientes. Antes esta fixture exigía `<= 10`.
    assert.equal(result.candidatesCreated, 16, 'las 20 menos las 4 rechazadas');
    assert.deepEqual(
      result.skipped.filter((s) => s.reason === 'target_cap'),
      [],
      '🔴 el objetivo es un MÍNIMO: no recorta',
    );
  });

  it('🔴 la OBSERVABILIDAD del evaluador se conserva entera', async () => {
    const candidates: ProspectingPipelineCandidate[] = [
      makeCandidate({ name: 'Marketerosagencia Digital', website: 'https://marketerosagencia.com', domain: 'marketerosagencia.com', sourceSnippet: 'Somos una agencia de marketing digital para empresas' }),
      makeCandidate({ name: 'COL2TEC', website: 'https://col2tec.com', domain: 'col2tec.com', sourceSnippet: 'Software ERP gestión empresarial Colombia sistemas corporativos' }),
    ];

    const admin = makeFakeAdminClient();
    const result = await writeProspectingCandidates(
      {
        pipelineOutput: makePipelineOutput(candidates),
        triggeredByUserId: null,
        ownerId: null,
        batchName: null,
        source: 'agent_1',
        dryRun: false,
        extraBatchMetadata: null,
        targetPersistibleCandidates: 10,
      },
      admin.client,
    );

    // Las dos entran: una por encaje `reject` que ya no descarta, otra limpia.
    assert.equal(result.candidatesCreated, 2);

    const gate = (admin.batchMetadata() as {
      business_fit_gate?: Record<string, unknown>;
    } | null)?.business_fit_gate;
    assert.ok(gate, '🔴 el bloque de observación sigue publicándose');
    // 🔴 El evaluador SIGUE midiendo: los cuatro contadores existen y la
    // agencia sigue contándose como `reject`, aunque ya no la descarte.
    assert.equal(gate!.rejected_count, 1, 'el nivel se mide aunque no decida');
    assert.ok(Array.isArray(gate!.samples), 'y la muestra con su motivo se conserva');
    // 🔴 Y la fila declara que dejó de decidir, para que una corrida antigua y
    // una nueva no se lean igual.
    assert.equal(gate!.blocks_admission, false);
    assert.equal(gate!.decides_acceptance, false);
    assert.equal(gate!.authorizes_spend, false);
    assert.equal(gate!.affects_ranking, false);
  });
});

// ─── Fixture F — Ranking: fit alto rankea sobre fit bajo ─────────────────────

describe('Fixture F — Ranking: el encaje ya no ordena, y el objetivo no recorta', () => {
  /**
   * 🔴 Esta fixture exigía que GOBO CRM (encaje `high`) rankeara por encima de
   * un candidato genérico y que, con `targetPersistibleCandidates: 1`, el
   * genérico quedara fuera por `target_cap`.
   *
   * Las DOS mitades quedaron obsoletas por reglas ya aprobadas:
   *
   *   · X6.13 — el objetivo es un MÍNIMO: no existe `target_cap`, así que
   *     pedir 1 no descarta a la segunda.
   *   · BUSINESS-FIT-OBSERVATION-ONLY — `businessFitRankingBonus` sale del
   *     score compuesto: el encaje no ordena.
   *
   * Lo que la fixture protegía de verdad —que el writer no pierda candidatas y
   * que el orden lo decidan señales con respaldo— se conserva y se hace
   * explícito.
   */
  it('🔴 con objetivo 1, las DOS persisten: el objetivo no es un techo', async () => {
    const candidates: ProspectingPipelineCandidate[] = [
      makeCandidate({ name: 'GenericoCo', website: 'https://genericoco.com.co', domain: 'genericoco.com.co', sourceSnippet: null }),
      makeCandidate({ name: 'GOBO CRM', website: 'https://gobo.com.co/implementacion-crm-empresas-colombia', domain: 'gobo.com.co', sourceSnippet: 'Implementación de CRM para empresas Colombia clientes corporativos software ERP' }),
    ];

    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient().client;

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

    assert.equal(
      result.candidatesCreated,
      2,
      '🔴 se pidió 1 y sobreviven las 2: el objetivo es un mínimo',
    );
    assert.deepEqual(
      result.skipped.filter((s) => s.reason === 'target_cap'),
      [],
      '🔴 `target_cap` ya no existe como desenlace',
    );
    assert.deepEqual(
      result.skipped.filter((s) => s.reason.startsWith('business_fit:')),
      [],
      '🔴 y el genérico tampoco cae por encaje',
    );
  });

  it('🔴 el comparador del writer ya no puede ordenar por encaje', () => {
    // El trinquete es el TIPO: `WriterEligibleRankSignals` no tiene término de
    // encaje, así que dos candidatas con las MISMAS señales con respaldo empatan.
    const señales = {
      sourceUrlRankingBonus: 10,
      countryCompatWeight: 1,
      confidenceScore: 0.85,
      website: 'https://gobo.com.co/implementacion-crm-empresas-colombia',
    };
    assert.equal(
      compareWriterEligibleRank(señales, { ...señales }),
      0,
      'mismas señales con respaldo ⇒ empate, sea cual sea el encaje',
    );
    // Y los desempates que SÍ tienen respaldo siguen ordenando.
    assert.ok(
      compareWriterEligibleRank({ ...señales, sourceUrlRankingBonus: 40 }, señales) < 0,
      'mejor calidad de URL gana',
    );
    assert.ok(
      compareWriterEligibleRank({ ...señales, website: 'https://gobo.com.co/' }, señales) < 0,
      'y a igualdad de compuesto y confianza, gana la URL más cercana a la raíz',
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

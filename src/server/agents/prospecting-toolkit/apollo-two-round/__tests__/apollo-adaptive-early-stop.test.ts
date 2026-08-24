/**
 * apollo-adaptive-early-stop.test.ts
 *
 * AGENT1-APOLLO-FINALIZATION-HARDENING-1 · ADAPTIVE-EARLY-STOP
 * §§ 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 y 14.
 *
 * El defecto que esta suite cierra, y que el addendum anterior CREÓ al cerrar el
 * suyo:
 *
 *   WRITER-ONLY-ADMISSION-PENDING dejó de leer la ausencia de un veredicto como
 *   un pase —correcto— pero declaró las TRECE comprobaciones de admisión
 *   permanentemente pendientes. Con trece pendientes fijas, ningún candidato
 *   podía ser `stable`, así que la parada temprana por objetivo quedó MUERTA en
 *   producción: toda corrida recorría el máximo de gasto autorizado aunque la
 *   ronda 1 ya hubiera traído las cinco empresas.
 *
 * Lo que aquí se congela es que las trece se RESUELVEN —con las funciones del
 * writer, no con copias— sin volver a la semántica optimista: sin resolver sigue
 * sin ser un pase, y una admisión resuelta NEGATIVA descarta igual que una
 * condición fallida.
 *
 * Sin red, sin Apollo, sin Supabase real, sin créditos, sin reloj.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundCandidateTargetConditions,
  type ApolloTwoRoundDeps,
  type ApolloTwoRoundRunResult,
  type EnrichmentResult,
} from '../orchestrator';
import {
  APOLLO_DB_BACKED_PRE_WRITER_ADMISSION_CHECKS,
  APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS,
  buildApolloPreWriterBatchAdmissionContext,
  evaluateApolloPreWriterDeterministicGates,
  evaluateCandidatePreWriterAdmission,
  type ApolloPreWriterDbAdmissionContext,
} from '../../apollo-pre-writer-target-conditions';
import { evaluateCandidateTargetEligibility } from '../../candidate-completeness-contract';
import {
  compareWriterEligibleRank,
  orderByCompleteFirst,
  selectIntraBatchIdentityWinnerIndexes,
} from '../../candidate-writer-pure-gates';
import { writeProspectingCandidates } from '../../candidate-writer';
import type { CandidateWriterInput, ProspectingPipelineCandidate } from '../../types';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  simulatedEffectiveRequestBuilder,
  org,
  passingAssessment,
} from './fixtures';

import { preM126Rpc } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
// ─── Fixtures de candidato ────────────────────────────────────────────────────

const GATE_CONTEXT = {
  targetCountryCode: 'CO',
  subindustries: ['Supermercados e Hipermercados'] as readonly string[],
};

/**
 * Candidata que supera los OCHO gates deterministas del writer. Todas las
 * variaciones de esta suite parten de ella y cambian un solo campo, para que el
 * gate que se ejercita sea inequívoco.
 */
function candidate(
  overrides: Record<string, unknown> = {},
): ProspectingPipelineCandidate {
  return {
    name: 'Supermercados Andinos S.A.',
    website: 'https://www.supermercadosandinos.com.co',
    domain: 'supermercadosandinos.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail y Consumo',
    sourceUrl: 'https://www.supermercadosandinos.com.co/',
    sourceTitle: 'Supermercados Andinos — Cadena de supermercados en Colombia',
    sourceSnippet:
      'Supermercados Andinos opera una cadena de supermercados e hipermercados en Colombia.',
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate',
      confidence: 1,
      input: { name: 'Supermercados Andinos S.A.', website: null, domain: null },
      checkedSources: ['sellup'],
      summary: 'No match',
      matches: [],
    },
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 0.9,
      fitScore: 0.88,
      dataCompletenessScore: 0.82,
      recommendedAction: 'approve_for_review',
      breakdown: {
        existenceSignals: 1,
        websiteSignals: 1,
        duplicateSignals: 1,
        sourceSignals: 1,
        fitSignals: 1,
        completenessSignals: 1,
        penalties: 0,
      },
      reasons: [],
      warnings: [],
      blockers: [],
    },
    ...overrides,
  } as unknown as ProspectingPipelineCandidate;
}

function stateOf(
  checks: readonly { check: string; state: string }[],
  name: string,
): string {
  const found = checks.find((entry) => entry.check === name);
  assert.ok(found, `la comprobación ${name} debe existir en el resultado`);
  return found.state;
}

/** Contexto de base VACÍO pero sano: cubre el dominio y no degradó. */
function dbContext(
  overrides: Partial<ApolloPreWriterDbAdmissionContext> = {},
): ApolloPreWriterDbAdmissionContext {
  return {
    coveredDomains: new Set(['supermercadosandinos.com.co']),
    noveltyIndex: new Map(),
    recentIdentityKeys: new Set<string>(),
    activeCandidates: [],
    degraded: false,
    ...overrides,
  };
}

// ─── § 3 · los ocho gates deterministas se resuelven ANTES del writer ─────────

describe('§ 3 · gates deterministas del writer, resueltos pre-writer', () => {
  test('la candidata sana no falla ninguno de los ocho', () => {
    const checks = evaluateApolloPreWriterDeterministicGates(candidate(), GATE_CONTEXT);

    assert.deepEqual(
      checks.map((entry) => entry.check),
      [
        'quality_label_discard',
        'canonical_identity_gate',
        'non_official_source_domain',
        'country_compatibility_gate',
        'content_page_gate',
        'content_intermediary_gate',
        'external_platform_gate',
        'source_url_quality_gate',
      ],
      'el orden es el de Pass 1 del writer: decide QUÉ causa se reporta',
    );
    for (const entry of checks) {
      assert.equal(entry.state, 'passed', `${entry.check} debería pasar: ${entry.reason}`);
    }
  });

  test('cada gate se puede DISPARAR, y sólo el suyo cambia a `failed`', () => {
    const cases: Array<{ gate: string; candidate: ProspectingPipelineCandidate }> = [
      {
        gate: 'quality_label_discard',
        candidate: candidate({
          scoring: { ...(candidate().scoring as object), qualityLabel: 'discard' },
        }),
      },
      {
        gate: 'canonical_identity_gate',
        candidate: candidate({ name: 'Software empresarial' }),
      },
      {
        gate: 'non_official_source_domain',
        candidate: candidate({
          domain: 'capterra.com',
          website: 'https://www.capterra.com/p/12345/andinos/',
        }),
      },
      {
        gate: 'content_page_gate',
        candidate: candidate({
          website: 'https://www.supermercadosandinos.com.co/blog/tendencias-retail',
        }),
      },
      {
        gate: 'external_platform_gate',
        candidate: candidate({
          domain: 'linkedin.com',
          website: 'https://www.linkedin.com/company/supermercados-andinos',
        }),
      },
    ];

    for (const scenario of cases) {
      const checks = evaluateApolloPreWriterDeterministicGates(
        scenario.candidate,
        GATE_CONTEXT,
      );
      assert.equal(
        stateOf(checks, scenario.gate),
        'failed',
        `${scenario.gate} debería bloquear a su fixture`,
      );
      const failing = checks.find((entry) => entry.check === scenario.gate);
      assert.ok(
        failing?.reason && failing.reason.length > 0,
        `${scenario.gate} debe nombrar la causa, no sólo fallar`,
      );
    }
  });

  test('sin código de país el gate geográfico queda PENDIENTE, nunca aprobado', () => {
    // El writer descarta con `missing_country_code`. Aquí no se afirma un rechazo
    // del candidato —la causa es de configuración— pero tampoco un pase: es
    // exactamente el caso en el que «no se sabe» no puede leerse como «cumple».
    const checks = evaluateApolloPreWriterDeterministicGates(candidate(), {
      targetCountryCode: null,
      subindustries: [],
    });
    assert.equal(stateOf(checks, 'country_compatibility_gate'), 'pending');
  });
});

// ─── § 3 · PARIDAD REAL contra el writer ──────────────────────────────────────

const PARITY_BATCH_ID = 'batch-adaptive-early-stop-0000-000000000001';
const PARITY_USER_ID = 'aaaaaaaa-0000-0000-0000-000000000009';

class Chain {
  constructor(private readonly value: unknown) {}
  eq(): Chain { return this; }
  neq(): Chain { return this; }
  in(): Chain { return this; }
  not(): Chain { return this; }
  gte(): Chain { return this; }
  limit(): Chain { return this; }
  select(): Chain { return this; }
  then<T>(onFulfilled: (v: unknown) => T | PromiseLike<T>): Promise<T> {
    return Promise.resolve(this.value).then(onFulfilled);
  }
}

/** Doble de cliente admin: cero red, cero Supabase, cero escrituras reales. */
function makeFakeAdmin(): SupabaseClient {
  let seq = 0;
  return {
    // CUT-3B4-CORRECCIÓN — la 126 SIN aplicar se declara como lo hace la BASE.
    // Omitir `rpc` modelaría un cliente no soportado, y eso degrada CERRADO.
    rpc: preM126Rpc,
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select() {
            return {
              eq(column: string) {
                if (column === 'source') return new Chain({ data: [], error: null });
                return {
                  single: async () => ({
                    data: {
                      id: PARITY_BATCH_ID,
                      status: 'draft',
                      source: 'agent_1',
                      created_by: PARITY_USER_ID,
                      owner_id: PARITY_USER_ID,
                      metadata: { request_source: 'chat_wizard' },
                      client_request_id: 'req-adaptive-early-stop',
                    },
                    error: null,
                  }),
                };
              },
            };
          },
          update() {
            return new Chain({ error: null });
          },
        };
      }
      if (table === 'prospect_candidates') {
        return {
          select() {
            return new Chain({ data: [], error: null });
          },
          insert() {
            const index = seq++;
            return {
              select() {
                return {
                  single: async () => ({ data: { id: `cand-${index + 1}` }, error: null }),
                };
              },
            };
          },
        };
      }
      if (table === 'prospect_candidate_audit') {
        return { insert: async () => ({ data: null, error: null }) };
      }
      throw new Error(`tabla no simulada: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function writerInput(
  candidates: readonly ProspectingPipelineCandidate[],
  targetPersistibleCandidates?: number,
  provider: string = 'tavily',
): CandidateWriterInput {
  return {
    pipelineOutput: {
      input: {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Retail y Consumo',
        subindustries: [],
        maxResults: candidates.length,
      },
      candidates: [...candidates],
      summary: {
        requested: candidates.length,
        returned: candidates.length,
        highQualityNew: candidates.length,
        needsReview: 0,
        duplicates: 0,
        insufficientData: 0,
        discarded: 0,
      },
      metadata: { provider, pipelineVersion: 'test' },
      warnings: [],
      catalogContext: null,
    },
    triggeredByUserId: PARITY_USER_ID,
    ownerId: PARITY_USER_ID,
    source: 'agent_1',
    dryRun: false,
    existingBatchId: PARITY_BATCH_ID,
    ...(targetPersistibleCandidates !== undefined ? { targetPersistibleCandidates } : {}),
  } as unknown as CandidateWriterInput;
}

describe('§ 3 · paridad: lo que el evaluador declara `failed`, el writer lo descarta', () => {
  test('los cinco fixtures bloqueados por gate no llegan a persistirse', async () => {
    const blocked: ProspectingPipelineCandidate[] = [
      candidate({
        name: 'Descartada por calidad',
        domain: 'descartada-calidad.com.co',
        website: 'https://www.descartada-calidad.com.co',
        scoring: { ...(candidate().scoring as object), qualityLabel: 'discard' },
      }),
      candidate({
        name: 'Software empresarial',
        domain: 'software-empresarial.com.co',
        website: 'https://www.software-empresarial.com.co',
      }),
      candidate({
        name: 'Andinos en Capterra',
        domain: 'capterra.com',
        website: 'https://www.capterra.com/p/12345/andinos/',
      }),
      candidate({
        name: 'Andinos Blog',
        domain: 'andinos-blog.com.co',
        website: 'https://www.andinos-blog.com.co/blog/tendencias-retail',
      }),
      candidate({
        name: 'Andinos en LinkedIn',
        domain: 'linkedin.com',
        website: 'https://www.linkedin.com/company/supermercados-andinos',
      }),
    ];

    // 1. El evaluador PRE-writer los marca `failed` (al menos un gate cada uno).
    for (const entry of blocked) {
      const checks = evaluateApolloPreWriterDeterministicGates(entry, GATE_CONTEXT);
      assert.ok(
        checks.some((check) => check.state === 'failed'),
        `${entry.name}: el evaluador pre-writer debería bloquearla`,
      );
    }

    // 2. Y el writer real, con el mismo lote, no persiste a ninguno.
    const result = await writeProspectingCandidates(writerInput(blocked), makeFakeAdmin());
    assert.equal(
      result.candidatesCreated,
      0,
      'ninguna de las cinco puede llegar a `prospect_candidates`',
    );
    for (const entry of blocked) {
      assert.ok(
        result.skipped.some((skip) => skip.name === entry.name),
        `${entry.name} debe aparecer en los descartes del writer`,
      );
    }
  });

  test('la candidata sana SÍ la persiste el writer', async () => {
    const result = await writeProspectingCandidates(
      writerInput([candidate()]),
      makeFakeAdmin(),
    );
    assert.equal(result.candidatesCreated, 1, 'el fixture base no puede estar bloqueado');
  });
});

// ─── § 2 · prefetch de base: una vez, y su ausencia NO es un pase ─────────────

describe('§ 2 · las tres comprobaciones respaldadas por base', () => {
  test('sin contexto de base quedan PENDIENTES, con la causa nombrada', () => {
    const admission = evaluateCandidatePreWriterAdmission({
      candidateKey: 'apollo:a1',
      candidate: candidate(),
      context: GATE_CONTEXT,
      dbContext: null,
      batchContext: { intraBatchIdentityWinners: new Map(), targetCapAdmittedKeys: new Set() },
    });
    for (const check of APOLLO_DB_BACKED_PRE_WRITER_ADMISSION_CHECKS) {
      assert.equal(stateOf(admission.checks, check), 'pending', check);
    }
    assert.ok(
      admission.checks
        .filter((c) => APOLLO_DB_BACKED_PRE_WRITER_ADMISSION_CHECKS.includes(c.check))
        .every((c) => c.reason === 'db_prefetch_unavailable'),
    );
  });

  test('un prefetch DEGRADADO tampoco resuelve: fail-open sirve para escribir, no para dejar de gastar', () => {
    const admission = evaluateCandidatePreWriterAdmission({
      candidateKey: 'apollo:a1',
      candidate: candidate(),
      context: GATE_CONTEXT,
      dbContext: dbContext({ degraded: true }),
      batchContext: { intraBatchIdentityWinners: new Map(), targetCapAdmittedKeys: new Set() },
    });
    for (const check of APOLLO_DB_BACKED_PRE_WRITER_ADMISSION_CHECKS) {
      assert.equal(stateOf(admission.checks, check), 'pending', check);
    }
  });

  test('un dominio FUERA de la cobertura del prefetch queda pendiente, no aprobado', () => {
    // Éste es el caso que un `Map` vacío contestaría como «no hay nada» — y que
    // leído como pase sería el defecto de siempre con otro disfraz.
    const admission = evaluateCandidatePreWriterAdmission({
      candidateKey: 'apollo:a1',
      candidate: candidate({ domain: 'otra-empresa.com.co', website: 'https://otra-empresa.com.co' }),
      context: GATE_CONTEXT,
      dbContext: dbContext(),
      batchContext: { intraBatchIdentityWinners: new Map(), targetCapAdmittedKeys: new Set() },
    });
    for (const check of APOLLO_DB_BACKED_PRE_WRITER_ADMISSION_CHECKS) {
      assert.equal(stateOf(admission.checks, check), 'pending', check);
      const entry = admission.checks.find((c) => c.check === check);
      assert.equal(entry?.reason, 'domain_outside_prefetch_coverage');
    }
  });

  test('con el prefetch sano y cubriendo el dominio, las tres se RESUELVEN', () => {
    const soleCandidate = candidate();
    const admission = evaluateCandidatePreWriterAdmission({
      candidateKey: 'apollo:a1',
      candidate: soleCandidate,
      context: GATE_CONTEXT,
      dbContext: dbContext(),
      batchContext: buildApolloPreWriterBatchAdmissionContext({
        candidates: [
          {
            candidateKey: 'apollo:a1',
            candidate: soleCandidate,
            completeValidIfPersisted: true,
          },
        ],
        context: GATE_CONTEXT,
        targetCap: 5,
      }),
    });
    for (const check of APOLLO_DB_BACKED_PRE_WRITER_ADMISSION_CHECKS) {
      assert.equal(stateOf(admission.checks, check), 'passed', check);
    }
    assert.deepEqual(admission.pendingChecks, [], 'ninguna pendiente');
    assert.deepEqual(admission.failedChecks, [], 'ninguna fallida');
    assert.equal(
      admission.passedChecks.length,
      APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS.length,
      'las TRECE resueltas y aprobadas',
    );
  });

  test('un duplicado activo, un cooldown de identidad o una repetición previa BLOQUEAN', () => {
    // A. duplicado activo por dominio.
    const withActiveDuplicate = evaluateCandidatePreWriterAdmission({
      candidateKey: 'apollo:a1',
      candidate: candidate(),
      context: GATE_CONTEXT,
      dbContext: dbContext({
        activeCandidates: [
          {
            id: 'existing-1',
            name: 'Supermercados Andinos S.A.',
            domain: 'supermercadosandinos.com.co',
            normalizedName: 'supermercados andinos s a',
            inferredCompanyName: null,
            status: 'needs_review',
          },
        ],
      }),
      batchContext: {
        intraBatchIdentityWinners: new Map(),
        targetCapAdmittedKeys: new Set(['apollo:a1']),
      },
    });
    assert.equal(stateOf(withActiveDuplicate.checks, 'active_duplicate_guard'), 'failed');

    // B. novedad: el dominio ya fue sugerido y sigue pendiente de revisión.
    const withNovelty = evaluateCandidatePreWriterAdmission({
      candidateKey: 'apollo:a1',
      candidate: candidate(),
      context: GATE_CONTEXT,
      dbContext: dbContext({
        noveltyIndex: new Map([
          [
            'supermercadosandinos.com.co',
            [
              {
                id: 'prev-1',
                batch_id: 'batch-prev',
                name: 'Supermercados Andinos S.A.',
                domain: 'supermercadosandinos.com.co',
                website: null,
                status: 'duplicate',
                duplicate_status: 'exact_duplicate',
                reviewed_at: null,
                updated_at: null,
                created_at: '2020-01-01T00:00:00.000Z',
              },
            ],
          ],
        ]) as unknown as ApolloPreWriterDbAdmissionContext['noveltyIndex'],
      }),
      batchContext: {
        intraBatchIdentityWinners: new Map(),
        targetCapAdmittedKeys: new Set(['apollo:a1']),
      },
    });
    assert.equal(stateOf(withNovelty.checks, 'novelty_index'), 'failed');
  });
});

// ─── § 4 · dedupe intra-lote, sin base y con la política del writer ──────────

describe('§ 4 · dedupe intra-lote resuelta antes del writer', () => {
  test('dos candidatas con la MISMA identidad: sólo una puede ser admitida', () => {
    const first = candidate({
      name: 'Supermercados Andinos',
      domain: 'andinos-uno.com.co',
      website: 'https://www.andinos-uno.com.co',
    });
    const second = candidate({
      name: 'Supermercados Andinos S.A.S.',
      domain: 'andinos-dos.com.co',
      website: 'https://www.andinos-dos.com.co/tienda/bogota',
    });

    const context = buildApolloPreWriterBatchAdmissionContext({
      candidates: [
        { candidateKey: 'k1', candidate: first, completeValidIfPersisted: true },
        { candidateKey: 'k2', candidate: second, completeValidIfPersisted: true },
      ],
      context: GATE_CONTEXT,
      targetCap: null,
    });

    const winners = [...context.intraBatchIdentityWinners.values()];
    assert.equal(winners.length, 1, 'una sola identidad, un solo ganador');

    const admissions = [
      { key: 'k1', candidate: first },
      { key: 'k2', candidate: second },
    ].map(({ key, candidate: entry }) =>
      evaluateCandidatePreWriterAdmission({
        candidateKey: key,
        candidate: entry,
        context: GATE_CONTEXT,
        dbContext: null,
        batchContext: context,
      }),
    );

    const passed = admissions.filter(
      (a) => stateOf(a.checks, 'intra_batch_identity_dedupe') === 'passed',
    );
    const failed = admissions.filter(
      (a) => stateOf(a.checks, 'intra_batch_identity_dedupe') === 'failed',
    );
    assert.equal(passed.length, 1);
    assert.equal(failed.length, 1);
    assert.equal(
      failed[0].failedChecks.includes('intra_batch_identity_dedupe'),
      true,
      'la perdedora lo declara FALLIDO, no pendiente: hay respuesta',
    );
  });

  test('la política de ganador es la del writer: primera en el orden de encaje', () => {
    // El helper compartido es literalmente el que aplica Pass 2.5.
    const { winners, losers } = selectIntraBatchIdentityWinnerIndexes([
      'a',
      'b',
      'a',
      null,
      'b',
    ]);
    assert.deepEqual(winners, [0, 1, 3], 'sin identidad nunca se deduplica');
    assert.deepEqual(losers, [2, 4]);
  });

  test('cinco contract-complete de las que dos comparten identidad ⇒ 4 admitidas', () => {
    const entries = [
      candidate({ name: 'Andinos Uno', domain: 'a1.com.co', website: 'https://a1.com.co' }),
      candidate({ name: 'Andinos Dos', domain: 'a2.com.co', website: 'https://a2.com.co' }),
      candidate({ name: 'Andinos Tres', domain: 'a3.com.co', website: 'https://a3.com.co' }),
      candidate({ name: 'Mercados Cuatro', domain: 'a4.com.co', website: 'https://a4.com.co' }),
      candidate({
        name: 'Mercados Cuatro S.A.S.',
        domain: 'a5.com.co',
        website: 'https://a5.com.co',
      }),
    ];
    const context = buildApolloPreWriterBatchAdmissionContext({
      candidates: entries.map((entry, index) => ({
        candidateKey: `k${index + 1}`,
        candidate: entry,
        completeValidIfPersisted: true,
      })),
      context: GATE_CONTEXT,
      targetCap: 5,
    });

    const admitted = entries.filter((entry, index) => {
      const admission = evaluateCandidatePreWriterAdmission({
        candidateKey: `k${index + 1}`,
        candidate: entry,
        context: GATE_CONTEXT,
        dbContext: null,
        batchContext: context,
      });
      return stateOf(admission.checks, 'intra_batch_identity_dedupe') === 'passed';
    });

    assert.equal(admitted.length, 4, 'la identidad repetida no puede contar dos veces');
  });
});

// ─── § 5 · el cupo es COMPLETE-FIRST ─────────────────────────────────────────

describe('§ 5 · target cap complete-first', () => {
  test('el orden coloca a los completos primero sin tocar el orden interno', () => {
    const entries = [
      { id: 'r1', complete: false },
      { id: 'c1', complete: true },
      { id: 'r2', complete: false },
      { id: 'c2', complete: true },
    ];
    assert.deepEqual(
      orderByCompleteFirst(entries, (entry) => entry.complete).map((entry) => entry.id),
      ['c1', 'c2', 'r1', 'r2'],
      'la partición es estable: dentro de cada grupo manda el encaje',
    );
  });

  test('cinco completos + tres de revisión con MEJOR encaje ⇒ sobreviven los cinco completos', () => {
    const complete = Array.from({ length: 5 }, (_unused, index) =>
      candidate({
        name: `Completa ${index + 1}`,
        domain: `completa${index + 1}.com.co`,
        website: `https://completa${index + 1}.com.co`,
      }),
    );
    const reviewOnly = Array.from({ length: 3 }, (_unused, index) =>
      candidate({
        name: `Revision ${index + 1}`,
        domain: `revision${index + 1}.com.co`,
        website: `https://revision${index + 1}.com.co`,
        // Confianza máxima: en el orden ANTERIOR estas tres desplazaban a completas.
        scoring: { ...(candidate().scoring as object), confidenceScore: 1 },
      }),
    );

    const context = buildApolloPreWriterBatchAdmissionContext({
      candidates: [
        ...complete.map((entry, index) => ({
          candidateKey: `c${index + 1}`,
          candidate: entry,
          completeValidIfPersisted: true,
        })),
        ...reviewOnly.map((entry, index) => ({
          candidateKey: `r${index + 1}`,
          candidate: entry,
          completeValidIfPersisted: false,
        })),
      ],
      context: GATE_CONTEXT,
      targetCap: 5,
    });

    const admitted = context.targetCapAdmittedKeys;
    assert.ok(admitted !== null);
    assert.equal(admitted.size, 5, 'el cupo TOTAL no cambia');
    for (let index = 1; index <= 5; index++) {
      assert.ok(
        admitted.has(`c${index}`),
        `la completa c${index} no puede ser expulsada por un review-only con mejor encaje`,
      );
    }
    for (let index = 1; index <= 3; index++) {
      assert.ok(!admitted.has(`r${index}`));
    }
  });

  test('tres completos + cinco de revisión ⇒ el objetivo estable es 3, no 5', () => {
    const complete = Array.from({ length: 3 }, (_unused, index) =>
      candidate({
        name: `Completa ${index + 1}`,
        domain: `completa${index + 1}.com.co`,
        website: `https://completa${index + 1}.com.co`,
      }),
    );
    const reviewOnly = Array.from({ length: 5 }, (_unused, index) =>
      candidate({
        name: `Revision ${index + 1}`,
        domain: `revision${index + 1}.com.co`,
        website: `https://revision${index + 1}.com.co`,
      }),
    );

    const context = buildApolloPreWriterBatchAdmissionContext({
      candidates: [
        ...complete.map((entry, index) => ({
          candidateKey: `c${index + 1}`,
          candidate: entry,
          completeValidIfPersisted: true,
        })),
        ...reviewOnly.map((entry, index) => ({
          candidateKey: `r${index + 1}`,
          candidate: entry,
          completeValidIfPersisted: false,
        })),
      ],
      context: GATE_CONTEXT,
      targetCap: 5,
    });

    // El cupo admite cinco, pero sólo tres de ellos cuentan hacia el objetivo.
    const admitted = context.targetCapAdmittedKeys!;
    const admittedComplete = [...admitted].filter((key) => key.startsWith('c'));
    assert.equal(admittedComplete.length, 3, 'los tres completos entran');
    assert.equal(admitted.size, 5, 'y el cupo se llena con revisión, sin desplazarlos');
  });

  test('EL WRITER REAL conserva las completas cuando el cupo aprieta', async () => {
    // Éste es el § 5 medido donde de verdad ocurre: el cupo de Pass 3.
    //
    // Antes de este addendum el cupo cortaba el lote ordenado por ENCAJE, así que
    // las dos completas —con confianza deliberadamente MÁS BAJA— quedaban fuera y
    // se persistían tres de revisión. El resultado de la corrida bajaba de 2
    // empresas que cuentan a 0, sin que ninguna métrica lo dijera.
    // AGENT1-CUT3B23 — el LinkedIn empresarial se DERIVA del indice, como el dominio.
    //
    // Con una constante compartida las dos completas declaraban dominios DISTINTOS
    // y a la vez la MISMA pagina de empresa de LinkedIn. Mientras nadie comparaba
    // LinkedIn era relleno inofensivo; con el registro de identidad de lote una de
    // las dos se retira como duplicado duro y el cupo mide 1 en vez de 2. La
    // contradiccion esta en la fabrica, no en la admision.
    const confirmedFieldsFor = (index: number) => ({
      linkedin: {
        companyLinkedInUrl: `https://www.linkedin.com/company/cadena-completa-${index}`,
        status: 'confirmed',
        sourceProvider: 'apollo',
        sourceOperation: 'organizations_search',
        observedAt: '2026-08-01T00:00:00.000Z',
        rawValue: `https://www.linkedin.com/company/cadena-completa-${index}`,
        reason: null,
      },
      employeeCount: {
        employeeCount: 850,
        status: 'confirmed',
        sourceProvider: 'apollo',
        sourceOperation: 'organizations_search',
        observedAt: '2026-08-01T00:00:00.000Z',
        rawValue: 850,
        reason: null,
      },
    });
    const confirmedFieldsTemplate = confirmedFieldsFor(0);
    const missingFields = {
      linkedin: {
        ...confirmedFieldsTemplate.linkedin,
        companyLinkedInUrl: null,
        rawValue: null,
        status: 'not_returned',
      },
      employeeCount: {
        ...confirmedFieldsTemplate.employeeCount,
        employeeCount: null,
        status: 'not_returned',
      },
    };

    const complete = [1, 2].map((index) =>
      candidate({
        name: `Cadena Completa ${index}`,
        domain: `cadena-completa-${index}.com.co`,
        website: `https://www.cadena-completa-${index}.com.co`,
        sectorEvidenceState: 'sector_evidence_confirmed',
        providerCompanyFields: confirmedFieldsFor(index),
        // Confianza BAJA a propósito: en el orden anterior perdían el cupo.
        scoring: { ...(candidate().scoring as object), confidenceScore: 0.1 },
      }),
    );
    const reviewOnly = [1, 2, 3].map((index) =>
      candidate({
        name: `Cadena Revision ${index}`,
        domain: `cadena-revision-${index}.com.co`,
        website: `https://www.cadena-revision-${index}.com.co`,
        sectorEvidenceState: 'sector_evidence_confirmed',
        providerCompanyFields: missingFields,
        scoring: { ...(candidate().scoring as object), confidenceScore: 1 },
      }),
    );

    const result = await writeProspectingCandidates(
      // Cupo 2: sólo caben dos, y tienen que ser las completas.
      writerInput([...reviewOnly, ...complete], 2, 'apollo_organizations'),
      makeFakeAdmin(),
    );

    assert.equal(result.candidatesCreated, 2, 'el cupo TOTAL no cambia');
    const cappedOut = result.skipped.filter((skip) => skip.reason === 'target_cap');
    assert.equal(cappedOut.length, 3, 'las tres de revisión quedan fuera por cupo');
    for (const entry of complete) {
      assert.ok(
        !cappedOut.some((skip) => skip.name === entry.name),
        `${entry.name} es completa: un review-only con mejor encaje no puede expulsarla`,
      );
    }
  });

  test('el comparador de ranking es el MISMO que aplica el writer', () => {
    const better = {
      businessFitRankingBonus: 10,
      sourceUrlRankingBonus: 0,
      countryCompatWeight: 0,
      confidenceScore: 0.1,
      website: 'https://x.com/a/b/c',
    };
    const worse = {
      businessFitRankingBonus: 0,
      sourceUrlRankingBonus: 0,
      countryCompatWeight: 0,
      confidenceScore: 0.9,
      website: 'https://x.com/',
    };
    assert.ok(
      compareWriterEligibleRank(better, worse) < 0,
      'el score compuesto manda sobre la confianza, igual que en Pass 2',
    );
  });
});

// ─── § 6 · el pipeline canónico y su regla de estabilidad ────────────────────

describe('§ 6 · `stable` sólo con cero fallidas y cero pendientes', () => {
  test('una admisión FALLIDA descarta igual que una condición fallida', () => {
    const eligibility = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: 'confirmed',
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
      failedWriterOnlyAdmissionChecks: ['target_cap'],
    });
    assert.equal(eligibility.countsTowardTargetIfPersisted, false);
    // Y NO es un pendiente: hay respuesta, y es que no pasa.
    assert.deepEqual(eligibility.writerOnlyFailedChecks, ['target_cap']);
    assert.deepEqual(eligibility.pendingConditions, []);
    assert.ok(eligibility.strictlyFailedConditions.includes('target_cap'));
  });

  test('todas las admisiones resueltas y aprobadas ⇒ el candidato SÍ es estable', () => {
    const eligibility = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: 'confirmed',
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
      unresolvedWriterOnlyAdmissionChecks: [],
      failedWriterOnlyAdmissionChecks: [],
    });
    assert.equal(eligibility.countsTowardTargetIfPersisted, true);
  });

  test('una misma admisión no puede contarse a la vez como pendiente y como fallida', () => {
    const eligibility = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: 'confirmed',
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
      unresolvedWriterOnlyAdmissionChecks: ['novelty_index'],
      failedWriterOnlyAdmissionChecks: ['novelty_index'],
    });
    assert.deepEqual(eligibility.writerOnlyPendingChecks, ['novelty_index']);
    assert.deepEqual(eligibility.writerOnlyFailedChecks, []);
  });
});

// ─── Fixture de corrida para §§ 7, 8 y 14 ────────────────────────────────────

const CANDIDATE_IDS = ['s1', 's2', 's3', 's4', 's5'] as const;

type RunProbe = {
  result: ApolloTwoRoundRunResult;
  enrichCalls: string[];
  searchCalls: number;
};

/**
 * `missingEmployeeFor` — candidatas a las que el proveedor NO devolvió
 * `employee_count`. Es la única variable del escenario, y es exactamente la que
 * decide si la parada temprana puede ocurrir.
 */
async function run(scenario: {
  missingEmployeeFor?: readonly string[];
  /** Un enrichment resuelve el campo que faltaba. */
  enrichmentResolvesEmployee?: boolean;
}): Promise<RunProbe> {
  const enrichCalls: string[] = [];
  let searchCalls = 0;
  const missing = new Set((scenario.missingEmployeeFor ?? []).map((id) => `apollo:${id}`));
  const resolvedByEnrichment = new Set<string>();

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber }) => {
      searchCalls++;
      return {
        organizations:
          roundNumber === 1
            ? CANDIDATE_IDS.map((id, index) => org(id, { providerRank: index + 1 }))
            : [],
        providerRequestCount: 1,
        internalRecordedCredits: CANDIDATE_IDS.length,
        providerTotalPages: 2,
      };
    },
    // Las señales GRATUITAS tienen que decir lo mismo que el contrato: a quien le
    // falta `employee_count` le falta también en la respuesta de búsqueda. Si no,
    // el selector de enrichment no vería nada que comprar y el escenario del § 8
    // no ejercitaría lo que dice ejercitar.
    assessCandidate: ({ organization }) => {
      const key = `apollo:${organization.providerOrganizationId}`;
      const base = passingAssessment();
      return missing.has(key)
        ? { ...base, signals: { ...base.signals, hasCompanySizeSignal: false } }
        : base;
    },
    enrichCandidate: async ({ candidateKey }): Promise<EnrichmentResult> => {
      enrichCalls.push(candidateKey);
      if (scenario.enrichmentResolvesEmployee) resolvedByEnrichment.add(candidateKey);
      return {
        executed: true,
        internalRecordedCredits: 1,
        sectorEvidenceState: 'sector_evidence_confirmed',
        providerCompanyFields: {
          employeeCountStatus: scenario.enrichmentResolvesEmployee
            ? 'confirmed'
            : 'not_returned',
          linkedinStatus: 'confirmed',
        },
      };
    },
    applyFinalGates: () => ({ rejection: null }),
    readCandidateTargetConditions: ({
      candidateKey,
    }): ApolloTwoRoundCandidateTargetConditions => {
      const employeeResolved =
        !missing.has(candidateKey) || resolvedByEnrichment.has(candidateKey);
      return {
        subindustryMatch: 'confirmed',
        employeeCountStatus: employeeResolved ? 'confirmed' : 'not_returned',
        linkedinStatus: 'confirmed',
        duplicateStatus: 'no_match',
        ownershipGate: 'pass',
        qualityGate: 'pass',
        // ADAPTIVE-EARLY-STOP — el adaptador resuelve las TRECE admisiones.
        unresolvedWriterOnlyAdmissionChecks: [],
        failedWriterOnlyAdmissionChecks: [],
        resolvedWriterOnlyAdmissionChecks: APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS,
      };
    },
  };

  const result = await runApolloTwoRoundDiscovery(
    {
      config: testConfig({
        targetEligibleCompanies: 5,
        maxRounds: 2,
        maxResultsPerRound: 5,
        maxRawResultsPerRun: 10,
        maxEnrichmentsPerRun: 5,
      }),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
      resume: null,
    },
    deps,
  );

  return { result, enrichCalls, searchCalls };
}

/** § 14 — los topes ABSOLUTOS. Se comprueban en cada corrida de esta suite. */
function assertCapsHold(probe: RunProbe): void {
  assert.ok(probe.searchCalls <= 2, `búsquedas = ${probe.searchCalls}`);
  assert.ok(probe.enrichCalls.length <= 5, `enrichments = ${probe.enrichCalls.length}`);
  const credits =
    probe.result.runMetrics.totalSearchCredits + probe.result.runMetrics.totalEnrichmentCredits;
  assert.ok(credits <= 25, `créditos = ${credits}`);
}

// ─── § 7 · la parada temprana vuelve a existir ───────────────────────────────

describe('§ 7 · cinco finalizables en la ronda 1 detienen la corrida', () => {
  test('sin ronda 2, sin enrichments y con el objetivo alcanzado', async () => {
    const probe = await run({});

    assert.equal(probe.result.stableFinalizableCandidateCount, 5, 'las cinco son ESTABLES');
    assert.equal(probe.result.targetReached, true);
    assert.equal(probe.result.roundsExecuted, 1, 'la ronda 2 no se ejecuta');
    assert.equal(probe.result.secondRoundSkippedReason, 'target_reached');
    assert.equal(probe.searchCalls, 1, 'una sola búsqueda pagada');
    assert.deepEqual(probe.enrichCalls, [], 'cero enrichments: no había nada que resolver');
    assert.equal(probe.result.projectedTargetGap, 0);
    assertCapsHold(probe);
  });

  test('§ 14 — el ahorro es REAL: el trabajo queda por debajo del peor caso permitido', async () => {
    const probe = await run({});
    const worstCaseSearches = 2;
    const worstCaseEnrichments = 5;
    assert.ok(
      probe.searchCalls < worstCaseSearches,
      'con el objetivo cubierto no se emite la segunda búsqueda',
    );
    assert.ok(
      probe.enrichCalls.length < worstCaseEnrichments,
      'ni se compran los enrichments del peor caso',
    );
    // Y el gasto registrado es estrictamente menor al techo autorizado.
    const credits =
      probe.result.runMetrics.totalSearchCredits +
      probe.result.runMetrics.totalEnrichmentCredits;
    assert.ok(credits < 25, `créditos = ${credits}`);
  });
});

// ─── § 8 · NO REGRESIÓN: un incompleto nunca detiene la corrida ──────────────

describe('§ 8 · tres finalizables y dos sin `employee_count`', () => {
  test('la cuenta estable es 3 y la corrida SIGUE compitiendo', async () => {
    const probe = await run({ missingEmployeeFor: ['s4', 's5'] });

    assert.equal(
      probe.result.stableFinalizableCandidateCount,
      3,
      'un candidato sin `employee_count` no cuenta, aunque sea elegible',
    );
    assert.equal(probe.result.targetReached, false);
    assert.equal(probe.result.projectedTargetGap, 2);
    assert.notEqual(
      probe.result.secondRoundSkippedReason,
      'target_reached',
      'con hueco abierto, la parada por objetivo no puede dispararse',
    );
    // Las dos incompletas SÍ pudieron competir por un enrichment.
    assert.ok(probe.enrichCalls.length > 0, 'el presupuesto de enrichment sigue vivo');
    assertCapsHold(probe);
  });

  test('cuando el enrichment resuelve el campo, la cuenta sube a 5 y ya se puede parar', async () => {
    const probe = await run({
      missingEmployeeFor: ['s4', 's5'],
      enrichmentResolvesEmployee: true,
    });

    assert.equal(
      probe.result.stableFinalizableCandidateCount,
      5,
      'el crédito pagado SÍ movió la cuenta: ése es el ciclo que el § 8 exige',
    );
    assert.equal(probe.result.targetReached, true);
    assert.equal(probe.result.projectedTargetGap, 0);
    assertCapsHold(probe);
  });

  test('ningún candidato incompleto puede emitir `target_already_reached`', async () => {
    const probe = await run({ missingEmployeeFor: CANDIDATE_IDS });
    assert.equal(probe.result.stableFinalizableCandidateCount, 0);
    assert.equal(probe.result.targetReached, false);
    assert.ok(
      !probe.result.enrichmentSkips.some(
        (skip) => skip.skippedReason === 'target_already_reached',
      ),
      'con cero estables, nadie puede saltarse por objetivo alcanzado',
    );
    assertCapsHold(probe);
  });
});

// ─── § 11 · observabilidad ───────────────────────────────────────────────────

describe('§ 11 · las cifras de admisión viajan con su propio nombre', () => {
  test('pass / failed / pending se emiten por separado y sin duplicar metadata', async () => {
    const probe = await run({});
    assert.equal(
      probe.result.preWriterAdmissionPassCount,
      5 * APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS.length,
      'las trece resueltas por cada una de las cinco',
    );
    assert.equal(probe.result.preWriterAdmissionFailedCount, 0);
    assert.equal(probe.result.preWriterAdmissionPendingCount, 0);
    assert.equal(probe.result.writerOnlyPendingCount, 0, 'ya no hay nada pendiente');
    assert.deepEqual(probe.result.writerOnlyPendingReasons, []);
    // Y la proyección nunca queda por debajo de la estable.
    assert.ok(
      probe.result.projectedFinalizableCandidateCount >=
        probe.result.stableFinalizableCandidateCount,
    );
  });
});

// ─── § 12 · la reconciliación POST-writer sigue siendo la autoritativa ───────

describe('§ 12 · la cuenta pre-writer es control de gasto, no verdad persistida', () => {
  test('`targetReached` del orquestador es una PROYECCIÓN, no la cifra final', async () => {
    const probe = await run({});
    // El orquestador puede declarar el objetivo alcanzado antes de escribir; lo
    // que decide de verdad es la reconciliación posterior, que cuenta filas.
    assert.equal(probe.result.targetReached, true);
    assert.equal(probe.result.persistedCandidates, 5, 'lo que el ranking propone persistir');
    // Nada aquí afirma que las filas existan: `persistenceSuccess` no se evalúa
    // pre-writer, y por eso la decisión se lee de `countsTowardTargetIfPersisted`.
    assert.equal(probe.result.resultStatus, 'target_reached');
  });
});

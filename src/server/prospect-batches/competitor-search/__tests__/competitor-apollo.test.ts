/**
 * «Competidores de una empresa» — Apollo como último recurso. Todo con fakes:
 * 0 llamadas reales a Apollo, a Claude ni a la base.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MACRO_INDUSTRY_CATALOG_VERSION } from '@/modules/macro-industry-catalog/macro-industries';
import {
  COMPETITOR_APOLLO_MIN_REMAINING_MS,
  executeCompetitorSearchRun,
  shouldRunCompetitorApollo,
  type CompetitorApolloOutcome,
  type CompetitorApolloRequest,
  type CompetitorRunDeps,
  type CompetitorRunInput,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-competitor-run';
import { RUN_PROGRESS_LABELS, RUN_PROGRESS_STAGES } from '@/modules/prospect-batches/chat-wizard-execution/run-progress';
import { WIZARD_FUNCTION_LIMIT_MS } from '@/modules/prospect-batches/chat-wizard-execution/wizard-claude-search-leg';
import type { CompetitorReference } from '@/modules/prospect-batches/competitor-search/competitor-reference';
import type { CompetitorJudgeInput } from '@/server/agents/prospecting-toolkit/claude-classifier/competitor-judge';
import type { ApolloOrganizationInput } from '@/server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider';
import {
  buildCompetitorApolloSearchBody,
  COMPETITOR_APOLLO_MAX_EXCLUDED_DOMAINS,
  COMPETITOR_APOLLO_PER_PAGE,
  runCompetitorApolloStep,
  toCompetitorApolloJudgeItems,
  type CompetitorApolloPage,
  type CompetitorApolloPick,
  type CompetitorApolloStepDeps,
} from '../competitor-apollo';
import { readCompetitorApolloPage } from '../competitor-apollo.server';

const REFERENCE: CompetitorReference = {
  name: 'Alpina',
  domain: 'alpina.com',
  description: 'Lácteos y alimentos para consumo masivo',
  accountId: null,
  keywords: ['dairy products', 'yogurt'],
  homeCountryCode: 'CO',
};

const STEP_INPUT = { reference: REFERENCE, countryCode: 'CO', countryName: 'Colombia', industryName: 'Consumo masivo' };

function org(id: string, name: string | null, domain: string | null, extra: Partial<ApolloOrganizationInput> = {}): ApolloOrganizationInput {
  return {
    id,
    name,
    website_url: domain ? `https://www.${domain}` : null,
    primary_domain: domain,
    industry: 'dairy',
    short_description: `${name} produce lácteos`,
    city: 'Bogotá',
    ...extra,
  };
}

const PAGE: CompetitorApolloPage = {
  ok: true,
  organizations: [
    org('1', 'Colanta', 'colanta.com.co'),
    org('2', 'Alpina Productos Alimenticios', 'alpina.com'),
    org('3', 'Alquería', 'alqueria.com.co'),
    org('4', 'Banco Lácteo', 'yaenlote.com'),
    org('5', 'Colanta duplicada', 'colanta.com.co'),
  ],
  rawCount: 5,
  error: null,
};

type StepRecorded = {
  bodies: Record<string, unknown>[];
  judged: CompetitorJudgeInput[];
  written: CompetitorApolloPick[][];
  logged: number;
};

function stepDeps(overrides: Partial<CompetitorApolloStepDeps> = {}): { deps: CompetitorApolloStepDeps; rec: StepRecorded } {
  const rec: StepRecorded = { bodies: [], judged: [], written: [], logged: 0 };
  const deps: CompetitorApolloStepDeps = {
    isEnabled: () => true,
    checkQuota: async () => ({ allowed: true }),
    resolveLocation: (code) => (code === 'CO' ? 'Colombia' : null),
    loadExcludedDomains: async () => ['yaenlote.com'],
    searchPage: async (body) => {
      rec.bodies.push(body);
      return PAGE;
    },
    logUsage: async () => {
      rec.logged += 1;
    },
    judge: async (input) => {
      rec.judged.push(input);
      return {
        competitors: [{ key: 'a1', reason: 'leche y yogur' }, { key: 'zz', reason: 'inventada' }],
        judged: input.items.length,
        usage: null,
        errorCode: null,
      };
    },
    writeCandidates: async (picks) => {
      rec.written.push([...picks]);
      return { persistedCount: picks.length, completeValidCandidates: picks.length, errors: [] };
    },
    nowMs: () => 0,
    ...overrides,
  };
  return { deps, rec };
}

describe('K — consulta a Apollo', () => {
  it('K1: palabras clave + país + exclusión, una sola página', () => {
    const body = buildCompetitorApolloSearchBody({
      keywords: ['dairy products', 'yogurt', 'yogurt'],
      location: 'Colombia',
      excludeDomains: ['WWW.Alpina.com', 'colanta.com.co', ''],
    });
    assert.deepEqual(body, {
      q_organization_keyword_tags: ['dairy products', 'yogurt'],
      organization_locations: ['Colombia'],
      not_organization_websites_list: ['alpina.com', 'colanta.com.co'],
      per_page: COMPETITOR_APOLLO_PER_PAGE,
      page: 1,
    });
  });

  it('K2: sin palabras clave no hay consulta (sería «empresas del país»)', () => {
    assert.equal(buildCompetitorApolloSearchBody({ keywords: undefined, location: 'Colombia', excludeDomains: [] }), null);
    assert.equal(buildCompetitorApolloSearchBody({ keywords: ['  '], location: 'Colombia', excludeDomains: [] }), null);
  });

  it('K3: la exclusión se recorta al tope de Apollo y se omite si está vacía', () => {
    const many = Array.from({ length: 700 }, (_, i) => `d${i}.com`);
    const body = buildCompetitorApolloSearchBody({ keywords: ['x'], location: 'Colombia', excludeDomains: many });
    assert.equal((body?.not_organization_websites_list as string[]).length, COMPETITOR_APOLLO_MAX_EXCLUDED_DOMAINS);
    const empty = buildCompetitorApolloSearchBody({ keywords: ['x'], location: 'Colombia', excludeDomains: [] });
    assert.equal('not_organization_websites_list' in (empty ?? {}), false);
  });

  it('K4: al juez no llegan la referencia, las ya vistas ni las repetidas', () => {
    const { items, byKey } = toCompetitorApolloJudgeItems(
      [...PAGE.organizations, org('6', null, 'sinnombre.com'), org('7', 'Sin web', null)],
      REFERENCE,
      ['yaenlote.com'],
    );
    assert.deepEqual(items.map((i) => i.name), ['Colanta', 'Alquería', 'Sin web']);
    assert.deepEqual(items.map((i) => i.key), ['a1', 'a2', 'a3']);
    assert.equal(items[0].activity, 'dairy — Colanta produce lácteos');
    assert.equal(items[0].domain, 'colanta.com.co');
    assert.equal(byKey.get('a2')?.id, '3');
  });
});

describe('L — paso Apollo (juez + escritura)', () => {
  it('L1: escribe SÓLO lo que eligió el juez, con su motivo', async () => {
    const { deps, rec } = stepDeps();
    const outcome = await runCompetitorApolloStep(STEP_INPUT, deps);
    assert.equal(outcome.status, 'written');
    assert.equal(outcome.persistedCount, 1);
    assert.equal(rec.bodies.length, 1);
    // La referencia también se excluye en la consulta.
    assert.deepEqual(rec.bodies[0].not_organization_websites_list, ['alpina.com', 'yaenlote.com']);
    assert.equal(rec.judged[0].items.length, 2);
    assert.equal(rec.judged[0].reference.name, 'Alpina');
    assert.deepEqual(rec.written[0].map((p) => [p.organization.name, p.reason]), [['Colanta', 'leche y yogur']]);
    assert.equal(rec.logged, 1);
    assert.equal(outcome.telemetry.credits_charged, 1);
    assert.equal(outcome.telemetry.selected, 1);
  });

  it('L2: si el juez no responde, no se escribe NINGUNA', async () => {
    const { deps, rec } = stepDeps({ judge: async () => null });
    const outcome = await runCompetitorApolloStep(STEP_INPUT, deps);
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.reason, 'judge_unavailable');
    assert.equal(rec.written.length, 0);
    assert.equal(rec.logged, 1, 'la página pagada igual se registra');
  });

  it('L3: kill switch, sin palabras clave, país sin ubicación o sin cuota ⇒ 0 llamadas', async () => {
    const cases: Array<[Partial<CompetitorApolloStepDeps>, typeof STEP_INPUT, string]> = [
      [{ isEnabled: () => false }, STEP_INPUT, 'apollo_disabled'],
      [{}, { ...STEP_INPUT, reference: { ...REFERENCE, keywords: [] } }, 'no_reference_keywords'],
      [{}, { ...STEP_INPUT, reference: { ...REFERENCE, keywords: undefined } }, 'no_reference_keywords'],
      [{}, { ...STEP_INPUT, countryCode: 'XX' }, 'country_not_supported'],
      [{ checkQuota: async () => ({ allowed: false }) }, STEP_INPUT, 'apollo_quota_unavailable'],
      [{ checkQuota: async () => Promise.reject(new Error('down')) }, STEP_INPUT, 'apollo_quota_unavailable'],
      [{ loadExcludedDomains: async () => Promise.reject(new Error('db')) }, STEP_INPUT, 'exclusion_read_failed'],
    ];
    for (const [overrides, input, reason] of cases) {
      const { deps, rec } = stepDeps(overrides);
      const outcome = await runCompetitorApolloStep(input, deps);
      assert.equal(outcome.status, 'skipped', reason);
      assert.equal(outcome.reason, reason);
      assert.equal(rec.bodies.length, 0, reason);
      assert.equal(rec.judged.length, 0, reason);
    }
  });

  it('L4: Apollo falla ⇒ se registra y no se juzga ni escribe', async () => {
    const { deps, rec } = stepDeps({ searchPage: async () => ({ ok: false, organizations: [], rawCount: 0, error: 'http_500' }) });
    const outcome = await runCompetitorApolloStep(STEP_INPUT, deps);
    assert.equal(outcome.reason, 'apollo_search_failed');
    assert.equal(outcome.telemetry.credits_charged, 0);
    assert.equal(rec.logged, 1);
    assert.equal(rec.judged.length, 0);
  });

  it('L5: el juez no elige ninguna ⇒ no se escribe', async () => {
    const { deps, rec } = stepDeps({
      judge: async (input) => ({ competitors: [], judged: input.items.length, usage: null, errorCode: null }),
    });
    const outcome = await runCompetitorApolloStep(STEP_INPUT, deps);
    assert.equal(outcome.status, 'nothing_selected');
    assert.equal(rec.written.length, 0);
  });

  it('L6: un error inesperado al escribir no lanza', async () => {
    const { deps } = stepDeps({ writeCandidates: async () => Promise.reject(new Error('boom')) });
    const outcome = await runCompetitorApolloStep(STEP_INPUT, deps);
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.persistedCount, 0);
  });

  it('L7: la página de Apollo se lee de `organizations[]`, aunque `accounts[]` venga vacío', () => {
    const page = readCompetitorApolloPage({
      accounts: [],
      organizations: [{ id: 'o1', name: 'Colanta', primary_domain: 'colanta.com.co', website_url: 'http://colanta.com.co' }, { id: 'o2', name: '' }],
    });
    assert.equal(page.rawCount, 2);
    assert.deepEqual(page.organizations.map((o) => [o.id, o.name, o.primary_domain]), [['o1', 'Colanta', 'colanta.com.co']]);
    assert.deepEqual(readCompetitorApolloPage(null), { organizations: [], rawCount: 0 });
  });
});

// ── M — En la corrida ─────────────────────────────────────────────────────────

const RUN_INPUT: CompetitorRunInput = {
  userId: 'user-1',
  clientRequestId: 'req-1',
  countryCode: 'CO',
  countryName: 'Colombia',
  additionalCriteria: null,
  reference: REFERENCE,
  catalogResolution: {
    country: { code: 'CO', name: 'Colombia' },
    catalog: { version: MACRO_INDUSTRY_CATALOG_VERSION },
    industry: { id: 'aaaaaaaa-0000-4000-8000-000000000001', slug: 'consumo-masivo', name: 'Consumo masivo' },
    subindustries: [],
  } as unknown as CompetitorRunInput['catalogResolution'],
  target: 5,
};

function runDeps(opts: {
  claudePersisted: number;
  apollo?: CompetitorApolloOutcome | 'throw';
  reviewable?: number[];
  nowMs?: () => number;
}): { deps: CompetitorRunDeps; apolloCalls: CompetitorApolloRequest[]; stages: string[]; seals: Array<Record<string, unknown> | null | undefined> } {
  const apolloCalls: CompetitorApolloRequest[] = [];
  const stages: string[] = [];
  const seals: Array<Record<string, unknown> | null | undefined> = [];
  const reviewable = [...(opts.reviewable ?? [])];
  const deps: CompetitorRunDeps = {
    reserveSlot: async () => ({ status: 'reserved', batchId: 'batch-1' }),
    checkPersistenceReadiness: async () => ({ status: 'available' }),
    resolveClaudeSearchLeg: () => true,
    runClaudeCompanySearchLeg: async () => ({
      executed: true,
      persistedCandidates: opts.claudePersisted,
      completeValidCandidates: opts.claudePersisted,
      acceptedIdentities: [],
      estimatedCostUsd: 0.2,
      proposed: 5,
      passedPreFilter: 3,
    }),
    countCompetitorBatchOutcome: async () =>
      reviewable.length > 0 ? { reviewable: reviewable.shift() as number, hubspotDuplicates: 0, sellupDuplicates: 0 } : null,
    runCompetitorApollo: async (input) => {
      apolloCalls.push(input);
      if (opts.apollo === 'throw') throw new Error('apollo down');
      return (
        opts.apollo ?? { status: 'skipped', reason: 'apollo_disabled', persistedCount: 0, completeValidCandidates: null, telemetry: {} }
      );
    },
    reportProgress: (stage) => stages.push(stage),
    sealFreeOnlyBatchStatus: async (input) => {
      seals.push(input.metadata);
    },
    markBatchFailed: async () => undefined,
    actionStartedAtMs: 0,
    nowMs: opts.nowMs ?? (() => 5_000),
  };
  return { deps, apolloCalls, stages, seals };
}

const WROTE_TWO: CompetitorApolloOutcome = {
  status: 'written',
  reason: null,
  persistedCount: 2,
  completeValidCandidates: 2,
  telemetry: { status: 'written', selected: 2 },
};

describe('M — Apollo en la corrida de competidores', () => {
  it('M1: corre DESPUÉS de las rondas de Claude si Por revisar sigue bajo la meta', async () => {
    // Claude: 1 en Por revisar tras cada ronda; Apollo suma 2 ⇒ 3.
    const { deps, apolloCalls, stages, seals } = runDeps({ claudePersisted: 1, apollo: WROTE_TWO, reviewable: [1, 1, 3] });
    const result = await executeCompetitorSearchRun(RUN_INPUT, deps);
    assert.deepEqual(stages, ['competitor_round_1', 'competitor_round_2', 'competitor_apollo', 'reviewing']);
    assert.equal(apolloCalls.length, 1);
    assert.deepEqual(apolloCalls[0], {
      batchId: 'batch-1',
      clientRequestId: 'req-1',
      reference: REFERENCE,
      countryCode: 'CO',
      countryName: 'Colombia',
      industryName: 'Consumo masivo',
      target: 5,
      userId: 'user-1',
    });
    assert.deepEqual(seals[0]?.competitor_apollo, WROTE_TWO.telemetry);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.candidateCount, 3);
    assert.equal(result.batchStatus, 'ready_for_review');
    // 2 de Claude (dos rondas × 1) + 2 de Apollo = 4 aceptadas < 5.
    assert.equal(result.acceptedForTarget?.acceptedPaidForTarget, 4);
    assert.equal(result.acceptedForTarget?.persistedTotalCandidates, 4);
    assert.equal(result.status, 'success_partial');
  });

  it('M2: si Claude ya llenó Por revisar, Apollo no corre', async () => {
    const { deps, apolloCalls, stages } = runDeps({ claudePersisted: 5, reviewable: [5] });
    await executeCompetitorSearchRun(RUN_INPUT, deps);
    assert.equal(apolloCalls.length, 0);
    assert.equal(stages.includes('competitor_apollo'), false);
  });

  it('M3: sin tiempo suficiente, Apollo no corre', async () => {
    const late = WIZARD_FUNCTION_LIMIT_MS - COMPETITOR_APOLLO_MIN_REMAINING_MS + 1;
    let calls = 0;
    // 1.ª lectura (fase de la ronda 1) con tiempo; después, tarde.
    const { deps, apolloCalls } = runDeps({ claudePersisted: 1, reviewable: [1], nowMs: () => (calls++ < 2 ? 5_000 : late) });
    await executeCompetitorSearchRun(RUN_INPUT, deps);
    assert.equal(apolloCalls.length, 0);
  });

  it('M4: si Apollo falla, la corrida sigue con lo de Claude', async () => {
    const { deps, apolloCalls, seals } = runDeps({ claudePersisted: 1, apollo: 'throw', reviewable: [1, 1] });
    const result = await executeCompetitorSearchRun(RUN_INPUT, deps);
    assert.equal(apolloCalls.length, 1);
    assert.equal(seals[0]?.competitor_apollo, undefined);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.candidateCount, 1);
  });

  it('M5: el umbral de tiempo y de meta', () => {
    assert.equal(shouldRunCompetitorApollo(4, 5, 0), true);
    assert.equal(shouldRunCompetitorApollo(5, 5, 0), false);
    assert.equal(shouldRunCompetitorApollo(0, 5, WIZARD_FUNCTION_LIMIT_MS - COMPETITOR_APOLLO_MIN_REMAINING_MS), true);
    assert.equal(shouldRunCompetitorApollo(0, 5, WIZARD_FUNCTION_LIMIT_MS - COMPETITOR_APOLLO_MIN_REMAINING_MS + 1), false);
  });

  it('M6: la etapa tiene texto en el chat', () => {
    assert.ok(RUN_PROGRESS_STAGES.includes('competitor_apollo'));
    assert.ok(RUN_PROGRESS_LABELS.competitor_apollo.includes('Apollo'));
  });
});

describe('N — guardas estáticas', () => {
  // Sin comentarios: nombrar una ruta en un comentario no es usarla.
  const read = (p: string) =>
    readFileSync(new URL(p, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  const pure = read('../competitor-apollo.ts');
  const live = read('../competitor-apollo.server.ts');

  it('N1: no usa la ruta Apollo del asistente ni toca presupuesto o créditos', () => {
    for (const src of [pure, live]) {
      assert.doesNotMatch(src, /wizard-apollo-executor|apollo-two-round|wizard_monthly_budget|reserveBudget|budget_credits/);
    }
    assert.match(live, /isApolloCompanySearchEnabled/);
    assert.match(live, /checkProviderQuotaAvailable\('apollo'\)/);
  });

  it('N2: escribe en el lote de la corrida, reabriéndolo, y marca la relación', () => {
    assert.match(live, /existingBatchId: input\.batchId/);
    assert.match(live, /reopenClosedBatch\(input\.batchId\)/);
    assert.match(live, /kind: 'competitor_of'/);
    assert.match(live, /source: 'apollo'/);
  });
});

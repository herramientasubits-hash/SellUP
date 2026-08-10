/**
 * wizard-multi-subindustry-request.test.ts
 *
 * AGENT1-MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § A.2 / § A.3 / § A.11.
 *
 * Recorre la ruta REAL desde el input del wizard hasta el objeto que recibe el
 * production-runner, sin llamar a ningún proveedor:
 *
 *   reductor del wizard
 *     → payload que envía la pantalla de confirmación
 *     → `wizardExecutionRequestSchema` (parseo estricto)
 *     → `resolveWizardCatalog` (catálogo simulado, sólo lectura)
 *     → `runWizardApolloSearch` (runner de dos rondas simulado)
 *
 * El defecto que cierra: el lote `7d92773b` se creó con UNA subindustria cuando
 * la usuaria había elegido dos. La solicitud llegó ya con una sola, así que la
 * pérdida estaba antes del servidor — en la selección sin comprometer del paso.
 *
 * NO llama a Apollo ni a Tavily. LIVE_APOLLO_CALLS = 0, LIVE_TAVILY_CALLS = 0,
 * APOLLO_CREDITS_USED = 0.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createInitialProspectWizardState,
  prospectWizardReducer,
} from '@/modules/prospect-batches/chat-wizard/wizard-reducer';
import type { ProspectWizardState } from '@/modules/prospect-batches/chat-wizard/wizard-types';
import { wizardExecutionRequestSchema } from '../wizard-execution-schema';
import { resolveWizardCatalog } from '../wizard-catalog-resolver';
import { runWizardApolloSearch } from '../wizard-apollo-executor';
import type { ResolvedWizardExecution } from '../wizard-execution-types';
import { WIZARD_SYSTEM_CONTROLS } from '../wizard-pipeline-adapter';
import { APOLLO_TWO_ROUND_DISCOVERY_FLAG } from '@/lib/feature-flags.server';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ─── Catálogo simulado — Retail y Consumo (Colombia), ids reales del catálogo ──

const CATALOG_VERSION = '1.0.0';
const INDUSTRY_ID = 'e9338391-f2d1-5c84-90da-49a5508e4d3f';

const SUBINDUSTRIES = [
  { id: '912a4b36-8597-5204-bb8e-814fb0769505', name: 'Tiendas por Departamento, Moda y Calzado' },
  { id: 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', name: 'Supermercados e Hipermercados' },
  { id: 'd49ba019-c2e4-59b5-bc58-12724ec1f152', name: 'Farmacias Cadena y Retail de Salud' },
  { id: '8f893965-daf2-508f-95c7-bbc332595f3e', name: 'Operadores Omnicanal y Ecommerce Retail' },
  { id: '9d036663-b424-5989-9bfc-02c85b0c25c8', name: 'Retailers Especializados' },
  { id: '228440c9-a8d7-51b9-96cd-47bac896b0cf', name: 'Cuidado Personal, Higiene y Hogar (FMCG)' },
] as const;

const UNKNOWN_SUBINDUSTRY_ID = '00000000-0000-4000-8000-000000000000';

function catalogClient(): SupabaseClient {
  const rows = SUBINDUSTRIES.map((sub) => ({
    catalog_version: CATALOG_VERSION,
    industry_id: INDUSTRY_ID,
    industry_name: 'Retail y Consumo',
    industry_slug: 'retail-y-consumo',
    subindustry_id: sub.id,
    subindustry_name: sub.name,
    subindustry_slug: sub.id,
    applicable_countries: null,
  }));

  return {
    from: () => ({ select: async () => ({ data: rows, error: null }) }),
  } as unknown as SupabaseClient;
}

// ─── Etapa 1 · el reductor del wizard ─────────────────────────────────────────

/** Lleva el wizard hasta el paso de subindustrias, como hace la UI. */
function wizardAtSubindustriesStep(): ProspectWizardState {
  let state = createInitialProspectWizardState({
    catalogVersion: CATALOG_VERSION,
    defaultRequestedCount: 25,
  });
  state = prospectWizardReducer(state, { type: 'START' });
  state = prospectWizardReducer(state, { type: 'SELECT_SEARCH_MODE', mode: 'exploratory' });
  state = prospectWizardReducer(state, { type: 'SELECT_COUNTRY', countryCode: 'CO' });
  state = prospectWizardReducer(state, { type: 'SELECT_INDUSTRY', industryId: INDUSTRY_ID });
  assert.equal(state.currentStep, 'subindustries');
  return state;
}

/** Simula clics sucesivos en el multiselector: cada uno se compromete al estado. */
function selectSubindustries(
  state: ProspectWizardState,
  ids: readonly string[],
): ProspectWizardState {
  let next = state;
  for (const id of ids) {
    const already = next.subindustryIds.includes(id);
    next = prospectWizardReducer(next, {
      type: 'SET_SUBINDUSTRY_SELECTION',
      subindustryIds: already
        ? next.subindustryIds.filter((current) => current !== id)
        : [...next.subindustryIds, id],
    });
  }
  return next;
}

/** «Continuar» y el resto del wizard hasta quedar listo para ejecutar. */
function confirmSelection(state: ProspectWizardState): ProspectWizardState {
  let next = prospectWizardReducer(state, {
    type: 'SET_SUBINDUSTRIES',
    subindustryIds: state.subindustryIds,
  });
  next = prospectWizardReducer(next, { type: 'SKIP_ADDITIONAL_CRITERIA' });
  return next;
}

// ─── Etapas 2-4 · solicitud, catálogo y runner ────────────────────────────────

/**
 * Reproduce EXACTAMENTE lo que la pantalla de confirmación envía: el schema
 * es `.strict()`, así que cualquier campo de más invalidaría la solicitud entera.
 */
function requestFromWizardState(state: ProspectWizardState): Record<string, unknown> {
  return {
    countryCode: state.countryCode,
    industryId: state.industryId,
    subindustryIds: state.subindustryIds,
    additionalCriteriaRaw: state.additionalCriteriaRaw,
    catalogVersion: state.catalogVersion,
    clientRequestId: '9a4d1a3e-0f1a-4c26-9d9c-8a2f2f1f9c11',
  };
}

type RunnerCapture = { subindustries: string[]; industry: string; country: string };

/**
 * Atraviesa el resto de la cadena y devuelve lo que el production-runner recibió.
 * El runner de dos rondas es un doble: no abre socket ni consume créditos.
 */
async function runThroughChain(
  request: Record<string, unknown>,
): Promise<{ requestCount: number; catalogCount: number; runner: RunnerCapture }> {
  const parsed = wizardExecutionRequestSchema.parse(request);

  const catalogResolution = await resolveWizardCatalog(
    {
      countryCode: parsed.countryCode,
      industryId: parsed.industryId,
      subindustryIds: parsed.subindustryIds,
      catalogVersion: parsed.catalogVersion,
    },
    catalogClient(),
  );

  const resolved: ResolvedWizardExecution = {
    userId: 'user-1',
    clientRequestId: parsed.clientRequestId,
    mode: 'exploratory',
    country: catalogResolution.country,
    catalog: catalogResolution.catalog,
    industry: catalogResolution.industry,
    subindustries: catalogResolution.subindustries,
    additionalCriteria: parsed.additionalCriteriaRaw,
    systemControls: { ...WIZARD_SYSTEM_CONTROLS },
  };

  let runner: RunnerCapture | null = null;
  await runWizardApolloSearch(
    {
      resolved,
      reservedBatchId: 'batch-1',
      correlation: {
        wizardRunId: 'run-1',
        clientRequestId: parsed.clientRequestId,
        batchId: 'batch-1',
        reservationId: 'reservation-1',
        requestFingerprint: 'fingerprint-1',
        idempotencyKey: 'idempotency-1',
      },
      reservedCredits: 25,
    },
    undefined,
    async (input) => {
      runner = {
        subindustries: [...input.subindustries],
        industry: input.industry,
        country: input.country,
      };
      return { candidates: [] } as unknown as IncrementalSearchOutput;
    },
  );

  assert.ok(runner, 'el runner de dos rondas debió recibir la corrida');
  return {
    requestCount: parsed.subindustryIds.length,
    catalogCount: catalogResolution.subindustries.length,
    runner: runner!,
  };
}

function nameOf(id: string): string {
  return SUBINDUSTRIES.find((sub) => sub.id === id)!.name;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('§ A.3 — la multiselección llega íntegra al production-runner', () => {
  const previousFlag = process.env[APOLLO_TWO_ROUND_DISCOVERY_FLAG];

  beforeEach(() => {
    process.env[APOLLO_TWO_ROUND_DISCOVERY_FLAG] = 'true';
  });
  afterEach(() => {
    if (previousFlag === undefined) delete process.env[APOLLO_TWO_ROUND_DISCOVERY_FLAG];
    else process.env[APOLLO_TWO_ROUND_DISCOVERY_FLAG] = previousFlag;
  });

  test('caso A — 1 subindustria ⇒ 1 id en todas las etapas', async () => {
    const ids = [SUBINDUSTRIES[1].id];
    const state = confirmSelection(selectSubindustries(wizardAtSubindustriesStep(), ids));

    assert.deepEqual(state.subindustryIds, ids);
    const chain = await runThroughChain(requestFromWizardState(state));

    assert.equal(chain.requestCount, 1);
    assert.equal(chain.catalogCount, 1);
    assert.deepEqual(chain.runner.subindustries, ids.map(nameOf));
  });

  test('caso B — 2 subindustrias ⇒ 2 ids, mismo orden (el caso de `7d92773b`)', async () => {
    const ids = [SUBINDUSTRIES[0].id, SUBINDUSTRIES[1].id];
    const state = confirmSelection(selectSubindustries(wizardAtSubindustriesStep(), ids));

    assert.deepEqual(state.subindustryIds, ids);
    const chain = await runThroughChain(requestFromWizardState(state));

    assert.equal(chain.requestCount, 2);
    assert.equal(chain.catalogCount, 2);
    assert.deepEqual(chain.runner.subindustries, [
      'Tiendas por Departamento, Moda y Calzado',
      'Supermercados e Hipermercados',
    ]);
  });

  test('caso C — 5 subindustrias (el tope) ⇒ 5 ids, mismo orden', async () => {
    const ids = SUBINDUSTRIES.slice(0, 5).map((sub) => sub.id);
    const state = confirmSelection(selectSubindustries(wizardAtSubindustriesStep(), ids));

    assert.deepEqual(state.subindustryIds, ids);
    const chain = await runThroughChain(requestFromWizardState(state));

    assert.equal(chain.requestCount, 5);
    assert.deepEqual(chain.runner.subindustries, ids.map(nameOf));
  });

  test('caso D — [A,B] y [B,A] conservan cada uno SU orden', async () => {
    const forward = [SUBINDUSTRIES[0].id, SUBINDUSTRIES[1].id];
    const backward = [SUBINDUSTRIES[1].id, SUBINDUSTRIES[0].id];

    const a = await runThroughChain(
      requestFromWizardState(
        confirmSelection(selectSubindustries(wizardAtSubindustriesStep(), forward)),
      ),
    );
    const b = await runThroughChain(
      requestFromWizardState(
        confirmSelection(selectSubindustries(wizardAtSubindustriesStep(), backward)),
      ),
    );

    assert.deepEqual(a.runner.subindustries, forward.map(nameOf));
    assert.deepEqual(b.runner.subindustries, backward.map(nameOf));
    assert.notDeepEqual(a.runner.subindustries, b.runner.subindustries);
  });

  test('caso E — ids duplicados: política explícita (se colapsan en la PRIMERA aparición)', async () => {
    // En el reductor. La UI nunca puede producir un duplicado (el multiselector
    // alterna), pero la política tiene que estar escrita y probada.
    const state = prospectWizardReducer(wizardAtSubindustriesStep(), {
      type: 'SET_SUBINDUSTRY_SELECTION',
      subindustryIds: [SUBINDUSTRIES[0].id, SUBINDUSTRIES[1].id, SUBINDUSTRIES[0].id],
    });
    assert.deepEqual(state.subindustryIds, [SUBINDUSTRIES[0].id, SUBINDUSTRIES[1].id]);

    // Y en la solicitud: un duplicado que llegue por otra vía la INVALIDA entera,
    // no se deduplica en silencio.
    const invalid = wizardExecutionRequestSchema.safeParse({
      ...requestFromWizardState(state),
      subindustryIds: [SUBINDUSTRIES[0].id, SUBINDUSTRIES[0].id],
    });
    assert.equal(invalid.success, false);
  });

  test('caso F — un id inválido falla cerrado; nunca se elimina en silencio', async () => {
    const state = confirmSelection(
      selectSubindustries(wizardAtSubindustriesStep(), [SUBINDUSTRIES[1].id]),
    );
    const request = {
      ...requestFromWizardState(state),
      subindustryIds: [SUBINDUSTRIES[1].id, UNKNOWN_SUBINDUSTRY_ID],
    };

    await assert.rejects(
      () => runThroughChain(request),
      (error: unknown) =>
        error instanceof Error && /SUBINDUSTRY_NOT_FOUND|catálogo/i.test(String(error.message)),
    );

    // Un id que ni siquiera es UUID invalida la solicitud completa.
    const malformed = wizardExecutionRequestSchema.safeParse({
      ...requestFromWizardState(state),
      subindustryIds: ['no-es-un-uuid'],
    });
    assert.equal(malformed.success, false);

    // Y por encima del tope tampoco se trunca: se rechaza.
    const tooMany = wizardExecutionRequestSchema.safeParse({
      ...requestFromWizardState(state),
      subindustryIds: [...SUBINDUSTRIES.map((sub) => sub.id)],
    });
    assert.equal(tooMany.success, false);
  });

  test('caso G — una selección previa y luego una segunda: AMBAS permanecen', async () => {
    // Éste es el defecto real. La primera selección se confirmaba, y al volver al
    // paso la segunda sustituía a la primera en vez de sumarse.
    let state = selectSubindustries(wizardAtSubindustriesStep(), [SUBINDUSTRIES[1].id]);
    state = confirmSelection(state);
    assert.deepEqual(state.subindustryIds, [SUBINDUSTRIES[1].id]);

    // «Editar» sobre la fila de subindustrias.
    state = prospectWizardReducer(state, { type: 'EDIT_STEP', step: 'subindustries' });
    state = selectSubindustries(state, [SUBINDUSTRIES[0].id]);

    assert.deepEqual(state.subindustryIds, [SUBINDUSTRIES[1].id, SUBINDUSTRIES[0].id]);

    state = confirmSelection(state);
    const chain = await runThroughChain(requestFromWizardState(state));
    assert.equal(chain.requestCount, 2);
    assert.deepEqual(chain.runner.subindustries, [
      'Supermercados e Hipermercados',
      'Tiendas por Departamento, Moda y Calzado',
    ]);
  });

  test('caso H — editar la búsqueda y volver a confirmación conserva la multiselección', async () => {
    let state = confirmSelection(
      selectSubindustries(wizardAtSubindustriesStep(), [
        SUBINDUSTRIES[0].id,
        SUBINDUSTRIES[1].id,
      ]),
    );
    assert.equal(state.currentStep, 'summary');

    // «Editar búsqueda» lleva al último paso de datos y vuelve al resumen.
    state = prospectWizardReducer(state, { type: 'EDIT_STEP', step: 'additional_criteria' });
    state = prospectWizardReducer(state, { type: 'SKIP_ADDITIONAL_CRITERIA' });
    assert.equal(state.currentStep, 'summary');

    // Y una vuelta completa por validación + ejecución no la toca tampoco.
    state = prospectWizardReducer(state, { type: 'BEGIN_VALIDATION' });
    state = prospectWizardReducer(state, { type: 'VALIDATION_SUCCEEDED' });
    assert.equal(state.currentStep, 'validated');

    assert.deepEqual(state.subindustryIds, [SUBINDUSTRIES[0].id, SUBINDUSTRIES[1].id]);
    const chain = await runThroughChain(requestFromWizardState(state));
    assert.equal(chain.requestCount, 2);
    assert.equal(chain.runner.subindustries.length, 2);
  });
});

describe('§ A.2 — el tope de subindustrias falla cerrado, no trunca', () => {
  test('seleccionar una sexta no descarta ninguna: bloquea y conserva las cinco', () => {
    const five = SUBINDUSTRIES.slice(0, 5).map((sub) => sub.id);
    const state = selectSubindustries(wizardAtSubindustriesStep(), five);
    assert.equal(state.subindustryIds.length, 5);

    const blocked = prospectWizardReducer(state, {
      type: 'SET_SUBINDUSTRY_SELECTION',
      subindustryIds: [...five, SUBINDUSTRIES[5].id],
    });

    assert.deepEqual(blocked.subindustryIds, five);
    assert.equal(
      blocked.blockingIssues.some((issue) => issue.code === 'TOO_MANY_SUBINDUSTRIES'),
      true,
    );
  });

  test('la selección sólo se acepta en su propio paso', () => {
    const state = confirmSelection(
      selectSubindustries(wizardAtSubindustriesStep(), [SUBINDUSTRIES[1].id]),
    );
    const ignored = prospectWizardReducer(state, {
      type: 'SET_SUBINDUSTRY_SELECTION',
      subindustryIds: [],
    });
    assert.deepEqual(ignored.subindustryIds, [SUBINDUSTRIES[1].id]);
  });
});

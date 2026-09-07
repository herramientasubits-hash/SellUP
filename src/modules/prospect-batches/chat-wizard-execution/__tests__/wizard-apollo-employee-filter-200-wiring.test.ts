/**
 * A1-APOLLO-EMPLOYEE-FILTER-200-1 — el CABLEADO del filtro de 200+ empleados.
 *
 * Por qué esta suite existe aparte de la del mapper:
 *
 *   `apollo-organizations-query-mapping-l2-11.test.ts` ya probaba que
 *   `mapEmployeeThresholdToApolloRanges(200)` devuelve los siete rangos y que el
 *   mapper los pone en `organization_num_employees_ranges`. Esas pruebas pasaban
 *   en verde mientras las 87 búsquedas de organizaciones de Producción
 *   —2026-07-01 a 2026-09-07— salían TODAS con `apollo_employee_ranges_sent: []`.
 *
 *   El motivo es que alimentaban `targetEmployeeThreshold` a mano. Probaban el
 *   traductor y no que alguien lo llamara. Un traductor correcto que nadie invoca
 *   es indistinguible de un traductor ausente desde el punto de vista del dinero
 *   que se gasta.
 *
 *   Esta suite prueba la CADENA: desde `resolved.systemControls.minimumEmployees`
 *   hasta el body y su huella. Es la prueba que habría fallado en rojo antes del
 *   hito, y la que vuelve imposible perder el filtro otra vez en silencio.
 *
 * Offline por construcción: runner falso, sin HTTP, sin Apollo, sin Supabase,
 * sin créditos. El único efecto es leer y restaurar una variable de entorno.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runWizardApolloSearch } from '../wizard-apollo-executor';
import type { WizardApolloInput } from '../wizard-apollo-executor';
import type { ResolvedWizardExecution } from '../wizard-execution-types';
import { WIZARD_SYSTEM_CONTROLS } from '../wizard-pipeline-adapter';
import type {
  IncrementalSearchInput,
  IncrementalSearchOutput,
} from '@/server/agents/prospecting-toolkit/incremental-search-types';
import type { ApolloSubindustryCatalogTermsLoadResult } from '@/server/agents/prospecting-toolkit/apollo-subindustry-catalog-terms-loader.server';
import type { ApolloTwoRoundWizardRunInput } from '@/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server';

// ── Alcance de esta suite ────────────────────────────────────────────────────
//
// Aquí se prueba SÓLO que el número cruce la frontera del wizard. La traducción
// del umbral a los rangos de Apollo y el body resultante se prueban donde se
// construyen, en `apollo-employee-filter-200-request-contract.test.ts`: repetir
// los siete rangos en dos suites crearía dos expectativas capaces de divergir.

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-emp-filter-0001';
const BATCH_ID = 'batch-emp-filter-0001';

/**
 * `minimumEmployees` NO se escribe a mano con un 200 literal: se lee de
 * `WIZARD_SYSTEM_CONTROLS`, la misma constante que la acción del wizard usa para
 * construir el `resolved` real. Si alguien cambia el umbral del producto, esta
 * suite lo sigue en vez de defender un 200 que ya no es el del sistema.
 */
const BASE_RESOLVED: ResolvedWizardExecution = {
  userId: USER_ID,
  clientRequestId: 'req-emp-filter-0002',
  mode: 'exploratory',
  country: { code: 'CO', name: 'Colombia' },
  catalog: { version: '2.0.0' },
  industry: { id: 'ind-uuid-0003', slug: 'gobierno', name: 'Gobierno' },
  subindustries: [],
  additionalCriteria: null,
  systemControls: {
    targetCount: WIZARD_SYSTEM_CONTROLS.targetCount,
    minimumEmployees: WIZARD_SYSTEM_CONTROLS.minimumEmployees,
    employeeThresholdMode: WIZARD_SYSTEM_CONTROLS.employeeThresholdMode,
  },
};

/**
 * Resolución de catálogo vacía pero EXITOSA: sin subindustrias pedidas el gate de
 * coherencia de versión no tiene nada que comparar, así que no bloquea. Mantiene
 * la suite offline sin desactivar ninguna valla.
 */
const EMPTY_CATALOG_TERMS: ApolloSubindustryCatalogTermsLoadResult = {
  resolution: {
    catalogVersion: '2.0.0',
    catalogVersionId: 'catalog-version-emp-filter-0004',
    termType: 'keyword',
    entries: [],
    sourceHash: 'sha256-empty-emp-filter',
  },
  failureReason: null,
};

function makeInput(overrides?: Partial<WizardApolloInput>): WizardApolloInput {
  return {
    resolved: BASE_RESOLVED,
    reservedBatchId: BATCH_ID,
    loadCatalogSearchTerms: async () => EMPTY_CATALOG_TERMS,
    ...overrides,
  };
}

const EMPTY_OUTPUT_METADATA = {
  rounds_executed: 1,
  stopped_reason: 'min_useful_reached',
  total_raw_evaluated: 0,
  total_candidates_accumulated: 0,
  useful_candidates_count: 0,
  min_useful_candidates: 7,
  target_internal: 25,
  max_rounds: 4,
  max_total_raw_to_evaluate: 50,
  dry_run: false,
  rounds: [],
};

/** Runner legacy falso. Captura el input y no ejecuta nada. */
function makeLegacyRunner() {
  let captured: IncrementalSearchInput | null = null;
  const runner = async (input: IncrementalSearchInput): Promise<IncrementalSearchOutput> => {
    captured = input;
    return {
      input,
      candidates: [],
      candidatesCount: 0,
      usefulCandidatesCount: 0,
      candidatesCreated: 0,
      metadata: EMPTY_OUTPUT_METADATA,
      warnings: [],
      batchId: BATCH_ID,
    } as unknown as IncrementalSearchOutput;
  };
  return { runner, getCapture: () => captured };
}

/** Runner de dos rondas falso. Captura el input y no ejecuta nada. */
function makeTwoRoundRunner() {
  let captured: ApolloTwoRoundWizardRunInput | null = null;
  const runner = async (input: ApolloTwoRoundWizardRunInput) => {
    captured = input;
    return {
      input: input as unknown,
      candidates: [],
      candidatesCount: 0,
      usefulCandidatesCount: 0,
      candidatesCreated: 0,
      metadata: EMPTY_OUTPUT_METADATA,
      warnings: [],
      batchId: BATCH_ID,
    } as never;
  };
  return {
    runner: runner as never,
    getCapture: () => captured,
  };
}

const TWO_ROUND_CORRELATION = {
  wizardRunId: 'wizard-run-emp-filter-0005',
  clientRequestId: 'req-emp-filter-0002',
  reservationId: 'reservation-emp-filter-0006',
  batchId: BATCH_ID,
} as never;

/** Corre `fn` con la modalidad de dos rondas encendida o apagada, y restaura. */
async function withTwoRoundMode(enabled: boolean, fn: () => Promise<void>): Promise<void> {
  const saved = process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
  if (enabled) process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = 'true';
  else delete process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
    else process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = saved;
  }
}

// ── Test 1 — wizard → Apollo executor ────────────────────────────────────────

describe('Test 1 — el umbral del wizard llega al ejecutor de Apollo', () => {
  it('two-round: targetEmployeeThreshold === 200 desde systemControls', async () => {
    const { runner, getCapture } = makeTwoRoundRunner();

    await withTwoRoundMode(true, async () => {
      await runWizardApolloSearch(
        makeInput({ correlation: TWO_ROUND_CORRELATION }),
        undefined,
        runner,
      );
    });

    const captured = getCapture();
    assert.ok(captured, 'el runner de dos rondas debió ejecutarse');
    assert.equal(captured!.targetEmployeeThreshold, 200);
    // La fuente es la constante viva del producto, no un 200 duplicado aquí.
    assert.equal(
      captured!.targetEmployeeThreshold,
      BASE_RESOLVED.systemControls.minimumEmployees,
    );
  });

  it('legacy: targetEmployeeThreshold === 200 desde systemControls', async () => {
    const { runner, getCapture } = makeLegacyRunner();

    await withTwoRoundMode(false, async () => {
      await runWizardApolloSearch(makeInput(), runner);
    });

    const captured = getCapture();
    assert.ok(captured, 'el runner legacy debió ejecutarse');
    assert.equal(captured!.targetEmployeeThreshold, 200);
    assert.equal(
      captured!.targetEmployeeThreshold,
      BASE_RESOLVED.systemControls.minimumEmployees,
    );
  });

  it('el umbral NO se hardcodea: un systemControls distinto viaja distinto', async () => {
    // Protege contra el arreglo falso «poner 200 literal en el ejecutor». Si
    // alguien lo hiciera, este caso saldría en rojo.
    const { runner, getCapture } = makeLegacyRunner();
    const resolved: ResolvedWizardExecution = {
      ...BASE_RESOLVED,
      systemControls: { ...BASE_RESOLVED.systemControls, minimumEmployees: 500 },
    };

    await withTwoRoundMode(false, async () => {
      await runWizardApolloSearch(makeInput({ resolved }), runner);
    });

    assert.equal(getCapture()!.targetEmployeeThreshold, 500);
  });
});

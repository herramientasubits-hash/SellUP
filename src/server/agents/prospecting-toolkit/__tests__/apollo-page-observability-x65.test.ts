/**
 * APOLLO-PAGE-OBSERVABILITY-X6.5 — instrumentación durable POR PÁGINA.
 *
 * Qué defiende esta suite, dicho como defecto:
 *
 *   * que una página que cobró y no produjo nada vuelva a ser indistinguible:
 *     sólo-`accounts[]`, organizaciones sin id, todo duplicado y página vacía
 *     de verdad tienen que dar CUATRO filas distintas, no una;
 *   * que los contadores se pierdan por página — `normalizationMeta` se
 *     reasigna en cada vuelta del bucle y el resultado sólo publicaba la de la
 *     ÚLTIMA página, que es justo la que no se está investigando;
 *   * que `dropped_without_id_count` siga colapsando dos orígenes: una cuenta
 *     sin `organization_id` y una organización sin `id` son causas distintas;
 *   * que el cobro cambie de cara al diagnóstico. `pageCredits` sigue siendo
 *     `rawPageHadResults ? 1 : 0` sobre la respuesta CRUDA, byte por byte. Hay
 *     trinquete explícito: una página descartada entera por normalización NO
 *     se vuelve gratis;
 *   * que un error se lea como "cero organizaciones": sin respuesta que
 *     normalizar no hay contadores ni causa de vacío, y eso se escribe `null`,
 *     no 0;
 *   * que la ronda se invente en la ruta legacy, que no tiene rondas.
 *
 * Offline y determinista: `fetchPage`, `now`, `random` y `sleep` se inyectan.
 * Un espía sobre `fetch` falla la suite si algo intentara salir a la red.
 * 0 llamadas a Apollo, 0 llamadas a Lusha, 0 créditos.
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsPaginatedSearch,
  type ApolloPageFetchResult,
  type ApolloPageLogEntry,
  type ApolloPaginatedSearchDeps,
} from '../apollo-organizations-paginated-search';
import { createApolloPaginationBudget } from '../apollo-organizations-pagination-budget';
import { normalizeApolloOrganizationsResponse } from '../apollo-organizations-response-normalizer';
import {
  buildApolloPageNormalizationDiagnostics,
  classifyApolloEmptyPage,
  type ApolloPageNormalizationDiagnostics,
} from '../apollo-page-observability';

// ─── Guardia de red ───────────────────────────────────────────────────────────

let realFetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (...args: unknown[]) => {
  realFetchCalls++;
  throw new Error(`LLAMADA REAL PROHIBIDA EN TESTS: ${String(args[0])}`);
}) as typeof originalFetch;

beforeEach(() => { realFetchCalls = 0; });
after(() => { globalThis.fetch = originalFetch; });

// ─── Helpers ──────────────────────────────────────────────────────────────────

type RawPayload = {
  organizations?: Array<Record<string, unknown>>;
  accounts?: Array<Record<string, unknown>>;
  pagination?: Record<string, number>;
};

function okPage(payload: RawPayload): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload,
    headers: null,
  };
}

function errorPage(status: number): ApolloPageFetchResult {
  return {
    ok: false,
    status,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: undefined,
    headers: null,
    errorBody: `error ${status}`,
  };
}

/** Organizaciones válidas: con `id`, que es la identidad de descubrimiento. */
const orgs = (count: number, offset = 0): Array<Record<string, unknown>> =>
  Array.from({ length: count }, (_, i) => ({
    id: `org_${offset + i}`,
    name: `Empresa ${offset + i}`,
    primary_domain: `empresa-${offset + i}.com`,
  }));

/** Entradas de `organizations[]` SIN identidad — el caso C de la auditoría. */
const orgsWithoutId = (count: number): Array<Record<string, unknown>> =>
  Array.from({ length: count }, (_, i) => ({
    name: `Sin id ${i}`,
    primary_domain: `sin-id-${i}.com`,
  }));

/** Cuentas del workspace que SÍ apuntan a una organización canónica. */
const accounts = (count: number, offset = 0): Array<Record<string, unknown>> =>
  Array.from({ length: count }, (_, i) => ({
    id: `acc_${offset + i}`,
    organization_id: `org_${offset + i}`,
    name: `Cuenta ${offset + i}`,
  }));

type Harness = {
  deps: ApolloPaginatedSearchDeps;
  logs: ApolloPageLogEntry[];
};

function harness(
  responder: (call: number) => ApolloPageFetchResult,
): Harness {
  const logs: ApolloPageLogEntry[] = [];
  let clock = 0;
  let call = 0;
  return {
    logs,
    deps: {
      fetchPage: async () => { clock += 10; return responder(call++); },
      now: () => clock,
      random: () => 0.5,
      logPage: (entry) => { logs.push(entry); },
      sleep: async () => {},
    },
  };
}

const baseInput = {
  filters: { locations: ['Colombia'], keywordTags: ['retail'] },
  wizardRunId: 'run_x65',
  agentRunId: 'agent_run_x65',
};

const onePageBudget = () =>
  createApolloPaginationBudget({ maxPages: 1, perPage: 100, maxCandidates: 999 });

async function runOnePage(payload: RawPayload) {
  const h = harness(() => okPage(payload));
  const result = await runApolloOrganizationsPaginatedSearch(
    { ...baseInput, budget: onePageBudget() },
    h.deps,
  );
  assert.equal(h.logs.length, 1, 'una página pedida ⇒ un registro de página');
  assert.equal(result.pageOutcomes.length, 1);
  return { result, log: h.logs[0]!, outcome: result.pageOutcomes[0]! };
}

/** El diagnóstico tiene que llegar IGUAL por las dos superficies durables. */
function diagnosticsOf(
  log: ApolloPageLogEntry,
  outcome: { normalization: ApolloPageNormalizationDiagnostics | null },
): ApolloPageNormalizationDiagnostics {
  assert.deepEqual(
    outcome.normalization,
    log.normalization,
    'page_outcomes y apollo_page_logs no pueden contar cosas distintas de la MISMA página',
  );
  assert.ok(log.normalization, 'una página normalizada tiene contadores, no null');
  return log.normalization;
}

// ─── § 2 · desglose del descarte por falta de identidad ───────────────────────

describe('X6.5 § 2 · dropped_without_id se desglosa por ORIGEN', () => {
  it('organizaciones sin `id` cuentan sólo del lado de organizations', () => {
    const meta = normalizeApolloOrganizationsResponse({
      organizations: orgsWithoutId(3),
    }).meta;
    assert.equal(meta.dropped_without_id_from_organizations_count, 3);
    assert.equal(meta.dropped_without_id_from_accounts_count, 0);
    assert.equal(meta.dropped_without_id_count, 3, 'el total NO cambia de valor');
  });

  it('cuentas sin `organization_id` cuentan sólo del lado de accounts', () => {
    const meta = normalizeApolloOrganizationsResponse({
      accounts: [{ id: 'acc_1' }, { id: 'acc_2' }],
    }).meta;
    assert.equal(meta.dropped_without_id_from_accounts_count, 2);
    assert.equal(meta.dropped_without_id_from_organizations_count, 0);
    assert.equal(meta.dropped_without_id_count, 2);
  });

  it('el total sigue siendo la suma exacta de los dos orígenes', () => {
    const meta = normalizeApolloOrganizationsResponse({
      organizations: orgsWithoutId(2),
      accounts: [{ id: 'acc_1' }, { id: 'acc_2' }, { id: 'acc_3' }],
    }).meta;
    assert.equal(meta.dropped_without_id_from_organizations_count, 2);
    assert.equal(meta.dropped_without_id_from_accounts_count, 3);
    assert.equal(
      meta.dropped_without_id_count,
      meta.dropped_without_id_from_organizations_count +
        meta.dropped_without_id_from_accounts_count,
      'antes eran indistinguibles; ahora el total tiene que seguir cuadrando',
    );
  });
});

// ─── § 3 · el clasificador, como función pura ─────────────────────────────────

describe('X6.5 § 3 · classifyApolloEmptyPage', () => {
  const base: ApolloPageNormalizationDiagnostics = {
    organizations_raw_count: 0,
    accounts_raw_count: 0,
    accounts_only_count: 0,
    accounts_merged_count: 0,
    duplicates_removed_count: 0,
    dropped_without_id_count: 0,
    dropped_without_id_from_organizations_count: 0,
    dropped_without_id_from_accounts_count: 0,
    organizations_normalized_count: 0,
    organizations_new_in_page_count: 0,
    candidate_cap_truncated: false,
  };

  it('una página que sí aportó organizaciones nuevas NO tiene causa de vacío', () => {
    assert.equal(
      classifyApolloEmptyPage({
        ...base,
        organizations_raw_count: 5,
        organizations_normalized_count: 5,
        organizations_new_in_page_count: 5,
      }),
      null,
    );
  });

  it('nada crudo ⇒ organizations_empty', () => {
    assert.equal(classifyApolloEmptyPage(base), 'organizations_empty');
  });

  it('cero en organizations[] y algo en accounts[] ⇒ accounts_only', () => {
    assert.equal(
      classifyApolloEmptyPage({ ...base, accounts_raw_count: 4, accounts_only_count: 4 }),
      'accounts_only',
    );
  });

  it('accounts_only gana a la falta de id: lo que define el caso es de qué array vino la página', () => {
    assert.equal(
      classifyApolloEmptyPage({
        ...base,
        accounts_raw_count: 2,
        dropped_without_id_count: 2,
        dropped_without_id_from_accounts_count: 2,
      }),
      'accounts_only',
    );
  });

  it('organizations[] con filas y nada normalizado por falta de id ⇒ organizations_missing_id', () => {
    assert.equal(
      classifyApolloEmptyPage({
        ...base,
        organizations_raw_count: 7,
        dropped_without_id_count: 7,
        dropped_without_id_from_organizations_count: 7,
      }),
      'organizations_missing_id',
    );
  });

  it('nada normalizado por duplicados DENTRO de la página ⇒ organizations_all_dropped', () => {
    assert.equal(
      classifyApolloEmptyPage({
        ...base,
        organizations_raw_count: 3,
        duplicates_removed_count: 3,
      }),
      'organizations_all_dropped',
    );
  });

  it('normalizadas > 0 y ninguna nueva ⇒ organizations_all_duplicate', () => {
    assert.equal(
      classifyApolloEmptyPage({
        ...base,
        organizations_raw_count: 4,
        organizations_normalized_count: 4,
      }),
      'organizations_all_duplicate',
    );
  });

  it('el tope de candidatos gana al solapamiento: había algo nuevo y no cupo', () => {
    assert.equal(
      classifyApolloEmptyPage({
        ...base,
        organizations_raw_count: 4,
        organizations_normalized_count: 4,
        candidate_cap_truncated: true,
      }),
      'candidate_cap_reached',
    );
  });

  it('contadores que no explican el vacío ⇒ unknown, jamás una causa inventada', () => {
    assert.equal(
      classifyApolloEmptyPage({ ...base, organizations_raw_count: 9 }),
      'unknown',
    );
  });
});

// ─── Escenarios A-F sobre la búsqueda paginada real ───────────────────────────

describe('X6.5 · escenarios por página', () => {
  // ── A. organizaciones normales ─────────────────────────────────────────────
  it('A · organizaciones normales: raw > 0, normalizadas > 0, results > 0, 1 crédito, sin causa de vacío', async () => {
    const { result, log, outcome } = await runOnePage({ organizations: orgs(3) });
    const d = diagnosticsOf(log, outcome);

    assert.equal(d.organizations_raw_count, 3);
    assert.equal(d.accounts_raw_count, 0);
    assert.equal(d.dropped_without_id_count, 0);
    assert.equal(d.organizations_normalized_count, 3);
    assert.equal(d.organizations_new_in_page_count, 3);
    assert.equal(log.resultsReturned, 3);
    assert.equal(log.estimatedCredits, 1);
    assert.equal(log.emptyPageReason, null);
    assert.equal(outcome.emptyPageReason, null);
    assert.equal(log.billingState, 'charged');
    assert.equal(result.estimatedCredits, 1);
  });

  // ── B. accounts-only ───────────────────────────────────────────────────────
  it('B · accounts-only: 0 organizaciones crudas, cuentas > 0, results = 0, 1 crédito, accounts_only', async () => {
    const { log, outcome } = await runOnePage({ organizations: [], accounts: accounts(2) });
    const d = diagnosticsOf(log, outcome);

    assert.equal(d.organizations_raw_count, 0);
    assert.equal(d.accounts_raw_count, 2);
    assert.equal(d.accounts_only_count, 2, 'cuentas sin contraparte: diagnóstico, nunca candidatos');
    assert.equal(d.organizations_normalized_count, 0);
    assert.equal(d.organizations_new_in_page_count, 0);
    assert.equal(log.resultsReturned, 0);
    assert.equal(log.estimatedCredits, 1, 'Scenario H: una página accounts-only SÍ cuesta 1 crédito');
    assert.equal(log.emptyPageReason, 'accounts_only');
    assert.equal(outcome.emptyPageReason, 'accounts_only');
    assert.equal(log.billingState, 'charged');
  });

  // ── C. organizaciones sin id ───────────────────────────────────────────────
  it('C · organizaciones sin id: raw > 0, descartadas > 0, results = 0, 1 crédito, organizations_missing_id', async () => {
    const { log, outcome } = await runOnePage({ organizations: orgsWithoutId(4) });
    const d = diagnosticsOf(log, outcome);

    assert.equal(d.organizations_raw_count, 4);
    assert.equal(d.accounts_raw_count, 0);
    assert.equal(d.dropped_without_id_count, 4);
    assert.equal(d.dropped_without_id_from_organizations_count, 4);
    assert.equal(d.dropped_without_id_from_accounts_count, 0);
    assert.equal(d.organizations_normalized_count, 0);
    assert.equal(log.resultsReturned, 0);
    assert.equal(log.estimatedCredits, 1, 'Apollo ya cobró la página: descartarla en normalización no la vuelve gratis');
    assert.equal(log.emptyPageReason, 'organizations_missing_id');
    assert.equal(outcome.emptyPageReason, 'organizations_missing_id');
  });

  // ── D. todo duplicado ──────────────────────────────────────────────────────
  it('D · todo duplicado entre páginas: normalizadas > 0, nuevas = 0, 1 crédito, organizations_all_duplicate', async () => {
    const page = { organizations: orgs(2) };
    const h = harness(() => okPage(page));
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ maxPages: 2, perPage: 100, maxCandidates: 999 }),
      },
      h.deps,
    );

    assert.equal(h.logs.length, 2, 'dos páginas pedidas');
    const second = h.logs[1]!;
    const d = diagnosticsOf(second, result.pageOutcomes[1]!);

    assert.equal(d.organizations_raw_count, 2);
    assert.equal(d.organizations_normalized_count, 2, 'la normalización de ESA página sí produjo organizaciones');
    assert.equal(d.organizations_new_in_page_count, 0, 'ninguna era nueva: todas venían de la página anterior');
    assert.equal(d.candidate_cap_truncated, false, 'no fue el tope: fue el solapamiento');
    assert.equal(second.estimatedCredits, 1, 'una página repetida también se paga');
    assert.equal(second.emptyPageReason, 'organizations_all_duplicate');
    assert.equal(result.organizations.length, 2, 'el dedup entre páginas sigue intacto');
    assert.equal(result.estimatedCredits, 2);
  });

  // ── E. página realmente vacía ──────────────────────────────────────────────
  it('E · página realmente vacía: 0 crudas, 0 cuentas, results = 0, 0 créditos, organizations_empty', async () => {
    const { result, log, outcome } = await runOnePage({ organizations: [], accounts: [] });
    const d = diagnosticsOf(log, outcome);

    assert.equal(d.organizations_raw_count, 0);
    assert.equal(d.accounts_raw_count, 0);
    assert.equal(log.resultsReturned, 0);
    assert.equal(log.estimatedCredits, 0, 'sólo la página que no trajo NADA es gratis');
    assert.equal(log.billingState, 'not_charged');
    assert.equal(log.emptyPageReason, 'organizations_empty');
    assert.equal(outcome.emptyPageReason, 'organizations_empty');
    assert.equal(result.estimatedCredits, 0);
  });

  // ── F. mezcla organizations + accounts ─────────────────────────────────────
  it('F · mezcla: los dos contadores quedan separados y el cobro sigue siendo 1', async () => {
    const { log, outcome } = await runOnePage({
      // org_0 y org_1 vienen de organizations[]; acc_1 completa a org_1 y acc_9
      // no tiene contraparte, así que sólo cuenta como accounts_only.
      organizations: orgs(2),
      accounts: [
        { id: 'acc_1', organization_id: 'org_1', country: 'Colombia' },
        { id: 'acc_9', organization_id: 'org_9' },
      ],
    });
    const d = diagnosticsOf(log, outcome);

    assert.equal(d.organizations_raw_count, 2, 'el contador de organizaciones no absorbe cuentas');
    assert.equal(d.accounts_raw_count, 2, 'el contador de cuentas no absorbe organizaciones');
    assert.equal(d.accounts_merged_count, 1);
    assert.equal(d.accounts_only_count, 1);
    assert.equal(d.organizations_normalized_count, 2, 'accounts_only NO entra al pool de descubrimiento');
    assert.equal(log.resultsReturned, 2);
    assert.equal(log.estimatedCredits, 1);
    assert.equal(log.emptyPageReason, null);
  });

  it('F2 · organizaciones sin id + una cuenta: contadores separados y el cobro sigue siendo 1', async () => {
    const { log, outcome } = await runOnePage({
      organizations: orgsWithoutId(3),
      accounts: accounts(1),
    });
    const d = diagnosticsOf(log, outcome);

    assert.equal(d.organizations_raw_count, 3);
    assert.equal(d.accounts_raw_count, 1);
    assert.equal(d.dropped_without_id_from_organizations_count, 3);
    assert.equal(d.dropped_without_id_from_accounts_count, 0);
    assert.equal(d.accounts_only_count, 1);
    assert.equal(log.resultsReturned, 0);
    assert.equal(log.estimatedCredits, 1, 'cualquiera de los dos arrays con filas ⇒ página cobrada');
    // `organizations[]` SÍ trajo filas, así que el caso no es accounts_only: es
    // falta de identidad. La cuenta con `organization_id` tampoco rescata la
    // página — sin contraparte en `organizations[]` no entra al pool (§ 2).
    assert.equal(log.emptyPageReason, 'organizations_missing_id');
    assert.equal(outcome.emptyPageReason, 'organizations_missing_id');
  });
});

// ─── § 3 · el tope de candidatos, medido sin tocar el bucle anclado ──────────

describe('X6.5 § 3 · candidate_cap_truncated', () => {
  it('el tope que corta la página a media adopción queda registrado', async () => {
    const h = harness(() => okPage({ organizations: orgs(3) }));
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ maxPages: 1, perPage: 100, maxCandidates: 2 }),
      },
      h.deps,
    );
    const d = diagnosticsOf(h.logs[0]!, result.pageOutcomes[0]!);

    assert.equal(d.organizations_normalized_count, 3, 'la página normalizó tres');
    assert.equal(d.organizations_new_in_page_count, 2, 'sólo dos cupieron');
    assert.equal(
      d.candidate_cap_truncated,
      true,
      'sin este dato, una página frenada por el tope se leería como solapamiento',
    );
    assert.equal(result.organizations.length, 2, 'el tope sigue mandando: la instrumentación no lo mueve');
  });

  it('una página que cabe entera NO se marca como truncada', async () => {
    const { log, outcome } = await runOnePage({ organizations: orgs(3) });
    assert.equal(diagnosticsOf(log, outcome).candidate_cap_truncated, false);
  });
});

// ─── § 4 · el cobro no se mueve ───────────────────────────────────────────────

describe('X6.5 § 4 · trinquete de facturación — este corte es SÓLO observabilidad', () => {
  const cases: Array<{ name: string; payload: RawPayload; credits: 0 | 1 }> = [
    { name: 'organizaciones normales', payload: { organizations: orgs(3) }, credits: 1 },
    { name: 'accounts-only', payload: { organizations: [], accounts: accounts(2) }, credits: 1 },
    { name: 'organizaciones sin id', payload: { organizations: orgsWithoutId(4) }, credits: 1 },
    { name: 'todo duplicado dentro de la página', payload: { organizations: [...orgs(1), ...orgs(1)] }, credits: 1 },
    { name: 'página vacía', payload: { organizations: [], accounts: [] }, credits: 0 },
    { name: 'sin arrays', payload: {}, credits: 0 },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} ⇒ ${testCase.credits} crédito(s) — rawPageHadResults, no la utilidad del resultado`, async () => {
      const { log } = await runOnePage(testCase.payload);
      assert.equal(log.estimatedCredits, testCase.credits);
      assert.equal(log.billingState, testCase.credits > 0 ? 'charged' : 'not_charged');
    });
  }

  it('una página descartada ENTERA por la normalización NO se vuelve gratis', async () => {
    const { log } = await runOnePage({ organizations: orgsWithoutId(10) });
    assert.equal(log.resultsReturned, 0, 'nada utilizable');
    assert.equal(log.estimatedCredits, 1, 'y aun así se pagó');
  });

  it('el crédito se decide sobre lo CRUDO, no sobre lo normalizado', async () => {
    const { log } = await runOnePage({ organizations: [], accounts: [{ id: 'acc_sin_org' }] });
    assert.equal(log.normalization?.organizations_normalized_count, 0);
    assert.equal(log.estimatedCredits, 1);
  });
});

// ─── § 2 · ronda y páginas fallidas ───────────────────────────────────────────

describe('X6.5 § 2 · ronda y ausencia de datos', () => {
  it('la ronda inyectada llega al registro de la página', async () => {
    const h = harness(() => okPage({ organizations: orgs(1) }));
    await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: onePageBudget(), roundNumber: 2 },
      h.deps,
    );
    assert.equal(h.logs[0]!.roundNumber, 2);
  });

  it('la ruta legacy no inventa ronda: null, no 1', async () => {
    const { log } = await runOnePage({ organizations: orgs(1) });
    assert.equal(log.roundNumber, null);
  });

  it('un error NO es "cero organizaciones": sin respuesta no hay contadores ni causa', async () => {
    const h = harness(() => errorPage(500));
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: onePageBudget() },
      h.deps,
    );
    const failed = h.logs[h.logs.length - 1]!;
    assert.notEqual(failed.status, 'success');
    assert.equal(failed.normalization, null, 'null, nunca ceros: ceros afirmarían una página vacía');
    assert.equal(failed.emptyPageReason, null);
    assert.equal(failed.estimatedCredits, 0);
    for (const outcome of result.pageOutcomes) {
      if (outcome.status === 'success') continue;
      assert.equal(outcome.normalization, null);
      assert.equal(outcome.emptyPageReason, null);
    }
  });
});

// ─── Cadena RAW → NORMALIZACIÓN → DESCARTES → UTILIZABLES ─────────────────────

describe('X6.5 · la cadena cuadra por página', () => {
  it('crudas = normalizadas + sin id + duplicadas, y utilizables ≤ normalizadas', async () => {
    const { log, outcome } = await runOnePage({
      organizations: [...orgs(3), ...orgs(1), ...orgsWithoutId(2)],
    });
    const d = diagnosticsOf(log, outcome);

    assert.equal(d.organizations_raw_count, 6);
    assert.equal(d.organizations_normalized_count, 3);
    assert.equal(d.dropped_without_id_from_organizations_count, 2);
    assert.equal(d.duplicates_removed_count, 1);
    assert.equal(
      d.organizations_raw_count,
      d.organizations_normalized_count +
        d.dropped_without_id_from_organizations_count +
        d.duplicates_removed_count,
      'la cadena tiene que cerrar: si no cierra, el diagnóstico miente',
    );
    assert.ok(d.organizations_new_in_page_count <= d.organizations_normalized_count);
    assert.equal(log.resultsReturned, d.organizations_normalized_count);
  });

  it('buildApolloPageNormalizationDiagnostics no pierde ni renombra ningún contador de la normalización', () => {
    const normalized = normalizeApolloOrganizationsResponse({
      organizations: [...orgs(2), ...orgsWithoutId(1)],
      accounts: [{ id: 'acc_1', organization_id: 'org_1' }, { id: 'acc_x' }],
    });
    const d = buildApolloPageNormalizationDiagnostics({
      meta: normalized.meta,
      organizationsNormalizedCount: normalized.organizations.length,
      newInPageCount: normalized.organizations.length,
      candidateCapTruncated: false,
    });

    assert.equal(d.organizations_raw_count, normalized.meta.organizations_raw_count);
    assert.equal(d.accounts_raw_count, normalized.meta.accounts_raw_count);
    assert.equal(d.accounts_only_count, normalized.meta.accounts_only_count);
    assert.equal(d.accounts_merged_count, normalized.meta.accounts_merged_count);
    assert.equal(d.duplicates_removed_count, normalized.meta.duplicates_removed_count);
    assert.equal(d.dropped_without_id_count, normalized.meta.dropped_without_id_count);
    assert.equal(
      d.dropped_without_id_from_organizations_count,
      normalized.meta.dropped_without_id_from_organizations_count,
    );
    assert.equal(
      d.dropped_without_id_from_accounts_count,
      normalized.meta.dropped_without_id_from_accounts_count,
    );
    assert.equal(d.organizations_normalized_count, normalized.organizations.length);
  });
});

// ─── Cierre ───────────────────────────────────────────────────────────────────

describe('X6.5 · aislamiento', () => {
  it('ninguna prueba de este fichero salió a la red', () => {
    assert.equal(realFetchCalls, 0);
  });
});

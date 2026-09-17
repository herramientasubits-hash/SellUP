/**
 * APOLLO-PROSPECTED-BY-CURRENT-TEAM-X6.6 — `prospected_by_current_team: "no"`.
 *
 * Qué prueba este archivo, y qué NO.
 *
 * SÍ prueba que el parámetro que Apollo Support recomendó puede expresarse, que
 * viaja con el literal exacto hasta el transporte, que queda observable sin
 * credenciales y que el allowlist sigue cerrado para todo lo demás.
 *
 * NO prueba —ni puede— que Apollo se comporte como Support dijo. Eso exige una
 * corrida real contra el proveedor y la comparación `accounts[]` vs
 * `organizations[]`. Ver la sección homónima del PR.
 *
 * Puro y offline: `fetchPage`, `now`, `random` y `sleep` se inyectan, y un
 * contador verifica al final que ninguna prueba alcanzó la red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  buildApolloOrganizationsRequestContract,
  assertApolloOrganizationsBodySafe,
  APOLLO_ORGANIZATIONS_ALLOWED_PARAMS,
  APOLLO_PROSPECTED_BY_CURRENT_TEAM_VALUES,
  isApolloProspectedByCurrentTeam,
} from '../apollo-organizations-request-contract';
import {
  buildApolloOrganizationsEffectiveRequest,
  toApolloContractFilters,
  toApolloEffectiveRequestMetadata,
  AGENT1_APOLLO_PROSPECTED_BY_CURRENT_TEAM,
} from '../apollo-organizations-effective-request';
import {
  runApolloOrganizationsPaginatedSearch,
  type ApolloPageFetchResult,
  type ApolloPaginatedSearchDeps,
} from '../apollo-organizations-paginated-search';
import { createApolloPaginationBudget } from '../apollo-organizations-pagination-budget';
import {
  APOLLO_PRICING_VERSION,
  APOLLO_BILLABLE_UNIT,
  APOLLO_CREDITS_PER_UNIT,
  creditsForApolloNonEmptyPages,
} from '../apollo-operation-pricing';
import { MACRO_INDUSTRY_CATALOG_VERSION } from '@/modules/macro-industry-catalog/macro-industries';

// ─── Instrumentación de red ───────────────────────────────────────────────────

/** Sube si algo intentara salir a la red. Debe quedarse en 0. */
let realFetchCalls = 0;
globalThis.fetch = (async (...args: unknown[]) => {
  realFetchCalls++;
  throw new Error(`LLAMADA REAL PROHIBIDA EN TESTS: ${String(args[0])}`);
}) as typeof globalThis.fetch;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PARAM = 'prospected_by_current_team';

const baseInput = { page: 1, perPage: 100 } as const;

/** Los filtros que Agente 1 usa de verdad, sin el campo de este hito. */
const baseFilters = {
  locations: ['Colombia'],
  keywordTags: ['entidad publica', 'government agency'],
  employeeRanges: ['200,500', '500,1000'],
} as const;

function governmentWebSearchInput() {
  return {
    query: 'Gobierno en Colombia',
    industry: 'Gobierno',
    country: 'Colombia',
    countryCode: 'CO',
    subindustries: [],
    additionalCriteriaTokens: [],
    targetEmployeeThreshold: 200,
    selectionCatalogVersion: MACRO_INDUSTRY_CATALOG_VERSION,
    macroQueryVariantKey: null,
  };
}

function governmentEffectiveRequest() {
  return buildApolloOrganizationsEffectiveRequest({
    // El tipo de `WebSearchInput` trae campos opcionales que esta prueba no
    // necesita; el `as never` evita replicar la forma entera sin relajar nada
    // del módulo bajo prueba.
    input: governmentWebSearchInput() as never,
    requestedMaxResults: 5,
    resultLimitMode: 'two_round',
    twoRoundMaxResultsPerRound: 10,
    startPage: 1,
    legacyMaxResultsPerQuery: 3,
  });
}

function okPage(organizations: Array<Record<string, unknown>>): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: { organizations, pagination: { page: 1, total_pages: 1, total_entries: organizations.length } },
    headers: null,
  };
}

/** Captura el body EXACTO que llega al transporte. */
function transportHarness(): {
  deps: ApolloPaginatedSearchDeps;
  bodies: Array<Record<string, unknown>>;
} {
  const bodies: Array<Record<string, unknown>> = [];
  let clock = 0;
  return {
    bodies,
    deps: {
      fetchPage: async (body) => {
        bodies.push(body);
        clock += 10;
        return okPage([
          { id: 'org_1', name: 'Alcaldía de Prueba', primary_domain: 'alcaldia-prueba.gov.co' },
        ]);
      },
      now: () => clock,
      random: () => 0.5,
      sleep: async (ms: number) => { clock += ms; },
    },
  };
}

function contractSource(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(
    path.join(here, '..', 'apollo-organizations-request-contract.ts'),
    'utf8',
  );
}

/**
 * Quita comentarios antes de grepear.
 *
 * Sin esto, una guarda estática confunde NOMBRAR algo con HACERLO: la cabecera
 * de este contrato explica en prosa por qué no existe un paso-a-través genérico,
 * y un grep crudo leería esa explicación como si fuera el código que prohíbe.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\t ]*\/\/.*$/gm, '');
}

// ─── § 1: el parámetro es expresable y viaja con su literal ───────────────────

describe('X6.6 § 1 · el contrato acepta prospected_by_current_team', () => {
  it('acepta "no" y lo emite tal cual', () => {
    const { body, omittedFilters } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      ...baseFilters,
      prospectedByCurrentTeam: 'no',
    });
    assert.equal(body.prospected_by_current_team, 'no');
    assert.equal(
      omittedFilters.some((f) => f.param === PARAM),
      false,
      'un filtro que sí viaja no puede aparecer como omitido',
    );
  });

  it('el body final lo contiene, y `sentParamKeys` lo declara', () => {
    const { body, sentParamKeys } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      ...baseFilters,
      prospectedByCurrentTeam: 'no',
    });
    assert.ok(Object.prototype.hasOwnProperty.call(body, PARAM));
    assert.ok(sentParamKeys.includes(PARAM));
  });

  it('el valor cableado de Agente 1 es exactamente "no"', () => {
    assert.equal(AGENT1_APOLLO_PROSPECTED_BY_CURRENT_TEAM, 'no');
  });

  it('el único traductor mapper→contrato lo inyecta', () => {
    const filters = toApolloContractFilters({
      organization_locations: ['Colombia'],
      q_organization_keyword_tags: ['entidad publica'],
    } as never);
    assert.equal(filters.prospectedByCurrentTeam, 'no');
  });

  it('el request efectivo de Gobierno lo lleva en el body', () => {
    const effective = governmentEffectiveRequest();
    assert.equal(effective.body.prospected_by_current_team, 'no');
  });

  it('llega al TRANSPORTE, que es lo único que Apollo ve', async () => {
    const { deps, bodies } = transportHarness();
    const effective = governmentEffectiveRequest();

    await runApolloOrganizationsPaginatedSearch(
      {
        filters: toApolloContractFilters(effective.params),
        budget: createApolloPaginationBudget({ maxPages: 1 }),
        wizardRunId: 'run_x66_government',
      },
      deps,
    );

    assert.equal(bodies.length, 1, 'una sola página pedida');
    assert.equal(bodies[0][PARAM], 'no');
  });
});

// ─── § 2: observabilidad ──────────────────────────────────────────────────────

describe('X6.6 § 2 · superficie sanitizada', () => {
  it('publica el valor realmente enviado', () => {
    const metadata = toApolloEffectiveRequestMetadata(governmentEffectiveRequest());
    assert.equal(metadata['apollo_prospected_by_current_team_sent'], 'no');
  });

  it('la metadata no arrastra credenciales ni el body entero', () => {
    const metadata = toApolloEffectiveRequestMetadata(governmentEffectiveRequest());
    const serialized = JSON.stringify(metadata).toLowerCase();
    for (const forbidden of ['api_key', 'apikey', 'x-api-key', 'authorization', 'bearer']) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} no puede viajar en metadata`);
    }
    assert.equal(
      Object.prototype.hasOwnProperty.call(metadata, 'body'),
      false,
      'la metadata publica campos, no el body completo',
    );
  });

  it('dice `null` si el body NO lo lleva — no repite la constante', () => {
    // La afirmación de la superficie es «esto es lo que Apollo recibió». Sin
    // esta prueba, leer la constante en vez del body pasaría igual de verde y
    // la metadata mentiría exactamente cuando más importa: si el contrato
    // llegara a omitir el campo.
    const effective = governmentEffectiveRequest();
    const bodySinCampo = { ...effective.body };
    delete bodySinCampo.prospected_by_current_team;
    const metadata = toApolloEffectiveRequestMetadata({
      ...effective,
      body: bodySinCampo,
    });
    assert.equal(metadata['apollo_prospected_by_current_team_sent'], null);
  });

  it('la huella efectiva refleja el parámetro', () => {
    const effective = governmentEffectiveRequest();
    assert.ok(
      effective.effectiveRequestFingerprint.includes(`${PARAM}=no`),
      'la huella describe el body que sale; omitirlo la haría mentir',
    );
  });
});

// ─── § 3: sin traducciones silenciosas ────────────────────────────────────────

describe('X6.6 § 3 · el contrato no adivina el valor', () => {
  it('`false` booleano NO se convierte en "no"', () => {
    const { body, omittedFilters } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      ...baseFilters,
      prospectedByCurrentTeam: false as never,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(body, PARAM), false);
    assert.deepEqual(
      omittedFilters.find((f) => f.param === PARAM),
      { param: PARAM, reason: 'invalid_value' },
    );
  });

  it('`true` booleano NO se convierte en "yes"', () => {
    const { body, omittedFilters } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      ...baseFilters,
      prospectedByCurrentTeam: true as never,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(body, PARAM), false);
    assert.equal(omittedFilters.find((f) => f.param === PARAM)?.reason, 'invalid_value');
  });

  it('"yes" NO se convierte en "no": viaja como "yes"', () => {
    const { body } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      ...baseFilters,
      prospectedByCurrentTeam: 'yes',
    });
    assert.equal(body.prospected_by_current_team, 'yes');
  });

  it('una cadena que no es literal del proveedor se rechaza, no se normaliza', () => {
    for (const raw of ['NO', 'No', 'no ', 'false', 'nope', '']) {
      const { body, omittedFilters } = buildApolloOrganizationsRequestContract({
        ...baseInput,
        ...baseFilters,
        prospectedByCurrentTeam: raw as never,
      });
      assert.equal(
        Object.prototype.hasOwnProperty.call(body, PARAM),
        false,
        `"${raw}" no puede viajar`,
      );
      assert.equal(omittedFilters.find((f) => f.param === PARAM)?.reason, 'invalid_value');
    }
  });

  it('ausente ⇒ no viaja, y se reporta como `not_provided`', () => {
    const { body, omittedFilters } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      ...baseFilters,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(body, PARAM), false);
    assert.equal(omittedFilters.find((f) => f.param === PARAM)?.reason, 'not_provided');
  });

  it('el reconocedor de literales sólo admite los dos del proveedor', () => {
    assert.deepEqual([...APOLLO_PROSPECTED_BY_CURRENT_TEAM_VALUES], ['yes', 'no']);
    for (const ok of ['yes', 'no']) assert.equal(isApolloProspectedByCurrentTeam(ok), true);
    for (const bad of [false, true, 0, 1, null, undefined, 'NO', 'maybe', {}, []]) {
      assert.equal(isApolloProspectedByCurrentTeam(bad), false, `${String(bad)} no es literal válido`);
    }
  });
});

// ─── § 4: el resto del request no se mueve ────────────────────────────────────

describe('X6.6 § 4 · nada más cambia', () => {
  it('el único campo nuevo del body es el de este hito', () => {
    const sin = buildApolloOrganizationsRequestContract({
      ...baseInput,
      ...baseFilters,
      organizationName: 'Acme',
      domainsList: ['acme.com'],
      technologyUids: ['sap'],
      revenueRange: { min: 1, max: 2 },
      notLocations: ['Peru'],
    });
    const con = buildApolloOrganizationsRequestContract({
      ...baseInput,
      ...baseFilters,
      organizationName: 'Acme',
      domainsList: ['acme.com'],
      technologyUids: ['sap'],
      revenueRange: { min: 1, max: 2 },
      notLocations: ['Peru'],
      prospectedByCurrentTeam: 'no',
    });

    const added = Object.keys(con.body).filter((k) => !(k in sin.body));
    assert.deepEqual(added, [PARAM]);

    for (const key of Object.keys(sin.body)) {
      assert.deepEqual(
        (con.body as Record<string, unknown>)[key],
        (sin.body as Record<string, unknown>)[key],
        `${key} debe quedar idéntico`,
      );
    }
  });

  it('página y per_page no se tocan', () => {
    const effective = governmentEffectiveRequest();
    assert.equal(effective.body.page, 1);
    assert.equal(effective.body.per_page, 100);
    assert.equal(effective.perPage, 100);
  });
});

// ─── § 5: el allowlist sigue cerrado ──────────────────────────────────────────

describe('X6.6 § 5 · sin paso-a-través genérico', () => {
  it('el allowlist es exactamente el anterior más UN parámetro', () => {
    assert.deepEqual([...APOLLO_ORGANIZATIONS_ALLOWED_PARAMS], [
      'organization_locations',
      'organization_not_locations',
      'organization_num_employees_ranges',
      'q_organization_keyword_tags',
      'q_organization_name',
      'q_organization_domains_list',
      'revenue_range',
      'currently_using_any_of_technology_uids',
      'prospected_by_current_team',
      'page',
      'per_page',
    ]);
  });

  it('un parámetro desconocido sigue rechazándose por nombre', () => {
    const { body, rejectedUnknownParams, omittedFilters } =
      buildApolloOrganizationsRequestContract({
        ...baseInput,
        ...baseFilters,
        prospectedByCurrentTeam: 'no',
        extraParams: { some_random_param: 'x' },
      });
    assert.deepEqual(rejectedUnknownParams, ['some_random_param']);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'some_random_param'), false);
    assert.deepEqual(
      omittedFilters.find((f) => f.param === 'some_random_param'),
      { param: 'some_random_param', reason: 'unknown_parameter' },
    );
    // El hito no debilitó el rechazo: el campo nuevo sí viaja en el mismo body.
    assert.equal(body.prospected_by_current_team, 'no');
  });

  it('ningún parámetro arbitrario entra por `extraParams`', () => {
    const arbitrary = [
      'prospected_by_current_team_v2',
      'organization_sic_codes_v2',
      'q_organization_anything',
      'per_page_override',
      '__proto__polluted',
    ];
    for (const name of arbitrary) {
      const { body, rejectedUnknownParams } = buildApolloOrganizationsRequestContract({
        ...baseInput,
        ...baseFilters,
        extraParams: { [name]: 'x' },
      });
      assert.deepEqual(rejectedUnknownParams, [name]);
      assert.equal(Object.prototype.hasOwnProperty.call(body, name), false);
    }
  });

  it('`extraParams` no puede pisar el valor que el criterio ya resolvió', () => {
    const { body, rejectedUnknownParams } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      ...baseFilters,
      prospectedByCurrentTeam: 'no',
      extraParams: { [PARAM]: 'yes' },
    });
    assert.equal(body.prospected_by_current_team, 'no', 'el campo tipado manda');
    assert.deepEqual(rejectedUnknownParams, []);
  });

  it('`assertApolloOrganizationsBodySafe` acepta el nuevo y sigue bloqueando lo demás', () => {
    const { body } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      ...baseFilters,
      prospectedByCurrentTeam: 'no',
    });
    assert.doesNotThrow(() =>
      assertApolloOrganizationsBodySafe(body as unknown as Record<string, unknown>),
    );
    assert.throws(
      () => assertApolloOrganizationsBodySafe({ ...body, some_random_param: 'x' }),
      /apollo_organizations_unknown_params: some_random_param/,
    );
    assert.throws(
      () => assertApolloOrganizationsBodySafe({ ...body, organization_sic_codes: ['1234'] }),
      /apollo_organizations_forbidden_params: organization_sic_codes/,
    );
  });

  it('guarda estática: el constructor no derrama `extraParams` en el body', () => {
    const source = stripComments(contractSource());
    assert.equal(
      /\.\.\.\s*\(?\s*input\.extraParams/.test(source),
      false,
      'un spread de `extraParams` convertiría el allowlist en decorativo',
    );
    assert.ok(
      source.includes('if (!isAllowedParam(key))'),
      'la rama que rechaza lo no permitido tiene que seguir existiendo',
    );
  });
});

// ─── § 6: el cobro no se mueve ────────────────────────────────────────────────

describe('X6.6 § 6 · semántica de facturación intacta', () => {
  it('el modelo de precios sigue siendo por página no vacía', () => {
    assert.equal(APOLLO_PRICING_VERSION, 'a1-apollo-operation-pricing-v2-per-page');
    assert.equal(APOLLO_BILLABLE_UNIT['organizations_search'], 'non_empty_page');
    assert.equal(APOLLO_CREDITS_PER_UNIT['organizations_search'], 1);
    assert.equal(creditsForApolloNonEmptyPages(3), 3);
  });

  it('el mismo plan cobra lo mismo con y sin el parámetro', async () => {
    const budget = createApolloPaginationBudget({ maxPages: 1 });

    const sin = transportHarness();
    const sinResult = await runApolloOrganizationsPaginatedSearch(
      { filters: { ...baseFilters }, budget, wizardRunId: 'run_x66_sin' },
      sin.deps,
    );

    const con = transportHarness();
    const conResult = await runApolloOrganizationsPaginatedSearch(
      {
        filters: { ...baseFilters, prospectedByCurrentTeam: 'no' },
        budget,
        wizardRunId: 'run_x66_con',
      },
      con.deps,
    );

    assert.equal(conResult.estimatedCredits, sinResult.estimatedCredits);
    assert.equal(conResult.pagesProcessed, sinResult.pagesProcessed);
    assert.deepEqual(
      conResult.pageOutcomes.map((o) => [o.estimatedCredits, o.billingState]),
      sinResult.pageOutcomes.map((o) => [o.estimatedCredits, o.billingState]),
    );
    // Y la única diferencia observable entre los dos bodies es el parámetro.
    assert.equal(sin.bodies[0][PARAM], undefined);
    assert.equal(con.bodies[0][PARAM], 'no');
  });
});

// ─── Cierre ───────────────────────────────────────────────────────────────────

describe('X6.6 · aislamiento', () => {
  it('ninguna prueba alcanzó la red', () => {
    assert.equal(realFetchCalls, 0);
  });
});

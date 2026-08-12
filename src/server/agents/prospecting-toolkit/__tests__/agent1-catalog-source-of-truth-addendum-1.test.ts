/**
 * agent1-catalog-source-of-truth-addendum-1.test.ts
 *
 * AGENT1-MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 · CATALOG SOURCE-OF-TRUTH FINAL
 * ADDENDUM · §§ 1–11.
 *
 * El riesgo que cierra: el catálogo de industrias NO es code-owned. Vive en
 * PostgreSQL y una versión nueva se publica con una transacción
 * (`publish_industry_catalog_version`), sin despliegue. El wizard lo lee EN VIVO
 * (`resolveWizardCatalog` → vista `active_industry_catalog`) y verifica la versión
 * que el navegador envió. El addendum anterior, en cambio, redactaba las consultas
 * con un SNAPSHOT TypeScript de `subindustry_search_terms`: una segunda fuente de
 * verdad que podía describir otra versión sin que nada fallara.
 *
 * Lo que esta suite garantiza:
 *
 *   1. ningún módulo de producción importa un snapshot de esa tabla (§ 1 y § 2);
 *   2. la resolución de términos viaja como DATO desde una sola lectura (§ 2);
 *   3. `selection_catalog_version == search_term_catalog_version` o no se gasta
 *      (§ 3): cero llamadas al proveedor, cero filas económicas;
 *   4. un cambio de catálogo v1 → v2 nunca produce `wizard=v2 + términos=v1 +
 *      llamada al proveedor` (§ 6);
 *   5. la cobertura sigue siendo 73/73 sobre la versión publicada y la precisión
 *      sigue en 2/73 (§ 7);
 *   6. los topes de 2 llamadas / 5 enrichments / 25 créditos no se mueven (§ 8);
 *   7. la metadata declara versión, digest y procedencia (§ 9).
 *
 * Todo offline y por inyección de dependencias:
 *   LIVE_APOLLO_CALLS = 0 · LIVE_TAVILY_CALLS = 0 · APOLLO_CREDITS_USED = 0
 *   PRODUCTION_WRITES = 0 · HUBSPOT_WRITES = 0
 */

import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  APOLLO_CATALOG_TERMS_SOURCE,
  APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_COPY,
  APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_REASON,
  buildApolloSubindustryCatalogTermsResolution,
  createApolloSubindustryCatalogTermsLookup,
  evaluateApolloCatalogVersionCoherence,
  hashApolloSubindustryCatalogTerms,
  serializeApolloSubindustryCatalogTerms,
  toApolloCatalogVersionCoherenceMetadata,
  toApolloSubindustryCatalogTermsMetadata,
} from '../apollo-subindustry-catalog-terms-resolution';
import { loadApolloSubindustryCatalogTerms } from '../apollo-subindustry-catalog-terms-loader.server';
import {
  buildApolloOrganizationsEffectiveRequest,
  toApolloCatalogTermsRunMetadata,
  toApolloEffectiveRequestMetadata,
} from '../apollo-organizations-effective-request';
import {
  buildApolloOrganizationsSearchParams,
  resolveApolloSubindustryQueryTerms,
} from '../apollo-organizations-query-mapping';
import {
  auditApolloSubindustryCatalogSearchCoverage,
  resolveApolloSubindustrySearchCoverage,
} from '../apollo-subindustry-search-coverage';
import { resolveApolloSubindustrySearchMapping } from '../apollo-subindustry-search-mapping';
import { assessApolloSubindustryPrecisionForRequest } from '../apollo-subindustry-precision';
import { runApolloOrganizationsSearch } from '../web-search-providers/apollo-organizations-search-provider';
import { estimateApolloTwoRoundBudget } from '../apollo-two-round/budget';
import {
  MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
  MAX_SEARCH_ROUNDS_ABSOLUTE_MAX,
} from '../apollo-two-round/config';
import {
  buildPublishedCatalogTermsResolution,
  CATALOG_TERMS_SOURCE_HASH,
  CATALOG_VERSION,
  CATALOG_VERSION_ID,
  PUBLISHED_CATALOG_KEYWORD_TERM_ROWS,
  PUBLISHED_CATALOG_ROWS,
} from './fixtures/sellup-published-catalog-search-terms';
import { SELLUP_ACTIVE_SUBINDUSTRY_NAMES } from './fixtures/sellup-subindustry-catalog-names';
import type { WebSearchInput, WebSearchResult } from '../types';

// ─── Contexto ─────────────────────────────────────────────────────────────────

const PUBLISHED = buildPublishedCatalogTermsResolution();
const PUBLISHED_LOOKUP = createApolloSubindustryCatalogTermsLookup(PUBLISHED);

/** Una del catálogo especializado (2/73) y otra que sólo tiene términos de tabla. */
const SUPERMARKETS = 'Supermercados e Hipermercados';
const CYBERSECURITY = 'Ciberseguridad';
const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..', '..', '..');

/**
 * Etiquetas sintéticas para los tests de deriva del § 6.
 *
 * Deliberadamente ajenas a cualquier search pack: 'A' resuelve a `lms_platform` por
 * alias, y un pack ganando la consulta taparía justo lo que aquí se mide — qué versión
 * del catálogo redactó los keywords.
 */
const SYNTHETIC_A = 'Subindustria Sintetica Alfa';
const SYNTHETIC_B = 'Subindustria Sintetica Beta';
const SYNTHETIC_C = 'Subindustria Sintetica Gamma';

function webSearchInput(overrides: Partial<WebSearchInput> = {}): WebSearchInput {
  return {
    query: 'descubrimiento de empresas',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail y Consumo',
    intent: 'company_discovery',
    provider: 'apollo_organizations',
    maxResults: 5,
    subindustries: [SUPERMARKETS, CYBERSECURITY],
    subindustryCatalogTerms: PUBLISHED,
    selectionCatalogVersion: CATALOG_VERSION,
    ...overrides,
  };
}

function buildEffective(overrides: Partial<WebSearchInput> = {}) {
  return buildApolloOrganizationsEffectiveRequest({
    input: webSearchInput(overrides),
    requestedMaxResults: 5,
    resultLimitMode: 'two_round',
    twoRoundMaxResultsPerRound: 5,
    legacyMaxResultsPerQuery: 5,
  });
}

/** Cliente Supabase mínimo: dos vistas, sólo `select`. Cero escrituras posibles. */
function stubSupabase(config: {
  catalogRows?: readonly Record<string, unknown>[];
  termRows?: readonly Record<string, unknown>[];
  catalogError?: boolean;
  termError?: boolean;
}) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(table);
      const rowsFor = (): { data: unknown; error: unknown } => {
        if (table === 'active_industry_catalog') {
          return config.catalogError
            ? { data: null, error: { message: 'boom' } }
            : { data: config.catalogRows ?? [], error: null };
        }
        return config.termError
          ? { data: null, error: { message: 'boom' } }
          : { data: config.termRows ?? [], error: null };
      };
      const builder = {
        select: () => builder,
        eq: () => builder,
        then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
          Promise.resolve(rowsFor()).then(resolve),
      };
      return builder;
    },
  };
  return { client: client as never, calls };
}

// ─── § 1 y § 2: una sola fuente de verdad ─────────────────────────────────────

describe('§§ 1–2 · el catálogo publicado es la única fuente de los términos', () => {
  test('el snapshot estático de subindustry_search_terms ya no existe en producción', () => {
    const toolkitDir = path.join(
      REPO_ROOT,
      'src',
      'server',
      'agents',
      'prospecting-toolkit',
    );
    const files = readdirSync(toolkitDir);
    assert.equal(
      files.includes('apollo-subindustry-catalog-search-terms.ts'),
      false,
      'un snapshot en producción es una segunda fuente de verdad que puede describir otra versión',
    );
  });

  test('ningún módulo de producción importa el fixture de la lectura congelada', () => {
    // El fixture vive en `__tests__/fixtures/`. Si un módulo de producción lo
    // importara, el snapshot habría vuelto por la puerta de atrás.
    const productionFiles = [
      'apollo-organizations-query-mapping.ts',
      'apollo-subindustry-search-coverage.ts',
      'apollo-subindustry-catalog-terms-resolution.ts',
      'apollo-subindustry-catalog-terms-loader.server.ts',
      'apollo-organizations-effective-request.ts',
      'apollo-subindustry-query-terms.ts',
    ];
    for (const file of productionFiles) {
      const source = readFileSync(
        path.join(REPO_ROOT, 'src', 'server', 'agents', 'prospecting-toolkit', file),
        'utf8',
      );
      assert.ok(
        !source.includes('__tests__'),
        `${file} no puede importar nada de __tests__`,
      );
      assert.ok(
        !source.includes('apollo-subindustry-catalog-search-terms'),
        `${file} sigue apuntando al snapshot borrado`,
      );
    }
  });

  test('la ruta pura no consulta nada: sólo el loader toca la base', () => {
    const pureModules = [
      'apollo-subindustry-catalog-terms-resolution.ts',
      'apollo-subindustry-search-coverage.ts',
      'apollo-organizations-query-mapping.ts',
    ];
    for (const file of pureModules) {
      const source = readFileSync(
        path.join(REPO_ROOT, 'src', 'server', 'agents', 'prospecting-toolkit', file),
        'utf8',
      );
      assert.ok(!source.includes('@supabase/supabase-js'), `${file} no puede hablar con Supabase`);
      assert.ok(!source.includes('@/lib/supabase/'), `${file} no puede crear un cliente`);
    }
  });

  test('el resolvedor de términos es un parámetro obligatorio, no un import', () => {
    // Sin lookup, los términos de la TABLA no existen para la ruta de consulta: no
    // hay import que los traiga por detrás. Lo que queda es el mapa histórico, que
    // es code-owned y otra cosa.
    const withoutCatalog = resolveApolloSubindustryQueryTerms(CYBERSECURITY, () => null);
    assert.notEqual(withoutCatalog.termSource, 'catalog_search_terms');

    const withCatalog = resolveApolloSubindustryQueryTerms(CYBERSECURITY, PUBLISHED_LOOKUP);
    assert.equal(withCatalog.termSource, 'catalog_search_terms');
    assert.deepEqual(
      withCatalog.terms,
      PUBLISHED_LOOKUP(CYBERSECURITY)?.terms,
      'los términos son EXACTAMENTE los de la versión publicada, sin añadidos',
    );
  });

  test('una subindustria canónica sin ninguna otra fuente queda en `none` sin lookup', () => {
    // `Insurtech` no está en el catálogo especializado ni en el mapa histórico: sin
    // la lectura del catálogo publicado no hay NADA que buscar, y eso es lo que el
    // gate del § 7 convierte en un bloqueo pre-gasto.
    const withoutCatalog = resolveApolloSubindustryQueryTerms('Insurtech', () => null);
    assert.equal(withoutCatalog.termSource, 'none');
    assert.deepEqual(withoutCatalog.terms, []);
  });

  test('el catálogo especializado sigue ganando: es el que gobierna precisión', () => {
    const resolution = resolveApolloSubindustryQueryTerms(SUPERMARKETS, PUBLISHED_LOOKUP);
    assert.equal(resolution.termSource, 'explicit_catalog');
    assert.equal(resolution.canonicalSubindustry, SUPERMARKETS);
  });
});

// ─── § 2: el loader ───────────────────────────────────────────────────────────

describe('§ 2 · loadApolloSubindustryCatalogTerms — dos vistas, una sola versión', () => {
  test('la lectura real de `1.0.0` produce 73 subindustrias y 107 términos', async () => {
    const { client, calls } = stubSupabase({
      catalogRows: PUBLISHED_CATALOG_ROWS as unknown as Record<string, unknown>[],
      termRows: PUBLISHED_CATALOG_KEYWORD_TERM_ROWS as unknown as Record<string, unknown>[],
    });
    const result = await loadApolloSubindustryCatalogTerms(client);

    assert.equal(result.failureReason, null);
    assert.equal(result.resolution?.catalogVersion, CATALOG_VERSION);
    assert.equal(result.resolution?.catalogVersionId, CATALOG_VERSION_ID);
    assert.equal(result.resolution?.termType, 'keyword');
    assert.equal(result.resolution?.entries.length, 73);
    assert.equal(
      result.resolution?.entries.reduce((sum, entry) => sum + entry.terms.length, 0),
      107,
    );
    // Sólo las dos vistas del catálogo publicado, nada más.
    assert.deepEqual(
      [...new Set(calls)].sort(),
      ['active_industry_catalog', 'active_subindustry_search_terms'],
    );
  });

  test('el digest de la lectura real coincide con el congelado', async () => {
    const { client } = stubSupabase({
      catalogRows: PUBLISHED_CATALOG_ROWS as unknown as Record<string, unknown>[],
      termRows: PUBLISHED_CATALOG_KEYWORD_TERM_ROWS as unknown as Record<string, unknown>[],
    });
    const result = await loadApolloSubindustryCatalogTerms(client);
    assert.equal(result.resolution?.sourceHash, CATALOG_TERMS_SOURCE_HASH);
  });

  test('los términos salen en orden de peso: el primero es el que reparte primero', async () => {
    const { client } = stubSupabase({
      catalogRows: PUBLISHED_CATALOG_ROWS as unknown as Record<string, unknown>[],
      termRows: PUBLISHED_CATALOG_KEYWORD_TERM_ROWS as unknown as Record<string, unknown>[],
    });
    const result = await loadApolloSubindustryCatalogTerms(client);
    const hrtech = result.resolution?.entries.find(
      (entry) => entry.canonicalSubindustry === 'HRtech y Gestión del Talento',
    );
    assert.deepEqual(hrtech?.terms, [
      'software de recursos humanos',
      'plataforma de gestión del talento',
      'nómina digital LATAM',
    ]);
  });

  test('un publish colado entre las dos lecturas se rehúsa, no se mezcla', async () => {
    const { client } = stubSupabase({
      catalogRows: [
        {
          catalog_version_id: CATALOG_VERSION_ID,
          catalog_version: CATALOG_VERSION,
          subindustry_id: 'sub-1',
          subindustry_name: CYBERSECURITY,
        },
      ],
      termRows: [
        {
          catalog_version_id: 'otra-version-publicada',
          subindustry_id: 'sub-1',
          term: 'ciberseguridad empresas',
          term_type: 'keyword',
          weight: 1,
        },
      ],
    });
    const result = await loadApolloSubindustryCatalogTerms(client);
    assert.equal(result.resolution, null);
    assert.equal(result.failureReason, 'version_straddled_publish');
  });

  test('dos versiones publicadas a la vez ⇒ mixed_catalog_versions', async () => {
    const { client } = stubSupabase({
      catalogRows: [
        {
          catalog_version_id: 'v1',
          catalog_version: '1.0.0',
          subindustry_id: 'sub-1',
          subindustry_name: 'A',
        },
        {
          catalog_version_id: 'v2',
          catalog_version: '2.0.0',
          subindustry_id: 'sub-2',
          subindustry_name: 'B',
        },
      ],
      termRows: [],
    });
    const result = await loadApolloSubindustryCatalogTerms(client);
    assert.equal(result.resolution, null);
    assert.equal(result.failureReason, 'mixed_catalog_versions');
  });

  test('cada fallo se declara con su razón, nunca como «sin términos»', async () => {
    const catalogFail = await loadApolloSubindustryCatalogTerms(
      stubSupabase({ catalogError: true }).client,
    );
    assert.equal(catalogFail.failureReason, 'query_failed');

    const empty = await loadApolloSubindustryCatalogTerms(
      stubSupabase({ catalogRows: [] }).client,
    );
    assert.equal(empty.failureReason, 'empty_catalog');

    const termFail = await loadApolloSubindustryCatalogTerms(
      stubSupabase({
        catalogRows: PUBLISHED_CATALOG_ROWS as unknown as Record<string, unknown>[],
        termError: true,
      }).client,
    );
    assert.equal(termFail.failureReason, 'query_failed');

    const noTerms = await loadApolloSubindustryCatalogTerms(
      stubSupabase({
        catalogRows: PUBLISHED_CATALOG_ROWS as unknown as Record<string, unknown>[],
        termRows: [],
      }).client,
    );
    assert.equal(noTerms.failureReason, 'no_connected_terms');
  });
});

// ─── § 3: invariante de versión ───────────────────────────────────────────────

describe('§ 3 · selection_catalog_version == search_term_catalog_version', () => {
  test('misma versión ⇒ coherente', () => {
    const verdict = evaluateApolloCatalogVersionCoherence({
      selectionCatalogVersion: CATALOG_VERSION,
      resolution: PUBLISHED,
      requestedSubindustries: [SUPERMARKETS],
    });
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.reason, 'coherent');
    assert.equal(verdict.blockReason, null);
    assert.equal(verdict.termsCatalogVersionId, CATALOG_VERSION_ID);
  });

  test('versiones distintas ⇒ bloqueo con su copy, y NO se resuelve con la industria padre', () => {
    const verdict = evaluateApolloCatalogVersionCoherence({
      selectionCatalogVersion: '2.0.0',
      resolution: PUBLISHED,
      requestedSubindustries: [SUPERMARKETS],
    });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, 'version_mismatch');
    assert.equal(verdict.blockReason, APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_REASON);
    assert.equal(verdict.adminCopy, APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_COPY);
    assert.match(verdict.adminCopy ?? '', /No se consumieron créditos\./);
  });

  test('la ausencia es incoherencia, no permiso', () => {
    const noResolution = evaluateApolloCatalogVersionCoherence({
      selectionCatalogVersion: CATALOG_VERSION,
      resolution: null,
      requestedSubindustries: [SUPERMARKETS],
    });
    assert.equal(noResolution.allowed, false);
    assert.equal(noResolution.reason, 'terms_resolution_missing');

    const noSelection = evaluateApolloCatalogVersionCoherence({
      selectionCatalogVersion: null,
      resolution: PUBLISHED,
      requestedSubindustries: [SUPERMARKETS],
    });
    assert.equal(noSelection.allowed, false);
    assert.equal(noSelection.reason, 'selection_version_missing');
  });

  test('sin subindustrias pedidas no hay nada que cubrir ni comparar', () => {
    const verdict = evaluateApolloCatalogVersionCoherence({
      selectionCatalogVersion: null,
      resolution: null,
      requestedSubindustries: [],
    });
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.reason, 'no_subindustries_requested');
  });

  test('el veredicto es puro y no depende del orden de la solicitud', () => {
    const forward = evaluateApolloCatalogVersionCoherence({
      selectionCatalogVersion: '2.0.0',
      resolution: PUBLISHED,
      requestedSubindustries: [SUPERMARKETS, CYBERSECURITY],
    });
    const reverse = evaluateApolloCatalogVersionCoherence({
      selectionCatalogVersion: '2.0.0',
      resolution: PUBLISHED,
      requestedSubindustries: [CYBERSECURITY, SUPERMARKETS],
    });
    assert.deepEqual(forward, reverse);
  });

  test('el request efectivo lleva el veredicto, medido sobre los términos que redactaron el body', () => {
    const coherent = buildEffective();
    assert.equal(coherent.catalogVersionCoherence.allowed, true);
    assert.ok(coherent.effectiveKeywordTags.length > 0);

    const mismatch = buildEffective({ selectionCatalogVersion: '2.0.0' });
    assert.equal(mismatch.catalogVersionCoherence.allowed, false);
    assert.equal(mismatch.catalogVersionCoherence.reason, 'version_mismatch');
  });
});

// ─── § 3: el límite del dinero ────────────────────────────────────────────────

describe('§ 3 · una incoherencia de versión no llega al transporte', () => {
  const previousFlag = process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  before(() => {
    // El provider comprueba el flag de búsqueda de empresas antes que cualquier gate:
    // sin él la razón del skip sería la del flag y no la que se está probando.
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  });
  after(() => {
    if (previousFlag === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    else process.env.ENABLE_APOLLO_COMPANY_SEARCH = previousFlag;
  });

  async function runProvider(input: WebSearchInput) {
    let transportCalls = 0;
    let usageLogCalls = 0;
    const output = await runApolloOrganizationsSearch(input, 5, undefined, {
      fetchPage: async () => {
        transportCalls += 1;
        throw new Error('el transporte no debería alcanzarse');
      },
      logUsage: async () => {
        usageLogCalls += 1;
        return { kind: 'logged' as const };
      },
    });
    return { output, transportCalls, usageLogCalls };
  }

  test('versión distinta ⇒ skipped, 0 créditos, 0 llamadas, 0 filas económicas', async () => {
    const { output, transportCalls, usageLogCalls } = await runProvider(
      webSearchInput({ selectionCatalogVersion: '2.0.0' }),
    );

    assert.equal(transportCalls, 0, 'ninguna llamada a Apollo');
    assert.equal(usageLogCalls, 0, 'ninguna fila económica');
    assert.equal(output.skipped, true);
    assert.equal(output.skipReason, APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_REASON);
    assert.equal(output.estimatedCostUsd, 0);

    const metadata = output.metadata as Record<string, unknown>;
    assert.equal(metadata.note, APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_COPY);
    assert.equal((metadata.usage as Record<string, unknown>).credits_used, 0);
    assert.equal((metadata.usage as Record<string, unknown>).status, 'skipped');
    // La causa queda auditable con las DOS versiones, no con una nota genérica.
    assert.equal(metadata.selection_catalog_version, '2.0.0');
    assert.equal(metadata.search_term_catalog_version, CATALOG_VERSION);
    assert.equal(metadata.catalog_version_coherence_reason, 'version_mismatch');
  });

  test('sin resolución de términos tampoco se gasta', async () => {
    const { output, transportCalls, usageLogCalls } = await runProvider(
      webSearchInput({ subindustryCatalogTerms: null }),
    );
    assert.equal(transportCalls, 0);
    assert.equal(usageLogCalls, 0);
    assert.equal(output.skipped, true);
    assert.equal(output.skipReason, APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_REASON);
  });

  test('la incoherencia de versión se declara ANTES que la de cobertura', async () => {
    // Las dos condiciones a la vez: una subindustria sin términos Y otra versión.
    // Una cobertura perfecta sobre la versión equivocada sigue siendo la pregunta
    // equivocada, así que la versión es la razón que se reporta.
    const { output } = await runProvider(
      webSearchInput({
        subindustries: [SUPERMARKETS, 'Astilleros y Reparación Naval'],
        selectionCatalogVersion: '2.0.0',
      }),
    );
    assert.equal(output.skipReason, APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_REASON);
  });

  test('coherente y cubierta ⇒ el provider sí llega al transporte', async () => {
    let transportCalls = 0;
    await runApolloOrganizationsSearch(webSearchInput(), 5, undefined, {
      fetchPage: async () => {
        transportCalls += 1;
        return {
          kind: 'error' as const,
          status: 500,
          body: null,
          error: 'transporte doblado',
        } as never;
      },
      logUsage: async () => ({ kind: 'logged' as const }),
      sleep: async () => {},
    });
    assert.ok(transportCalls > 0, 'una corrida coherente no puede quedar bloqueada');
  });
});

// ─── § 6: deriva de catálogo ──────────────────────────────────────────────────

describe('§ 6 · un cambio de catálogo no se arrastra en silencio', () => {
  const previousFlag = process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  before(() => {
    // El provider comprueba el flag de búsqueda de empresas antes que cualquier gate:
    // sin él la razón del skip sería la del flag y no la que se está probando.
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  });
  after(() => {
    if (previousFlag === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    else process.env.ENABLE_APOLLO_COMPANY_SEARCH = previousFlag;
  });

  const V1 = buildApolloSubindustryCatalogTermsResolution({
    catalogVersion: '1.0.0',
    catalogVersionId: 'version-1',
    entries: [{ canonicalSubindustryId: 'sub-a', canonicalSubindustry: SYNTHETIC_A, terms: ['alpha'] }],
  });
  const V2 = buildApolloSubindustryCatalogTermsResolution({
    catalogVersion: '2.0.0',
    catalogVersionId: 'version-2',
    entries: [{ canonicalSubindustryId: 'sub-a', canonicalSubindustry: SYNTHETIC_A, terms: ['beta'] }],
  });

  test('con v2 disponible la consulta usa `beta`, nunca `alpha`', () => {
    const effective = buildEffective({
      industry: null,
      subindustries: [SYNTHETIC_A],
      subindustryCatalogTerms: V2,
      selectionCatalogVersion: '2.0.0',
    });
    assert.equal(effective.catalogVersionCoherence.allowed, true);
    assert.ok(effective.effectiveKeywordTags.includes('beta'));
    assert.ok(!effective.effectiveKeywordTags.includes('alpha'));
  });

  test('wizard=v2 + términos=v1 ⇒ bloqueo pre-gasto, jamás una llamada con `alpha`', async () => {
    const effective = buildEffective({
      industry: null,
      subindustries: [SYNTHETIC_A],
      subindustryCatalogTerms: V1,
      selectionCatalogVersion: '2.0.0',
    });
    assert.equal(effective.catalogVersionCoherence.allowed, false);
    assert.equal(effective.catalogVersionCoherence.reason, 'version_mismatch');

    let transportCalls = 0;
    const output = await runApolloOrganizationsSearch(
      webSearchInput({
        industry: null,
        subindustries: [SYNTHETIC_A],
        subindustryCatalogTerms: V1,
        selectionCatalogVersion: '2.0.0',
      }),
      5,
      undefined,
      {
        fetchPage: async () => {
          transportCalls += 1;
          throw new Error('el transporte no debería alcanzarse');
        },
        logUsage: async () => ({ kind: 'logged' as const }),
      },
    );
    assert.equal(transportCalls, 0);
    assert.equal(output.skipped, true);
    assert.equal(output.skipReason, APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_REASON);
  });

  test('el digest cambia cuando cambia un término: la deriva es detectable', () => {
    assert.notEqual(V1.sourceHash, V2.sourceHash);
    assert.equal(V1.sourceHash, hashApolloSubindustryCatalogTerms(V1.entries));
  });

  test('la serialización es canónica: mismo contenido, mismo digest, sin importar el orden de lectura', () => {
    const forward = buildApolloSubindustryCatalogTermsResolution({
      catalogVersion: '1.0.0',
      catalogVersionId: 'v',
      entries: [
        { canonicalSubindustryId: 'sub-a', canonicalSubindustry: SYNTHETIC_A, terms: ['alpha'] },
        { canonicalSubindustryId: 'sub-b', canonicalSubindustry: SYNTHETIC_B, terms: ['beta'] },
      ],
    });
    const reverse = buildApolloSubindustryCatalogTermsResolution({
      catalogVersion: '1.0.0',
      catalogVersionId: 'v',
      entries: [
        { canonicalSubindustryId: 'sub-b', canonicalSubindustry: SYNTHETIC_B, terms: ['beta'] },
        { canonicalSubindustryId: 'sub-a', canonicalSubindustry: SYNTHETIC_A, terms: ['alpha'] },
      ],
    });
    assert.equal(forward.sourceHash, reverse.sourceHash);
    assert.equal(
      serializeApolloSubindustryCatalogTerms(forward.entries),
      serializeApolloSubindustryCatalogTerms(reverse.entries),
    );
  });

  test('el ORDEN de los términos dentro de una subindustria sí cuenta: es la prioridad', () => {
    const a = buildApolloSubindustryCatalogTermsResolution({
      catalogVersion: '1.0.0',
      catalogVersionId: 'v',
      entries: [{ canonicalSubindustryId: 'sub-a', canonicalSubindustry: SYNTHETIC_A, terms: ['x', 'y'] }],
    });
    const b = buildApolloSubindustryCatalogTermsResolution({
      catalogVersion: '1.0.0',
      catalogVersionId: 'v',
      entries: [{ canonicalSubindustryId: 'sub-a', canonicalSubindustry: SYNTHETIC_A, terms: ['y', 'x'] }],
    });
    assert.notEqual(a.sourceHash, b.sourceHash);
  });

  test('una subindustria sin términos no entra en la resolución', () => {
    const resolution = buildApolloSubindustryCatalogTermsResolution({
      catalogVersion: '1.0.0',
      catalogVersionId: 'v',
      entries: [
        { canonicalSubindustryId: 'sub-a', canonicalSubindustry: SYNTHETIC_A, terms: [] },
        { canonicalSubindustryId: 'sub-b', canonicalSubindustry: SYNTHETIC_B, terms: ['  ', null] },
        { canonicalSubindustryId: 'sub-c', canonicalSubindustry: SYNTHETIC_C, terms: ['gamma'] },
      ],
    });
    assert.deepEqual(
      resolution.entries.map((entry) => entry.canonicalSubindustry),
      [SYNTHETIC_C],
    );
  });
});

// ─── § 5: qué term_type entra ─────────────────────────────────────────────────

describe('§ 5 · sólo `keyword`, y las 73 lo tienen', () => {
  test('el loader pide `keyword` y nada más', () => {
    const source = readFileSync(
      path.join(
        REPO_ROOT,
        'src',
        'server',
        'agents',
        'prospecting-toolkit',
        'apollo-subindustry-catalog-terms-loader.server.ts',
      ),
      'utf8',
    );
    assert.ok(source.includes("const CONNECTED_TERM_TYPE = 'keyword'"));
    // Los otros tres siguen fuera, y el contrato explica por qué cada uno.
    for (const excluded of ['query_phrase', 'exclusion_term', 'source_hint']) {
      assert.ok(
        !source.includes(`'${excluded}'`),
        `${excluded} no puede estar conectado en este addendum`,
      );
    }
    const contract = readFileSync(
      path.join(
        REPO_ROOT,
        'src',
        'server',
        'agents',
        'prospecting-toolkit',
        'apollo-subindustry-catalog-terms-resolution.ts',
      ),
      'utf8',
    );
    for (const excluded of ['query_phrase', 'exclusion_term', 'source_hint']) {
      assert.ok(contract.includes(excluded), `falta la razón declarada de excluir ${excluded}`);
    }
    assert.ok(contract.includes('{country}'), 'falta la razón del placeholder sin resolver');
  });

  test('73/73 subindustrias publicadas tienen al menos un `keyword`', () => {
    assert.equal(PUBLISHED.entries.length, 73);
    assert.equal(PUBLISHED.termType, 'keyword');
    assert.deepEqual(
      PUBLISHED.entries.filter((entry) => entry.terms.length === 0),
      [],
    );
  });
});

// ─── § 7: cobertura y precisión ───────────────────────────────────────────────

describe('§ 7 · discovery 73/73, precisión 2/73', () => {
  test('la auditoría sobre la versión publicada declara 73 cubiertas y 0 sin cubrir', () => {
    const audit = auditApolloSubindustryCatalogSearchCoverage({ resolution: PUBLISHED });
    assert.equal(audit.subindustriesTotal, 73);
    assert.equal(audit.queryCoveredSubindustries, 73);
    assert.equal(audit.queryUncoveredSubindustries, 0);
    assert.deepEqual(audit.uncoveredLabels, []);
  });

  test('los 73 nombres de la versión publicada son los del fixture congelado', () => {
    assert.deepEqual(
      PUBLISHED.entries.map((entry) => entry.canonicalSubindustry).sort(),
      [...SELLUP_ACTIVE_SUBINDUSTRY_NAMES].sort(),
    );
  });

  test('cubierta por catálogo NO significa mapeada para precisión', () => {
    // PHASE 2C — el ejemplo ya no puede ser «Ciberseguridad»: la Ola 1 le dio regla
    // de precisión. La propiedad que este test fija —`search_covered` y
    // `precision_mapped` son INDEPENDIENTES— sigue siendo cierta y sigue importando:
    // 73/73 tienen términos de búsqueda y sólo 11/73 tienen precisión. Se usa
    // «Formación Corporativa», que el § 21 mantiene deliberadamente sin mapeo.
    const PRECISION_UNMAPPED = 'Formación Corporativa y Corporate Training';
    const coverage = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: [PRECISION_UNMAPPED],
      catalogSearchTerms: PUBLISHED_LOOKUP,
    });
    assert.equal(coverage.entries[0].covered, true);
    assert.equal(resolveApolloSubindustrySearchMapping(PRECISION_UNMAPPED), null);

    const precision = assessApolloSubindustryPrecisionForRequest(
      {
        title: 'Empresa Cualquiera',
        url: 'https://ejemplo.com',
        snippet: 'formacion corporativa empresas',
        rank: 1,
        provider: 'apollo_organizations',
      } as WebSearchResult,
      [PRECISION_UNMAPPED],
    );
    assert.equal(precision.subindustryMapped, false);
    assert.notEqual(precision.subindustryMatch, 'confirmed');
    assert.equal(precision.matchedRequestedSubindustry, null);
  });

  test('la precisión sigue en 2 de 73, sin arrastrar ninguna otra', () => {
    const mapped = SELLUP_ACTIVE_SUBINDUSTRY_NAMES.filter(
      (name) => resolveApolloSubindustrySearchMapping(name) !== null,
    );
    assert.equal(mapped.length, 2);
  });
});

// ─── § 8: caps intactos ───────────────────────────────────────────────────────

describe('§ 8 · los topes no se mueven', () => {
  test('2 llamadas / 5 enrichments / 25 créditos, con 1 o con 5 subindustrias', () => {
    const budget = estimateApolloTwoRoundBudget({
      targetEligibleCompanies: 5,
      maxRounds: 2,
      maxResultsPerRound: 10,
      maxRawResultsPerRun: 20,
      maxEnrichmentsPerRun: 5,
    });
    assert.equal(budget.maximumInternalRecordedCredits, 25);
    assert.equal(MAX_SEARCH_ROUNDS_ABSOLUTE_MAX, 2);
    assert.equal(MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX, 5);

    const one = buildEffective({ subindustries: [CYBERSECURITY] });
    const five = buildEffective({
      subindustries: [
        CYBERSECURITY,
        'Legaltech',
        'Insurtech',
        'Agritech',
        'HRtech y Gestión del Talento',
      ],
    });
    assert.ok(one.effectiveKeywordTags.length <= 5);
    assert.ok(five.effectiveKeywordTags.length <= 5);
    // Un solo array de keywords: ni un parámetro por subindustria, ni una llamada
    // por subindustria.
    assert.equal(Array.isArray(five.body.q_organization_keyword_tags), true);
  });

  test('las 5 subindustrias quedan representadas dentro de las 5 posiciones', () => {
    const five = [
      CYBERSECURITY,
      'Legaltech',
      'Insurtech',
      'Agritech',
      'HRtech y Gestión del Talento',
    ];
    const { meta } = buildApolloOrganizationsSearchParams(
      {
        query: 'x',
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Tecnología',
        subindustries: five,
        subindustryCatalogTerms: PUBLISHED,
        selectionCatalogVersion: CATALOG_VERSION,
      },
      5,
    );
    assert.deepEqual(meta.query_uncovered_subindustries, []);
    assert.equal(meta.query_coverage_count, 5);
  });
});

// ─── § 9: metadata ────────────────────────────────────────────────────────────

describe('§ 9 · la corrida declara con qué catálogo se redactó', () => {
  test('procedencia, versión, digest y conteos, sin secretos', () => {
    const metadata = toApolloSubindustryCatalogTermsMetadata(PUBLISHED);
    assert.equal(metadata.catalog_terms_source, APOLLO_CATALOG_TERMS_SOURCE);
    assert.equal(metadata.catalog_terms_resolved, true);
    assert.equal(metadata.catalog_version_used, CATALOG_VERSION);
    assert.equal(metadata.catalog_version_id_used, CATALOG_VERSION_ID);
    assert.equal(metadata.catalog_terms_hash, CATALOG_TERMS_SOURCE_HASH);
    assert.equal(metadata.catalog_terms_term_type, 'keyword');
    assert.equal(metadata.catalog_terms_subindustry_count, 73);
    assert.equal(metadata.catalog_terms_total, 107);

    const serialized = JSON.stringify(metadata);
    assert.ok(!serialized.includes('api_key'));
    assert.ok(!serialized.includes('token'));
    assert.ok(!serialized.includes('service_role'));
  });

  test('sin resolución se declara como no resuelta, no como un campo ausente', () => {
    const metadata = toApolloSubindustryCatalogTermsMetadata(null);
    assert.equal(metadata.catalog_terms_resolved, false);
    assert.equal(metadata.catalog_version_used, null);
    assert.equal(metadata.catalog_terms_hash, null);
    assert.equal(metadata.catalog_terms_subindustry_count, 0);
  });

  test('el request efectivo publica las dos versiones y el veredicto', () => {
    const metadata = toApolloEffectiveRequestMetadata(buildEffective());
    assert.equal(metadata.selection_catalog_version, CATALOG_VERSION);
    assert.equal(metadata.search_term_catalog_version, CATALOG_VERSION);
    assert.equal(metadata.search_term_catalog_version_id, CATALOG_VERSION_ID);
    assert.equal(metadata.search_term_catalog_source_hash, CATALOG_TERMS_SOURCE_HASH);
    assert.equal(metadata.catalog_version_coherence_allowed, true);
    assert.equal(metadata.catalog_version_coherence_reason, 'coherent');
    assert.equal(metadata.catalog_version_coherence_block_reason, null);
  });

  test('la metadata de corrida sale del mismo input que redactó la consulta', () => {
    assert.deepEqual(
      toApolloCatalogTermsRunMetadata(webSearchInput()),
      toApolloSubindustryCatalogTermsMetadata(PUBLISHED),
    );
  });

  test('el veredicto de coherencia se serializa completo, incluido el bloqueo', () => {
    const metadata = toApolloCatalogVersionCoherenceMetadata(
      evaluateApolloCatalogVersionCoherence({
        selectionCatalogVersion: '2.0.0',
        resolution: PUBLISHED,
        requestedSubindustries: [SUPERMARKETS],
      }),
    );
    assert.equal(metadata.catalog_version_coherence_allowed, false);
    assert.equal(
      metadata.catalog_version_coherence_block_reason,
      APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_REASON,
    );
    assert.equal(metadata.selection_catalog_version, '2.0.0');
    assert.equal(metadata.search_term_catalog_version, CATALOG_VERSION);
  });
});

// ─── § 10: contratos previos ──────────────────────────────────────────────────

describe('§ 10 · PR #238 — el vocabulario de classification_source no se toca', () => {
  test('la CHECK de la migración 093 sigue con los 8 valores de quién clasificó', () => {
    const sql = readFileSync(
      path.join(
        REPO_ROOT,
        'supabase',
        'migrations',
        '093_add_record_origin_classification_to_prospect_candidates.sql',
      ),
      'utf8',
    );
    assert.ok(sql.includes('prospect_candidates_classification_source_check'));
    for (const value of [
      'writer',
      'derived_metadata',
      'derived_source_primary',
      'derived_review_notes',
      'derived_batch',
      'manual',
      'derived_status',
      'unknown',
    ]) {
      assert.ok(sql.includes(`'${value}'`), `falta "${value}" en la migración 093`);
    }
  });

  test('el catálogo se LEE: ninguna migración nueva toca subindustry_search_terms', () => {
    // La aserción no cuenta migraciones ni fija un número máximo: otras cadenas de
    // trabajo añaden las suyas constantemente y eso no tiene nada que ver con este
    // addendum. Lo que se afirma es más preciso — las ÚNICAS migraciones que
    // mencionan la tabla de términos siguen siendo las cuatro que la crearon,
    // endurecieron y sembraron. Este addendum no escribe en el catálogo: lo consulta.
    const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const touchingTermsTable = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .filter((file) =>
        readFileSync(path.join(migrationsDir, file), 'utf8').includes('subindustry_search_terms'),
      )
      .map((file) => file.slice(0, 3))
      .sort();

    assert.deepEqual(
      touchingTermsTable,
      ['057', '058', '059', '060'],
      'una migración nueva sobre subindustry_search_terms no pertenece a este addendum',
    );
  });
});

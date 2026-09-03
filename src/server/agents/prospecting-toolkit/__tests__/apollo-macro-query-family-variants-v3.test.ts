/**
 * apollo-macro-query-family-variants-v3.test.ts — FAMILIAS SEMÁNTICAS por macro
 * industria: la ronda 1 emite F1, la ronda 2 emite F2, y F2 arranca en la
 * página 1 de su propio universo.
 *
 * A1-APOLLO-QUERY-QUALITY-V3-A.
 *
 * ── Qué se está midiendo ─────────────────────────────────────────────────────
 *
 * Antes de este hito las dos rondas de una corrida macro redactaban el MISMO
 * plan de búsqueda: los mismos `specific` en el mismo orden ⇒ el mismo
 * `search_plan_fingerprint` ⇒ el mismo universo de paginación. La ronda 2 sólo
 * podía avanzar de página dentro del ranking que la ronda 1 ya había recorrido.
 *
 * Una familia parte la PREGUNTA, no la taxonomía: es un subconjunto declarado y
 * disjunto de `specific` que se emite solo. Dos familias ⇒ dos planes ⇒ dos
 * universos, y un universo nuevo empieza en la página 1.
 *
 * ── Los tres contratos que NO se tocan, y que esta suite vuelve a medir ──────
 *
 *   #380 BILLING     `per_page` sigue siendo el techo del contrato y el crédito
 *                    se sigue cobrando por página NO VACÍA, con la misma
 *                    `pricing_version`. La familia no toca ni una de las tres.
 *   #382 OWNERSHIP   `evaluateCompanyOwnership` no lee la consulta: su veredicto
 *                    es idéntico bajo F1 y bajo F2.
 *   #383 PAGINATION  `resolveApolloNextNetNewPage` sigue devolviendo «última
 *                    consumida por ESE plan + 1», y 1 para un plan del que no
 *                    consta consumo. Esta suite lo ejercita SIN modificar
 *                    `net-new-page-cursor.ts` ni el `max()` del orquestador: lo
 *                    que cambia es la hipótesis que lo alimenta.
 *
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MACRO_INDUSTRIES,
  MACRO_INDUSTRY_COUNT,
  macroIndustryQueryFamilyKeys,
  resolveMacroIndustryByDisplayName,
  resolveMacroIndustryQueryFamily,
  type MacroIndustryDefinition,
} from '@/modules/macro-industry-catalog/macro-industries';
import {
  buildMacroIndustryQueryPlan,
  MACRO_QUERY_MAX_BROAD_SHARE,
  MACRO_QUERY_MAX_BROAD_TERMS,
  MACRO_QUERY_MIN_SPECIFIC_FOR_BROAD,
  toMacroIndustryQueryMetadata,
} from '../apollo-macro-industry-query-terms';
import { buildApolloOrganizationsEffectiveRequest } from '../apollo-organizations-effective-request';
import { APOLLO_CONTRACT_MAX_PER_PAGE } from '../apollo-organizations-pagination-budget';
import {
  APOLLO_PRICING_VERSION,
  APOLLO_BILLABLE_UNIT,
  creditsForApolloNonEmptyPages,
} from '../apollo-operation-pricing';
import { evaluateCompanyOwnership } from '../company-ownership-gate';
import {
  buildApolloRoundProviderFingerprint,
  buildRound1Hypothesis,
  buildRound2Hypothesis,
  type ApolloTwoRoundQueryContext,
  type ApolloTwoRoundQueryHypothesis,
} from '../apollo-two-round/query-hypothesis';
import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
} from '../apollo-two-round/orchestrator';
import {
  EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS,
  resolveApolloNextNetNewPage,
  withApolloSearchPlanPageConsumption,
} from '../apollo-two-round/net-new-page-cursor';
import {
  orgs,
  rejectedAssessment,
  testConfig,
  testCorrelation,
} from '../apollo-two-round/__tests__/fixtures';
import type { WebSearchInput } from '../types';

// ─── Utilidades ───────────────────────────────────────────────────────────────

/** La MISMA normalización que el catálogo macro y el contrato del proveedor. */
function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Amplios que EFECTIVAMENTE viajan en la familia que los lleva.
 *
 * Se deriva del tope del § 15 en vez de copiarlo: si mañana el tope cambia, esta
 * suite mide el tope nuevo, no uno congelado que ya no rige.
 */
function travellingBroadTerms(definition: MacroIndustryDefinition): string[] {
  return [...definition.discovery.broad].slice(0, MACRO_QUERY_MAX_BROAD_TERMS);
}

/**
 * ¿Un amplio ABSORBE a un término específico?
 *
 * Sí cuando el específico contiene al amplio: buscar `logistics` ya devuelve todo
 * lo que devolvería `third party logistics`, así que en la misma consulta el
 * específico es INERTE. Es exactamente el modo de fallo del retest de Salud que
 * el § 15 cierra, medido sobre los términos en vez de sobre los resultados.
 */
function isAbsorbedByBroad(term: string, broadTerms: readonly string[]): boolean {
  const normalized = norm(term);
  return broadTerms.some((broad) => normalized.includes(norm(broad)));
}

/**
 * Amplios que la PRIMERA familia puede admitir sin que dominen la consulta.
 *
 * Se despeja de la propia cuota (`b / (s + b) <= SHARE`) en vez de copiarse: una
 * constante repetida aquí congelaría el valor y dejaría de medir la regla.
 */
function expectedBroadAllowance(specificCount: number): number {
  return Math.max(
    0,
    Math.min(
      MACRO_QUERY_MAX_BROAD_TERMS,
      Math.floor((specificCount * MACRO_QUERY_MAX_BROAD_SHARE) / (1 - MACRO_QUERY_MAX_BROAD_SHARE)),
    ),
  );
}

const CO_SPAIN_COUNTRY_TERMS = ['colombia', 'co', 'bogota', 'bogotá'];

/**
 * Corrida macro con la versión del catálogo v2 — la que activa la taxonomía.
 *
 * 🔴 V3-A-FIX § 2 — FIDELIDAD DEL ARNÉS.
 *
 * `additionalCriteriaTokens` es un PARÁMETRO, nunca `[]` fijo. Producción no
 * manda una lista vacía: `production-runner.server.ts` manda
 * `hypothesis.queryParameters.keywordTags` (las etiquetas que el catálogo
 * sectorial redactó para ESA ronda), y son ellas las que hacen que dos rondas de
 * familias distintas compartan términos efectivos. Con `[]` la suite medía un
 * cableado que no existe y el solapamiento de Retail no aparecía nunca.
 *
 * Las secciones A–D siguen pasando `[]` a propósito: miden propiedades del
 * CATÁLOGO y de la redacción por familia, donde el wizard no aporta criterios.
 * La sección E, que es la que ejercita la decisión de página del orquestador,
 * pasa las etiquetas reales de la hipótesis — igual que producción.
 */
function macroSearchInput(
  definition: MacroIndustryDefinition,
  variantKey: string | null,
  additionalCriteriaTokens: readonly string[] = [],
): WebSearchInput {
  return {
    query: `descubrimiento ${definition.key}`,
    country: 'Colombia',
    countryCode: 'CO',
    industry: definition.displayName,
    intent: 'company_discovery',
    maxResults: 5,
    provider: 'apollo_organizations',
    subindustries: [],
    selectionCatalogVersion: '2.0.0',
    additionalCriteriaTokens: [...additionalCriteriaTokens],
    macroQueryVariantKey: variantKey,
  };
}

function effectiveRequest(definition: MacroIndustryDefinition, variantKey: string | null) {
  return buildApolloOrganizationsEffectiveRequest({
    input: macroSearchInput(definition, variantKey),
    requestedMaxResults: 5,
    resultLimitMode: 'two_round',
    twoRoundMaxResultsPerRound: 5,
    startPage: 1,
    legacyMaxResultsPerQuery: 3,
  });
}

// ─── A · El catálogo declara familias emitibles ───────────────────────────────

describe('V3-A · A. las 12 macro industrias declaran familias emitibles', () => {
  test('1 — las 12 macro industrias tienen al menos dos familias', () => {
    assert.equal(MACRO_INDUSTRIES.length, MACRO_INDUSTRY_COUNT);
    for (const definition of MACRO_INDUSTRIES) {
      const families = definition.discovery.families ?? [];
      assert.ok(
        families.length >= 2,
        `${definition.key} declara ${families.length} familia(s); una sola no parte nada`,
      );
    }
  });

  test('2 — cada familia lleva al menos 4 términos', () => {
    for (const definition of MACRO_INDUSTRIES) {
      for (const family of definition.discovery.families ?? []) {
        assert.ok(
          family.terms.length >= 4,
          `${definition.key}/${family.key} tiene ${family.terms.length} términos`,
        );
      }
    }
  });

  test('2b — la primera familia alcanza el mínimo que autoriza amplios', () => {
    // § 15 — por debajo de este umbral el redactor RETIENE los amplios. Una F1
    // que no lo alcanzara emitiría una consulta distinta de la que se calibró.
    for (const definition of MACRO_INDUSTRIES) {
      const first = (definition.discovery.families ?? [])[0];
      assert.ok(first, `${definition.key} no declara familias`);
      assert.ok(
        first.terms.length >= MACRO_QUERY_MIN_SPECIFIC_FOR_BROAD,
        `${definition.key}/${first.key} tiene ${first.terms.length} términos y no autorizaría amplios`,
      );
    }
  });

  test('3 — las familias de una macro industria son disjuntas', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const seen = new Map<string, string>();
      for (const family of definition.discovery.families ?? []) {
        for (const term of family.terms) {
          const key = norm(term);
          const owner = seen.get(key);
          assert.equal(
            owner,
            undefined,
            `${definition.key}: «${term}» está en ${owner} y en ${family.key}`,
          );
          seen.set(key, family.key);
        }
      }
    }
  });

  test('3b — ninguna familia inventa vocabulario: sus términos salen de `specific`', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const specific = new Set(definition.discovery.specific.map(norm));
      for (const family of definition.discovery.families ?? []) {
        for (const term of family.terms) {
          assert.ok(
            specific.has(norm(term)),
            `${definition.key}/${family.key}: «${term}» no está en discovery.specific`,
          );
        }
      }
    }
  });

  test('3c — las familias particionan `specific` por completo', () => {
    // Un término que no cae en ninguna familia dejaría de viajar en TODA corrida
    // con variante: una pérdida de cobertura silenciosa.
    for (const definition of MACRO_INDUSTRIES) {
      const covered = new Set(
        (definition.discovery.families ?? []).flatMap((family) => family.terms.map(norm)),
      );
      const orphans = definition.discovery.specific.filter((term) => !covered.has(norm(term)));
      assert.deepEqual(orphans, [], `${definition.key} deja términos sin familia`);
    }
  });

  test('25 — la familia que lleva amplios no contiene términos que el amplio absorbe', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const families = definition.discovery.families ?? [];
      const broadTerms = travellingBroadTerms(definition);
      const first = families[0];
      assert.ok(first);
      for (const term of first.terms) {
        assert.equal(
          isAbsorbedByBroad(term, broadTerms),
          false,
          `${definition.key}/${first.key}: «${term}» es inerte bajo ${JSON.stringify(broadTerms)}`,
        );
      }
    }
  });

  test('25b — las claves de familia son únicas dentro de su macro industria', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const keys = macroIndustryQueryFamilyKeys(definition);
      assert.equal(new Set(keys).size, keys.length, `${definition.key} repite claves de familia`);
    }
  });
});

// ─── B · El redactor emite una familia por vez ────────────────────────────────

describe('V3-A · B. el redactor emite una familia por vez', () => {
  test('4 — F1 y F2 producen `effectiveKeywords` distintos en las 12', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const [f1, f2] = macroIndustryQueryFamilyKeys(definition);
      const planF1 = buildMacroIndustryQueryPlan({ definition, variantKey: f1 });
      const planF2 = buildMacroIndustryQueryPlan({ definition, variantKey: f2 });
      assert.notDeepEqual(
        planF1.effectiveKeywords,
        planF2.effectiveKeywords,
        `${definition.key}: F1 y F2 emiten la misma consulta`,
      );
      // Y no sólo «distintos»: sin un solo término específico en común. Un término
      // compartido bastaría para que la página 1 volviera a caer sobre el mismo
      // ranking (SCALE-SECOND-ROUND-FIX-1B).
      const f1Specific = new Set(planF1.coverage.coveringSpecificTerms.map(norm));
      for (const term of planF2.coverage.coveringSpecificTerms) {
        assert.equal(f1Specific.has(norm(term)), false, `${definition.key}: «${term}» en las dos`);
      }
    }
  });

  test('5 — fingerprint(F1) !== fingerprint(F2) !== fingerprint(sin variante)', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const [f1, f2] = macroIndustryQueryFamilyKeys(definition);
      const prints = new Set([
        buildMacroIndustryQueryPlan({ definition }).fingerprint,
        buildMacroIndustryQueryPlan({ definition, variantKey: f1 }).fingerprint,
        buildMacroIndustryQueryPlan({ definition, variantKey: f2 }).fingerprint,
      ]);
      assert.equal(prints.size, 3, `${definition.key}: huellas colisionadas`);
    }
  });

  test('6 — la misma variante construida dos veces produce la misma huella', () => {
    for (const definition of MACRO_INDUSTRIES) {
      for (const key of macroIndustryQueryFamilyKeys(definition)) {
        const a = buildMacroIndustryQueryPlan({ definition, variantKey: key });
        const b = buildMacroIndustryQueryPlan({ definition, variantKey: key });
        assert.equal(a.fingerprint, b.fingerprint);
        assert.deepEqual(a.effectiveKeywords, b.effectiveKeywords);
      }
    }
  });

  test('24 — la primera familia lleva amplios y las posteriores NO', () => {
    // 🔴 Ésta es la regla que el test de mutación invierte. Si el redactor
    // admitiera amplios en una variante posterior, o los retuviera en la primera,
    // estas dos aserciones caen.
    for (const definition of MACRO_INDUSTRIES) {
      const keys = macroIndustryQueryFamilyKeys(definition);
      const first = buildMacroIndustryQueryPlan({ definition, variantKey: keys[0] });
      const allowance = expectedBroadAllowance(first.coverage.specificTermCount);
      assert.ok(allowance >= 1, `${definition.key}/${keys[0]} no admitiría ni un amplio`);
      assert.equal(first.broadTermAllowance, allowance);
      assert.deepEqual(
        first.admittedBroadTerms,
        travellingBroadTerms(definition)
          .slice(0, allowance)
          .map((term) => norm(term)),
        `${definition.key}/${keys[0]} debía llevar los amplios calibrados`,
      );
      // Y la cuota se respeta MEDIDA sobre lo que viaja: es la condición que
      // autoriza el gasto de la variante (`queryCoverageComplete`).
      assert.ok(first.coverage.broadTermShare <= MACRO_QUERY_MAX_BROAD_SHARE);
      assert.equal(first.coverage.complete, true);

      for (const key of keys.slice(1)) {
        const later = buildMacroIndustryQueryPlan({ definition, variantKey: key });
        assert.deepEqual(later.admittedBroadTerms, [], `${definition.key}/${key} admitió amplios`);
        assert.equal(later.broadTermAllowance, 0);
        assert.deepEqual(
          later.withheldBroadTerms.map((entry) => entry.reason),
          later.broadTerms.map(() => 'variant_family_excludes_broad'),
          `${definition.key}/${key} publicó un motivo que no es el de la variante`,
        );
        assert.equal(later.coverage.broadTermShare, 0);
        assert.equal(later.coverage.complete, true);
      }
    }
  });

  test('11 — una macro industria SIN familias conserva el comportamiento anterior', () => {
    // El fallback se ejercita sobre una definición sin `families`, construida a
    // partir de una real: es el estado de una macro industria a medio migrar.
    const real = MACRO_INDUSTRIES[0];
    const unmigrated: MacroIndustryDefinition = {
      ...real,
      discovery: {
        specific: real.discovery.specific,
        broad: real.discovery.broad,
        exclusions: real.discovery.exclusions,
      },
    };

    const baseline = buildMacroIndustryQueryPlan({ definition: unmigrated });
    for (const variantKey of [null, 'logistics_operations', 'clave_inventada']) {
      const plan = buildMacroIndustryQueryPlan({ definition: unmigrated, variantKey });
      assert.deepEqual(plan.effectiveKeywords, baseline.effectiveKeywords);
      assert.equal(plan.fingerprint, baseline.fingerprint);
      assert.equal(plan.macroQueryVariantKey, null);
      assert.deepEqual(plan.macroQueryFamiliesAvailable, []);
    }
  });

  test('11b — una clave desconocida en una macro MIGRADA no estrecha la consulta', () => {
    const definition = MACRO_INDUSTRIES[1];
    const baseline = buildMacroIndustryQueryPlan({ definition });
    const unknown = buildMacroIndustryQueryPlan({ definition, variantKey: 'no_existe' });
    assert.deepEqual(unknown.effectiveKeywords, baseline.effectiveKeywords);
    assert.equal(unknown.fingerprint, baseline.fingerprint);
    assert.equal(unknown.macroQueryVariantKey, null);
    // Pero la observabilidad SÍ declara que había familias que elegir: es lo que
    // separa «no está migrada» de «se pidió una clave que no existe».
    assert.ok(unknown.macroQueryFamiliesAvailable.length >= 2);
  });

  test('16 — las exclusiones nunca entran en la consulta, con variante o sin ella', () => {
    for (const definition of MACRO_INDUSTRIES) {
      for (const variantKey of [null, ...macroIndustryQueryFamilyKeys(definition)]) {
        const plan = buildMacroIndustryQueryPlan({ definition, variantKey });
        const emitted = new Set(plan.effectiveKeywords.map(norm));
        for (const exclusion of plan.exclusionTerms) {
          assert.equal(
            emitted.has(norm(exclusion)),
            false,
            `${definition.key}/${variantKey}: exclusión «${exclusion}» viajó`,
          );
        }
        const metadata = toMacroIndustryQueryMetadata(plan);
        assert.equal(metadata['macro_industry_exclusions_sent_to_provider'], false);
        assert.equal(metadata['macro_query_variant_key'], plan.macroQueryVariantKey);
        assert.deepEqual(
          metadata['macro_query_families_available'],
          plan.macroQueryFamiliesAvailable,
        );
      }
    }
  });
});

// ─── C · La hipótesis reparte las familias entre las rondas ───────────────────

function macroContext(
  definition: MacroIndustryDefinition,
  overrides: Partial<ApolloTwoRoundQueryContext> = {},
): ApolloTwoRoundQueryContext {
  return {
    country: 'Colombia',
    countryCode: 'CO',
    sector: definition.displayName,
    subindustries: [],
    macroQueryFamilies: macroIndustryQueryFamilyKeys(definition),
    ...overrides,
  };
}

describe('V3-A · C. la hipótesis reparte las familias entre las rondas', () => {
  test('7 — la ronda 1 emite F1 en las 12 macro industrias', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const round1 = buildRound1Hypothesis(macroContext(definition), 5);
      assert.equal(round1.macroQueryVariantKey, macroIndustryQueryFamilyKeys(definition)[0]);
      assert.equal(round1.queryParameters.page, 1);
    }
  });

  test('8 y 9 — la ronda 2 emite F2, como variante de términos, en la página 1', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const context = macroContext(definition);
      const round2 = buildRound2Hypothesis(
        context,
        {
          remainingTarget: 5,
          excludedSeenOrganizationCount: 3,
          observedRejectionReasons: [],
          // El proveedor declara 52 páginas: `same_query_next_page` sería
          // elegible. La familia gana ANTES de llegar a esa rama.
          providerTotalPages: 52,
        },
        5,
      );
      assert.equal(round2.macroQueryVariantKey, macroIndustryQueryFamilyKeys(definition)[1]);
      assert.equal(round2.variantStrategy, 'alternative_specific_terms');
      assert.equal(round2.queryParameters.page, 1);
      assert.ok((round2.queryAdaptationReason ?? '').includes('familia_semantica_alternativa'));
    }
  });

  test('9b — la ronda 2 con familia nueva no hereda las etiquetas de la ronda 1', () => {
    // Retail es el caso peligroso: su nombre visible SÍ resuelve en
    // `SECTOR_SIGNAL_CATALOG`, así que la ronda 1 lleva etiquetas. Heredarlas
    // haría que las dos rondas compartieran keywords efectivos y el suelo de
    // página 2 de SCALE-SECOND-ROUND-FIX-1B se activara sobre un plan nuevo.
    const definition = resolveMacroIndustryByDisplayName('Retail');
    assert.ok(definition);
    const context = macroContext(definition);
    const round1 = buildRound1Hypothesis(context, 5);
    const round2 = buildRound2Hypothesis(
      context,
      {
        remainingTarget: 5,
        excludedSeenOrganizationCount: 0,
        observedRejectionReasons: [],
        providerTotalPages: 52,
      },
      5,
    );
    assert.ok(round1.queryParameters.keywordTags.length > 0, 'la ronda 1 debía traer etiquetas');
    const round1Keys = new Set(round1.queryParameters.keywordTags.map(norm));
    for (const tag of round2.queryParameters.keywordTags) {
      assert.equal(round1Keys.has(norm(tag)), false, `«${tag}» se heredó de la ronda 1`);
    }
    assert.equal(round2.queryParameters.page, 1);
  });

  test('11c — sin familias, las dos rondas se redactan como antes del hito', () => {
    const legacy: ApolloTwoRoundQueryContext = {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Retail y Consumo',
      subindustries: ['Supermercados e Hipermercados'],
      targetLocations: ['Bogotá'],
      employeeRanges: ['201,500'],
    };
    const round1 = buildRound1Hypothesis(legacy, 5);
    const round2 = buildRound2Hypothesis(
      legacy,
      {
        remainingTarget: 5,
        excludedSeenOrganizationCount: 0,
        observedRejectionReasons: [],
        providerTotalPages: 52,
      },
      5,
    );
    assert.equal(round1.macroQueryVariantKey, null);
    assert.equal(round2.macroQueryVariantKey, null);
    assert.deepEqual(round2.macroQueryFamiliesAvailable, []);
    // La cadena de siempre: sinónimos controlados ⇒ variante de términos.
    assert.equal(round2.variantStrategy, 'alternative_specific_terms');
    assert.equal(
      (round2.queryAdaptationReason ?? '').includes('familia_semantica_alternativa'),
      false,
    );
  });
});

// ─── D · El body efectivo REAL ────────────────────────────────────────────────

describe('V3-A · D. el body efectivo real de cada familia', () => {
  test('5b — el plan de búsqueda (huella SIN página) difiere entre F1 y F2', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const [f1, f2] = macroIndustryQueryFamilyKeys(definition);
      const a = effectiveRequest(definition, f1);
      const b = effectiveRequest(definition, f2);
      assert.notEqual(
        a.filtersFingerprint,
        b.filtersFingerprint,
        `${definition.key}: F1 y F2 comparten plan de búsqueda`,
      );
      assert.notEqual(a.effectiveRequestFingerprint, b.effectiveRequestFingerprint);
    }
  });

  test('14 — `organization_locations` sigue conteniendo el país', () => {
    for (const definition of MACRO_INDUSTRIES) {
      for (const variantKey of [null, ...macroIndustryQueryFamilyKeys(definition)]) {
        const effective = effectiveRequest(definition, variantKey);
        assert.ok(
          effective.effectiveLocations.some((location) => norm(location) === 'colombia'),
          `${definition.key}/${variantKey}: el país no viaja en las ubicaciones`,
        );
        assert.deepEqual(effective.body.organization_locations, effective.effectiveLocations);
      }
    }
  });

  test('15 — ningún término de país entra en los keyword tags', () => {
    for (const definition of MACRO_INDUSTRIES) {
      for (const variantKey of [null, ...macroIndustryQueryFamilyKeys(definition)]) {
        const effective = effectiveRequest(definition, variantKey);
        for (const tag of effective.effectiveKeywordTags) {
          assert.equal(
            CO_SPAIN_COUNTRY_TERMS.includes(norm(tag)),
            false,
            `${definition.key}/${variantKey}: «${tag}» es un término de país`,
          );
        }
      }
    }
  });

  test('16b — las exclusiones del catálogo no aparecen en el body', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const exclusions = new Set(definition.discovery.exclusions.map(norm));
      for (const variantKey of macroIndustryQueryFamilyKeys(definition)) {
        const effective = effectiveRequest(definition, variantKey);
        for (const tag of effective.body.q_organization_keyword_tags ?? []) {
          assert.equal(exclusions.has(norm(tag)), false, `${definition.key}: «${tag}» excluido`);
        }
      }
    }
  });

  test('17 — `per_page` sigue siendo el techo del contrato bajo toda variante', () => {
    assert.equal(APOLLO_CONTRACT_MAX_PER_PAGE, 100);
    for (const definition of MACRO_INDUSTRIES) {
      for (const variantKey of [null, ...macroIndustryQueryFamilyKeys(definition)]) {
        const effective = effectiveRequest(definition, variantKey);
        assert.equal(effective.perPage, 100);
        assert.equal(effective.body.per_page, 100);
        assert.equal(effective.page, 1);
      }
    }
  });

  test('la familia viaja hasta el plan macro del request efectivo', () => {
    const definition = MACRO_INDUSTRIES[0];
    const [f1, f2] = macroIndustryQueryFamilyKeys(definition);
    for (const variantKey of [f1, f2]) {
      const effective = effectiveRequest(definition, variantKey);
      assert.equal(effective.macroIndustryRequest.mode, 'macro_industry');
      const plan =
        effective.macroIndustryRequest.mode === 'macro_industry'
          ? effective.macroIndustryRequest.plan
          : null;
      assert.equal(plan?.macroQueryVariantKey, variantKey);
      assert.equal(effective.macroIndustryBootstrapPreconditions.catalogTermsResolved, true);
      assert.equal(effective.macroIndustryBootstrapPreconditions.queryCoverageComplete, true);
    }
  });
});

// ─── E · El orquestador · la ronda 2 arranca en la página 1 ───────────────────

type SpyDeps = {
  deps: ApolloTwoRoundDeps;
  searchCalls: Array<{
    roundNumber: number;
    page: number;
    plan: string;
    variantKey: string | null;
    /** V3-A-FIX § 2 — lo que el body EFECTIVO de esa ronda llevó realmente. */
    effectiveKeywords: string[];
  }>;
  providerCallCount: () => number;
  usageLogWrites: () => number;
};

/**
 * Dependencias que atraviesan el constructor de request efectivo REAL.
 *
 * `buildRoundProviderRequest` hace lo mismo que producción: mete
 * `hypothesis.macroQueryVariantKey` en el `WebSearchInput` y deja que el mapper
 * redacte. Así el `searchPlanFingerprint` que el cursor de #383 lee es el de
 * verdad, no uno declarado por el test.
 *
 * `searchRound` NO llama a Apollo: cuenta la llamada y devuelve organizaciones
 * sintéticas. Cero créditos, cero filas de uso.
 */
function macroSpyDeps(definition: MacroIndustryDefinition, providerTotalPages: number): SpyDeps {
  const searchCalls: SpyDeps['searchCalls'] = [];
  let providerCalls = 0;
  const usageLogs: unknown[] = [];

  /**
   * 🔴 El MISMO `WebSearchInput` que arma `production-runner.server.ts`.
   *
   * Los tres campos que deciden la redacción salen de la hipótesis, no del test:
   * la familia (`macroQueryVariantKey`), la página, y —lo que faltaba— las
   * etiquetas (`additionalCriteriaTokens: hypothesis.queryParameters.keywordTags`).
   * Sin la tercera, la suite construía un body que producción nunca emite.
   */
  const planFor = (hypothesis: ApolloTwoRoundQueryHypothesis, page: number) =>
    buildApolloOrganizationsEffectiveRequest({
      input: macroSearchInput(
        definition,
        hypothesis.macroQueryVariantKey,
        hypothesis.queryParameters.keywordTags,
      ),
      requestedMaxResults: 5,
      resultLimitMode: 'two_round',
      twoRoundMaxResultsPerRound: 5,
      startPage: page,
      legacyMaxResultsPerQuery: 3,
    });

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: ({ hypothesis }) => {
      const effective = planFor(hypothesis, hypothesis.queryParameters.page);
      return {
        effectiveRequestFingerprint: effective.effectiveRequestFingerprint,
        searchPlanFingerprint: effective.filtersFingerprint,
        page: effective.page,
        perPage: effective.perPage,
        effectiveKeywordTags: effective.effectiveKeywordTags,
        // 🔴 Igual que producción: la familia que el redactor RESOLVIÓ, no la
        // que la hipótesis pidió. Una clave desconocida resuelve a `null`.
        macroQueryResolvedVariantKey:
          effective.macroIndustryRequest.mode === 'macro_industry'
            ? (effective.macroIndustryRequest.plan?.macroQueryVariantKey ?? null)
            : null,
      };
    },
    searchRound: async ({ roundNumber, hypothesis }) => {
      providerCalls += 1;
      const page = hypothesis.queryParameters.page;
      const effective = planFor(hypothesis, page);
      searchCalls.push({
        roundNumber,
        page,
        plan: effective.filtersFingerprint,
        variantKey: hypothesis.macroQueryVariantKey,
        effectiveKeywords: [...effective.effectiveKeywordTags],
      });
      return {
        organizations: orgs(`r${roundNumber}-`, 3),
        providerRequestCount: 1,
        // 🔴 Cero créditos: este doble no cobra nada porque no llama a nadie.
        internalRecordedCredits: 0,
        providerTotalPages,
        consumedPages: {
          searchPlanFingerprint: effective.filtersFingerprint,
          consumedPages: [page],
          lastConsumedPage: page,
        },
      };
    },
    // Todo se descarta: el objetivo nunca se alcanza y la ronda 2 se decide sólo
    // por el criterio de página.
    assessCandidate: () => rejectedAssessment('sector_not_mapped'),
    enrichCandidate: async () => ({
      executed: false,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      internalRecordedCredits: 0,
    }),
  };

  return {
    deps,
    searchCalls,
    providerCallCount: () => providerCalls,
    usageLogWrites: () => usageLogs.length,
  };
}

/**
 * Corre las dos rondas con el arnés fiel y devuelve la decisión de página.
 *
 * Un solo sitio construye la corrida, así que todos los escenarios de la
 * sección G miden EL MISMO cableado: el de `production-runner.server.ts`.
 */
async function runFamilyScenario(
  definition: MacroIndustryDefinition,
  context: ApolloTwoRoundQueryContext,
  providerTotalPages = 52,
) {
  const spy = macroSpyDeps(definition, providerTotalPages);
  const result = await runApolloTwoRoundDiscovery(
    { config: testConfig(), queryContext: context, correlation: testCorrelation() },
    spy.deps,
  );
  return { spy, result, decision: result.round2PageDecision };
}

describe('V3-A · E. la ronda 2 estrena universo y arranca en la página 1', () => {
  test('9c, 10 y 12 — R1=F1 página 1, R2=F2 página 1, y el cursor de F1 no se hereda', async () => {
    for (const definition of MACRO_INDUSTRIES) {
      const [f1, f2] = macroIndustryQueryFamilyKeys(definition);
      const spy = macroSpyDeps(definition, 52);

      const result = await runApolloTwoRoundDiscovery(
        {
          config: testConfig(),
          queryContext: macroContext(definition),
          correlation: testCorrelation(),
        },
        spy.deps,
      );

      assert.equal(spy.searchCalls.length, 2, `${definition.key}: no corrieron las dos rondas`);
      const [round1, round2] = spy.searchCalls;

      assert.equal(round1.variantKey, f1);
      assert.equal(round1.page, 1);
      assert.equal(round2.variantKey, f2);
      // 10 — el `max()` NO salta la página 1: la hipótesis pide 1, el suelo de
      // solapamiento no se activa (no hay keywords compartidos) y el cursor del
      // plan nuevo devuelve 1.
      assert.equal(round2.page, 1, `${definition.key}: la ronda 2 se saltó la página 1`);

      // 12 — dos planes distintos: el cursor de A no puede alcanzar a B.
      assert.notEqual(round1.plan, round2.plan);
      assert.equal(result.round2PageDecision?.netNewCursorPage, 1);
      assert.equal(result.round2PageDecision?.advancedByNetNewCursor, false);
      assert.equal(result.round2PageDecision?.escalatedToPage2, false);
      assert.equal(result.round2PageDecision?.netNewCursorPlanFingerprint, round2.plan);

      /**
       * 🔴 V3-A-FIX § 1 — lo que esta aserción NO puede exigir.
       *
       * Con el arnés fiel, `escalationReason` ya no es `null` en todas las macro
       * industrias: donde el sector SÍ tiene señales en `SECTOR_SIGNAL_CATALOG`
       * (Retail), las etiquetas que producción manda como
       * `additionalCriteriaTokens` dejan términos efectivos compartidos entre F1
       * y F2. El solapamiento es real y se declara.
       *
       * Lo invariante es la PÁGINA: exista o no solapamiento, una familia nueva
       * estrena universo y arranca en la 1. Cuando el solapamiento existe, la
       * causa de que no moviera la página queda dicha en
       * `round2OpensNewFamilyUniverse`.
       */
      const decision = result.round2PageDecision;
      assert.ok(decision);
      if (decision.sharedEffectiveKeywords.length > 0) {
        assert.equal(decision.escalationReason, 'overlapping_effective_keywords');
        assert.equal(
          decision.round2OpensNewFamilyUniverse,
          true,
          `${definition.key}: hubo solapamiento y NO se declaró universo nuevo`,
        );
      } else {
        assert.equal(decision.escalationReason, null);
      }

      // 21 y 22 — dos llamadas al doble, cero llamadas reales, cero créditos.
      assert.equal(spy.providerCallCount(), 2);
      assert.equal(result.runMetrics.totalSearchCredits, 0);
      assert.equal(result.runMetrics.totalEnrichmentCredits, 0);
      // 23 — el doble no escribe filas de uso.
      assert.equal(spy.usageLogWrites(), 0);
    }
  });

  test('12b — el cursor de un plan MUY avanzado no arrastra al plan de la otra familia', () => {
    // Se mide directamente sobre #383, sin tocarlo: el plan A queda consumido
    // hasta la 40 y el plan B —el de F2— sigue arrancando en la 1.
    const definition = MACRO_INDUSTRIES[0];
    const [f1, f2] = macroIndustryQueryFamilyKeys(definition);
    const planA = effectiveRequest(definition, f1).filtersFingerprint;
    const planB = effectiveRequest(definition, f2).filtersFingerprint;

    const cursors = withApolloSearchPlanPageConsumption(EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS, {
      searchPlanFingerprint: planA,
      lastConsumedPage: 40,
    });

    assert.equal(resolveApolloNextNetNewPage(cursors, planA), 41);
    assert.equal(resolveApolloNextNetNewPage(cursors, planB), 1);
  });

  test('13 — el contrato de #383 sigue vigente, sin modificarlo', () => {
    // «next page = última consumida por ESE fingerprint + 1»; un plan sin consumo
    // registrado devuelve 1; un fingerprint ausente no inventa cursor.
    const cursors = withApolloSearchPlanPageConsumption(EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS, {
      searchPlanFingerprint: 'plan-a',
      lastConsumedPage: 4,
    });
    assert.equal(resolveApolloNextNetNewPage(cursors, 'plan-a'), 5);
    assert.equal(resolveApolloNextNetNewPage(cursors, 'plan-b'), 1);
    assert.equal(resolveApolloNextNetNewPage(cursors, null), 1);
    assert.equal(
      resolveApolloNextNetNewPage(EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS, 'plan-a'),
      1,
    );
  });
});

// ─── F · Los contratos de #380 y #382 siguen intactos ─────────────────────────

describe('V3-A · F. #380 y #382 no se movieron', () => {
  test('18 y 19 — el crédito sigue siendo por página no vacía, con la misma versión', () => {
    assert.equal(APOLLO_PRICING_VERSION, 'a1-apollo-operation-pricing-v2-per-page');
    assert.equal(APOLLO_BILLABLE_UNIT['organizations_search'], 'non_empty_page');
    assert.equal(creditsForApolloNonEmptyPages(0), 0);
    assert.equal(creditsForApolloNonEmptyPages(1), 1);
    assert.equal(creditsForApolloNonEmptyPages(4), 4);
  });

  test('20 — el veredicto de ownership es el mismo bajo F1 y bajo F2', () => {
    // El gate no lee la consulta: recibe nombre, url y dominio. La familia no
    // puede cambiar su veredicto, y esta prueba lo deja anclado.
    const subjects: Array<[string, string]> = [
      ['Alcaldía de Medellín', 'https://www.medellin.gov.co'],
      ['Ministerio de Ambiente', 'https://minambiente.gov.co'],
      ['Supermercados Éxito S.A.', 'https://www.exito.com'],
      ['Constructora Bolívar', 'https://www.constructorabolivar.com'],
    ];
    const definition = MACRO_INDUSTRIES[7];
    const keys = macroIndustryQueryFamilyKeys(definition);
    for (const [name, url] of subjects) {
      const baseline = evaluateCompanyOwnership(name, url);
      for (const variantKey of keys) {
        // La variante se emite y el gate se vuelve a evaluar: mismo veredicto.
        const plan = buildMacroIndustryQueryPlan({ definition, variantKey });
        assert.equal(plan.macroQueryVariantKey, variantKey);
        const again = evaluateCompanyOwnership(name, url);
        assert.equal(again.allowed, baseline.allowed);
        assert.equal(again.confidence, baseline.confidence);
        assert.equal(again.domainIdentityKey, baseline.domainIdentityKey);
      }
    }
  });

  test('la resolución de familia no acepta claves de otra macro industria', () => {
    const transport = MACRO_INDUSTRIES[0];
    const technology = MACRO_INDUSTRIES[1];
    const foreignKey = macroIndustryQueryFamilyKeys(technology)[0];
    assert.equal(resolveMacroIndustryQueryFamily(transport, foreignKey), null);
    assert.equal(resolveMacroIndustryQueryFamily(null, 'lo_que_sea'), null);
    assert.equal(
      resolveMacroIndustryQueryFamily(transport, macroIndustryQueryFamilyKeys(transport)[1])?.index,
      1,
    );
  });
});

// ─── G · V3-A-FIX · una familia NUEVA arranca en la página 1 ──────────────────
//
// El defecto que esta sección cierra, con el cableado REAL:
//
//   `production-runner.server.ts:1583` manda
//   `additionalCriteriaTokens: hypothesis.queryParameters.keywordTags`.
//
//   En Retail eso deja `[cadena de tiendas, retailer, comercio minorista]` en
//   común entre F1 y F2 ⇒ `escalationReason = overlapping_effective_keywords`
//   ⇒ `overlapFloorPage = 2` ⇒ la ronda 2 compraba la PÁGINA 2 de un universo
//   cuya página 1 no había comprado nadie. Con el crédito por página de #380,
//   una página pagada y saltada.
//
// La regla nueva NO elimina el suelo: lo limita al caso para el que se escribió
// —dos rondas dentro del MISMO universo—. Una familia declarada distinta cuyo
// `search_plan_fingerprint` también difiere estrena universo y empieza en la 1.

/** La macro industria cuyo sector SÍ tiene señales en `SECTOR_SIGNAL_CATALOG`. */
const RETAIL = MACRO_INDUSTRIES.find((d) => d.key === 'retail') as MacroIndustryDefinition;

describe('V3-A-FIX · G. familia nueva ⇒ página 1, mismo universo ⇒ suelo intacto', () => {
  test('G0 — FIDELIDAD: el arnés manda las etiquetas que manda producción', async () => {
    /**
     * 🔴 MUTATION GUARD del § P1.
     *
     * Si alguien vuelve a poner `additionalCriteriaTokens: []` en el arnés, los
     * términos efectivos de la ronda 1 dejan de contener las etiquetas del
     * catálogo sectorial y este test cae. Es la prueba de que la suite mide el
     * cableado de producción y no uno inventado.
     */
    const round1 = buildRound1Hypothesis(macroContext(RETAIL), 5);
    assert.ok(
      round1.queryParameters.keywordTags.length > 0,
      'Retail debe redactar etiquetas sectoriales: sin ellas el escenario no existe',
    );

    const { spy } = await runFamilyScenario(RETAIL, macroContext(RETAIL));
    const [r1Call] = spy.searchCalls;

    // Cada etiqueta que producción manda como criterio adicional tiene que
    // aparecer en el body efectivo de la ronda 1.
    for (const tag of round1.queryParameters.keywordTags) {
      assert.ok(
        r1Call.effectiveKeywords.some((k) => norm(k) === norm(tag)),
        `el arnés no propagó «${tag}»: additionalCriteriaTokens volvió a ser []`,
      );
    }
  });

  test('G1 — Retail F1→F2 con solapamiento REAL: página 1', async () => {
    const [f1, f2] = macroIndustryQueryFamilyKeys(RETAIL);
    const { spy, result, decision } = await runFamilyScenario(RETAIL, macroContext(RETAIL));

    assert.equal(spy.searchCalls.length, 2);
    const [round1, round2] = spy.searchCalls;
    assert.equal(round1.variantKey, f1);
    assert.equal(round2.variantKey, f2);

    assert.ok(decision);
    // 🔴 El solapamiento EXISTE — no se esconde ni se anula.
    assert.ok(
      decision.sharedEffectiveKeywords.length > 0,
      'Retail debe compartir términos efectivos: si no, el defecto no se está midiendo',
    );
    assert.equal(decision.escalationReason, 'overlapping_effective_keywords');

    // 🔴 …y aun así la ronda 2 arranca en la PÁGINA 1, porque F2 es otro universo.
    assert.equal(decision.requestedPage, 1, 'la ronda 2 se saltó la página 1 de F2');
    assert.equal(round2.page, 1, 'el proveedor recibió una página distinta de la 1');
    assert.equal(decision.round2OpensNewFamilyUniverse, true);
    assert.equal(decision.escalatedToPage2, false);
    assert.equal(decision.pageSource, 'first_page');

    // El universo es demostrablemente otro, y su cursor está en 1.
    assert.notEqual(round1.plan, round2.plan);
    assert.equal(decision.netNewCursorPage, 1);
    assert.equal(decision.netNewCursorPlanFingerprint, round2.plan);

    // Sin proveedor, sin créditos, sin escrituras.
    assert.equal(spy.providerCallCount(), 2);
    assert.equal(result.runMetrics.totalSearchCredits, 0);
    assert.equal(result.runMetrics.totalEnrichmentCredits, 0);
    assert.equal(spy.usageLogWrites(), 0);
  });

  test('G2 — MISMO universo con solapamiento: el suelo de #383/#1B sigue en 2', async () => {
    /**
     * El caso legacy de SCALE-SECOND-ROUND-FIX-1B, intacto: el MISMO sector de
     * Retail sin familias declaradas. La ronda 2 hereda las anclas de la ronda 1
     * (`[...synonyms, ...round1.keywordTags]`), comparte términos efectivos y no
     * declara familia alguna ⇒ no hay universo nuevo que probar ⇒ el suelo de 2
     * se aplica exactamente como antes de este arreglo.
     */
    const sinFamilias = macroContext(RETAIL, { macroQueryFamilies: [] });
    const { spy, decision } = await runFamilyScenario(RETAIL, sinFamilias);

    assert.equal(spy.searchCalls.length, 2);
    const [round1, round2] = spy.searchCalls;
    assert.equal(round1.variantKey, null);
    assert.equal(round2.variantKey, null);

    assert.ok(decision);
    assert.ok(
      decision.sharedEffectiveKeywords.length > 0,
      'sin familias la ronda 2 hereda las anclas: tiene que solaparse',
    );
    assert.equal(decision.escalationReason, 'overlapping_effective_keywords');
    // 🔴 Sin familia nueva NO hay universo nuevo: el suelo manda y la página sube.
    assert.equal(decision.round2OpensNewFamilyUniverse, false);
    assert.equal(decision.requestedPage, 2);
    assert.equal(round2.page, 2);
    assert.equal(decision.escalatedToPage2, true);
    assert.equal(decision.pageSource, 'effective_request_escalation');
  });

  test('G2b — una sola familia declarada: misma familia en las dos rondas ⇒ suelo intacto', async () => {
    /**
     * Con UNA sola familia, `buildRound2Hypothesis` no encuentra siguiente y las
     * dos rondas emiten la misma clave. La identidad de familia no cambia, así
     * que tampoco hay universo nuevo que declarar.
     */
    const [f1] = macroIndustryQueryFamilyKeys(RETAIL);
    const unaFamilia = macroContext(RETAIL, { macroQueryFamilies: [f1] });
    const { spy, decision } = await runFamilyScenario(RETAIL, unaFamilia);

    const [round1, round2] = spy.searchCalls;
    assert.equal(round1.variantKey, f1);
    assert.equal(round2.variantKey, f1, 'sin familia siguiente la ronda 2 repite la de la ronda 1');

    assert.ok(decision);
    assert.equal(decision.round2OpensNewFamilyUniverse, false);
    if (decision.escalationReason !== null) {
      assert.equal(decision.requestedPage, 2, 'mismo universo con solapamiento debe subir de página');
    }
  });

  test('G3 — familia nueva SIN solapamiento: página 1 (y la causa es `first_page`)', async () => {
    /**
     * Las 11 macro industrias cuyo sector no está en `SECTOR_SIGNAL_CATALOG`: sin
     * etiquetas sectoriales no hay términos compartidos, así que la página 1 no
     * necesitaba el arreglo. Se mide para que la corrección no la haya movido.
     */
    for (const definition of MACRO_INDUSTRIES) {
      if (definition.key === RETAIL.key) continue;
      const { spy, decision } = await runFamilyScenario(definition, macroContext(definition));
      const [, round2] = spy.searchCalls;

      assert.ok(decision, `${definition.key}: no hubo decisión de página`);
      assert.deepEqual(decision.sharedEffectiveKeywords, [], `${definition.key}`);
      assert.equal(decision.escalationReason, null, `${definition.key}`);
      assert.equal(decision.requestedPage, 1, `${definition.key}`);
      assert.equal(round2.page, 1, `${definition.key}`);
      assert.equal(decision.pageSource, 'first_page', `${definition.key}`);
      // Sin solapamiento el suelo ya era 1: la regla nueva no tiene nada que hacer.
      assert.equal(decision.round2OpensNewFamilyUniverse, true, `${definition.key}`);
    }
  });

  test('G4 — macro SIN familias: idéntico al baseline anterior al hito', async () => {
    /**
     * El contrato de no-regresión. Sin `macroQueryFamilies` la hipótesis se
     * redacta como antes de V3-A: misma clave (`null`), mismas etiquetas, misma
     * huella —incluida la huella de hipótesis, que sin variante NO lleva
     * componente nuevo (§ P3)—.
     */
    const sinFamilias = macroContext(RETAIL, { macroQueryFamilies: [] });
    const round1 = buildRound1Hypothesis(sinFamilias, 5);
    const round2 = buildRound2Hypothesis(
      sinFamilias,
      {
        remainingTarget: 5,
        excludedSeenOrganizationCount: 0,
        observedRejectionReasons: [],
        providerTotalPages: 52,
      },
      5,
    );

    assert.equal(round1.macroQueryVariantKey, null);
    assert.equal(round2.macroQueryVariantKey, null);
    assert.deepEqual(round1.macroQueryFamiliesAvailable, []);

    // 🔴 P3 — la huella legacy es BYTE POR BYTE la de antes: sin variante no se
    // añade componente alguno.
    assert.equal(
      round1.providerRequestFingerprint,
      buildApolloRoundProviderFingerprint(round1.queryParameters),
    );
    assert.ok(!round1.providerRequestFingerprint.includes('macro_query_variant_key'));
    assert.ok(!round2.providerRequestFingerprint.includes('macro_query_variant_key'));

    // Y la ronda 2 sigue heredando las anclas de la ronda 1, como antes.
    for (const tag of round1.queryParameters.keywordTags) {
      assert.ok(round2.queryParameters.keywordTags.some((t) => norm(t) === norm(tag)));
    }
  });

  test('G5 — clave de familia desconocida: plan completo, comportamiento legacy', async () => {
    /**
     * Una clave que la macro industria no declara no estrecha la consulta ni
     * inventa un universo: el plan se redacta entero, como si no hubiera
     * variante. La decisión de página vuelve a depender sólo del solapamiento.
     */
    const desconocida = buildMacroIndustryQueryPlan({
      definition: RETAIL,
      variantKey: 'familia_que_no_existe',
    });
    const completo = buildMacroIndustryQueryPlan({ definition: RETAIL, variantKey: null });
    assert.deepEqual(desconocida.effectiveKeywords, completo.effectiveKeywords);

    // En el orquestador: dos claves desconocidas NO son familias distintas, así
    // que no pueden declarar universo nuevo — la identidad exige que la ronda 1
    // haya emitido una familia REAL y la ronda 2 otra.
    const contexto = macroContext(RETAIL, {
      macroQueryFamilies: ['familia_que_no_existe', 'tampoco_esta'],
    });
    const { spy, decision } = await runFamilyScenario(RETAIL, contexto);
    const [round1, round2] = spy.searchCalls;

    // Las claves viajan (el redactor las ignora), pero el body es el plan completo.
    assert.equal(round1.variantKey, 'familia_que_no_existe');
    assert.equal(round2.variantKey, 'tampoco_esta');
    assert.ok(decision);
    /**
     * 🔴 Ninguna de las dos claves estrecha la consulta: el redactor las resuelve
     * a `null` y emite el plan COMPLETO en las dos rondas. Los planes efectivos
     * sí difieren —las etiquetas del wizard cambian entre ronda 1 y ronda 2, que
     * es el camino legacy—, pero eso NO es una familia nueva.
     *
     * Si la identidad se tomara de la clave PEDIDA en vez de la RESUELTA, estas
     * dos claves inventadas desactivarían el suelo de página con una consulta que
     * nadie ha cambiado. Fail-closed: no hay universo nuevo que declarar.
     */
    assert.equal(decision.round2OpensNewFamilyUniverse, false);
  });

  test('G6 — P3: `differsFromRound1` deja de mentir cuando R1=F1 y R2=F2', () => {
    /**
     * 🔴 El defecto de observabilidad del § P3.
     *
     * `buildApolloRoundProviderFingerprint` sólo cubría `queryParameters`, pero
     * desde V3-A la familia viaja al proveedor por su PROPIO campo de
     * `WebSearchInput`. En 11 de las 12 macro industrias el sector no aporta
     * etiquetas, los `keywordTags` de las dos rondas colapsan a la misma lista y
     * la huella declaraba «la misma búsqueda» de dos búsquedas distintas:
     * `differsFromRound1 = false` con R1=F1 y R2=F2.
     */
    let macrosSinEtiquetas = 0;
    for (const definition of MACRO_INDUSTRIES) {
      const [f1, f2] = macroIndustryQueryFamilyKeys(definition);
      const context = macroContext(definition);
      const round1 = buildRound1Hypothesis(context, 5);
      const round2 = buildRound2Hypothesis(
        context,
        {
          remainingTarget: 5,
          excludedSeenOrganizationCount: 0,
          observedRejectionReasons: [],
          providerTotalPages: 52,
        },
        5,
      );

      assert.equal(round1.macroQueryVariantKey, f1);
      assert.equal(round2.macroQueryVariantKey, f2);

      if (round2.queryParameters.keywordTags.length === 0) macrosSinEtiquetas += 1;

      // La huella lleva la familia, así que las dos rondas SIEMPRE difieren.
      assert.notEqual(
        round1.providerRequestFingerprint,
        round2.providerRequestFingerprint,
        `${definition.key}: dos familias distintas con la misma huella de hipótesis`,
      );
      assert.equal(
        round2.differsFromRound1,
        true,
        `${definition.key}: differsFromRound1 sigue mintiendo`,
      );
      assert.ok(round1.providerRequestFingerprint.includes(`macro_query_variant_key=${norm(f1)}`));
      assert.ok(round2.providerRequestFingerprint.includes(`macro_query_variant_key=${norm(f2)}`));
    }

    // La condición que producía la mentira existe de verdad: no es un caso teórico.
    assert.ok(
      macrosSinEtiquetas >= 10,
      `se esperaban ≥10 macros sin etiquetas sectoriales, hubo ${macrosSinEtiquetas}`,
    );
  });
});

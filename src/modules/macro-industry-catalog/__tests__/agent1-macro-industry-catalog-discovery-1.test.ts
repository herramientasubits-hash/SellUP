/**
 * agent1-macro-industry-catalog-discovery-1.test.ts — Catálogo, capacidad,
 * versionado y wizard de las 12 Macro Industrias.
 *
 * AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 · § 28.
 *
 * La evidencia macro y la admisión posterior al enrichment viven en
 * `src/server/agents/prospecting-toolkit/__tests__/agent1-macro-industry-evidence-admission-1.test.ts`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  getMacroIndustryByKey,
  getMacroIndustryBySlug,
  isMacroIndustryKey,
  LEGACY_INDUSTRY_CATALOG_VERSION,
  MACRO_INDUSTRIES,
  MACRO_INDUSTRY_CATALOG_VERSION,
  MACRO_INDUSTRY_COUNT,
  MACRO_INDUSTRY_KEYS,
  resolveMacroIndustryByDisplayName,
} from '../macro-industries';
import {
  isMacroIndustryTaxonomy,
  isSubindustrySelectionEnabled,
  resolveDiscoveryTaxonomyCapability,
  toDiscoveryTaxonomyMetadata,
} from '../discovery-taxonomy-capability';
import {
  LEGACY_TAXONOMY_MAPPING,
  summarizeLegacyTaxonomyMapping,
} from '../legacy-taxonomy-mapping';
import {
  buildMacroIndustryQueryPlan,
  computeMacroIndustryQueryCoverage,
  MACRO_QUERY_MAX_BROAD_SHARE,
  MACRO_QUERY_MAX_BROAD_TERMS,
} from '@/server/agents/prospecting-toolkit/apollo-macro-industry-query-terms';
import { resolveApolloMacroIndustryRequest } from '@/server/agents/prospecting-toolkit/apollo-macro-industry-request';
import {
  prospectWizardReducer,
  createInitialProspectWizardState,
} from '@/modules/prospect-batches/chat-wizard/wizard-reducer';
import {
  buildExploratoryFormInput,
  getPreviousWizardStep,
  getWizardProgress,
  getWizardProgressSteps,
  validateWizardStateInvariants,
} from '@/modules/prospect-batches/chat-wizard/wizard-selectors';
import { deriveWizardMessages } from '@/modules/prospect-batches/chat-wizard/wizard-messages';
import type { ProspectWizardState } from '@/modules/prospect-batches/chat-wizard/wizard-types';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

// ─── § 5 — nombres visibles exactos ───────────────────────────────────────────

/**
 * Copiados LITERALMENTE del enunciado, en su orden. Cualquier corrección
 * ortográfica, de espaciado o de separador tiene que fallar aquí antes de llegar
 * a la interfaz.
 */
const EXACT_DISPLAY_NAMES = [
  'Transporte & Logística',
  'Tecnología',
  'Seguros y Servicios Financieros',
  'Salud & Farmacéuticos',
  'Retail',
  'Propiedad & Construcción',
  'Industria / Manufactura / Químicos / Automotor',
  'Gobierno',
  'Gas / Petróleo / Energía / Minería / Medio Ambiente',
  'Consumo Masivo',
  'Compañía de Servicios',
  'Agroindustria',
] as const;

const EXACT_CANONICAL_KEYS = [
  'transport_logistics',
  'technology',
  'insurance_financial_services',
  'health_pharma',
  'retail',
  'property_construction',
  'industry_manufacturing_chemicals_automotive',
  'government',
  'energy_mining_environment',
  'consumer_goods',
  'services_company',
  'agroindustry',
] as const;

// ─── Catálogo ─────────────────────────────────────────────────────────────────

describe('§ 4/§ 5 — las 12 Macro Industrias', () => {
  it('son exactamente doce', () => {
    assert.equal(MACRO_INDUSTRIES.length, 12);
    assert.equal(MACRO_INDUSTRY_COUNT, 12);
    assert.equal(MACRO_INDUSTRY_KEYS.length, 12);
  });

  it('tienen las claves canónicas propuestas, en orden', () => {
    assert.deepEqual([...MACRO_INDUSTRY_KEYS], [...EXACT_CANONICAL_KEYS]);
    assert.deepEqual(
      MACRO_INDUSTRIES.map((m) => m.key),
      [...EXACT_CANONICAL_KEYS],
    );
  });

  it('tienen los nombres visibles EXACTOS, sin reinterpretar', () => {
    assert.deepEqual(
      MACRO_INDUSTRIES.map((m) => m.displayName),
      [...EXACT_DISPLAY_NAMES],
    );
  });

  it('derivan el slug mecánicamente de la clave (`_` → `-`)', () => {
    for (const definition of MACRO_INDUSTRIES) {
      assert.equal(definition.slug, definition.key.replace(/_/g, '-'));
    }
  });

  it('numeran sortOrder 1..12 sin huecos', () => {
    assert.deepEqual(
      MACRO_INDUSTRIES.map((m) => m.sortOrder),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
  });

  it('no repiten claves, slugs ni nombres', () => {
    assert.equal(new Set(MACRO_INDUSTRIES.map((m) => m.key)).size, 12);
    assert.equal(new Set(MACRO_INDUSTRIES.map((m) => m.slug)).size, 12);
    assert.equal(new Set(MACRO_INDUSTRIES.map((m) => m.displayName)).size, 12);
  });

  it('resuelven por clave, por slug y por nombre visible', () => {
    for (const definition of MACRO_INDUSTRIES) {
      assert.equal(getMacroIndustryByKey(definition.key)?.key, definition.key);
      assert.equal(getMacroIndustryBySlug(definition.slug)?.key, definition.key);
      assert.equal(
        resolveMacroIndustryByDisplayName(definition.displayName)?.key,
        definition.key,
      );
      assert.ok(isMacroIndustryKey(definition.key));
    }
  });

  it('resuelven el nombre visible sin acentos y con mayúsculas distintas', () => {
    assert.equal(resolveMacroIndustryByDisplayName('salud & farmaceuticos')?.key, 'health_pharma');
    assert.equal(resolveMacroIndustryByDisplayName('TECNOLOGÍA')?.key, 'technology');
  });

  it('NO resuelven por coincidencia parcial del nombre', () => {
    // «Retail» es substring de otras etiquetas del negocio. Una coincidencia
    // parcial resolvería la macro industria equivocada en silencio.
    assert.equal(resolveMacroIndustryByDisplayName('Retail y Consumo'), null);
    assert.equal(resolveMacroIndustryByDisplayName('Tecno'), null);
    assert.equal(resolveMacroIndustryByDisplayName(''), null);
    assert.equal(resolveMacroIndustryByDisplayName(null), null);
  });

  it('separan términos de descubrimiento y de evidencia (§ 24)', () => {
    for (const definition of MACRO_INDUSTRIES) {
      assert.ok(definition.discovery.specific.length > 0, definition.key);
      assert.ok(definition.discovery.broad.length > 0, definition.key);
      assert.ok(definition.discovery.exclusions.length > 0, definition.key);
      assert.ok(definition.evidence.confirming.length > 0, definition.key);
      assert.ok(definition.evidence.excludingIndustries.length > 0, definition.key);
    }
  });

  it('nunca usan el token suelto `retail` como señal positiva de Retail', () => {
    // Es substring de `retail banking`: con él, Citigroup entra en una búsqueda
    // de retail. Es el modo de fallo de v1.16K-AC.
    const retail = getMacroIndustryByKey('retail')!;
    assert.ok(!retail.discovery.specific.includes('retail'));
    assert.ok(!retail.discovery.broad.includes('retail'));
  });
});

// ─── § 3 — versionado ─────────────────────────────────────────────────────────

describe('§ 3 — versionado del catálogo', () => {
  it('la versión macro y la legacy son distintas', () => {
    assert.equal(MACRO_INDUSTRY_CATALOG_VERSION, '2.0.0');
    assert.equal(LEGACY_INDUSTRY_CATALOG_VERSION, '1.0.0');
    assert.notEqual(MACRO_INDUSTRY_CATALOG_VERSION, LEGACY_INDUSTRY_CATALOG_VERSION);
  });

  it('la migración 118 siembra la v2 en DRAFT y no toca la v1', () => {
    const sql = readFileSync(
      join(REPO_ROOT, 'supabase/migrations/118_macro_industry_catalog_v2_draft.sql'),
      'utf8',
    );
    assert.match(sql, /'2\.0\.0',\s*\n?\s*'draft'/);
    // Ninguna sentencia destructiva sobre el contenido existente.
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(sql, /UPDATE\s+public\.subindustries/i);
    // No publica: la publicación es la 119.
    assert.doesNotMatch(sql, /SELECT\s+public\.publish_macro_industry_catalog_version/i);
  });

  it('la migración 118 declara las 12 macro industrias igual que el módulo', () => {
    const sql = readFileSync(
      join(REPO_ROOT, 'supabase/migrations/118_macro_industry_catalog_v2_draft.sql'),
      'utf8',
    );
    for (const definition of MACRO_INDUSTRIES) {
      // Nombre exacto, slug exacto y sort_order exacto, en la misma fila.
      const row = new RegExp(
        `'${definition.displayName.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}',\\s*'${definition.slug}'`,
      );
      assert.match(sql, row, `falta la fila de ${definition.key}`);
      assert.match(sql, new RegExp(`true,\\s*${definition.sortOrder}\\)`));
    }
  });

  it('la migración 119 es el cutover, separado y explícito', () => {
    const sql = readFileSync(
      join(REPO_ROOT, 'supabase/migrations/119_publish_macro_industry_catalog_v2_cutover.sql'),
      'utf8',
    );
    assert.match(sql, /SELECT\s+public\.publish_macro_industry_catalog_version/i);
    assert.match(sql, /APPLIED IN PRODUCTION: NO/);
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(sql, /\bDROP\b/i);
  });
});

// ─── § 6 — matriz de correspondencia ──────────────────────────────────────────

describe('§ 6 — matriz vieja → macro', () => {
  it('cubre las 8 industrias y las 73 subindustrias de v1', () => {
    const summary = summarizeLegacyTaxonomyMapping();
    assert.equal(summary.oldIndustries, 8);
    assert.equal(summary.oldSubindustries, 73);
    assert.equal(LEGACY_TAXONOMY_MAPPING.length, 81);
  });

  it('toda fila con destino apunta a una clave canónica real', () => {
    for (const row of LEGACY_TAXONOMY_MAPPING) {
      if (row.proposedMacroIndustry !== null) {
        assert.ok(
          isMacroIndustryKey(row.proposedMacroIndustry),
          `${row.oldIndustry}/${row.oldSubindustry}`,
        );
      }
    }
  });

  it('toda fila sin destino se declara `none` y toda fila con destino no', () => {
    for (const row of LEGACY_TAXONOMY_MAPPING) {
      assert.equal(
        row.confidence === 'none',
        row.proposedMacroIndustry === null,
        `${row.oldIndustry}/${row.oldSubindustry}`,
      );
      assert.ok(row.reason.trim().length > 0);
    }
  });

  it('Educación queda SIN destino — hallazgo declarado, no resuelto por código', () => {
    const educationRows = LEGACY_TAXONOMY_MAPPING.filter((r) => r.oldIndustry === 'educacion');
    assert.equal(educationRows.length, 8); // 1 industria + 7 subindustrias
    for (const row of educationRows) {
      assert.equal(row.proposedMacroIndustry, null);
      assert.equal(row.confidence, 'none');
    }
  });

  it('ninguna fila ambigua se puede aplicar automáticamente', () => {
    // El contrato es que `ambiguous` obliga a revisión humana. La prueba fija
    // que existen: una matriz sin ambigüedades sería sospechosa de haberlas
    // resuelto en silencio.
    const ambiguous = LEGACY_TAXONOMY_MAPPING.filter((r) => r.ambiguous);
    assert.ok(ambiguous.length > 0);
    for (const row of ambiguous) {
      assert.notEqual(row.confidence, 'high');
    }
  });
});

// ─── § 2/§ 13 — capacidad y enrutado ──────────────────────────────────────────

describe('§ 2/§ 13 — capacidad de selección de subindustria', () => {
  it('el catálogo v2 desactiva la selección y exige una sola industria', () => {
    const capability = resolveDiscoveryTaxonomyCapability('2.0.0');
    assert.equal(capability.mode, 'macro_industry');
    assert.equal(capability.subindustrySelectionEnabled, false);
    assert.equal(capability.singleIndustryRequired, true);
    assert.equal(capability.reason, 'macro_industry_catalog_version');
  });

  it('el catálogo v1 conserva la selección exactamente como antes', () => {
    const capability = resolveDiscoveryTaxonomyCapability('1.0.0');
    assert.equal(capability.mode, 'industry_subindustry');
    assert.equal(capability.subindustrySelectionEnabled, true);
    assert.equal(capability.reason, 'legacy_catalog_version');
  });

  it('una versión desconocida o ausente NO activa la vía macro (fail-closed)', () => {
    for (const version of ['3.1.4', '', null, undefined]) {
      const capability = resolveDiscoveryTaxonomyCapability(version);
      assert.equal(capability.mode, 'industry_subindustry', String(version));
      assert.equal(capability.subindustrySelectionEnabled, true, String(version));
    }
    assert.equal(resolveDiscoveryTaxonomyCapability('9.9.9').reason, 'unknown_catalog_version');
    assert.equal(resolveDiscoveryTaxonomyCapability(null).reason, 'catalog_version_missing');
  });

  it('el enrutado NO depende del array de subindustrias', () => {
    // Una búsqueda v1 sin subindustrias sigue siendo v1. Es la distinción que el
    // § 13 exige: «no quise acotar» ≠ «el paso no existe».
    assert.equal(isMacroIndustryTaxonomy('1.0.0'), false);
    assert.equal(isSubindustrySelectionEnabled('1.0.0'), true);
  });

  it('proyecta metadata plana y sin PII', () => {
    const metadata = toDiscoveryTaxonomyMetadata(resolveDiscoveryTaxonomyCapability('2.0.0'));
    assert.equal(metadata.discovery_taxonomy_mode, 'macro_industry');
    assert.equal(metadata.subindustry_selection_enabled, false);
    assert.equal(metadata.single_industry_required, true);
    assert.equal(metadata.catalog_version, '2.0.0');
  });
});

// ─── § 7/§ 18/§ 22 — wizard ───────────────────────────────────────────────────

function macroState(): ProspectWizardState {
  return {
    ...createInitialProspectWizardState({
      catalogVersion: MACRO_INDUSTRY_CATALOG_VERSION,
      defaultRequestedCount: 25,
    }),
    searchMode: 'exploratory',
    countryCode: 'CO',
    currentStep: 'industry',
  };
}

describe('§ 7/§ 18 — wizard bajo la taxonomía macro', () => {
  it('elegir macro industria salta DIRECTO al criterio adicional', () => {
    const next = prospectWizardReducer(macroState(), {
      type: 'SELECT_INDUSTRY',
      industryId: 'c1000004-0000-4000-8000-000000000004',
    });
    assert.equal(next.currentStep, 'additional_criteria');
    assert.deepEqual(next.subindustryIds, []);
  });

  it('bajo v1 el paso de subindustria SIGUE existiendo', () => {
    const legacy: ProspectWizardState = {
      ...macroState(),
      catalogVersion: LEGACY_INDUSTRY_CATALOG_VERSION,
    };
    const next = prospectWizardReducer(legacy, {
      type: 'SELECT_INDUSTRY',
      industryId: 'legacy-industry',
    });
    assert.equal(next.currentStep, 'subindustries');
  });

  it('el paso de subindustria no cuenta para el progreso', () => {
    assert.ok(!getWizardProgressSteps('2.0.0').includes('subindustries'));
    assert.ok(getWizardProgressSteps('1.0.0').includes('subindustries'));
    const progress = getWizardProgress({ ...macroState(), currentStep: 'additional_criteria' });
    assert.equal(progress.totalSteps, 5);
  });

  it('volver atrás desde el criterio adicional lleva a la industria, no a un hueco', () => {
    assert.equal(getPreviousWizardStep('additional_criteria', '2.0.0'), 'industry');
    assert.equal(getPreviousWizardStep('additional_criteria', '1.0.0'), 'subindustries');
    const back = prospectWizardReducer(
      { ...macroState(), currentStep: 'additional_criteria' },
      { type: 'GO_BACK' },
    );
    assert.equal(back.currentStep, 'industry');
  });

  it('editar el paso de subindustria es un no-op bajo v2', () => {
    const state = { ...macroState(), currentStep: 'summary' as const };
    const next = prospectWizardReducer(state, { type: 'EDIT_STEP', step: 'subindustries' });
    assert.equal(next.currentStep, 'summary');
  });

  it('§ 22 — el estado obsoleto NUNCA viaja en la solicitud', () => {
    // Una sesión vieja con selecciones en memoria pasando al flujo nuevo.
    const contaminated: ProspectWizardState = {
      ...macroState(),
      industryId: 'c1000004-0000-4000-8000-000000000004',
      subindustryIds: ['stale-a', 'stale-b'],
      currentStep: 'summary',
      requestedCount: 25,
    };
    const payload = buildExploratoryFormInput(contaminated);
    assert.ok(payload);
    assert.deepEqual(payload.subindustryIds, []);
    assert.equal(payload.catalogVersion, '2.0.0');
  });

  it('§ 22 — el estado contaminado se declara como violación de invariante', () => {
    const violations = validateWizardStateInvariants({
      ...macroState(),
      subindustryIds: ['stale-a'],
    });
    assert.ok(violations.some((v) => v.includes('subindustry selection is disabled')));
  });

  it('el hilo de mensajes no menciona subindustrias bajo v2', () => {
    const messages = deriveWizardMessages(
      {
        ...macroState(),
        industryId: 'c1000004-0000-4000-8000-000000000004',
        currentStep: 'summary',
      },
      {
        countries: [{ code: 'CO', name: 'Colombia' }],
        industries: [
          { id: 'c1000004-0000-4000-8000-000000000004', name: 'Salud & Farmacéuticos' },
        ],
        subindustries: [],
      },
    );
    for (const message of messages) {
      assert.notEqual(message.step, 'subindustries', message.id);
      assert.ok(!message.content.toLowerCase().includes('subindustria'), message.id);
    }
    assert.ok(
      messages.some((m) => m.step === 'industry' && m.content.includes('macro industria')),
    );
  });
});

// ─── §§ 14/15/16/17/23 — redacción de la consulta ─────────────────────────────

describe('§ 15 — los términos amplios no pueden dominar', () => {
  it('cada macro industria emite una consulta con cobertura completa', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const plan = buildMacroIndustryQueryPlan({ definition });
      assert.ok(plan.coverage.complete, definition.key);
      assert.ok(plan.coverage.coveringSpecificTerms.length > 0, definition.key);
    }
  });

  it('los amplios nunca superan el tope ni la cuota', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const plan = buildMacroIndustryQueryPlan({ definition });
      assert.ok(plan.admittedBroadTerms.length <= MACRO_QUERY_MAX_BROAD_TERMS, definition.key);
      assert.ok(plan.coverage.broadTermShare <= MACRO_QUERY_MAX_BROAD_SHARE, definition.key);
    }
  });

  it('los específicos viajan ANTES que los amplios', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const plan = buildMacroIndustryQueryPlan({ definition });
      const firstBroadIndex = plan.effectiveKeywords.findIndex((k) =>
        plan.admittedBroadTerms.includes(k),
      );
      const lastSpecificIndex = plan.effectiveKeywords.reduce(
        (acc, keyword, index) =>
          plan.coverage.coveringSpecificTerms.includes(keyword) ? index : acc,
        -1,
      );
      if (firstBroadIndex !== -1) {
        assert.ok(lastSpecificIndex < firstBroadIndex, definition.key);
      }
    }
  });

  it('un presupuesto sin específicos suficientes NO admite ningún amplio', () => {
    const plan = buildMacroIndustryQueryPlan({
      definition: getMacroIndustryByKey('health_pharma')!,
      keywordBudget: 3,
    });
    assert.deepEqual(plan.admittedBroadTerms, []);
    assert.ok(
      plan.withheldBroadTerms.every((w) => w.reason === 'insufficient_specific_terms'),
    );
  });

  it('las exclusiones NUNCA viajan al proveedor', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const plan = buildMacroIndustryQueryPlan({ definition });
      for (const exclusion of plan.exclusionTerms) {
        assert.ok(!plan.effectiveKeywords.includes(exclusion), `${definition.key}: ${exclusion}`);
      }
    }
  });

  it('la cobertura medida sobre el body manda sobre la del plan', () => {
    const definition = getMacroIndustryByKey('retail')!;
    // Un body que perdió todos los específicos: sólo sobrevivieron amplios.
    const coverage = computeMacroIndustryQueryCoverage({
      definition,
      effectiveKeywords: ['retail store', 'retail trade'],
    });
    assert.equal(coverage.complete, false);
    assert.equal(coverage.incompleteReason, 'no_specific_terms_travelled');
  });
});

describe('§ 16 — regresión Salud & Farmacéuticos', () => {
  const plan = buildMacroIndustryQueryPlan({
    definition: getMacroIndustryByKey('health_pharma')!,
  });

  it('la hipótesis es sustancialmente más específica que `health OR healthcare`', () => {
    assert.ok(plan.coverage.coveringSpecificTerms.length >= 10);
    const genericOnly = plan.effectiveKeywords.filter((k) => k === 'health' || k === 'healthcare');
    assert.ok(genericOnly.length < plan.effectiveKeywords.length / 2);
  });

  it('`health` y `healthcare` son AMPLIOS, no específicos', () => {
    const definition = getMacroIndustryByKey('health_pharma')!;
    assert.ok(definition.discovery.broad.includes('health'));
    assert.ok(definition.discovery.broad.includes('healthcare'));
    assert.ok(!definition.discovery.specific.includes('health'));
    assert.ok(!definition.discovery.specific.includes('healthcare'));
  });

  it('los términos específicos NO son inertes: cambiarlos cambia la huella', () => {
    // El defecto del retest `74a49b01` era exactamente esto: cambiar una keyword
    // no cambiaba nada porque los amplios decidían el conjunto.
    const mutated = buildMacroIndustryQueryPlan({
      definition: {
        ...getMacroIndustryByKey('health_pharma')!,
        discovery: {
          ...getMacroIndustryByKey('health_pharma')!.discovery,
          specific: ['clinica veterinaria', 'hospital universitario'],
        },
      },
    });
    assert.notEqual(mutated.fingerprint, plan.fingerprint);
  });
});

describe('§ 17/§ 23 — las 12 hipótesis son materialmente distintas', () => {
  const plans = MACRO_INDUSTRIES.map((definition) =>
    buildMacroIndustryQueryPlan({ definition }),
  );

  it('las 12 huellas son distintas', () => {
    assert.equal(new Set(plans.map((p) => p.fingerprint)).size, 12);
  });

  it('ningún par comparte más de un tercio de sus términos efectivos', () => {
    for (let i = 0; i < plans.length; i += 1) {
      for (let j = i + 1; j < plans.length; j += 1) {
        const a = new Set(plans[i].effectiveKeywords);
        const b = new Set(plans[j].effectiveKeywords);
        const intersection = [...a].filter((t) => b.has(t)).length;
        const union = new Set([...a, ...b]).size;
        assert.ok(
          intersection / union < 0.34,
          `${plans[i].macroIndustryKey} ↔ ${plans[j].macroIndustryKey}`,
        );
      }
    }
  });

  it('las macro industrias más amplias siguen teniendo términos que discriminan', () => {
    // § 17 — «Compañía de Servicios», «Industria/Manufactura» y
    // «Gas/Petróleo/Energía» son las que un matcher perezoso volvería
    // always-true. Sus específicos nombran modelos de negocio, no categorías.
    for (const key of [
      'services_company',
      'industry_manufacturing_chemicals_automotive',
      'energy_mining_environment',
      'insurance_financial_services',
    ] as const) {
      const definition = getMacroIndustryByKey(key)!;
      assert.ok(definition.discovery.specific.length >= 10, key);
      // Ningún término específico es también uno de los amplios de su propia
      // macro industria: si lo fuera, la separación de cubetas sería nominal y
      // el racionamiento del § 15 no filtraría nada.
      const broad = new Set(definition.discovery.broad);
      for (const term of definition.discovery.specific) {
        assert.ok(!broad.has(term), `${key}: ${term} está en las dos cubetas`);
      }
    }
  });

  it('la huella es determinista', () => {
    for (const definition of MACRO_INDUSTRIES) {
      assert.equal(
        buildMacroIndustryQueryPlan({ definition }).fingerprint,
        buildMacroIndustryQueryPlan({ definition }).fingerprint,
      );
    }
  });
});

// ─── § 19 — criterio adicional ────────────────────────────────────────────────

describe('§ 19 — el criterio adicional modifica la consulta pero no confirma', () => {
  it('sus términos viajan al final y NO cuentan como cobertura', () => {
    const definition = getMacroIndustryByKey('retail')!;
    const plan = buildMacroIndustryQueryPlan({
      definition,
      additionalCriteriaTerms: ['zona franca', 'exportador'],
    });
    assert.ok(plan.effectiveKeywords.includes('zona franca'));
    assert.ok(!plan.coverage.coveringSpecificTerms.includes('zona franca'));
    const baseline = buildMacroIndustryQueryPlan({ definition });
    assert.deepEqual(
      plan.coverage.coveringSpecificTerms,
      baseline.coverage.coveringSpecificTerms,
    );
  });

  it('un criterio adicional NO puede completar una cobertura vacía', () => {
    const plan = buildMacroIndustryQueryPlan({
      definition: getMacroIndustryByKey('retail')!,
      keywordBudget: 0,
      additionalCriteriaTerms: ['supermercado'],
    });
    assert.equal(plan.coverage.complete, false);
  });
});

// ─── §§ 11/13/18 — contexto macro de la solicitud ─────────────────────────────

describe('§ 11 — el contexto macro autoriza el bootstrap sin subindustrias', () => {
  it('resuelve el modo macro por versión + nombre canónico', () => {
    const context = resolveApolloMacroIndustryRequest({
      industry: 'Salud & Farmacéuticos',
      selectionCatalogVersion: '2.0.0',
    });
    assert.equal(context.mode, 'macro_industry');
    assert.ok(context.mode === 'macro_industry' && context.definition?.key === 'health_pharma');
  });

  it('una industria que no está en el catálogo falla CERRADO', () => {
    const context = resolveApolloMacroIndustryRequest({
      industry: 'Educación',
      selectionCatalogVersion: '2.0.0',
    });
    assert.equal(context.mode, 'macro_industry');
    assert.ok(context.mode === 'macro_industry' && context.definition === null);
    assert.ok(context.mode === 'macro_industry' && context.blockReason === 'macro_industry_not_in_catalog');
  });

  it('una corrida legacy no entra en modo macro aunque la industria coincida', () => {
    const context = resolveApolloMacroIndustryRequest({
      industry: 'Retail',
      selectionCatalogVersion: '1.0.0',
    });
    assert.equal(context.mode, 'industry_subindustry');
  });
});

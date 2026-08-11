/**
 * AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 2B — registry tipado de reglas
 * de precisión.
 *
 * Qué prueba y qué NO.
 *
 * SÍ: que los datos de precisión de las dos subindustrias vigentes viven ahora en
 * un contrato tipado; que portarlos no movió una sola decisión; que el modo
 * `confirm_only` existe, es genérico y no puede perjudicar la economía por sus
 * ramas negativas; que la cobertura sigue siendo 2 de 73; y que ninguna identidad
 * del registro puede apuntar a dos reglas.
 *
 * NO: Ola 1. Este PR no registra ninguna subindustria nueva. La regla
 * `confirm_only` que se ejercita aquí es TEST-ONLY: se inyecta en el evaluador y no
 * está —ni puede estar, según el ratchet del § 12— en el registro de producción.
 *
 * Cero red, cero base de datos, cero proveedor, cero crédito. Fixtures sintéticas.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessApolloSubindustryPrecision,
  assessApolloSubindustryPrecisionForRequest,
  listSubindustryPrecisionAnchorKeys,
  listSubindustryPrecisionIdentityRegistry,
  listSubindustryPrecisionRuleSets,
  projectOperationalSubindustryVerdict,
  toApolloSubindustryPrecisionMetadata,
  type ApolloSubindustryPrecisionAssessment,
  type SubindustryPrecisionRuleSet,
} from '../apollo-subindustry-precision';
import {
  auditSubindustryPrecisionRuleSetCollisions,
  buildSubindustryPrecisionRuleSetRegistry,
  SUBINDUSTRY_PRECISION_RULE_SETS,
} from '../apollo-subindustry-precision-rule-sets';
import {
  normalizeSubindustryIdentity,
  resolveSubindustryPrecisionIdentity,
} from '../apollo-subindustry-key-resolution';
import {
  evaluateCandidateSubindustryTargetEligibility,
  resolveCandidateSubindustryRequirement,
} from '../candidate-completeness-contract';
import { foldSubindustryPrecisionIntoSectorState } from '../apollo-two-round/production-runner.server';
import {
  SELLUP_ACTIVE_SUBINDUSTRY_NAMES,
  SELLUP_SUBINDUSTRIES_WITH_APOLLO_MAPPING,
} from './fixtures/sellup-subindustry-catalog-names';
import { SELLUP_ACTIVE_SUBINDUSTRY_ALIASES } from './fixtures/sellup-subindustry-catalog-aliases';
import type { WebSearchResult } from '../types';

const SUPERMARKETS = 'Supermercados e Hipermercados';
const DEPARTMENT = 'Tiendas por Departamento, Moda y Calzado';

function result(title: string, metadata: Record<string, unknown>): WebSearchResult {
  return {
    title,
    url: 'https://example.test',
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata,
  } as unknown as WebSearchResult;
}

const blank = (): WebSearchResult => result('Empresa Neutra', {});

// ─── § 3, § 4 · el contrato y el registro ─────────────────────────────────────

describe('§ 3–4 · el registro tipado declara EXACTAMENTE las dos reglas de siempre', () => {
  test('dos entradas, con los nombres canónicos del catálogo activo', () => {
    const ruleSets = listSubindustryPrecisionRuleSets();
    assert.equal(ruleSets.length, 2);
    assert.deepEqual(
      ruleSets.map((ruleSet) => ruleSet.canonicalName).sort(),
      [...SELLUP_SUBINDUSTRIES_WITH_APOLLO_MAPPING].sort(),
    );
  });

  test('cada regla declara todos los campos del contrato, sin inventar ninguno', () => {
    for (const ruleSet of listSubindustryPrecisionRuleSets()) {
      const keys = Object.keys(ruleSet).sort();
      assert.deepEqual(keys, [
        'anchorFamilies',
        'anchors',
        'broadProviderIndustries',
        'canonicalName',
        'catalogVersionId',
        'conflictingBusinessModels',
        'contradictoryProviderIndustries',
        'exclusiveBusinessModels',
        'key',
        'metadata',
        'mode',
        'precisionAliases',
        'subindustryId',
      ]);
      // La clave de indexación ya está normalizada: si no lo estuviera, el resolver
      // exacto no podría alcanzarla nunca.
      assert.equal(ruleSet.key, normalizeSubindustryIdentity(ruleSet.key));
      assert.equal(ruleSet.key, normalizeSubindustryIdentity(ruleSet.canonicalName));
      assert.ok(ruleSet.anchors.length > 0);
    }
  });

  test('la vista de identidad y las claves de anclas cubren el mismo conjunto', () => {
    assert.deepEqual(
      listSubindustryPrecisionIdentityRegistry()
        .map((entry) => entry.key)
        .sort(),
      listSubindustryPrecisionAnchorKeys().sort(),
    );
  });

  test('los dos modos vigentes son `full`: el port no cambió la potestad de ninguna regla', () => {
    for (const ruleSet of listSubindustryPrecisionRuleSets()) {
      assert.equal(ruleSet.mode, 'full', `${ruleSet.canonicalName} debe seguir en modo full`);
    }
  });

  test('§ 15 · `catalogVersionId` existe y es null: el hueco está, la coherencia falsa no', () => {
    for (const ruleSet of listSubindustryPrecisionRuleSets()) {
      assert.equal(ruleSet.catalogVersionId, null);
      // Y en particular NO se ha hardcodeado la única versión publicada.
      assert.notEqual(ruleSet.catalogVersionId, 'e4675daf-65a2-5e26-8640-58f1aeaee5ed');
    }
  });

  test('§ 16 · las reglas son code-owned: `subindustryId` sin poblar, sin loader de catálogo', () => {
    for (const ruleSet of listSubindustryPrecisionRuleSets()) {
      assert.equal(ruleSet.subindustryId, null);
    }
  });

  test('la etiqueta COMPUESTA declara familias; la simple, ninguna', () => {
    const byName = new Map(
      listSubindustryPrecisionRuleSets().map((ruleSet) => [ruleSet.canonicalName, ruleSet]),
    );

    const supermarkets = byName.get(SUPERMARKETS)!;
    assert.equal(supermarkets.anchorFamilies, null);

    const department = byName.get(DEPARTMENT)!;
    assert.ok(department.anchorFamilies !== null);
    // Cada ancla tiene familia: una confirmación sin familia no podría decir cuál
    // de las tres la produjo.
    for (const anchor of department.anchors) {
      assert.ok(
        department.anchorFamilies![anchor] !== undefined,
        `el ancla "${anchor}" no declara familia`,
      );
    }
    assert.deepEqual(
      [...new Set(Object.values(department.anchorFamilies!))].sort(),
      ['department_store', 'fashion_apparel', 'footwear'],
    );
  });
});

// ─── § 8 · alias de precisión ≠ alias de catálogo ─────────────────────────────

describe('§ 8 · los 127 alias publicados NO se promueven a identidad de precisión', () => {
  test('las dos reglas declaran `precisionAliases` vacío', () => {
    for (const ruleSet of listSubindustryPrecisionRuleSets()) {
      assert.deepEqual([...ruleSet.precisionAliases], []);
    }
  });

  test('ningún alias del catálogo activo resuelve precisión', () => {
    for (const entry of SELLUP_ACTIVE_SUBINDUSTRY_ALIASES) {
      for (const alias of entry.aliases) {
        assert.equal(
          assessApolloSubindustryPrecision(blank(), alias).subindustryMapped,
          false,
          `"${alias}" (${entry.canonicalName}) no puede resolver precisión en Phase 2B`,
        );
      }
    }
  });

  test('en particular, `banco`, `bank` y `fintech` no son identidad de precisión', () => {
    for (const generic of ['banco', 'bank', 'fintech']) {
      assert.equal(assessApolloSubindustryPrecision(blank(), generic).subindustryMapped, false);
    }
  });

  test('un alias de precisión DECLARADO sí resuelve — el mecanismo existe, no se usa', () => {
    const withAlias: SubindustryPrecisionRuleSet = {
      ...listSubindustryPrecisionRuleSets()[0],
      precisionAliases: ['Autoservicios de Cadena'],
    };
    const assessment = assessApolloSubindustryPrecisionForRequest(
      result('Cadena Norte', { keywords: ['hipermercados'] }),
      ['Autoservicios de Cadena'],
      { ruleSets: [withAlias] },
    );
    assert.equal(assessment.subindustryMapped, true);
    assert.equal(assessment.subindustryMatch, 'confirmed');
  });
});

// ─── § 7 · el resolver de PR #265 sigue siendo exacto y fail-closed ───────────

describe('§ 7 · identidad por igualdad exacta: sin substring, sin fuzzy, sin padre', () => {
  const MAPPED_KEYS = ['supermercados e hipermercados', 'tiendas por departamento, moda y calzado'];

  test('el canónico exacto resuelve; la clave normalizada también', () => {
    for (const label of [...SELLUP_SUBINDUSTRIES_WITH_APOLLO_MAPPING, ...MAPPED_KEYS]) {
      assert.equal(
        assessApolloSubindustryPrecision(blank(), label).subindustryMapped,
        true,
        `"${label}" debe resolver`,
      );
    }
  });

  test('ningún substring de una clave resuelve — el defecto de PHASE 2A no vuelve', () => {
    const substrings = [
      'super',
      'moda',
      'calzado',
      'tiendas',
      'departamento',
      'mercados',
      'hipermercados',
      'a',
      'e',
      's',
      'o',
      'y',
      '',
      ' ',
      'supermercados',
      'tiendas por departamento',
    ];
    for (const label of substrings) {
      assert.equal(
        assessApolloSubindustryPrecision(blank(), label).subindustryMapped,
        false,
        `"${label}" no puede heredar el catálogo de una subindustria real`,
      );
    }
  });

  test('ninguna etiqueta que CONTENGA una clave resuelve', () => {
    for (const label of [
      'Supermercados e Hipermercados extra',
      'Retail > Supermercados e Hipermercados',
      'Tiendas por Departamento, Moda y Calzado (Ola 1)',
    ]) {
      assert.equal(assessApolloSubindustryPrecision(blank(), label).subindustryMapped, false);
    }
  });

  test('sin fallback al sector padre ni a la primera entrada del registro', () => {
    for (const label of ['Retail y Consumo', 'Retail', 'Consumo Masivo']) {
      assert.equal(assessApolloSubindustryPrecision(blank(), label).subindustryMapped, false);
    }
  });

  test('el registro NO se itera buscando parecidos: el orden no puede elegir ganador', () => {
    const forward = listSubindustryPrecisionRuleSets();
    const reversed = [...forward].reverse();
    for (const label of ['moda', 'super', 'mercados', 'a']) {
      for (const ruleSets of [forward, reversed]) {
        assert.equal(
          assessApolloSubindustryPrecisionForRequest(blank(), [label], { ruleSets })
            .subindustryMapped,
          false,
        );
      }
    }
  });

  test('un `subindustryId` desconocido NO degrada a búsqueda por nombre', () => {
    const resolution = resolveSubindustryPrecisionIdentity(
      { label: SUPERMARKETS, subindustryId: '00000000-0000-0000-0000-000000000000' },
      listSubindustryPrecisionIdentityRegistry(),
    );
    assert.equal(resolution, null);
  });
});

// ─── § 12 · ratchet de cobertura ──────────────────────────────────────────────

describe('§ 12 · la cobertura de precisión sigue siendo 2 de 73', () => {
  test('el conteo de reglas es EXACTAMENTE 2', () => {
    assert.equal(listSubindustryPrecisionRuleSets().length, 2);
    assert.equal(SUBINDUSTRY_PRECISION_RULE_SETS.length, 2);
  });

  test('los nombres canónicos son EXACTAMENTE esos dos, nombrados aquí uno a uno', () => {
    assert.deepEqual(
      listSubindustryPrecisionRuleSets()
        .map((ruleSet) => ruleSet.canonicalName)
        .sort(),
      ['Supermercados e Hipermercados', 'Tiendas por Departamento, Moda y Calzado'],
    );
  });

  test('de las 73 subindustrias del catálogo activo, exactamente 2 tienen precisión', () => {
    assert.equal(SELLUP_ACTIVE_SUBINDUSTRY_NAMES.length, 73);
    const mapped = SELLUP_ACTIVE_SUBINDUSTRY_NAMES.filter(
      (name) => assessApolloSubindustryPrecision(blank(), name).subindustryMapped,
    );
    assert.equal(mapped.length, 2, `cobertura inesperada: ${JSON.stringify(mapped)}`);
    assert.deepEqual([...mapped].sort(), [...SELLUP_SUBINDUSTRIES_WITH_APOLLO_MAPPING].sort());
  });

  test('las 71 restantes siguen sin mapeo y ninguna confirma a nadie', () => {
    const unmapped = SELLUP_ACTIVE_SUBINDUSTRY_NAMES.filter(
      (name) => !assessApolloSubindustryPrecision(blank(), name).subindustryMapped,
    );
    assert.equal(unmapped.length, 71);
    for (const name of unmapped) {
      const assessment = assessApolloSubindustryPrecision(
        result('Cadena Norte', { industry: 'retail', keywords: ['hipermercados', 'shoe store'] }),
        name,
      );
      assert.equal(assessment.verdictReason, 'subindustry_not_mapped');
      assert.notEqual(assessment.subindustryMatch, 'confirmed');
    }
  });

  test('§ 17 · «Formación Corporativa» NO está registrada y no auto-confirma', () => {
    // Nombre canónico exacto del catálogo activo: la decisión del § 17 se prueba
    // contra la etiqueta REAL, no contra una abreviatura.
    const FORMACION = 'Formación Corporativa y Corporate Training';
    // Sigue siendo una subindustria REAL del catálogo activo…
    assert.ok(SELLUP_ACTIVE_SUBINDUSTRY_NAMES.includes(FORMACION));
    // …y sigue sin regla de precisión: buscable y revisable, no auto-confirmable.
    assert.equal(
      listSubindustryPrecisionRuleSets().some((ruleSet) => ruleSet.canonicalName === FORMACION),
      false,
    );
    const assessment = assessApolloSubindustryPrecision(
      result('Instituto Empresarial', {
        industry: 'professional training & coaching',
        keywords: ['corporate training', 'formacion corporativa'],
      }),
      FORMACION,
    );
    assert.equal(assessment.subindustryMapped, false);
    assert.notEqual(assessment.subindustryMatch, 'confirmed');
    assert.equal(assessment.verdictReason, 'subindustry_not_mapped');
    // Y no cuenta hacia el objetivo por ninguna regla nueva.
    const eligibility = evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [FORMACION],
      subindustryPrecision: assessment,
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.equal(eligibility.countsTowardTarget, false);
    assert.equal(eligibility.subindustryMatch, 'unmapped');
  });
});

// ─── § 14 · seguridad ante colisiones ─────────────────────────────────────────

describe('§ 14 · una identidad no puede apuntar a dos reglas', () => {
  const [first, second] = listSubindustryPrecisionRuleSets();

  test('el registro vigente no tiene ninguna colisión', () => {
    assert.deepEqual(
      auditSubindustryPrecisionRuleSetCollisions(
        SUBINDUSTRY_PRECISION_RULE_SETS,
        normalizeSubindustryIdentity,
      ),
      [],
    );
  });

  test('clave duplicada ⇒ falla la construcción, no «gana la primera»', () => {
    assert.throws(
      () =>
        buildSubindustryPrecisionRuleSetRegistry(
          [first, { ...second, key: first.key, canonicalName: 'Otra Etiqueta' }],
          normalizeSubindustryIdentity,
        ),
      /identidad de precisión ambigua/,
    );
  });

  test('canónico duplicado tras normalizar ⇒ falla', () => {
    assert.throws(
      () =>
        buildSubindustryPrecisionRuleSetRegistry(
          [
            first,
            {
              ...second,
              key: 'otra clave',
              canonicalName: first.canonicalName.toUpperCase(),
            },
          ],
          normalizeSubindustryIdentity,
        ),
      /identidad de precisión ambigua/,
    );
  });

  test('`subindustryId` duplicado ⇒ falla', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    assert.throws(
      () =>
        buildSubindustryPrecisionRuleSetRegistry(
          [
            { ...first, subindustryId: id },
            { ...second, subindustryId: id },
          ],
          normalizeSubindustryIdentity,
        ),
      /identidad de precisión ambigua/,
    );
  });

  test('el mismo alias declarado por dos reglas ⇒ falla', () => {
    const collisions = auditSubindustryPrecisionRuleSetCollisions(
      [
        { ...first, precisionAliases: ['comercio minorista'] },
        { ...second, precisionAliases: ['Comercio Minorista'] },
      ],
      normalizeSubindustryIdentity,
    );
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0].kind, 'alias_alias');
    assert.throws(
      () =>
        buildSubindustryPrecisionRuleSetRegistry(
          [
            { ...first, precisionAliases: ['comercio minorista'] },
            { ...second, precisionAliases: ['Comercio Minorista'] },
          ],
          normalizeSubindustryIdentity,
        ),
      /identidad de precisión ambigua/,
    );
  });

  test('un alias que normaliza igual que el canónico de OTRA regla ⇒ falla', () => {
    const collisions = auditSubindustryPrecisionRuleSetCollisions(
      [first, { ...second, precisionAliases: [first.canonicalName] }],
      normalizeSubindustryIdentity,
    );
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0].kind, 'alias_canonical');
  });

  test('un alias que repite el canónico de su PROPIA regla es redundancia, no colisión', () => {
    assert.deepEqual(
      auditSubindustryPrecisionRuleSetCollisions(
        [{ ...first, precisionAliases: [first.canonicalName] }, second],
        normalizeSubindustryIdentity,
      ),
      [],
    );
  });

  test('una regla sin anclas ⇒ falla: no podría confirmar a nadie', () => {
    assert.throws(
      () =>
        buildSubindustryPrecisionRuleSetRegistry(
          [{ ...first, anchors: [] }],
          normalizeSubindustryIdentity,
        ),
      /no declara anclas/,
    );
  });

  test('un ancla sin familia en una regla compuesta ⇒ falla', () => {
    assert.throws(
      () =>
        buildSubindustryPrecisionRuleSetRegistry(
          [{ ...second, anchors: [...second.anchors, 'boutique multimarca'] }],
          normalizeSubindustryIdentity,
        ),
      /no declara familia/,
    );
  });
});

// ─── § 11 · paridad de los dos mappings vigentes ──────────────────────────────
//
// La paridad BEFORE/AFTER del port se comprobó fuera de la suite, con un volcado
// exhaustivo (49.973 registros: matcher puro, assessment por término × campo ×
// subindustria, metadata, estado sectorial plegado, requisito de subindustria y
// elegibilidad hacia el objetivo) cuyo SHA-256 es idéntico antes y después.
//
// Lo que la suite fija de forma permanente es el invariante que ESE volcado
// demostró y que un cambio futuro podría romper: con las dos reglas en `full`, el
// veredicto OPERATIVO es el diagnóstico. Si alguien pone una en `confirm_only` sin
// decirlo, esto falla.

describe('§ 11 · con las dos reglas en `full`, operativo ≡ diagnóstico', () => {
  const ANCHOR_FIELDS = [
    'industry',
    'industries',
    'keywords',
    'short_description',
    'apollo_profile.industry',
    'apollo_profile.keywords',
    'apollo_profile.organization_keywords',
    'apollo_profile.short_description',
    'apollo_profile.seo_description',
    'apollo_profile.description',
  ];

  const TERMS = [
    'hipermercados',
    'supermercado',
    'grocery store',
    'grocery delivery',
    'food distribution',
    'wholesale distribution',
    'retail',
    'retail banking',
    'marketplace',
    'clothing store',
    'shoe store',
    'tienda por departamentos',
    'moda',
    'fashion retail',
    'food production',
    'supermarkets',
    'almacenes',
    'consulting',
    'saas',
    'nada de esto coincide',
  ];

  function place(field: string, value: string): Record<string, unknown> {
    const [head, tail] = field.split('.');
    const arrayish = (name: string) =>
      name === 'keywords' || name === 'industries' || name === 'organization_keywords';
    if (tail === undefined) return { [head]: arrayish(head) ? [value] : value };
    return { [head]: { [tail]: arrayish(tail) ? [value] : value } };
  }

  test('para toda la matriz de término × campo × subindustria, los dos veredictos coinciden', () => {
    let checked = 0;
    for (const label of [SUPERMARKETS, DEPARTMENT]) {
      for (const field of ANCHOR_FIELDS) {
        for (const term of TERMS) {
          const assessment = assessApolloSubindustryPrecision(
            result('Empresa Fixture', place(field, term)),
            label,
          );
          const operational = projectOperationalSubindustryVerdict(assessment);
          assert.equal(
            operational.subindustryMapped,
            assessment.subindustryMapped,
            `${label} · ${field} · ${term}`,
          );
          assert.equal(
            operational.subindustryMatch,
            assessment.subindustryMatch,
            `${label} · ${field} · ${term}`,
          );
          assert.equal(operational.precisionMode, 'full');
          checked += 1;
        }
      }
    }
    assert.equal(checked, 2 * ANCHOR_FIELDS.length * TERMS.length);
  });

  test('también en ANY-OF y con mezclas de mapeada / sin mapeo', () => {
    const COMBOS = [
      [SUPERMARKETS],
      [DEPARTMENT],
      [SUPERMARKETS, DEPARTMENT],
      [DEPARTMENT, SUPERMARKETS],
      [SUPERMARKETS, 'Agritech'],
      ['Agritech', SUPERMARKETS],
      ['Agritech', 'Insurtech'],
      [],
    ];
    const FIXTURES: [string, Record<string, unknown>][] = [
      ['Cadena Norte', { industry: 'retail', keywords: ['hipermercados'] }],
      ['Moda Norte', { industry: 'retail', keywords: ['clothing store'] }],
      ['Banco Retail', { industry: 'retail banking', keywords: ['supermercado'] }],
      ['Distribuidora', { industry: 'food and beverages', keywords: ['food distribution'] }],
      ['Generica', { industry: 'retail' }],
      ['Vacia', {}],
    ];
    for (const combo of COMBOS) {
      for (const [title, metadata] of FIXTURES) {
        const assessment = assessApolloSubindustryPrecisionForRequest(
          result(title, metadata),
          combo,
        );
        const operational = projectOperationalSubindustryVerdict(assessment);
        assert.equal(operational.subindustryMapped, assessment.subindustryMapped);
        assert.equal(operational.subindustryMatch, assessment.subindustryMatch);
      }
    }
  });

  test('los cinco casos del contrato original siguen dando el mismo veredicto', () => {
    const cases: [string, Record<string, unknown>, string, string][] = [
      [
        'Cadena Norte',
        { industry: 'retail', keywords: ['hipermercados'] },
        'confirmed',
        'anchor_evidence_confirmed',
      ],
      [
        'Distribuidora Central',
        { industry: 'food and beverages', keywords: ['food distribution', 'grocery'] },
        'rejected',
        'excluded_business_model',
      ],
      [
        'Mercado Ya',
        { industry: 'consumer services', keywords: ['grocery delivery', 'supermercado'] },
        'ambiguous',
        'conflicting_business_model_with_anchor',
      ],
      ['Grupo Comercial', { industry: 'retail' }, 'ambiguous', 'broad_industry_only'],
      [
        'Banco Retail',
        { industry: 'retail banking', keywords: ['supermercado'] },
        'rejected',
        'declared_industry_contradicts',
      ],
    ];
    for (const [title, metadata, verdict, reason] of cases) {
      const assessment = assessApolloSubindustryPrecision(result(title, metadata), SUPERMARKETS);
      assert.equal(assessment.subindustryMatch, verdict, title);
      assert.equal(assessment.verdictReason, reason, title);
    }
  });

  test('la proyección a metadata no cambió de forma', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Almacenes del Sur', {
        industry: 'retail',
        short_description: 'Opera supermercados e hipermercados.',
      }),
      SUPERMARKETS,
    );
    assert.deepEqual(Object.keys(toApolloSubindustryPrecisionMetadata(assessment)).sort(), [
      'classification_source',
      'disqualifying_signals',
      'industry_match',
      'matched_requested_subindustry',
      'matched_subindustry_family',
      'per_requested_subindustry_evaluations',
      'requested_subindustries',
      'requested_subindustry',
      'subindustry_confidence',
      'subindustry_evidence',
      'subindustry_mapped',
      'subindustry_match',
      'subindustry_match_family',
      'verdict_reason',
    ]);
  });
});

// ─── § 9, § 10 · `confirm_only`, implementado y sin usar ──────────────────────
//
// La regla que sigue es TEST-ONLY. Se inyecta con `{ ruleSets }` y NO está en el
// registro de producción: el ratchet del § 12 falla si alguien la registra.

/**
 * Regla `confirm_only` sintética: una subindustria de venta de bicicletas.
 *
 * Vocabulario deliberadamente ajeno al de las dos reglas reales, para que su
 * evidencia no pueda confundirse con la de ninguna de ellas.
 */
const BICYCLE_CONFIRM_ONLY: SubindustryPrecisionRuleSet = {
  key: 'venta minorista de bicicletas',
  canonicalName: 'Venta Minorista de Bicicletas',
  subindustryId: null,
  precisionAliases: [],
  mode: 'confirm_only',
  catalogVersionId: null,
  anchors: ['tienda de bicicletas', 'bicycle store', 'bike shop'],
  anchorFamilies: null,
  exclusiveBusinessModels: ['fabricante de bicicletas', 'bicycle manufacturing'],
  conflictingBusinessModels: ['alquiler de bicicletas', 'bike sharing'],
  broadProviderIndustries: ['sporting goods', 'deportes'],
  contradictoryProviderIndustries: ['banking', 'automotive manufacturing'],
};

const BICYCLE = BICYCLE_CONFIRM_ONLY.canonicalName;
const CONFIRM_ONLY_REGISTRY = [...listSubindustryPrecisionRuleSets(), BICYCLE_CONFIRM_ONLY];
const withFake = { ruleSets: CONFIRM_ONLY_REGISTRY };

function assessBicycle(
  title: string,
  metadata: Record<string, unknown>,
  requested: readonly string[] = [BICYCLE],
): ApolloSubindustryPrecisionAssessment {
  return assessApolloSubindustryPrecisionForRequest(result(title, metadata), requested, withFake);
}

const CONFIRMED_BIKE = (): ApolloSubindustryPrecisionAssessment =>
  assessBicycle('Ciclo Norte', { industry: 'sporting goods', keywords: ['bike shop'] });
const AMBIGUOUS_BIKE = (): ApolloSubindustryPrecisionAssessment =>
  assessBicycle('Deportes Sur', { industry: 'sporting goods' });
const REJECTED_BIKE = (): ApolloSubindustryPrecisionAssessment =>
  assessBicycle('Fabrica Ciclos', {
    industry: 'sporting goods',
    keywords: ['bicycle manufacturing'],
  });

describe('§ 9 · `confirm_only` está implementado y NINGUNA regla de producción lo usa', () => {
  test('el registro de producción no contiene ninguna regla `confirm_only`', () => {
    assert.equal(
      listSubindustryPrecisionRuleSets().filter((ruleSet) => ruleSet.mode === 'confirm_only')
        .length,
      0,
    );
  });

  test('la regla sintética NO está registrada en producción', () => {
    assert.equal(
      listSubindustryPrecisionRuleSets().some((ruleSet) => ruleSet.key === BICYCLE_CONFIRM_ONLY.key),
      false,
    );
    // Y sin inyectarla, su etiqueta no resuelve nada.
    assert.equal(assessApolloSubindustryPrecision(blank(), BICYCLE).subindustryMapped, false);
  });

  test('el diagnóstico conserva las TRES ramas', () => {
    assert.equal(CONFIRMED_BIKE().subindustryMatch, 'confirmed');
    assert.equal(AMBIGUOUS_BIKE().subindustryMatch, 'ambiguous');
    assert.equal(REJECTED_BIKE().subindustryMatch, 'rejected');
    for (const assessment of [CONFIRMED_BIKE(), AMBIGUOUS_BIKE(), REJECTED_BIKE()]) {
      assert.equal(assessment.subindustryMapped, true);
    }
  });

  test('el veredicto OPERATIVO admite sólo la rama positiva', () => {
    const confirmed = projectOperationalSubindustryVerdict(CONFIRMED_BIKE(), withFake);
    assert.deepEqual(confirmed, {
      subindustryMapped: true,
      subindustryMatch: 'confirmed',
      precisionMode: 'confirm_only',
    });

    for (const assessment of [AMBIGUOUS_BIKE(), REJECTED_BIKE()]) {
      assert.deepEqual(projectOperationalSubindustryVerdict(assessment, withFake), {
        subindustryMapped: false,
        subindustryMatch: 'ambiguous',
        precisionMode: null,
      });
    }
  });

  test('diagnóstico y operativo son DISTINGUIBLES, no dos nombres de lo mismo', () => {
    const rejected = REJECTED_BIKE();
    assert.equal(rejected.subindustryMatch, 'rejected');
    assert.notEqual(
      projectOperationalSubindustryVerdict(rejected, withFake).subindustryMatch,
      'rejected',
    );
    assert.equal(rejected.verdictReason, 'excluded_business_model');
    assert.ok(rejected.disqualifyingSignals.includes('bicycle manufacturing'));
  });

  test('`unmapped` conserva el comportamiento base: ni la regla existe', () => {
    const unmapped = assessApolloSubindustryPrecisionForRequest(blank(), ['Nada Registrado'], withFake);
    assert.equal(unmapped.subindustryMapped, false);
    assert.deepEqual(projectOperationalSubindustryVerdict(unmapped, withFake), {
      subindustryMapped: false,
      subindustryMatch: 'ambiguous',
      precisionMode: null,
    });
  });
});

describe('§ 10 · economía de `confirm_only`: aporta, no perjudica', () => {
  const BASE_STATES = [
    'sector_evidence_confirmed',
    'sector_not_mapped',
    'sector_evidence_contradictory',
    'sector_evidence_missing_needs_enrichment',
  ] as const;

  const eligibility = (assessment: ApolloSubindustryPrecisionAssessment, requested: string[]) =>
    evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: requested,
      subindustryPrecision: assessment,
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });

  test('`ambiguous` NO modifica el estado sectorial base ⇒ no crea prioridad de enrichment', () => {
    const ambiguous = AMBIGUOUS_BIKE();
    for (const base of BASE_STATES) {
      assert.equal(
        foldSubindustryPrecisionIntoSectorState(base, ambiguous, withFake),
        base,
        `base ${base} no debe moverse`,
      );
    }
    // El contraste que da sentido a la prueba: una regla `full` ambigua SÍ degrada
    // `sector_evidence_confirmed` a «necesita enrichment».
    const fullAmbiguous = assessApolloSubindustryPrecision(
      result('Grupo Comercial', { industry: 'retail' }),
      SUPERMARKETS,
    );
    assert.equal(
      foldSubindustryPrecisionIntoSectorState('sector_evidence_confirmed', fullAmbiguous),
      'sector_evidence_missing_needs_enrichment',
    );
  });

  test('`rejected` NO contradice el sector ⇒ no impide persistir', () => {
    const rejected = REJECTED_BIKE();
    for (const base of BASE_STATES) {
      assert.equal(foldSubindustryPrecisionIntoSectorState(base, rejected, withFake), base);
    }
    // Contraste: una regla `full` rechazada SÍ contradice.
    const fullRejected = assessApolloSubindustryPrecision(
      result('Banco Retail', { industry: 'retail banking' }),
      SUPERMARKETS,
    );
    assert.equal(
      foldSubindustryPrecisionIntoSectorState('sector_evidence_confirmed', fullRejected),
      'sector_evidence_contradictory',
    );
  });

  test('`confirmed` SÍ confirma la subindustria y puede contar hacia el objetivo', () => {
    const confirmed = CONFIRMED_BIKE();
    assert.equal(
      foldSubindustryPrecisionIntoSectorState('sector_evidence_confirmed', confirmed, withFake),
      'sector_evidence_confirmed',
    );
    const requirement = resolveCandidateSubindustryRequirement({
      sectorEvidenceState: 'sector_evidence_confirmed',
      requestedSubindustries: [BICYCLE],
      subindustryPrecision: confirmed,
    });
    assert.equal(requirement.subindustryMatch, 'confirmed');
    assert.equal(requirement.eligibilityVerdict, 'confirmed');
    assert.equal(requirement.matchedRequestedSubindustry, BICYCLE);
    assert.equal(eligibility(confirmed, [BICYCLE]).countsTowardTarget, true);
  });

  test('`ambiguous` y `rejected` de una `confirm_only` no cuentan — y no cuentan tampoco sin la regla', () => {
    for (const assessment of [AMBIGUOUS_BIKE(), REJECTED_BIKE()]) {
      assert.equal(eligibility(assessment, [BICYCLE]).countsTowardTarget, false);
    }
    // La comparación que hace la afirmación medible: el desenlace OPERATIVO es el
    // mismo que si la regla no existiera. `confirm_only` no añade ni quita conteo
    // por sus ramas negativas.
    const withoutRule = assessApolloSubindustryPrecisionForRequest(
      result('Deportes Sur', { industry: 'sporting goods' }),
      [BICYCLE],
    );
    assert.equal(withoutRule.subindustryMapped, false);
    assert.equal(eligibility(withoutRule, [BICYCLE]).countsTowardTarget, false);
  });

  test('§ 9 · el DIAGNÓSTICO sí distingue: la ficha ve `ambiguous`/`rejected`, no `unmapped`', () => {
    // Esta es la mitad que hace `confirm_only` útil para calibrar. Si el
    // diagnóstico se colapsara a `unmapped`, la regla nueva sería inobservable y no
    // habría con qué decidir su promoción a `full`.
    const ambiguous = eligibility(AMBIGUOUS_BIKE(), [BICYCLE]);
    assert.equal(ambiguous.subindustryMatch, 'ambiguous');
    assert.equal(ambiguous.subindustryBlockingReason, 'subindustry_ambiguous');

    const rejected = eligibility(REJECTED_BIKE(), [BICYCLE]);
    assert.equal(rejected.subindustryMatch, 'rejected');
    assert.equal(rejected.subindustryBlockingReason, 'subindustry_rejected');

    // Y aun así, ninguno de los dos mueve el estado sectorial ni el conteo.
    assert.equal(ambiguous.countsTowardTarget, false);
    assert.equal(rejected.countsTowardTarget, false);
    assert.equal(
      foldSubindustryPrecisionIntoSectorState(
        'sector_evidence_confirmed',
        REJECTED_BIKE(),
        withFake,
      ),
      'sector_evidence_confirmed',
    );
  });

  test('una `confirm_only` rechazada JUNTO a una `full` confirmada no le quita el conteo', () => {
    const mixed = assessApolloSubindustryPrecisionForRequest(
      result('Ciclos y Mercado', {
        industry: 'retail',
        keywords: ['hipermercados', 'bicycle manufacturing'],
      }),
      [SUPERMARKETS, BICYCLE],
      withFake,
    );
    assert.equal(mixed.subindustryMatch, 'confirmed');
    assert.equal(
      projectOperationalSubindustryVerdict(mixed, withFake).subindustryMatch,
      'confirmed',
    );
    assert.equal(eligibility(mixed, [SUPERMARKETS, BICYCLE]).countsTowardTarget, true);
  });

  test('una `full` rechazada JUNTO a una `confirm_only` confirmada sí confirma (ANY-OF)', () => {
    const mixed = assessApolloSubindustryPrecisionForRequest(
      result('Ciclos del Banco', { industry: 'sporting goods', keywords: ['bike shop'] }),
      [DEPARTMENT, BICYCLE],
      withFake,
    );
    // `Tiendas por Departamento…` no confirma con este vocabulario; la bicicletera sí.
    assert.equal(mixed.subindustryMatch, 'confirmed');
    assert.equal(mixed.matchedRequestedSubindustry, BICYCLE);
    assert.equal(eligibility(mixed, [DEPARTMENT, BICYCLE]).countsTowardTarget, true);
  });

  test('una `confirm_only` rechazada NO arrastra a una `full` ambigua', () => {
    const mixed = assessApolloSubindustryPrecisionForRequest(
      result('Comercio y Ciclos', {
        industry: 'retail',
        keywords: ['bicycle manufacturing'],
      }),
      [SUPERMARKETS, BICYCLE],
      withFake,
    );
    // Diagnóstico: la ambigua de `Supermercados` gana al rechazo de la bicicletera.
    assert.equal(mixed.subindustryMatch, 'ambiguous');
    // Operativo: sigue siendo la ambigua mapeada de la regla `full`.
    assert.deepEqual(projectOperationalSubindustryVerdict(mixed, withFake), {
      subindustryMapped: true,
      subindustryMatch: 'ambiguous',
      precisionMode: 'full',
    });
    assert.equal(
      foldSubindustryPrecisionIntoSectorState('sector_evidence_confirmed', mixed, withFake),
      'sector_evidence_missing_needs_enrichment',
    );
  });

  test('los topes de la corrida no se tocan en ningún camino de este PR', () => {
    // Este bloque no consume presupuesto, no reserva créditos y no llama a ningún
    // proveedor: la precisión es pura. Los topes viven en el runner y el registry
    // no los lee ni los expone.
    const ruleSetKeys = listSubindustryPrecisionRuleSets().flatMap((ruleSet) =>
      Object.keys(ruleSet),
    );
    for (const forbidden of ['cap', 'limit', 'budget', 'credits', 'target', 'maxResults']) {
      assert.equal(
        ruleSetKeys.some((key) => key.toLowerCase().includes(forbidden.toLowerCase())),
        false,
        `el contrato de la regla no puede declarar "${forbidden}"`,
      );
    }
  });
});

// ─── § 13 · ANY-OF e invariancia de orden ─────────────────────────────────────

describe('§ 13 · ANY-OF: cada subindustria se resuelve sola, y el orden no decide', () => {
  const FIXTURES: [string, Record<string, unknown>][] = [
    ['Cadena Norte', { industry: 'retail', keywords: ['hipermercados'] }],
    ['Moda Norte', { industry: 'retail', keywords: ['clothing store'] }],
    ['Ciclo Norte', { industry: 'sporting goods', keywords: ['bike shop'] }],
    ['Fabrica Ciclos', { industry: 'sporting goods', keywords: ['bicycle manufacturing'] }],
    ['Banco Retail', { industry: 'retail banking' }],
    ['Generica', { industry: 'retail' }],
    ['Mixta', { industry: 'retail', keywords: ['hipermercados', 'bike shop'] }],
    ['Vacia', {}],
  ];

  const LABELS = [SUPERMARKETS, DEPARTMENT, BICYCLE, 'Agritech'];

  test('B confirmada satisface el ANY-OF aunque A quede rechazada y C sin mapeo', () => {
    const assessment = assessApolloSubindustryPrecisionForRequest(
      result('Mercado Norte', { industry: 'supermarkets', keywords: ['hipermercados'] }),
      [DEPARTMENT, SUPERMARKETS, 'Agritech'],
      withFake,
    );
    const byLabel = new Map(
      assessment.perRequestedSubindustryEvaluations.map((item) => [
        item.requestedSubindustry,
        item,
      ]),
    );
    assert.equal(byLabel.get(DEPARTMENT)!.subindustryMatch, 'rejected');
    assert.equal(byLabel.get(SUPERMARKETS)!.subindustryMatch, 'confirmed');
    assert.equal(byLabel.get('Agritech')!.subindustryMapped, false);
    assert.equal(assessment.subindustryMatch, 'confirmed');
    assert.equal(assessment.matchedRequestedSubindustry, SUPERMARKETS);
  });

  test('el veredicto es invariante al orden — full y confirm_only mezcladas', () => {
    const pairs: [string, string][] = [];
    for (const a of LABELS) for (const b of LABELS) if (a !== b) pairs.push([a, b]);

    for (const [title, metadata] of FIXTURES) {
      for (const [a, b] of pairs) {
        const forward = assessApolloSubindustryPrecisionForRequest(
          result(title, metadata),
          [a, b],
          withFake,
        );
        const reverse = assessApolloSubindustryPrecisionForRequest(
          result(title, metadata),
          [b, a],
          withFake,
        );
        const label = `${title} · [${a} | ${b}]`;
        assert.equal(forward.subindustryMatch, reverse.subindustryMatch, label);
        assert.equal(forward.subindustryMapped, reverse.subindustryMapped, label);
        // El VEREDICTO operativo —lo único que decide gasto y conteo— es invariante
        // al orden. `precisionMode` no se compara aquí: nombra a la regla GANADORA,
        // y ante empate la gana la que el usuario pidió primero. Ver la prueba
        // siguiente, donde ese límite se declara en vez de esconderse.
        const forwardOperational = projectOperationalSubindustryVerdict(forward, withFake);
        const reverseOperational = projectOperationalSubindustryVerdict(reverse, withFake);
        assert.equal(
          forwardOperational.subindustryMatch,
          reverseOperational.subindustryMatch,
          label,
        );
        assert.equal(
          forwardOperational.subindustryMapped,
          reverseOperational.subindustryMapped,
          label,
        );
        // Y ninguna selección se pierde: las dos evaluaciones viajan siempre.
        assert.deepEqual(
          forward.perRequestedSubindustryEvaluations
            .map((item) => `${item.requestedSubindustry}=${item.subindustryMatch}`)
            .sort(),
          reverse.perRequestedSubindustryEvaluations
            .map((item) => `${item.requestedSubindustry}=${item.subindustryMatch}`)
            .sort(),
          label,
        );
      }
    }
  });

  test('límite declarado: ante EMPATE, quién gana sigue el orden pedido — el veredicto, no', () => {
    // `Mixta` confirma las DOS: una regla `full` y una `confirm_only`. Empatan en
    // precedencia, así que gana la que el usuario pidió primero. Es el mismo
    // desempate que `matchedRequestedSubindustry` ya tenía desde #241/#251, y por
    // eso `precisionMode` lo hereda: nombra al ganador, no al veredicto.
    const mixta = result('Mixta', {
      industry: 'retail',
      keywords: ['hipermercados', 'bike shop'],
    });

    const supermarketFirst = assessApolloSubindustryPrecisionForRequest(
      mixta,
      [SUPERMARKETS, BICYCLE],
      withFake,
    );
    const bicycleFirst = assessApolloSubindustryPrecisionForRequest(
      mixta,
      [BICYCLE, SUPERMARKETS],
      withFake,
    );

    // El veredicto —lo que decide— es idéntico.
    for (const assessment of [supermarketFirst, bicycleFirst]) {
      assert.equal(assessment.subindustryMatch, 'confirmed');
      const operational = projectOperationalSubindustryVerdict(assessment, withFake);
      assert.equal(operational.subindustryMapped, true);
      assert.equal(operational.subindustryMatch, 'confirmed');
    }

    // La ATRIBUCIÓN sigue el orden pedido, y las dos caras lo hacen igual.
    assert.equal(supermarketFirst.matchedRequestedSubindustry, SUPERMARKETS);
    assert.equal(
      projectOperationalSubindustryVerdict(supermarketFirst, withFake).precisionMode,
      'full',
    );
    assert.equal(bicycleFirst.matchedRequestedSubindustry, BICYCLE);
    assert.equal(
      projectOperationalSubindustryVerdict(bicycleFirst, withFake).precisionMode,
      'confirm_only',
    );
  });

  test('con tres subindustrias, el conteo hacia el objetivo tampoco depende del orden', () => {
    const triples: string[][] = [
      [SUPERMARKETS, DEPARTMENT, BICYCLE],
      [BICYCLE, SUPERMARKETS, DEPARTMENT],
      [DEPARTMENT, BICYCLE, SUPERMARKETS],
      [BICYCLE, DEPARTMENT, SUPERMARKETS],
    ];
    for (const [title, metadata] of FIXTURES) {
      const counts = triples.map((requested) => {
        const assessment = assessApolloSubindustryPrecisionForRequest(
          result(title, metadata),
          requested,
          withFake,
        );
        return evaluateCandidateSubindustryTargetEligibility({
          persistenceSuccess: true,
          sectorEvidenceState: 'sector_evidence_confirmed',
          requestedSubindustries: requested,
          subindustryPrecision: assessment,
          employeeCountStatus: 'confirmed',
          linkedinStatus: 'confirmed',
          duplicateStatus: 'no_match',
          ownershipGate: 'pass',
          qualityGate: 'pass',
        }).countsTowardTarget;
      });
      assert.equal(new Set(counts).size, 1, `${title}: el orden cambió el conteo`);
    }
  });

  test('el registro invertido produce el mismo veredicto: su orden no es una regla', () => {
    const reversedRegistry = { ruleSets: [...CONFIRM_ONLY_REGISTRY].reverse() };
    for (const [title, metadata] of FIXTURES) {
      const forward = assessApolloSubindustryPrecisionForRequest(
        result(title, metadata),
        LABELS,
        withFake,
      );
      const reversed = assessApolloSubindustryPrecisionForRequest(
        result(title, metadata),
        LABELS,
        reversedRegistry,
      );
      assert.equal(forward.subindustryMatch, reversed.subindustryMatch, title);
      assert.equal(forward.matchedRequestedSubindustry, reversed.matchedRequestedSubindustry, title);
    }
  });
});

// ─── § 6 · un solo evaluador genérico ─────────────────────────────────────────

describe('§ 6 · no hay un evaluador por subindustria ni por proveedor', () => {
  test('la regla nueva se evalúa con el MISMO evaluador, sin tocarlo', () => {
    // La prueba de que el evaluador es genérico es que `BICYCLE_CONFIRM_ONLY` —una
    // subindustria que el módulo no conocía— produce los cinco desenlaces del
    // contrato sin una línea de código específica para ella.
    assert.equal(CONFIRMED_BIKE().verdictReason, 'anchor_evidence_confirmed');
    assert.equal(REJECTED_BIKE().verdictReason, 'excluded_business_model');
    assert.equal(AMBIGUOUS_BIKE().verdictReason, 'broad_industry_only');
    assert.equal(
      assessBicycle('Sin Nada', {}).verdictReason,
      'no_subindustry_evidence',
    );
    assert.equal(
      assessBicycle('Banco Ciclos', { industry: 'banking' }).verdictReason,
      'declared_industry_contradicts',
    );
    assert.equal(
      assessBicycle('Alquiler Ciclos', {
        industry: 'sporting goods',
        keywords: ['bike sharing', 'bike shop'],
      }).verdictReason,
      'conflicting_business_model_with_anchor',
    );
  });

  test('el matcher por tokens también protege a la regla nueva', () => {
    // `bike shop` no debe casar dentro de otra palabra ni fuera de orden.
    assert.notEqual(
      assessBicycle('Shop Bike', { keywords: ['shop bike'] }).subindustryMatch,
      'confirmed',
    );
    assert.equal(
      assessBicycle('Ciclo Norte', { keywords: ['bike shop del norte'] }).subindustryMatch,
      'confirmed',
    );
  });

  test('§ 18 · añadir una subindustria es 1 rule-set: los campos son los mismos', () => {
    assert.deepEqual(
      Object.keys(BICYCLE_CONFIRM_ONLY).sort(),
      Object.keys(listSubindustryPrecisionRuleSets()[0])
        .filter((key) => key !== 'metadata')
        .sort(),
    );
  });
});

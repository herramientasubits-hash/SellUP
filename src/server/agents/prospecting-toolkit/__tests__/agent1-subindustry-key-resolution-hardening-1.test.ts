/**
 * AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 2A — resolución EXACTA de la
 * identidad de subindustria.
 *
 * Lo que esta suite prueba:
 *
 *   § 1/§ 2  la contención bidireccional por substring ya no resuelve identidad,
 *            y ninguna de sus víctimas medidas —incluidas las cadenas de UNA
 *            letra— vuelve a producir `subindustryMapped: true`;
 *   § 3      la normalización es la misma que usa la evidencia, y dos cadenas
 *            normalizadas distintas no son la misma subindustria;
 *   § 5      auditoría read-only de colisiones sobre las 73 canónicas + 127 alias;
 *   § 7      batería adversarial de prefijos, sufijos, frases contenidas y
 *            genéricos;
 *   § 8      ANY-OF, aislamiento por ítem e invariancia de orden;
 *   § 9      fail-closed: sin resolución no hay sector padre ni clave más cercana;
 *   § 10     la cobertura de precisión sigue siendo exactamente 2 de 73;
 *   § 11     el contrato que Phase 2B debe recibir existe como tipo.
 *
 * Sin proveedor, sin red, sin base de datos, sin env, sin reloj. Cero créditos.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessApolloSubindustryPrecision,
  assessApolloSubindustryPrecisionForRequest,
  listSubindustryPrecisionAnchorKeys,
  listSubindustryPrecisionIdentityRegistry,
} from '../apollo-subindustry-precision';
import {
  auditSubindustryIdentityCollisions,
  normalizeSubindustryIdentity,
  resolveSubindustryPrecisionIdentity,
  type SubindustryPrecisionIdentityEntry,
  type SubindustryPrecisionPhase2BInput,
} from '../apollo-subindustry-key-resolution';
import type { WebSearchResult } from '../types';
import {
  SELLUP_ACTIVE_SUBINDUSTRY_NAMES,
  SELLUP_SUBINDUSTRIES_WITH_APOLLO_MAPPING,
} from './fixtures/sellup-subindustry-catalog-names';
import {
  SELLUP_ACTIVE_SUBINDUSTRY_ALIASES,
  SELLUP_ACTIVE_SUBINDUSTRY_ALIAS_COUNT,
  SELLUP_SUBINDUSTRIES_WITH_ALIASES_COUNT,
} from './fixtures/sellup-subindustry-catalog-aliases';

const SUPERMARKETS = 'Supermercados e Hipermercados';
const DEPARTMENT_STORES = 'Tiendas por Departamento, Moda y Calzado';

/**
 * Candidato SIN evidencia alguna. Deliberado: aquí sólo se mide si la etiqueta
 * RESUELVE, y un candidato con señales mezclaría dos preguntas.
 */
function blank(title = 'Empresa Neutra'): WebSearchResult {
  return {
    title,
    url: 'https://example.test',
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata: {},
  } as unknown as WebSearchResult;
}

/** ¿La etiqueta resolvió a una subindustria con política de precisión? */
function mapped(label: string | null | undefined): boolean {
  return assessApolloSubindustryPrecision(blank(), label).subindustryMapped;
}

// ─── § 1 · el defecto, con sus víctimas medidas ───────────────────────────────

describe('§ 1 · la contención bidireccional por substring ya no resuelve identidad', () => {
  /**
   * `key.includes(normalized)` — la mitad más peligrosa. Las claves de precisión
   * son frases largas, así que CUALQUIER substring suyo resolvía: se midió sobre
   * el código de `origin/main` y estas 12 cadenas devolvían
   * `subindustryMapped: true`, con el ganador decidido por el orden de
   * `Object.keys`.
   */
  const CONTAINED_IN_A_KEY = [
    'a',
    'e',
    's',
    'o',
    'y',
    'de',
    'por',
    'super',
    'mercados',
    'moda',
    'calzado',
    'departamento',
  ];

  for (const victim of CONTAINED_IN_A_KEY) {
    test(`«${victim}» está contenida en una clave y ya NO resuelve`, () => {
      const assessment = assessApolloSubindustryPrecision(blank(), victim);
      assert.equal(assessment.subindustryMapped, false);
      assert.equal(assessment.verdictReason, 'subindustry_not_mapped');
      // Fail-closed hacia el objetivo: sin política no se confirma a nadie.
      assert.equal(assessment.subindustryMatch, 'ambiguous');
      assert.equal(assessment.requestedSubindustry, victim);
    });
  }

  /**
   * `normalized.includes(key)` — la otra mitad. Una etiqueta que CONTIENE la clave
   * heredaba el catálogo completo. Importa para el futuro: en cuanto el catálogo
   * publique una variante con sufijo, la laxitud dejaría de ser teórica.
   */
  test('una etiqueta que CONTIENE la clave tampoco resuelve', () => {
    for (const label of [
      'supermercados e hipermercados extra',
      'Supermercados e Hipermercados (Colombia)',
      'Retail — Supermercados e Hipermercados',
      'proveedores de Tiendas por Departamento, Moda y Calzado',
    ]) {
      assert.equal(mapped(label), false, `"${label}" no puede heredar la política`);
    }
  });

  /**
   * Y por qué corregirlo AHORA y no después de la Ola 1: con claves cortas la
   * colisión deja de ser una curiosidad. Se prueba sobre un registro sintético
   * —no se añade ninguna subindustria real (§ 16)—.
   */
  test('con claves cortas la contención sería la norma, y el registro exacto la evita', () => {
    const shortKeys: SubindustryPrecisionIdentityEntry[] = [
      { key: 'banca tradicional', canonicalName: 'Banca Tradicional', subindustryId: null, explicitAliases: [] },
      { key: 'agritech', canonicalName: 'Agritech', subindustryId: null, explicitAliases: [] },
      { key: 'insurtech', canonicalName: 'Insurtech', subindustryId: null, explicitAliases: [] },
      { key: 'legaltech', canonicalName: 'Legaltech', subindustryId: null, explicitAliases: [] },
    ];

    // Todas estas resolvían con el matcher viejo; con el exacto, ninguna.
    for (const label of ['banca', 'tech', 'agri', 'insur', 'legal', 'a', 'tradicional']) {
      assert.equal(
        resolveSubindustryPrecisionIdentity({ label }, shortKeys),
        null,
        `"${label}" no puede identificar una subindustria`,
      );
    }

    // Y las canónicas siguen resolviendo, cada una a la suya.
    for (const entry of shortKeys) {
      assert.equal(
        resolveSubindustryPrecisionIdentity({ label: entry.canonicalName }, shortKeys)?.key,
        entry.key,
      );
    }
  });
});

// ─── § 2 · el contrato nuevo ──────────────────────────────────────────────────

describe('§ 2 · identidad por id exacto, canónico exacto o alias explícito exacto', () => {
  const REGISTRY: SubindustryPrecisionIdentityEntry[] = [
    {
      key: 'supermercados e hipermercados',
      canonicalName: 'Supermercados e Hipermercados',
      subindustryId: '11111111-1111-1111-1111-111111111111',
      explicitAliases: ['Autoservicios'],
    },
    {
      key: 'tiendas por departamento, moda y calzado',
      canonicalName: 'Tiendas por Departamento, Moda y Calzado',
      subindustryId: '22222222-2222-2222-2222-222222222222',
      explicitAliases: [],
    },
  ];

  test('1. subindustryId exacto resuelve y se reporta como tal', () => {
    const resolution = resolveSubindustryPrecisionIdentity(
      { subindustryId: '22222222-2222-2222-2222-222222222222' },
      REGISTRY,
    );
    assert.equal(resolution?.canonicalName, DEPARTMENT_STORES);
    assert.equal(resolution?.matchedBy, 'subindustry_id');
  });

  test('un subindustryId desconocido NO degrada a búsqueda por etiqueta', () => {
    // La etiqueta acompañante es válida; el id manda y no resuelve.
    assert.equal(
      resolveSubindustryPrecisionIdentity(
        { subindustryId: '99999999-9999-9999-9999-999999999999', label: SUPERMARKETS },
        REGISTRY,
      ),
      null,
    );
  });

  test('2. el nombre canónico normalizado exacto resuelve', () => {
    const resolution = resolveSubindustryPrecisionIdentity({ label: SUPERMARKETS }, REGISTRY);
    assert.equal(resolution?.matchedBy, 'canonical_name');
    assert.equal(resolution?.key, 'supermercados e hipermercados');
  });

  test('3. un alias EXPLÍCITO exacto resuelve; una variante suya no', () => {
    assert.equal(
      resolveSubindustryPrecisionIdentity({ label: 'autoservicios' }, REGISTRY)?.matchedBy,
      'explicit_alias',
    );
    // Contenida en el alias, y por tanto fuera.
    assert.equal(resolveSubindustryPrecisionIdentity({ label: 'auto' }, REGISTRY), null);
    // Contiene el alias, y por tanto también fuera.
    assert.equal(
      resolveSubindustryPrecisionIdentity({ label: 'autoservicios del norte' }, REGISTRY),
      null,
    );
  });

  test('un alias declarado por DOS entradas es ambiguo y no resuelve', () => {
    const colliding: SubindustryPrecisionIdentityEntry[] = [
      { ...REGISTRY[0], explicitAliases: ['comercio'] },
      { ...REGISTRY[1], explicitAliases: ['comercio'] },
    ];
    assert.equal(resolveSubindustryPrecisionIdentity({ label: 'comercio' }, colliding), null);
  });

  test('4. sin coincidencia, null — y el registro vacío nunca inventa una', () => {
    assert.equal(resolveSubindustryPrecisionIdentity({ label: 'Ciberseguridad' }, REGISTRY), null);
    assert.equal(resolveSubindustryPrecisionIdentity({ label: SUPERMARKETS }, []), null);
    assert.equal(resolveSubindustryPrecisionIdentity({}, REGISTRY), null);
    assert.equal(resolveSubindustryPrecisionIdentity({ label: '' }, REGISTRY), null);
    assert.equal(resolveSubindustryPrecisionIdentity({ label: '   ' }, REGISTRY), null);
    assert.equal(resolveSubindustryPrecisionIdentity({ label: null }, REGISTRY), null);
  });
});

// ─── § 3 · normalización ──────────────────────────────────────────────────────

describe('§ 3 · la normalización es la existente, y no es fuzzy matching', () => {
  test('case folding, acentos y espacios: la misma subindustria', () => {
    for (const label of [
      'SUPERMERCADOS E HIPERMERCADOS',
      'supermercados e hipermercados',
      'Supermercádos e Hipermercados',
      '  Supermercados   e   Hipermercados  ',
    ]) {
      assert.equal(mapped(label), true, `"${label}" debería resolver`);
    }
  });

  test('la puntuación NO se normaliza: quitar la coma sería una equivalencia nueva', () => {
    assert.equal(mapped(DEPARTMENT_STORES), true);
    assert.equal(mapped('Tiendas por Departamento Moda y Calzado'), false);
  });

  test('dos cadenas normalizadas distintas no son la misma subindustria', () => {
    assert.notEqual(
      normalizeSubindustryIdentity('Supermercados'),
      normalizeSubindustryIdentity(SUPERMARKETS),
    );
    assert.equal(mapped('Supermercados'), false);
    // Y no hay tolerancia a errores de tipeo ni a plurales.
    for (const label of ['Supermercado e Hipermercado', 'Supermercadoss e Hipermercados', 'Supermercads e Hipermercados']) {
      assert.equal(mapped(label), false, `"${label}" no es la canónica`);
    }
  });
});

// ─── § 5 · auditoría de colisiones ────────────────────────────────────────────

describe('§ 5 · colisiones sobre las 73 canónicas y los 127 alias', () => {
  const CATALOG = SELLUP_ACTIVE_SUBINDUSTRY_NAMES.map((canonicalName) => ({
    canonicalName,
    aliases:
      SELLUP_ACTIVE_SUBINDUSTRY_ALIASES.find((entry) => entry.canonicalName === canonicalName)
        ?.aliases ?? [],
  }));

  test('el fixture de alias refleja la lectura de Prod y encaja con las 73 canónicas', () => {
    assert.equal(SELLUP_ACTIVE_SUBINDUSTRY_ALIASES.length, SELLUP_SUBINDUSTRIES_WITH_ALIASES_COUNT);
    assert.equal(
      SELLUP_ACTIVE_SUBINDUSTRY_ALIASES.reduce((total, entry) => total + entry.aliases.length, 0),
      SELLUP_ACTIVE_SUBINDUSTRY_ALIAS_COUNT,
    );
    // Ningún alias huérfano: cada canónico del fixture de alias es una de las 73.
    for (const entry of SELLUP_ACTIVE_SUBINDUSTRY_ALIASES) {
      assert.ok(
        SELLUP_ACTIVE_SUBINDUSTRY_NAMES.includes(entry.canonicalName),
        `"${entry.canonicalName}" no está en el catálogo activo`,
      );
    }
  });

  test('la auditoría es read-only y reporta las tres clases de colisión', () => {
    const audit = auditSubindustryIdentityCollisions(CATALOG);

    assert.equal(audit.canonicalCount, 73);
    assert.equal(audit.aliasCount, SELLUP_ACTIVE_SUBINDUSTRY_ALIAS_COUNT);

    // Hecho sobre ESTA lectura del catálogo `1.0.0`: no hay colisiones. No es una
    // promesa sobre el catálogo futuro — por eso la auditoría existe y se ejecuta.
    assert.deepEqual(audit.canonicalCollisions, []);
    assert.deepEqual(audit.aliasCanonicalCollisions, []);
    assert.deepEqual(audit.aliasAliasCollisions, []);
    assert.deepEqual(audit.ambiguousAliases, []);
  });

  test('un alias repetido entre dos subindustrias se reporta, y no se escoge ganador', () => {
    const audit = auditSubindustryIdentityCollisions([
      { canonicalName: 'Banca Tradicional', aliases: ['banco', 'entidad financiera'] },
      { canonicalName: 'Cooperativas y Entidades Financieras Solidarias', aliases: ['entidad financiera'] },
    ]);

    assert.deepEqual(audit.aliasAliasCollisions, [
      {
        normalized: 'entidad financiera',
        canonicalNames: ['Banca Tradicional', 'Cooperativas y Entidades Financieras Solidarias'],
      },
    ]);
    assert.deepEqual(audit.ambiguousAliases, ['entidad financiera']);
  });

  test('un alias que normaliza igual que el canónico de OTRA subindustria se reporta', () => {
    const audit = auditSubindustryIdentityCollisions([
      { canonicalName: 'Insurtech', aliases: [] },
      { canonicalName: 'Seguros Generales', aliases: ['insurtech'] },
    ]);

    assert.equal(audit.aliasCanonicalCollisions.length, 1);
    assert.equal(audit.aliasCanonicalCollisions[0].normalized, 'insurtech');
    assert.deepEqual(audit.ambiguousAliases, ['insurtech']);
    assert.deepEqual(audit.aliasAliasCollisions, []);
  });

  test('un alias igual a su PROPIO canónico es redundancia, no colisión', () => {
    const audit = auditSubindustryIdentityCollisions([
      { canonicalName: 'Legaltech', aliases: ['legaltech', 'LEGALTECH'] },
    ]);
    assert.deepEqual(audit.aliasCanonicalCollisions, []);
    assert.deepEqual(audit.aliasAliasCollisions, []);
    assert.deepEqual(audit.ambiguousAliases, []);
  });

  test('dos canónicas que normalizan igual se reportan como colisión canónica', () => {
    const audit = auditSubindustryIdentityCollisions([
      { canonicalName: 'Formación Corporativa', aliases: [] },
      { canonicalName: 'FORMACION  CORPORATIVA', aliases: [] },
    ]);
    assert.equal(audit.canonicalCollisions.length, 1);
    assert.equal(audit.canonicalCollisions[0].normalized, 'formacion corporativa');
  });
});

// ─── § 7 · batería adversarial ────────────────────────────────────────────────

describe('§ 7 · prefijos, sufijos, frases contenidas y genéricos', () => {
  test('canónica exacta ⇒ resuelve', () => {
    assert.equal(mapped(SUPERMARKETS), true);
    assert.equal(mapped(DEPARTMENT_STORES), true);
  });

  test('prefijo parcial ⇒ no resuelve', () => {
    for (const label of ['Supermerc', 'Supermercados e', 'Tiendas por', 'Tiendas por Departamento']) {
      assert.equal(mapped(label), false, `"${label}" es un prefijo`);
    }
  });

  test('sufijo parcial ⇒ no resuelve', () => {
    for (const label of ['e Hipermercados', 'Hipermercados', 'Moda y Calzado', 'y Calzado']) {
      assert.equal(mapped(label), false, `"${label}" es un sufijo`);
    }
  });

  test('frase contenida ⇒ no resuelve', () => {
    for (const label of ['por Departamento, Moda', 'Departamento, Moda y', 'cadena de supermercados']) {
      assert.equal(mapped(label), false, `"${label}" es una frase contenida`);
    }
  });

  test('candidato más largo que la clave ⇒ no resuelve salvo canónica exacta', () => {
    assert.equal(mapped(`${SUPERMARKETS} LATAM`), false);
    assert.equal(mapped(`Grandes ${SUPERMARKETS}`), false);
    assert.equal(mapped(SUPERMARKETS), true);
  });

  test('clave más larga que el candidato ⇒ no resuelve', () => {
    for (const label of ['mercado', 'tienda', 'calzados', 'depto']) {
      assert.equal(mapped(label), false, `"${label}" es más corto que cualquier clave`);
    }
  });

  /**
   * Los genéricos del § 7. Ninguno puede resolver una subindustria hija: si lo
   * hiciera, heredaría un catálogo de anclas que decide gasto y admisión.
   */
  test('ningún genérico resuelve una subindustria hija', () => {
    for (const generic of [
      'retail',
      'Retail',
      'empresa',
      'latam',
      'LATAM',
      'seguridad',
      'ciber',
      'software',
      'farmacia',
      'banco',
      'banca',
      'educacion',
      'educación',
      'comercio',
      'consumo',
      'alimentos',
      'food',
      'grocery',
      'moda',
      'fashion',
      'supermercados',
    ]) {
      assert.equal(mapped(generic), false, `"${generic}" no puede resolver`);
    }
  });

  test('Unicode adversarial: acentos sí, homoglifos y separadores raros no', () => {
    // NFD explícito de la canónica: la normalización lo colapsa.
    assert.equal(mapped('Supermercados e Hipermercados'.normalize('NFD')), true);
    // Tabulaciones y saltos cuentan como espacio, que ya se colapsa.
    assert.equal(mapped('Supermercados\te\nHipermercados'), true);
    // Cirílico «е» en lugar del latino: NO es la misma subindustria.
    assert.equal(mapped('Supermercados е Hipermercados'), false);
    // El espacio de no separación (U+00A0) SÍ entra en `\s`, así que colapsa como
    // cualquier otro espacio: es la normalización de espacios que el contrato ya
    // declaraba, no una equivalencia nueva, y sigue siendo igualdad exacta sobre
    // la forma normalizada.
    assert.equal(mapped('Supermercados e Hipermercados'), true);
  });
});

// ─── § 8 · multi-subindustria ─────────────────────────────────────────────────

describe('§ 8 · ANY-OF, aislamiento por ítem e invariancia de orden', () => {
  const CONFIRMS_SUPERMARKET = {
    title: 'Cadena Andina',
    url: 'https://example.test',
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata: {
      industry: 'retail',
      keywords: ['supermercado'],
    },
  } as unknown as WebSearchResult;

  test('cada ítem pedido se resuelve por separado', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(CONFIRMS_SUPERMARKET, [
      SUPERMARKETS,
      'Ciberseguridad',
    ]);

    const bySubindustry = new Map(
      precision.perRequestedSubindustryEvaluations.map((item) => [item.requestedSubindustry, item]),
    );
    assert.equal(bySubindustry.get(SUPERMARKETS)?.subindustryMapped, true);
    assert.equal(bySubindustry.get('Ciberseguridad')?.subindustryMapped, false);
    assert.equal(bySubindustry.get('Ciberseguridad')?.verdictReason, 'subindustry_not_mapped');
  });

  test('un ítem no reconocido no contamina al otro', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(CONFIRMS_SUPERMARKET, [
      'super',
      SUPERMARKETS,
    ]);
    assert.equal(precision.subindustryMatch, 'confirmed');
    assert.equal(precision.matchedRequestedSubindustry, SUPERMARKETS);
    // «super» ya no resuelve, así que no puede arrastrar la política de nadie.
    assert.equal(
      precision.perRequestedSubindustryEvaluations.find((i) => i.requestedSubindustry === 'super')
        ?.subindustryMapped,
      false,
    );
  });

  test('[A,B] == [B,A]: el desenlace no depende del orden', () => {
    const forward = assessApolloSubindustryPrecisionForRequest(CONFIRMS_SUPERMARKET, [
      SUPERMARKETS,
      DEPARTMENT_STORES,
    ]);
    const reverse = assessApolloSubindustryPrecisionForRequest(CONFIRMS_SUPERMARKET, [
      DEPARTMENT_STORES,
      SUPERMARKETS,
    ]);

    assert.equal(forward.subindustryMatch, reverse.subindustryMatch);
    assert.equal(forward.matchedRequestedSubindustry, reverse.matchedRequestedSubindustry);
    assert.equal(forward.subindustryMapped, reverse.subindustryMapped);
    assert.equal(forward.subindustryConfidence, reverse.subindustryConfidence);
    assert.deepEqual(
      [...forward.requestedSubindustries].sort(),
      [...reverse.requestedSubindustries].sort(),
    );
  });

  test('todos los ítems irreconocibles ⇒ ninguno mapeado, ninguno confirmado', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(CONFIRMS_SUPERMARKET, [
      'super',
      'moda',
      'a',
    ]);
    assert.equal(precision.subindustryMapped, false);
    assert.equal(precision.subindustryMatch, 'ambiguous');
    assert.equal(precision.matchedRequestedSubindustry, null);
    assert.ok(
      precision.perRequestedSubindustryEvaluations.every((item) => !item.subindustryMapped),
    );
  });
});

// ─── § 9 · fail-closed ────────────────────────────────────────────────────────

describe('§ 9 · sin resolución no hay sustituto', () => {
  /**
   * Un candidato que sería `confirmed` bajo la política de supermercados. Si la
   * resolución fallida cayera al sector padre, a la clave más cercana o a la
   * primera entrada del registro, este candidato confirmaría con una etiqueta que
   * el catálogo no reconoce — y contaría hacia el objetivo.
   */
  const WOULD_CONFIRM_UNDER_SUPERMARKETS = {
    title: 'Cadena Andina',
    url: 'https://example.test',
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata: {
      industry: 'retail',
      keywords: ['supermercado', 'hipermercado'],
      short_description: 'Opera una cadena de supermercados e hipermercados.',
    },
  } as unknown as WebSearchResult;

  for (const label of ['super', 'Retail y Consumo', 'Supermercados', 'a']) {
    test(`«${label}» no resuelve ⇒ nunca confirma, ni por fallback`, () => {
      const precision = assessApolloSubindustryPrecision(WOULD_CONFIRM_UNDER_SUPERMARKETS, label);
      assert.equal(precision.subindustryMapped, false);
      assert.equal(precision.subindustryMatch, 'ambiguous');
      assert.equal(precision.verdictReason, 'subindustry_not_mapped');
      assert.equal(precision.matchedRequestedSubindustry, null);
      assert.equal(precision.subindustryConfidence, 0);
      assert.deepEqual(precision.subindustryEvidence, []);
      assert.equal(precision.classificationSource, 'none');
      assert.equal(precision.subindustryMatchFamily, 'none');
    });
  }

  test('y con la canónica exacta el MISMO candidato sí confirma', () => {
    const precision = assessApolloSubindustryPrecision(
      WOULD_CONFIRM_UNDER_SUPERMARKETS,
      SUPERMARKETS,
    );
    assert.equal(precision.subindustryMapped, true);
    assert.equal(precision.subindustryMatch, 'confirmed');
    assert.equal(precision.verdictReason, 'anchor_evidence_confirmed');
  });
});

// ─── § 10 · la cobertura no cambia ────────────────────────────────────────────

describe('§ 10 · la cobertura de precisión sigue siendo 2 de 73', () => {
  test('el registro declara exactamente dos subindustrias, las de siempre', () => {
    const registry = listSubindustryPrecisionIdentityRegistry();
    assert.equal(registry.length, 2);
    assert.deepEqual(
      registry.map((entry) => entry.canonicalName).sort(),
      [...SELLUP_SUBINDUSTRIES_WITH_APOLLO_MAPPING].sort(),
    );
  });

  test('el registro de identidad y los catálogos de anclas cubren el mismo conjunto', () => {
    assert.deepEqual(
      listSubindustryPrecisionIdentityRegistry().map((entry) => entry.key).sort(),
      listSubindustryPrecisionAnchorKeys().sort(),
    );
  });

  test('de las 73 subindustrias del catálogo activo, exactamente 2 tienen precisión', () => {
    const mappedNames = SELLUP_ACTIVE_SUBINDUSTRY_NAMES.filter((name) => mapped(name));
    assert.equal(SELLUP_ACTIVE_SUBINDUSTRY_NAMES.length, 73);
    assert.equal(mappedNames.length, 2, `cobertura inesperada: ${JSON.stringify(mappedNames)}`);
    assert.deepEqual([...mappedNames].sort(), [...SELLUP_SUBINDUSTRIES_WITH_APOLLO_MAPPING].sort());
  });

  test('ningún alias publicado del catálogo resuelve precisión todavía (§ 4)', () => {
    for (const entry of SELLUP_ACTIVE_SUBINDUSTRY_ALIASES) {
      for (const alias of entry.aliases) {
        assert.equal(
          mapped(alias),
          false,
          `"${alias}" (${entry.canonicalName}) no puede resolver precisión en Phase 2A`,
        );
      }
    }
    // Y el registro lo declara explícitamente: cero alias code-owned.
    assert.ok(
      listSubindustryPrecisionIdentityRegistry().every((entry) => entry.explicitAliases.length === 0),
    );
  });

  test('las 71 subindustrias sin precisión siguen sin mapeo', () => {
    const unmapped = SELLUP_ACTIVE_SUBINDUSTRY_NAMES.filter((name) => !mapped(name));
    assert.equal(unmapped.length, 71);
    for (const name of unmapped) {
      assert.equal(
        assessApolloSubindustryPrecision(blank(), name).verdictReason,
        'subindustry_not_mapped',
      );
    }
  });
});

// ─── § 11 · interfaz para Phase 2B ────────────────────────────────────────────

describe('§ 11 · el contrato de Phase 2B existe como tipo, sin consumidor', () => {
  test('declara id, canónica, alias explícitos y versión de catálogo', () => {
    const contract: SubindustryPrecisionPhase2BInput = {
      subindustryId: '11111111-1111-1111-1111-111111111111',
      canonicalName: SUPERMARKETS,
      explicitAliases: ['cadena de supermercados'],
      catalogVersionId: 'e4675daf-65a2-5e26-8640-58f1aeaee5ed',
    };

    assert.equal(contract.canonicalName, SUPERMARKETS);
    assert.equal(contract.explicitAliases.length, 1);
    assert.ok(contract.catalogVersionId);

    // Y el resolver ya sabe consumir esa forma cuando Phase 2B la construya.
    const resolution = resolveSubindustryPrecisionIdentity({ label: 'cadena de supermercados' }, [
      {
        key: 'supermercados e hipermercados',
        canonicalName: contract.canonicalName,
        subindustryId: contract.subindustryId,
        explicitAliases: contract.explicitAliases,
      },
    ]);
    assert.equal(resolution?.matchedBy, 'explicit_alias');
    assert.equal(resolution?.subindustryId, contract.subindustryId);
  });
});

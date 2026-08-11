/**
 * apollo-subindustry-precision-rule-sets.ts — los DATOS de precisión de una
 * subindustria, separados del evaluador que los interpreta.
 *
 * AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 2B · §§ 2, 3, 4, 9, 14 y 15.
 *
 * ── Qué cambia y qué no ───────────────────────────────────────────────────────
 *
 * Hasta aquí, `apollo-subindustry-precision.ts` mezclaba dos cosas en un mismo
 * archivo: la MÁQUINA de evaluación —matcher por tokens, autoridad de fuentes,
 * precedencia del ANY-OF, techo de confianza— y los DATOS de las dos
 * subindustrias que hoy tienen política de precisión, escritos como seis
 * `Record<string, string[]>` indexados por clave normalizada.
 *
 * Con dos subindustrias eso se sostiene. Con once —Ola 1 son nueve más— añadir
 * una obliga a tocar seis literales en seis sitios distintos del mismo archivo, y
 * nada impide que una quede a medias: con anclas pero sin contradicciones, o al
 * revés. Un mapeo incompleto no falla ruidosamente; confirma o rechaza de menos,
 * y eso decide gasto y admisión (PR #251).
 *
 * Este módulo hace de esos datos UN objeto por subindustria, tipado y validado.
 * Los cinco catálogos y el mapa de familias son EXACTAMENTE los de antes, término
 * por término y en el mismo orden: PHASE 2B es un port 1:1, no una ampliación.
 * La cobertura sigue siendo 2 de 73.
 *
 * ── Qué NO vive aquí (§ 2) ────────────────────────────────────────────────────
 *
 * Nada genérico. El matcher por secuencia de tokens, `CLASSIFYING_FIELDS`,
 * `DECLARED_INDUSTRY_FIELDS`, `SOURCE_AUTHORITY`, el techo de confianza ambigua y
 * la precedencia del ANY-OF siguen en el evaluador, porque son la regla —igual
 * para toda subindustria— y no el dato. Mover lógica aquí sería abrir la puerta a
 * un evaluador por subindustria, que es justo lo que el § 6 prohíbe.
 *
 * ── Nada de catálogo en runtime (§ 16) ────────────────────────────────────────
 *
 * Estas reglas son CODE-OWNED. No se leen de `subindustry_rules`, no se publican,
 * no tocan `execution_layer` ni el catálogo 1.0.0, y no hay migración. La
 * convergencia con `catalog_version_id` es Phase C2; aquí sólo se reserva el hueco
 * (§ 15, `catalogVersionId`).
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

// ─── Vocabulario ──────────────────────────────────────────────────────────────

/**
 * § 9 — cuánto puede DECIDIR una regla de precisión.
 *
 * `full`          las tres ramas del veredicto tienen efecto operativo, como
 *                 hasta hoy: `confirmed` cuenta, `ambiguous` degrada el estado
 *                 sectorial y compite por enrichment, `rejected` contradice.
 *
 * `confirm_only`  SÓLO la rama positiva tiene efecto. `confirmed` confirma igual
 *                 que en `full`; `ambiguous` y `rejected` quedan como diagnóstico
 *                 y no mueven el estado sectorial, no crean prioridad de
 *                 enrichment y no impiden persistir.
 *
 * Existe para que una subindustria nueva pueda aportar evidencia positiva sin que
 * sus ramas negativas —las que no se han calibrado todavía— alteren la economía de
 * la corrida. Ninguna regla de producción lo usa aún (§ 4 y § 9 de PHASE 2B).
 */
export type SubindustryPrecisionMode = 'full' | 'confirm_only';

/**
 * Familia de operador que produjo la confirmación, para etiquetas COMPUESTAS
 * (varias familias bajo un solo nombre de catálogo).
 *
 * Declarada aquí, junto al mapa que la asigna, y re-exportada por el evaluador
 * para que los consumidores históricos no cambien de import.
 * `apollo-subindustry-precision.ts` la exporta desde su superficie de siempre.
 */
export type SubindustryMatchFamily =
  | 'department_store'
  | 'fashion_apparel'
  | 'footwear'
  | 'none';

// ─── El contrato (§ 3) ────────────────────────────────────────────────────────

/**
 * Todo lo ESPECÍFICO de una subindustria con política de precisión.
 *
 * Cada lista de términos es un catálogo cerrado que el evaluador comprueba con su
 * matcher por secuencia de tokens: nunca por substring. El vocabulario del § 2 del
 * encargo se mapea así sobre la semántica REAL del evaluador, sin duplicar
 * estructuras equivalentes:
 *
 *   anchors / positive signals   → `anchors`
 *   broad signals                → `broadProviderIndustries`
 *   negative signals             → `exclusiveBusinessModels`
 *   conflict signals             → `conflictingBusinessModels`
 *   contradictory signals        → `contradictoryProviderIndustries`
 *   provider industry matches    → `anchors`, evaluadas sobre los campos de
 *                                  industria DECLARADA. No hay una segunda lista:
 *                                  el evaluador reutiliza las anclas ahí, y
 *                                  duplicarlas crearía dos verdades.
 *   provider industry exclusions → `contradictoryProviderIndustries`, que sólo se
 *                                  comprueban sobre la industria declarada.
 *
 * `match keys`, `source authority`, `thresholds` y `precedence` NO están: son de
 * la máquina, no de la subindustria.
 */
export type SubindustryPrecisionRuleSet = {
  /**
   * Clave con la que el evaluador indexa esta regla. Ya normalizada.
   *
   * Se conserva separada de `canonicalName` porque los catálogos históricos se
   * escribieron contra la forma normalizada; renombrarlos no es de esta fase.
   */
  key: string;
  /** Nombre canónico tal como lo publica el catálogo activo. */
  canonicalName: string;
  /** `public.subindustries.id`. `null` mientras ningún consumidor lo traiga (§ 15). */
  subindustryId: string | null;
  /**
   * Alias APROBADOS uno a uno para resolver identidad de PRECISIÓN.
   *
   * § 8 — alias de catálogo ≠ alias de precisión. Los 127 alias publicados en
   * `subindustry_aliases` NO se conectan: viajan con un `catalog_version_id` que
   * la precisión no recibe, y varios son palabras genéricas de una sola pieza
   * (`banco`, `bank`, `fintech`). Vacío no es un pendiente: es la declaración de
   * que hoy sólo el nombre canónico resuelve.
   */
  precisionAliases: readonly string[];
  /** § 9 — cuánto puede decidir esta regla. */
  mode: SubindustryPrecisionMode;
  /**
   * § 15 — versión publicada del catálogo que respalda estos términos.
   *
   * `null` en C1 porque estas reglas son code-owned y la precisión no recibe la
   * versión que resolvió la selección del wizard. El campo existe para que Phase
   * C2 pueda adjuntarla sin reescribir el evaluador; ponerle un valor hoy
   * afirmaría una coherencia con el catálogo que no está comprobada.
   */
  catalogVersionId: string | null;
  /**
   * Términos que, por sí solos, nombran la OPERACIÓN de la subindustria.
   *
   * Nunca categorías de producto ni industrias contenedoras: `grocery` y `retail`
   * a secas están deliberadamente fuera —son substring de `grocery delivery` y de
   * `retail banking`— y viven en `broadProviderIndustries`.
   */
  anchors: readonly string[];
  /**
   * Para una etiqueta COMPUESTA, qué familia demuestra cada ancla. `null` cuando
   * la subindustria no distingue familias.
   *
   * Confirmar UNA familia basta; no se exige cumplir todas.
   */
  anchorFamilies: Readonly<Record<string, SubindustryMatchFamily>> | null;
  /**
   * Modelos de negocio EXCLUYENTES: quien opera así no es de la subindustria
   * pedida, por muchos términos de categoría que comparta con ella.
   */
  exclusiveBusinessModels: readonly string[];
  /**
   * Modelos de negocio EN CONFLICTO: pueden coexistir con la subindustria pero no
   * la demuestran. Con ancla ⇒ ambiguo; sin ancla ⇒ rechazado.
   */
  conflictingBusinessModels: readonly string[];
  /**
   * Industrias AMPLIAS: contienen a la subindustria sin demostrarla. Sólo se
   * comprueban sobre la industria DECLARADA por el proveedor.
   */
  broadProviderIndustries: readonly string[];
  /**
   * Industrias que CONTRADICEN la subindustria. Sólo sobre la industria
   * DECLARADA, y se comprueban ANTES que cualquier ancla.
   */
  contradictoryProviderIndustries: readonly string[];
  /** Trazabilidad de la regla. No participa en ninguna decisión. */
  metadata?: {
    /** Por qué esta regla existe y qué defecto cierra. */
    rationale?: string;
  };
};

// ─── Datos: familias de la etiqueta compuesta ─────────────────────────────────

/**
 * «Tiendas por Departamento, Moda y Calzado» es una etiqueta COMPUESTA: tres
 * familias de operador distintas bajo un solo nombre de catálogo.
 *
 * `confeccion` y `calzado` sueltos NO son anclas: son substring de «confección
 * industrial» y de «fabricante de calzado», y con ellos un fabricante mayorista
 * quedaría confirmado sin una sola señal de venta al consumidor. Sólo la forma
 * compuesta con evidencia de venta/comercio cuenta.
 *
 * El ORDEN de las claves es el orden histórico y se conserva: de él deriva
 * `anchors`, y con él el orden en que la evidencia se recolecta y se reporta.
 */
const DEPARTMENT_STORE_ANCHOR_FAMILIES: Readonly<Record<string, SubindustryMatchFamily>> = {
  // Tiendas por departamento — español e inglés.
  'tienda por departamentos': 'department_store',
  'tiendas por departamentos': 'department_store',
  'almacen por departamentos': 'department_store',
  'almacenes por departamentos': 'department_store',
  'department store': 'department_store',
  'department stores': 'department_store',
  'departmental store': 'department_store',
  'departmental stores': 'department_store',

  // Moda y confección comercial.
  moda: 'fashion_apparel',
  fashion: 'fashion_apparel',
  'fashion retail': 'fashion_apparel',
  'fashion retailer': 'fashion_apparel',
  'apparel retail': 'fashion_apparel',
  'apparel retailer': 'fashion_apparel',
  'clothing store': 'fashion_apparel',
  'clothing stores': 'fashion_apparel',
  'clothing retailer': 'fashion_apparel',
  'tienda de ropa': 'fashion_apparel',
  'tiendas de ropa': 'fashion_apparel',
  'prendas de vestir': 'fashion_apparel',
  'venta de confeccion': 'fashion_apparel',
  'venta de prendas de vestir': 'fashion_apparel',

  // Calzado — sólo con evidencia de venta/tienda, nunca `calzado` a secas.
  'footwear retail': 'footwear',
  'footwear retailer': 'footwear',
  'shoe store': 'footwear',
  'shoe stores': 'footwear',
  'shoe retailer': 'footwear',
  'tienda de calzado': 'footwear',
  'tiendas de calzado': 'footwear',
  'venta de calzado': 'footwear',
};

// ─── El registro (§ 4) ────────────────────────────────────────────────────────

/**
 * Las subindustrias con política de PRECISIÓN. EXACTAMENTE dos, las de siempre.
 *
 * Añadir una tercera es el trabajo de Phase 2C y exige, por sí solo, un rule-set
 * completo más sus fixtures: el ratchet de cobertura de la suite falla si el
 * conteo deja de ser 2, y el validador de colisiones falla si dos reglas
 * comparten identidad.
 *
 * «Formación Corporativa» NO está aquí a propósito (§ 17): sigue siendo buscable y
 * revisable, y no obtiene mapeo de precisión, ni auto-confirmación, ni conteo
 * hacia el objetivo por una regla nueva.
 */
export const SUBINDUSTRY_PRECISION_RULE_SETS: readonly SubindustryPrecisionRuleSet[] = [
  {
    key: 'supermercados e hipermercados',
    canonicalName: 'Supermercados e Hipermercados',
    subindustryId: null,
    precisionAliases: [],
    mode: 'full',
    catalogVersionId: null,
    anchors: [
      // Español — nombran al operador, no a la categoría de producto.
      'supermercado',
      'supermercados',
      'hipermercado',
      'hipermercados',
      'autoservicio',
      'cadena de supermercados',
      'almacen de cadena',
      'tienda de descuento',
      // Inglés
      'supermarket',
      'supermarkets',
      'hypermarket',
      'hypermarkets',
      'grocery store',
      'grocery stores',
      'grocery chain',
      'grocery retailer',
      'supermarket chain',
    ],
    anchorFamilies: null,
    exclusiveBusinessModels: [
      'wholesale distributor',
      'wholesale distributors',
      'wholesale distribution',
      'food distributor',
      'food distributors',
      'food distribution',
      'foodservice distribution',
      'distribuidor mayorista',
      'distribuidores mayoristas',
      'distribucion mayorista',
      'distribuidor de alimentos',
      'distribuidores de alimentos',
      'distribucion de alimentos',
      'venta al por mayor',
      'b2b marketplace',
      'restaurant supply',
      'proveedor de restaurantes',
      'proveedores de restaurantes',
    ],
    conflictingBusinessModels: [
      'grocery delivery',
      'delivery app',
      'delivery apps',
      'on-demand delivery',
      'domicilios',
      'aplicacion de domicilios',
      'marketplace',
      'marketplaces',
      'ecommerce platform',
      'e-commerce platform',
      'quick commerce',
      'q-commerce',
      'dark store',
      'dark stores',
      'last mile delivery',
    ],
    broadProviderIndustries: [
      'retail',
      'consumer goods',
      'consumer services',
      'food',
      'food and beverage',
      'food & beverages',
      'food and beverages',
      'beverages',
      'wholesale',
      'grocery',
      'comercio',
      'consumo',
    ],
    contradictoryProviderIndustries: [
      // `retail banking` y `commercial banking` se nombran explícitamente porque
      // contienen el token `retail`, que es AMPLIO: sin nombrarlas, la
      // comprobación de amplitud las dejaría pasar como «por confirmar».
      'retail banking',
      'commercial banking',
      'investment banking',
      'banking',
      'financial services',
      'finance',
      'insurance',
      'capital markets',
      'software',
      'saas',
      'information technology',
      'consulting',
    ],
    metadata: {
      rationale:
        'El gate sectorial declaraba «relevante» con `grocery` en cualquier texto, así ' +
        'que una app de domicilios y un distribuidor B2B de alimentos se confirmaron y ' +
        'se persistieron. La subindustria exige evidencia positiva y trazable.',
    },
  },
  {
    key: 'tiendas por departamento, moda y calzado',
    canonicalName: 'Tiendas por Departamento, Moda y Calzado',
    subindustryId: null,
    precisionAliases: [],
    mode: 'full',
    catalogVersionId: null,
    // Derivadas del mapa de familias, en su orden: una ancla sin familia sería una
    // confirmación que no puede decir cuál de las tres familias la produjo.
    anchors: Object.keys(DEPARTMENT_STORE_ANCHOR_FAMILIES),
    anchorFamilies: DEPARTMENT_STORE_ANCHOR_FAMILIES,
    // Sin modelos excluyentes propios: el histórico no declaró ninguno para esta
    // etiqueta, y añadirlos aquí sería ampliar la regla, no portarla.
    exclusiveBusinessModels: [],
    conflictingBusinessModels: [],
    broadProviderIndustries: [
      // Amplias a propósito: presencia y NADA más ⇒ ambiguo, nunca confirmado.
      'retail',
      'retailer',
      'retailers',
      'consumer goods',
      'comercio',
      'marketplace',
      'marketplaces',
      'supermarket',
      'grocery',
      'food',
      'beverage',
      'beverages',
      'manufacturer',
      'manufacturers',
      'distributor',
      'distributors',
      'wholesale',
      'shopping',
      // Con matcher por token, `almacen` no cubre «Almacenes La 14»: el plural se
      // declara aparte. Ambos siguen siendo AMPLIOS —`almacen` es parte frecuente
      // del nombre comercial y no demuestra ninguna de las tres familias—.
      'almacen',
      'almacenes',
    ],
    contradictoryProviderIndustries: [
      'food production',
      'food manufacturing',
      'fabricante de alimentos',
      'fabricantes de alimentos',
      'food and beverage manufacturing',
      'beverage manufacturing',
      'agriculture',
      'farming',
      // Supermercado/hipermercado es una subindustria de retail DISTINTA, no una
      // de las tres familias de esta etiqueta.
      'supermarket',
      'supermarkets',
      'supermercado',
      'supermercados',
      'hypermarket',
      'hypermarkets',
      'hipermercado',
      'hipermercados',
      'grocery store',
      'grocery stores',
      'banking',
      'financial services',
      'insurance',
      'software',
      'saas',
      'information technology',
      'consulting',
      'oil & energy',
      'mining & metals',
      'construction',
      'real estate',
      'hospital & health care',
      'pharmaceuticals',
    ],
    metadata: {
      rationale:
        'Etiqueta COMPUESTA de tres familias. Cuatro candidatos de Retail y Consumo de ' +
        'la corrida 8c86eb06 contaron hacia el objetivo sin una sola señal de tienda por ' +
        'departamentos, moda o calzado.',
    },
  },
];

// ─── Validación de colisiones (§ 14) ──────────────────────────────────────────

/**
 * Normalización de identidad, duplicada a propósito EN NINGÚN SITIO.
 *
 * El validador la recibe inyectada desde el evaluador, que es quien la posee
 * (`normalizeSubindustryIdentity`). Importarla aquí crearía una dependencia
 * circular entre datos y máquina; declararla de nuevo crearía una segunda regla de
 * equivalencia, que es exactamente cómo se cuela una divergencia entre «qué
 * subindustria es» y «qué texto la demuestra».
 */
export type SubindustryIdentityNormalizer = (value: string) => string;

export type SubindustryPrecisionRuleSetCollision = {
  /** Forma normalizada que dos reglas se disputan. */
  normalized: string;
  /** Clase de colisión, para que el mensaje diga qué arreglar. */
  kind: 'key' | 'canonical_name' | 'subindustry_id' | 'alias_canonical' | 'alias_alias';
  /** Nombres canónicos implicados, en el orden en que el registro los declara. */
  canonicalNames: string[];
};

/**
 * § 14 — ¿alguna identidad del registro apunta a más de una regla?
 *
 * Pura y read-only. NO elige ganador: «la primera que gane» es precisamente cómo
 * `Object.keys` decidía la subindustria antes de PHASE 2A. Reportar es lo único
 * seguro; quien construye el registro debe fallar.
 *
 * Un alias que coincide con el canónico de su PROPIA regla no es colisión: es
 * redundancia inofensiva.
 */
export function auditSubindustryPrecisionRuleSetCollisions(
  ruleSets: readonly SubindustryPrecisionRuleSet[],
  normalize: SubindustryIdentityNormalizer,
): SubindustryPrecisionRuleSetCollision[] {
  const collisions: SubindustryPrecisionRuleSetCollision[] = [];

  const collect = (
    kind: SubindustryPrecisionRuleSetCollision['kind'],
    owners: Map<string, string[]>,
  ): void => {
    for (const [normalized, names] of owners) {
      if (names.length > 1) collisions.push({ normalized, kind, canonicalNames: names });
    }
  };

  const push = (owners: Map<string, string[]>, value: string, owner: string): void => {
    const bucket = owners.get(value) ?? [];
    if (!bucket.includes(owner)) bucket.push(owner);
    owners.set(value, bucket);
  };

  const byKey = new Map<string, string[]>();
  const byCanonical = new Map<string, string[]>();
  const byId = new Map<string, string[]>();
  const byAlias = new Map<string, string[]>();

  for (const ruleSet of ruleSets) {
    push(byKey, ruleSet.key, ruleSet.canonicalName);
    push(byCanonical, normalize(ruleSet.canonicalName), ruleSet.canonicalName);
    if (ruleSet.subindustryId !== null) push(byId, ruleSet.subindustryId, ruleSet.canonicalName);
    for (const alias of ruleSet.precisionAliases) {
      push(byAlias, normalize(alias), ruleSet.canonicalName);
    }
  }

  collect('key', byKey);
  collect('canonical_name', byCanonical);
  collect('subindustry_id', byId);
  collect('alias_alias', byAlias);

  // Un alias que normaliza igual que el canónico de OTRA regla no puede resolver
  // identidad: la forma fuerte y la débil se contradirían.
  for (const [normalized, aliasOwners] of byAlias) {
    const canonicalOwners = byCanonical.get(normalized) ?? [];
    const foreign = canonicalOwners.filter((name) => !aliasOwners.includes(name));
    if (foreign.length > 0) {
      collisions.push({
        normalized,
        kind: 'alias_canonical',
        canonicalNames: [...aliasOwners, ...foreign],
      });
    }
  }

  return collisions;
}

/**
 * § 14 — construye el registro efectivo, o LANZA.
 *
 * Una colisión de identidad no se degrada a «la primera gana»: aborta. Con el
 * registro code-owned esto sólo puede dispararse al editar el código, así que el
 * fallo llega en el import —y por tanto en cada suite, en el typecheck y en el
 * build— y no en una corrida de producción con crédito reservado.
 */
export function buildSubindustryPrecisionRuleSetRegistry(
  ruleSets: readonly SubindustryPrecisionRuleSet[],
  normalize: SubindustryIdentityNormalizer,
): readonly SubindustryPrecisionRuleSet[] {
  const collisions = auditSubindustryPrecisionRuleSetCollisions(ruleSets, normalize);
  if (collisions.length > 0) {
    const detail = collisions
      .map(
        (collision) =>
          `${collision.kind}:"${collision.normalized}" → ${collision.canonicalNames.join(' | ')}`,
      )
      .join('; ');
    throw new Error(
      `apollo-subindustry-precision: identidad de precisión ambigua en el registro (${detail}). ` +
        'Una identidad no puede apuntar a dos reglas: corrige el registro, no el resolvedor.',
    );
  }

  // Una regla mapeada sin anclas sería «subindustria con política» incapaz de
  // confirmar a nadie: mapearía candidatos a un catálogo vacío y los dejaría
  // ambiguos para siempre, gastando el enrichment que la ambigüedad convoca.
  for (const ruleSet of ruleSets) {
    if (ruleSet.anchors.length === 0) {
      throw new Error(
        `apollo-subindustry-precision: "${ruleSet.canonicalName}" no declara anclas. ` +
          'Una regla sin anclas no puede confirmar a nadie.',
      );
    }
    if (ruleSet.anchorFamilies === null) continue;
    for (const anchor of ruleSet.anchors) {
      if (ruleSet.anchorFamilies[anchor] === undefined) {
        throw new Error(
          `apollo-subindustry-precision: el ancla "${anchor}" de "${ruleSet.canonicalName}" ` +
            'no declara familia. Una confirmación debe poder decir qué familia la produjo.',
        );
      }
    }
  }

  return ruleSets;
}

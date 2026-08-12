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

// ─── Ola 1 · reglas `confirm_only` (PHASE 2C) ─────────────────────────────────

/**
 * Las nueve subindustrias de la Ola 1, todas en `confirm_only`.
 *
 * PHASE 2C · §§ 2, 3, 4, 5, 6, 7, 9 y 25. Se declaran aparte del array final sólo
 * para que este bloque de comentario cubra lo que las nueve comparten; el registro
 * las concatena y el validador de colisiones las trata igual que a las dos de
 * `full`.
 *
 * ── Por qué NINGUNA es `full` (§ 3, § 25) ─────────────────────────────────────
 *
 * En `confirm_only` sólo la rama POSITIVA cruza al plano operativo. `ambiguous` y
 * `rejected` quedan como diagnóstico y ABSTIENEN: no mueven el estado sectorial, no
 * crean prioridad de enrichment y no impiden persistir. Eso invierte el coste de
 * equivocarse y decide cómo están escritas estas nueve reglas:
 *
 *   un FALSO NEGATIVO es gratis  — la regla se abstiene y la corrida queda
 *                                  exactamente como si la regla no existiera;
 *   un FALSO POSITIVO cuesta     — `confirmed` sí puede contar hacia el objetivo.
 *
 * De ahí la asimetría deliberada: las anclas son estrechas y las listas negativas
 * son generosas. Un término dudoso NUNCA es ancla; va a `broadProviderIndustries`
 * (sólo puede producir ambiguo) o a `conflictingBusinessModels` (con ancla,
 * ambiguo). Ampliar una lista negativa no puede crear una confirmación falsa.
 *
 * ── La industria PADRE no puede confirmar a la hija (§ 4, § 13, § 15) ─────────
 *
 * `classifyDeclaredIndustry` comprueba las anclas contra la industria DECLARADA, y
 * el matcher casa subsecuencias de tokens. Así que un ancla de una sola palabra que
 * sea token de la industria padre de Apollo convierte al padre en confirmación de
 * la hija. Cada regla se auditó contra su padre:
 *
 *   Banca Tradicional        `banking` ES el valor de Apollo para la banca
 *                            comercial —`investment banking` y `capital markets`
 *                            son valores DISTINTOS—, y el padre `financial
 *                            services` es AMPLIO. Ancla legítima.
 *   Ciberseguridad           `network security` casa dentro de `computer & network
 *                            security` (valor de Apollo para el sector) pero NO
 *                            dentro de `information technology` ni `software`, que
 *                            son AMPLIOS. `security` a secas es AMPLIO.
 *   Fabricantes de Alimentos `food production` es el valor de fabricación de
 *                            Apollo; `food and beverages` es AMPLIO.
 *   Redes Hospitalarias      `hospital` y `clinica` a secas están EXCLUIDOS de las
 *                            anclas: `hospital` es token de `hospital & health
 *                            care`, el valor de Apollo para TODA la salud, y con él
 *                            un laboratorio, una EPS o una farmacia quedaban
 *                            confirmados como red hospitalaria por su industria
 *                            padre. Sólo confirman las formas COMPUESTAS.
 *   Laboratorios Clínicos    `laboratorio`/`laboratory` a secas son AMPLIOS (§ 16).
 *   Universidades            `higher education` y `education management` son
 *                            AMPLIOS; sólo `higher education institution` confirma.
 *   Escuelas de Negocios     `professional training & coaching` —el único valor de
 *                            proveedor observado, y compartido con Formación
 *                            Corporativa y Certificación B2B— es AMPLIO (§ 7).
 *
 * ── Alias de catálogo que NO se promueven (§ 5) ───────────────────────────────
 *
 * `precisionAliases` está VACÍO en las nueve. Los alias publicados que se revisaron
 * y se RECHAZARON como identidad, uno a uno:
 *
 *   `banco`, `bank`         una sola palabra genérica; «banco de alimentos» y
 *                           «banco de sangre» no son bancos. Van a AMPLIAS.
 *   `EPS`                   tres letras que colisionan con poliestireno expandido y
 *                           con «earnings per share». Ni alias ni ancla.
 *   `CPG`, `FMCG alimentos`,
 *   `consumo masivo`        nombran la CATEGORÍA, no la fabricación (§ 17). AMPLIAS.
 *   `protección de datos`   lo usan despachos de abogados y consultoras de
 *                           cumplimiento tanto como las firmas de seguridad. Fuera.
 *   `infosec`, `cybersecurity`,
 *   `seguridad informática` inequívocos, pero entran como ANCLAS —evidencia—, no
 *                           como identidad de la regla (§ 5).
 *
 * ── Términos de búsqueda que NO son anclas (§ 4) ──────────────────────────────
 *
 * Los `keyword` del catálogo son FRASES DE CONSULTA («droguerías cadena retail
 * farmacia», «corporativo banca empresas», «grupo hospitalario clínicas»), no
 * anclas. Ninguna se promovió entera. Cuando de una frase se extrajo un fragmento
 * —`grupo hospitalario`, `red de laboratorios`, `escuela de negocios`— fue por
 * revisión manual del fragmento, no por partir la frase en tokens.
 *
 * `subindustryId` y `catalogVersionId` siguen en `null`: estas reglas son
 * code-owned y la precisión no recibe la versión del catálogo (§ 26).
 */
const WAVE_1_CONFIRM_ONLY_RULE_SETS: readonly SubindustryPrecisionRuleSet[] = [
  {
    key: 'banca tradicional',
    canonicalName: 'Banca Tradicional',
    subindustryId: null,
    precisionAliases: [],
    mode: 'confirm_only',
    catalogVersionId: null,
    anchors: [
      // `banking` es el valor de Apollo para la banca comercial, y el único de las
      // nueve reglas OBSERVADO en Producción. Sus hermanas —`investment banking`,
      // `capital markets`, `investment management`— son valores distintos y están
      // declaradas abajo como contradictorias y en conflicto.
      'banking',
      'retail banking',
      'commercial banking',
      'credit institution',
      // Español
      'banca comercial',
      'banca minorista',
      'banca de personas',
      'banca empresarial',
      'banco comercial',
      'bancos comerciales',
      'banco multiple',
      'entidad bancaria',
      'entidades bancarias',
      'institucion bancaria',
      'instituciones bancarias',
      'establecimiento bancario',
      'establecimientos bancarios',
      'caja de ahorros',
      'cooperativa de ahorro y credito',
    ],
    anchorFamilies: null,
    exclusiveBusinessModels: [
      // Tecnología financiera: comparte el vocabulario de la banca sin ser un banco.
      'neobank',
      'neobanco',
      'challenger bank',
      'banking as a service',
      'core banking software',
      'banking software',
      'software bancario',
      'fintech platform',
      'payment processor',
      'procesador de pagos',
      'pasarela de pagos',
      'payment gateway',
    ],
    conflictingBusinessModels: [
      // Hermanas de Servicios Financieros: pueden coexistir en la ficha de un banco
      // universal, y por sí solas no demuestran banca comercial.
      'investment banking',
      'banca de inversion',
      'capital markets',
      'mercado de capitales',
      'investment management',
      'asset management',
      'gestion de activos',
      'administradora de fondos',
      'private equity',
      'venture capital',
      'hedge fund',
      'fondo de inversion',
      'brokerage',
      'comisionista de bolsa',
      'casa de bolsa',
      'stock broker',
      'fintech',
      'insurtech',
      'factoring',
      'microfinanzas',
      'microfinance',
    ],
    broadProviderIndustries: [
      // § 7 — `financial services` por sí solo NO confirma banca tradicional.
      'financial services',
      'servicios financieros',
      'finance',
      'financiero',
      // § 5 — los alias `banco`/`bank` viven aquí, no en las anclas: su único
      // efecto posible es «por confirmar».
      'banca',
      'banco',
      'bank',
      'banks',
      'credit',
      'credito',
      'lending',
      'consumer lending',
    ],
    contradictoryProviderIndustries: [
      // `retail` a secas NO está: es token de `retail banking`, que es un POSITIVO
      // de esta regla, y declararlo contradictorio rechazaría a la banca minorista.
      // Lo mismo con `internet`, token de «internet banking».
      'investment banking',
      'capital markets',
      'investment management',
      'venture capital & private equity',
      'insurance',
      'seguros',
      'accounting',
      'management consulting',
      'software',
      'computer software',
      'saas',
      'information technology',
      'real estate',
      'education management',
      'hospital & health care',
    ],
    metadata: {
      rationale:
        'Ola 1 · confirm_only. `banking` es el único valor de industria de proveedor ' +
        'observado en Prod para esta subindustria; sus hermanas de inversión y mercado ' +
        'de capitales son valores distintos y se declaran negativas. Los alias de ' +
        'catálogo `banco` y `bank` NO se promueven: son palabras genéricas de una pieza.',
    },
  },
  {
    key: 'farmacias cadena y retail de salud',
    canonicalName: 'Farmacias Cadena y Retail de Salud',
    subindustryId: null,
    precisionAliases: [],
    mode: 'confirm_only',
    catalogVersionId: null,
    anchors: [
      'farmacia',
      'farmacias',
      'cadena de farmacias',
      'cadenas de farmacias',
      'drogueria',
      'droguerias',
      'botica',
      'boticas',
      'pharmacy',
      'pharmacies',
      'pharmacy chain',
      'pharmacy chains',
      'chain pharmacy',
      'retail pharmacy',
      'drugstore',
      'drugstores',
      'drug store',
      'drug stores',
    ],
    anchorFamilies: null,
    exclusiveBusinessModels: [
      // § 11 — fabricación y distribución farmacéutica comparten el vocabulario de
      // «pharma» sin ser retail de farmacia.
      'laboratorio farmaceutico',
      'laboratorios farmaceuticos',
      'pharmaceutical manufacturer',
      'pharmaceutical manufacturing',
      'fabricante de medicamentos',
      'fabricantes de medicamentos',
      'drug manufacturer',
      'drug manufacturing',
      'distribuidor farmaceutico',
      'distribuidores farmaceuticos',
      'distribucion farmaceutica',
      'pharmaceutical distributor',
      'pharmaceutical distribution',
      'wholesale distributor',
      'venta al por mayor',
      'contract research organization',
    ],
    conflictingBusinessModels: [
      // § 11 — la farmacia de un hospital o de una clínica no es una cadena de
      // farmacias, y `farmacia`/`pharmacy` casan dentro de ambas formas.
      'farmacia hospitalaria',
      'hospital pharmacy',
      'farmacia clinica',
      'clinical pharmacy',
      // Formas COMPUESTAS: `hospital` y `clinica` a secas NO pueden estar aquí. Son
      // tokens de `hospital & health care`, la industria que Apollo asigna a toda la
      // salud, y las listas de modelo de negocio se comprueban contra TODOS los
      // campos clasificadores —incluida la industria—. Con la palabra suelta, una
      // cadena de farmacias clasificada en esa industria quedaba en conflicto
      // consigo misma y no podía confirmar nunca.
      'red hospitalaria',
      'grupo hospitalario',
      'hospital privado',
      'clinica privada',
      'centro medico',
      'laboratorio clinico',
      'clinical laboratory',
      'eps',
      'medicina prepagada',
      'veterinaria',
      'veterinary',
      'telemedicina',
      'telemedicine',
      'healthtech',
      'marketplace',
      'ecommerce platform',
      'delivery app',
      'domicilios',
    ],
    broadProviderIndustries: [
      'retail',
      'retailer',
      'consumer goods',
      'comercio',
      'consumo',
      'wholesale',
      // La industria de Apollo para la salud y para el sector farmacéutico contiene
      // a la subindustria sin demostrarla; con un ancla en otro campo, confirma.
      'health care',
      'healthcare',
      'salud',
      'pharmaceuticals',
      'pharmaceutical',
      'farmaceutica',
    ],
    contradictoryProviderIndustries: [
      // `hospital & health care` NO está: casa `health care`, que es AMPLIO, y una
      // cadena de farmacias clasificada así seguiría pudiendo confirmar por ancla.
      'biotechnology',
      'medical devices',
      'chemicals',
      'software',
      'saas',
      'information technology',
      'insurance',
      'banking',
      'financial services',
      'consulting',
      'education management',
      'food production',
      'agriculture',
    ],
    metadata: {
      rationale:
        'Ola 1 · confirm_only. § 11 — el riesgo no es «pharma» sino confundir el ' +
        'retail de farmacia con el laboratorio, el distribuidor y la farmacia ' +
        'hospitalaria; las tres se declaran negativas y las dos últimas contienen el ' +
        'ancla `farmacia`, así que sólo abstención es posible ahí.',
    },
  },
  {
    key: 'medicina prepagada y eps',
    canonicalName: 'Medicina Prepagada y EPS',
    subindustryId: null,
    precisionAliases: [],
    mode: 'confirm_only',
    catalogVersionId: null,
    anchors: [
      // § 12 — `EPS` a secas NO es ancla: tres letras que colisionan con el
      // poliestireno expandido y con «earnings per share». La forma desplegada sí.
      'entidad promotora de salud',
      'entidades promotoras de salud',
      'medicina prepagada',
      'isapre',
      'isapres',
      'plano de saude',
      'planos de saude',
      'operadora de saude',
      'operadoras de saude',
      'plan de salud corporativo',
      'planes de salud corporativos',
      'plan complementario de salud',
      'prepaid health plan',
      'prepaid medicine',
      'health maintenance organization',
      'aseguradora en salud',
      'aseguradoras en salud',
    ],
    anchorFamilies: null,
    exclusiveBusinessModels: [
      // § 12 — seguros generales y su intermediación no son aseguramiento en salud.
      'seguros generales',
      'life insurance',
      'seguro de vida',
      'auto insurance',
      'seguro de automoviles',
      'property insurance',
      'insurance broker',
      'insurance brokerage',
      'corredor de seguros',
      'corredores de seguros',
      'reinsurance',
      'reaseguro',
      // Prestadores y proveedores: el otro lado de la relación.
      'laboratorio clinico',
      'clinical laboratory',
      'farmacia',
      'drogueria',
    ],
    conflictingBusinessModels: [
      // § 12 — hospitales y clínicas son el PRESTADOR, no el asegurador. El propio
      // catálogo lo declara como exclusión de esta subindustria.
      //
      // En forma COMPUESTA, y no por gusto: `hospital` a secas es token de
      // `hospital & health care`, la industria que Apollo asigna a toda la salud —y
      // que esta regla declara AMPLIA—. Como los modelos de negocio se comprueban
      // contra todos los campos clasificadores, la palabra suelta ponía en conflicto
      // a cualquier EPS clasificada en su propia industria padre, y la regla no podía
      // confirmar nunca.
      'red hospitalaria',
      'redes hospitalarias',
      'grupo hospitalario',
      'hospital privado',
      'hospitales privados',
      'clinica privada',
      'clinicas privadas',
      'centro medico',
      'institucion prestadora de servicios de salud',
      'consultorio',
      'medical practice',
      'telemedicina',
      'telemedicine',
      'healthtech',
      'health tech',
      'software',
      'saas',
    ],
    broadProviderIndustries: [
      // § 12 — ni `salud` ni `insurance` confirman por sí solos.
      'insurance',
      'seguros',
      'health insurance',
      'health care',
      'healthcare',
      'hospital & health care',
      'salud',
      'medicina',
    ],
    contradictoryProviderIndustries: [
      // `insurance` a secas NO está: es AMPLIO, y una EPS clasificada así debe poder
      // confirmar por ancla. Las formas COMPUESTAS de seguro no-salud sí contradicen.
      'life insurance',
      'auto insurance',
      'property & casualty insurance',
      'insurance brokers',
      'reinsurance',
      'pharmaceuticals',
      'medical devices',
      'biotechnology',
      'banking',
      'software',
      'information technology',
      'education management',
      'retail',
      'construction',
    ],
    metadata: {
      rationale:
        'Ola 1 · confirm_only. § 12 — el alias más específico del catálogo (`EPS`) es ' +
        'inutilizable como ancla por longitud; la regla se sostiene en las formas ' +
        'desplegadas y en los términos locales inequívocos (`ISAPRE`, `plano de saúde`, ' +
        '`medicina prepagada`). Hospitales y seguros generales se declaran negativos.',
    },
  },
  {
    key: 'universidades e institutos privados',
    canonicalName: 'Universidades e Institutos Privados',
    subindustryId: null,
    precisionAliases: [],
    mode: 'confirm_only',
    catalogVersionId: null,
    anchors: [
      'universidad',
      'universidades',
      'universidade',
      'university',
      'universities',
      'universidad privada',
      'universidades privadas',
      'private university',
      // § 13 — la forma con `institution` confirma; `higher education` a secas es
      // AMPLIA y no casa esta secuencia de tres tokens.
      'higher education institution',
      'higher education institutions',
      'institucion de educacion superior',
      'instituciones de educacion superior',
      'instituto de educacion superior',
      'institutos de educacion superior',
      'campus universitario',
    ],
    anchorFamilies: null,
    exclusiveBusinessModels: [
      // El propio catálogo declara «universidad pública estatal» como exclusión.
      'universidad publica',
      'universidades publicas',
      'universidad estatal',
      'universidad nacional',
      'public university',
      'state university',
      'plataforma de aprendizaje',
      'learning management system',
      'e-learning platform',
      'edtech',
    ],
    conflictingBusinessModels: [
      // § 13 — la universidad CORPORATIVA es formación de empresa, no educación
      // superior, y `universidad` casa dentro de ella.
      'universidad corporativa',
      'corporate university',
      'corporate training',
      'formacion corporativa',
      'capacitacion empresarial',
      'formacion in company',
      // Hermanas de Educación.
      'escuela de negocios',
      'business school',
      'executive education',
      'educacion ejecutiva',
      'instituto tecnico',
      'institutos tecnicos',
      'instituto tecnologico',
      'vocational training',
      'formacion vocacional',
      'colegio',
      'colegios',
      'bootcamp',
      'academia de idiomas',
      'language school',
      'consultoria',
      'consulting',
    ],
    broadProviderIndustries: [
      // § 13 — parent-only: ninguno de estos confirma.
      'education',
      'educacion',
      'higher education',
      'education management',
      'educational services',
      'e-learning',
      'training',
    ],
    contradictoryProviderIndustries: [
      'primary/secondary education',
      'government administration',
      'staffing & recruiting',
      'management consulting',
      'publishing',
      'software',
      'saas',
      'information technology',
      'banking',
      'financial services',
      'retail',
      'hospital & health care',
    ],
    metadata: {
      rationale:
        'Ola 1 · confirm_only. § 13 — `education`, `higher education` y `education ' +
        'management` quedan AMPLIAS a propósito: son la industria padre y no pueden ' +
        'confirmar la hija. La universidad corporativa y las escuelas de negocios se ' +
        'declaran en conflicto porque `universidad` casa dentro de la primera.',
    },
  },
  {
    key: 'ciberseguridad',
    canonicalName: 'Ciberseguridad',
    subindustryId: null,
    precisionAliases: [],
    mode: 'confirm_only',
    catalogVersionId: null,
    anchors: [
      // § 14 — ninguna ancla es `security`, `seguridad`, `software` ni `IT` a secas.
      'ciberseguridad',
      'cybersecurity',
      'cyber security',
      'seguridad informatica',
      'seguridad de la informacion',
      'information security',
      'infosec',
      // Casa dentro de `computer & network security`, el valor de Apollo para el
      // sector, y NO dentro de `information technology` ni `software`.
      'network security',
      'endpoint security',
      'application security',
      'cloud security',
      'threat intelligence',
      'vulnerability management',
      'gestion de vulnerabilidades',
      'penetration testing',
      'pentesting',
      'ethical hacking',
      'hacking etico',
      'security operations center',
      'centro de operaciones de seguridad',
      'managed security services',
      'servicios de seguridad gestionados',
      'identity and access management',
      'zero trust',
      'siem',
    ],
    anchorFamilies: null,
    exclusiveBusinessModels: [
      // El catálogo declara «antivirus consumidor final» como exclusión.
      'antivirus consumidor final',
      'consumer antivirus',
      // Seguridad FÍSICA: en la región es el uso más frecuente de «seguridad», y no
      // es ciberseguridad.
      'seguridad fisica',
      'physical security',
      'vigilancia privada',
      'guardias de seguridad',
      'security guards',
      'private security',
      'circuito cerrado de television',
      'alarmas',
    ],
    conflictingBusinessModels: [
      'it services',
      'servicios de ti',
      'it consulting',
      'consultoria de ti',
      'system integrator',
      'integrador de sistemas',
      'telecomunicaciones',
      'internet service provider',
      'cloud provider',
      'hosting',
      'data center',
      'centro de datos',
      'staffing',
      'outsourcing',
      'legal services',
      'abogados',
      'bufete',
    ],
    broadProviderIndustries: [
      // § 14 — `security` y `seguridad` sueltos sólo pueden producir ambiguo.
      'security',
      'seguridad',
      'software',
      'computer software',
      'saas',
      'information technology',
      'tecnologia',
      'internet',
    ],
    contradictoryProviderIndustries: [
      // El valor de Apollo para la seguridad física y las investigaciones.
      'security & investigations',
      'telecommunications',
      'staffing & recruiting',
      'law practice',
      'insurance',
      'banking',
      'financial services',
      'retail',
      'education management',
      'construction',
      'real estate',
      'hospital & health care',
    ],
    metadata: {
      rationale:
        'Ola 1 · confirm_only. § 14 — el alias de catálogo `protección de datos` NO se ' +
        'promueve: lo usan despachos de abogados y consultoras de cumplimiento tanto ' +
        'como las firmas de seguridad. `SOC` tampoco: casa dentro de «SOC 2», que ' +
        'cualquier SaaS declara. La seguridad FÍSICA se declara excluyente.',
    },
  },
  {
    key: 'redes hospitalarias y clinicas',
    canonicalName: 'Redes Hospitalarias y Clínicas',
    subindustryId: null,
    precisionAliases: [],
    mode: 'confirm_only',
    catalogVersionId: null,
    anchors: [
      // § 15 — `hospital` y `clinica` a secas están DELIBERADAMENTE fuera. `hospital`
      // es token de `hospital & health care`, el valor de Apollo para TODA la salud:
      // con él, un laboratorio clínico, una EPS o una cadena de farmacias quedaban
      // confirmados como red hospitalaria por su industria PADRE. Sólo confirman las
      // formas compuestas, que son además las que el catálogo publica como alias.
      'red hospitalaria',
      'redes hospitalarias',
      'grupo hospitalario',
      'grupos hospitalarios',
      'hospital network',
      'hospital networks',
      'hospital privado',
      'hospitales privados',
      'private hospital',
      'private hospitals',
      'hospital universitario',
      'clinica privada',
      'clinicas privadas',
      'private clinic',
      'centro medico',
      'centros medicos',
      'medical center',
      'medical centers',
      'institucion prestadora de servicios de salud',
    ],
    anchorFamilies: null,
    exclusiveBusinessModels: [
      // El catálogo declara «hospital público gobierno» como exclusión.
      'hospital publico',
      'hospitales publicos',
      'public hospital',
      'hospital del gobierno',
      'secretaria de salud',
      'ministerio de salud',
      // Y «empresa tecnología salud plataforma».
      'hospital software',
      'healthcare software',
      'software hospitalario',
      'suministros hospitalarios',
      'hospital supplies',
      'proveedor hospitalario',
      'dispositivos medicos',
      'equipos medicos',
      'clinica veterinaria',
      'veterinary clinic',
      'veterinary hospital',
    ],
    conflictingBusinessModels: [
      // Hermanas de Salud: comparten la industria padre y no son red hospitalaria.
      'laboratorio clinico',
      'laboratorios clinicos',
      'clinical laboratory',
      'diagnostic laboratory',
      'laboratorio de diagnostico',
      'entidad promotora de salud',
      'medicina prepagada',
      'isapre',
      'plano de saude',
      'eps',
      'farmacia',
      'drogueria',
      'pharmacy',
      'telemedicina',
      'telemedicine',
      'healthtech',
      'consultorio',
      'consultorios',
      'clinica dental',
      'dental clinic',
      'medicina estetica',
      'clinica estetica',
      'universidad',
      'university',
    ],
    broadProviderIndustries: [
      // § 15 — la industria padre de Apollo queda AMPLIA: por sí sola, ambiguo.
      'hospital & health care',
      'health care',
      'healthcare',
      'salud',
      'medical practice',
      'medicina',
    ],
    contradictoryProviderIndustries: [
      'pharmaceuticals',
      'biotechnology',
      'medical devices',
      'software',
      'saas',
      'information technology',
      'insurance',
      'banking',
      'financial services',
      'retail',
      'education management',
      'construction',
      'veterinary',
    ],
    metadata: {
      rationale:
        'Ola 1 · confirm_only. El defecto que la forma COMPUESTA evita: con `hospital` ' +
        'como ancla de una palabra, la industria `hospital & health care` —que Apollo ' +
        'asigna a toda la salud, incluidas EPS, laboratorios y farmacias— confirmaba ' +
        'esta subindustria por sí sola, que es exactamente el parent-only que el § 15 ' +
        'prohíbe. Coste aceptado: «Hospital San X» en el nombre comercial ya no ' +
        'confirma; en confirm_only un falso negativo es inerte.',
    },
  },
  {
    key: 'laboratorios clinicos y diagnostico',
    canonicalName: 'Laboratorios Clínicos y Diagnóstico',
    subindustryId: null,
    precisionAliases: [],
    mode: 'confirm_only',
    catalogVersionId: null,
    anchors: [
      // § 16 — ninguna ancla es `laboratorio`/`laboratory` a secas: todas nombran el
      // análisis o el diagnóstico clínico.
      'laboratorio clinico',
      'laboratorios clinicos',
      'clinical laboratory',
      'clinical laboratories',
      'clinical lab',
      'clinical labs',
      'medical laboratory',
      'medical laboratories',
      'laboratorio de diagnostico',
      'laboratorios de diagnostico',
      'diagnostic laboratory',
      'diagnostic laboratories',
      'analisis clinicos',
      'laboratorio de analisis clinicos',
      'patologia clinica',
      'medical diagnostics',
      'diagnostico medico',
      'red de laboratorios',
      'toma de muestras',
      'imagenes diagnosticas',
      'diagnostic imaging',
    ],
    anchorFamilies: null,
    exclusiveBusinessModels: [
      // § 16 — el laboratorio FARMACÉUTICO y el de investigación no son diagnóstico.
      'laboratorio farmaceutico',
      'laboratorios farmaceuticos',
      'pharmaceutical laboratory',
      'pharmaceutical manufacturer',
      'pharmaceutical manufacturing',
      'fabricante de medicamentos',
      'drug manufacturer',
      'laboratorio de investigacion',
      'research laboratory',
      'contract research organization',
      'laboratorio de alimentos',
      'laboratorio ambiental',
      'environmental laboratory',
      'laboratorio veterinario',
      'veterinary laboratory',
    ],
    conflictingBusinessModels: [
      // Formas COMPUESTAS. `hospital` a secas aquí era un DEFECTO medido: es token de
      // `hospital & health care`, la industria que Apollo asigna a toda la salud y la
      // clasificación más probable de un laboratorio clínico. Como los modelos de
      // negocio se comprueban contra todos los campos clasificadores —la industria
      // incluida—, la palabra suelta ponía en conflicto al laboratorio con su propia
      // industria padre: con ancla quedaba `ambiguous` y la regla no podía confirmar
      // a NADIE por esa vía. Es el mismo defecto de parent-only que obligó a
      // «Redes Hospitalarias» a usar sólo anclas compuestas, visto del otro lado.
      'red hospitalaria',
      'redes hospitalarias',
      'grupo hospitalario',
      'hospital privado',
      'clinica privada',
      'centro medico',
      'universidad',
      'university',
      'instituto de investigacion',
      'research institute',
      'entidad promotora de salud',
      'medicina prepagada',
      'eps',
      'farmacia',
      'drogueria',
      'reactivos',
      'software',
      'saas',
    ],
    broadProviderIndustries: [
      // § 16 — `laboratorio`/`laboratory` sueltos: sólo ambiguo.
      'laboratory',
      'laboratories',
      'laboratorio',
      'diagnostics',
      'hospital & health care',
      'health care',
      'healthcare',
      'salud',
      'medical practice',
    ],
    contradictoryProviderIndustries: [
      'pharmaceuticals',
      'biotechnology',
      'medical devices',
      'chemicals',
      'higher education',
      'education management',
      'software',
      'saas',
      'information technology',
      'banking',
      'financial services',
      'insurance',
      'retail',
      'food production',
      'agriculture',
    ],
    metadata: {
      rationale:
        'Ola 1 · confirm_only. § 16 — la separación que la regla sostiene es ' +
        '`laboratorio clínico` frente a `laboratorio farmacéutico`: el primero es ' +
        'ancla, el segundo excluyente, y `laboratorio` a secas es AMPLIO para que ' +
        'ninguno de los dos se confirme por la palabra compartida.',
    },
  },
  {
    key: 'fabricantes de alimentos y bebidas (fmcg)',
    canonicalName: 'Fabricantes de Alimentos y Bebidas (FMCG)',
    subindustryId: null,
    precisionAliases: [],
    mode: 'confirm_only',
    catalogVersionId: null,
    anchors: [
      // § 17 — cada ancla nombra la FABRICACIÓN. Ninguna es una categoría de
      // producto: `alimentos`, `bebidas`, `FMCG`, `CPG` y `consumo masivo` viven en
      // AMPLIAS, y son además los alias que el § 5 rehúsa promover.
      'fabricante de alimentos',
      'fabricantes de alimentos',
      'fabricante de bebidas',
      'fabricantes de bebidas',
      'food manufacturer',
      'food manufacturers',
      'food manufacturing',
      'food production',
      'food processing',
      'beverage manufacturer',
      'beverage manufacturers',
      'beverage manufacturing',
      'beverage production',
      'food and beverage manufacturing',
      'produccion de alimentos',
      'produccion de bebidas',
      'procesamiento de alimentos',
      'planta procesadora de alimentos',
      'industria de alimentos',
      'consumer packaged goods',
      'embotelladora',
      'embotelladoras',
      'bottling company',
      'bottler',
      'cerveceria',
      'brewery',
      'breweries',
    ],
    anchorFamilies: null,
    exclusiveBusinessModels: [
      // § 17 — distribución, servicio de comida y venta al por mayor no fabrican.
      'distribuidor de alimentos',
      'distribuidores de alimentos',
      'distribucion de alimentos',
      'food distributor',
      'food distributors',
      'food distribution',
      'restaurante',
      'restaurantes',
      'restaurant',
      'restaurants',
      'cadena de restaurantes',
      'food service',
      'foodservice',
      'catering',
      'wholesale distributor',
      'distribuidor mayorista',
      'venta al por mayor',
      'delivery app',
      'domicilios',
    ],
    conflictingBusinessModels: [
      // § 17 — el canal RETAIL coexiste con la fabricación (un fabricante vende a
      // supermercados) pero no la demuestra. Es también el par de conflicto que las
      // dos reglas `full` ya declaraban en sentido inverso.
      'supermercado',
      'supermercados',
      'hipermercado',
      'hipermercados',
      'supermarket',
      'supermarkets',
      'grocery store',
      'grocery stores',
      'retailer',
      'marketplace',
      'ecommerce platform',
      'importador',
      'importer',
      'trading company',
      'packaging',
      'envases',
    ],
    broadProviderIndustries: [
      // § 17 — la categoría por sí sola nunca demuestra fabricación.
      'food',
      'foods',
      'food and beverages',
      'food & beverages',
      'beverage',
      'beverages',
      'alimentos',
      'bebidas',
      'consumer goods',
      'retail',
      'comercio',
      'consumo',
      'manufacturing',
      'fmcg',
      'cpg',
      'consumo masivo',
    ],
    contradictoryProviderIndustries: [
      'restaurants',
      'hospitality',
      'agriculture',
      'farming',
      'supermarkets',
      'banking',
      'financial services',
      'insurance',
      'software',
      'saas',
      'information technology',
      'consulting',
      'pharmaceuticals',
      'hospital & health care',
      'education management',
      'construction',
      'real estate',
      'apparel & fashion',
    ],
    metadata: {
      rationale:
        'Ola 1 · confirm_only. § 17 — cierra un par de conflicto YA activo: ' +
        '`food production` y `fabricante de alimentos` son hoy contradicciones ' +
        'declaradas de «Tiendas por Departamento, Moda y Calzado», así que un ' +
        'fabricante pedido junto a ella queda rechazado por esa regla `full` y ' +
        'confirmado por esta — y el ANY-OF resuelve a confirmado, que es el desenlace ' +
        'correcto y el caso que el § 20 exige probar.',
    },
  },
  {
    key: 'escuelas de negocios y formacion ejecutiva',
    canonicalName: 'Escuelas de Negocios y Formación Ejecutiva',
    subindustryId: null,
    precisionAliases: [],
    mode: 'confirm_only',
    catalogVersionId: null,
    anchors: [
      // § 18 — evidencia específica de escuela de negocios o de programa ejecutivo.
      // `formacion ejecutiva` entra porque es literalmente la mitad del nombre
      // canónico publicado y el término del propio catálogo.
      'escuela de negocios',
      'escuelas de negocios',
      'escola de negocios',
      'business school',
      'business schools',
      'management school',
      'escuela de direccion',
      'escuela de administracion',
      'executive education',
      'educacion ejecutiva',
      'formacion ejecutiva',
      'executive mba',
      'mba ejecutivo',
      'programa de alta direccion',
      'programas de alta direccion',
      'executive development program',
    ],
    anchorFamilies: null,
    exclusiveBusinessModels: [
      // El catálogo declara «plataforma LMS e-learning tecnológica» como exclusión de
      // la hermana Formación Corporativa; aquí vale igual.
      'plataforma de aprendizaje',
      'plataforma lms',
      'learning management system',
      'e-learning platform',
      'edtech',
      'colegio',
      'primary school',
      'secondary school',
      'bootcamp',
      'academia de idiomas',
      'staffing',
      'reclutamiento',
    ],
    conflictingBusinessModels: [
      // § 18 y § 21 — «Formación Corporativa y Corporate Training» sigue SIN mapeo a
      // propósito. Declararla en conflicto es lo que impide que un proveedor de
      // capacitación de empresa se confirme bajo esta etiqueta.
      'corporate training',
      'formacion corporativa',
      'capacitacion empresarial',
      'formacion in company',
      'proveedor de capacitacion',
      'training provider',
      // Hermana Universidades: una universidad completa confirma la suya, no ésta.
      'universidad',
      'universidades',
      'university',
      'instituto de educacion superior',
      'certificacion profesional',
      'professional certification',
      'consultoria',
      'consulting',
      'management consulting',
      'consultora',
    ],
    broadProviderIndustries: [
      // § 7 — `professional training & coaching` es el ÚNICO valor de proveedor
      // observado, y Prod lo comparte entre Formación Corporativa, Escuelas de
      // Negocios y Certificación B2B. Por eso es AMPLIO y nunca confirma.
      'professional training & coaching',
      'education',
      'educacion',
      'higher education',
      'education management',
      'educational services',
      'e-learning',
      'training',
      'management',
    ],
    contradictoryProviderIndustries: [
      'primary/secondary education',
      'government administration',
      'staffing & recruiting',
      'publishing',
      'software',
      'saas',
      'information technology',
      'banking',
      'financial services',
      'insurance',
      'retail',
      'hospital & health care',
      'construction',
    ],
    metadata: {
      rationale:
        'Ola 1 · confirm_only. § 18 — la frontera que sostiene es con Formación ' +
        'Corporativa, que el § 21 mantiene sin mapeo: sus términos se declaran en ' +
        'conflicto para que la superposición ABSTENGA en vez de confirmar. ' +
        '`professional training & coaching` queda AMPLIO porque Prod lo observa ' +
        'repartido entre tres subindustrias.',
    },
  },
];

// ─── El registro (§ 4) ────────────────────────────────────────────────────────

/**
 * Las subindustrias con política de PRECISIÓN: las DOS de siempre en `full`, más
 * las NUEVE de la Ola 1 en `confirm_only`.
 *
 * El ratchet de cobertura de la suite falla si el conteo deja de ser 11, si alguna
 * de las dos históricas deja de ser `full`, o si alguna de las nueve nuevas deja de
 * ser `confirm_only`. El validador de colisiones falla si dos reglas comparten
 * identidad.
 *
 * «Formación Corporativa» NO está aquí a propósito (§ 21): sigue siendo buscable y
 * revisable, y no obtiene mapeo de precisión, ni auto-confirmación, ni conteo
 * hacia el objetivo por una regla nueva. Es la subindustria con MÁS demanda
 * observada sin mapear (13 búsquedas), y esa decisión es de la dueña del producto,
 * no del diseño.
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
  // PHASE 2C · Ola 1. Se concatenan al final para que el ORDEN de las dos reglas
  // `full` no cambie: de él dependen los desempates de atribución del ANY-OF.
  ...WAVE_1_CONFIRM_ONLY_RULE_SETS,
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

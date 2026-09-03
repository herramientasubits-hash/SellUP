/**
 * macro-industries.ts — Las 12 Macro Industrias, sus claves canónicas y sus
 * términos de descubrimiento y de evidencia.
 *
 * AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 · §§ 4, 5, 14, 15, 17 y 24.
 *
 * ── Qué gobierna este archivo ─────────────────────────────────────────────────
 *
 * Es la ÚNICA fuente de verdad de la taxonomía macro en código:
 *
 *   - la clave canónica (`key`), que es lo que la lógica usa;
 *   - el nombre visible (`displayName`), que es lo que la persona lee;
 *   - el `slug` publicado en base de datos;
 *   - los términos de DESCUBRIMIENTO (qué se le pregunta al proveedor);
 *   - los términos de EVIDENCIA (qué demuestra pertenencia después de pagar).
 *
 * § 14 prohíbe un segundo hardcode disperso: ningún módulo puede escribir sus
 * propios términos macro. El catálogo publicado en base de datos (migración
 * `118_publish_macro_industry_catalog_v2.sql`) se SIEMBRA con estos mismos
 * `slug`, `displayName` y `sortOrder`, y una prueba de la suite compara ambos
 * literalmente para que no puedan derivar.
 *
 * ── Por qué `key` y `displayName` están separados (§ 4) ───────────────────────
 *
 * Ninguna decisión puede depender del nombre visible. «Gas / Petróleo / Energía /
 * Minería / Medio Ambiente» lleva barras, acentos y cinco conceptos: usarlo como
 * identificador ataría la lógica a una cadena que el negocio querrá reescribir.
 * La clave es estable y ASCII; el nombre visible puede cambiar sin tocar código.
 *
 * ── Por qué los términos vienen en TRES cubetas (§ 15) ────────────────────────
 *
 * El retest de Salud (lote `74a49b01`, 2026-08-12) devolvió LAS MISMAS 20
 * empresas que RUN 1 pese a haber cambiado una keyword: `health` y `healthcare`
 * dominaban el OR y los términos específicos no movían nada. Un OR plano de
 * términos amplios y específicos hace que los amplios ganen siempre, porque
 * coinciden con más empresas.
 *
 * De ahí la separación:
 *
 *   `specific`   Términos comerciales que sólo aparecen en un miembro REAL de la
 *                macro industria. Son los que redactan la hipótesis.
 *   `broad`      Términos del padre. Amplían cobertura pero no discriminan: el
 *                redactor los raciona (ver `apollo-macro-industry-query-terms`).
 *   `exclusions` Señales que, en la industria DECLARADA por el proveedor,
 *                contradicen la macro industria. Nunca viajan al proveedor —
 *                Apollo no acepta exclusión de keywords en
 *                `mixed_companies/search` — y se aplican localmente.
 *
 * ── Evidencia ≠ descubrimiento (§ 10 y § 24) ──────────────────────────────────
 *
 * `evidence.confirming` no es `discovery.specific`. Descubrir es preguntar;
 * confirmar es leer lo que el proveedor respondió. Un término puede ser una buena
 * pregunta y una mala prueba (`logistics` encuentra operadores logísticos y
 * también el departamento de logística de una minera). La evidencia es
 * deliberadamente más estrecha.
 *
 * Y no se mezcla con la precisión de subindustria: § 24 lo prohíbe explícitamente.
 * Las reglas de subindustria (`apollo-subindustry-precision`) siguen intactas y
 * dormidas; este archivo no las lee ni las nombra.
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

// ─── Versión del catálogo macro ───────────────────────────────────────────────

/**
 * Versión que esta taxonomía publica. Es la MISMA cadena que la migración
 * escribe en `industry_catalog_versions.version`, y la que el wizard envía como
 * `catalogVersion`.
 *
 * La versión 1.0.0 (8 industrias / 73 subindustrias) NO desaparece: queda
 * archivada y consultable para reproducir corridas históricas (§ 3 y § 21).
 */
export const MACRO_INDUSTRY_CATALOG_VERSION = '2.0.0';

/** Versión del catálogo legacy de industria + subindustria. Sólo para routing. */
export const LEGACY_INDUSTRY_CATALOG_VERSION = '1.0.0';

// ─── Claves canónicas ─────────────────────────────────────────────────────────

/**
 * Las 12 claves canónicas. Estables, ASCII, independientes del nombre visible.
 *
 * El orden de esta tupla ES el orden de presentación (`sortOrder` = índice + 1).
 */
export const MACRO_INDUSTRY_KEYS = [
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

export type MacroIndustryKey = (typeof MACRO_INDUSTRY_KEYS)[number];

/** Cuántas macro industrias existen. Fijado por contrato de producto (§ 28). */
export const MACRO_INDUSTRY_COUNT = 12;

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * A1-APOLLO-QUERY-QUALITY-V3-A § 2 — una FAMILIA SEMÁNTICA de la macro industria.
 *
 * ── El defecto que las familias cierran ──────────────────────────────────────
 *
 * Las dos rondas de una corrida macro emitían el MISMO plan de búsqueda: los
 * mismos `specific` en el mismo orden, así que el mismo `search_plan_fingerprint`
 * y, con él, el mismo universo de paginación. La ronda 2 sólo podía avanzar de
 * página dentro del ranking que la ronda 1 ya había recorrido — nunca preguntar
 * otra cosa.
 *
 * Una macro industria, sin embargo, no es un solo dominio comercial. «Transporte
 * & Logística» contiene operadores logísticos Y transportadores de carga;
 * «Seguros y Servicios Financieros» contiene aseguradoras Y bancos. Preguntar por
 * las dos cosas a la vez, en un OR plano de catorce términos, hace que el ranking
 * de Apollo decida cuál de los dos dominios representa la macro entera.
 *
 * Una familia es una partición DECLARADA de `specific`: un subconjunto disjunto
 * que se puede emitir por sí solo. Cada familia redacta una consulta distinta y,
 * por tanto, produce un `search_plan_fingerprint` distinto — un universo de
 * paginación independiente que arranca en la página 1.
 *
 * ── Lo que una familia NO es ─────────────────────────────────────────────────
 *
 * No es una subindustria: no se publica, no se selecciona en el wizard, no entra
 * en la evidencia y no toca `apollo-subindustry-precision`. Es una forma de
 * partir la PREGUNTA, no la taxonomía.
 *
 * Y no inventa vocabulario: sus términos salen literalmente de `specific`. Una
 * familia con un término que el catálogo no declara sería una hipótesis que nadie
 * calibró.
 */
export type MacroIndustryQueryFamily = {
  /** Clave estable y ASCII. Es lo que viaja como `macroQueryVariantKey`. */
  key: string;
  /** Subconjunto de `specific`. Disjunto respecto de las demás familias. */
  terms: readonly string[];
};

/**
 * Términos de DESCUBRIMIENTO de una macro industria.
 *
 * El redactor de consulta consume estas tres cubetas por separado; nunca las
 * aplana en un solo OR (§ 15).
 */
export type MacroIndustryDiscoveryTerms = {
  /**
   * Términos que sólo aparecen en un miembro real de la macro industria.
   * Redactan la hipótesis y son los primeros en viajar.
   */
  specific: readonly string[];
  /**
   * Términos del padre. Amplios por diseño: amplían la cobertura y NO
   * discriminan. El redactor limita cuántos viajan.
   */
  broad: readonly string[];
  /**
   * Señales que contradicen la macro industria cuando aparecen en la industria
   * DECLARADA por el proveedor. No viajan al proveedor: se aplican localmente
   * antes de cualquier gasto.
   */
  exclusions: readonly string[];
  /**
   * V3-A § 2 — partición semántica de `specific`, en orden de emisión.
   *
   * `families[0]` es la que la ronda 1 emite y la ÚNICA que puede llevar términos
   * amplios: es la que hereda el comportamiento calibrado del § 15. Las demás
   * viajan solas, sin amplios, porque un amplio en una consulta ya estrecha la
   * devuelve al conjunto genérico del que la familia existe para salir.
   *
   * Ausente ⇒ la macro industria no está migrada y las dos rondas se comportan
   * exactamente como antes de este hito.
   */
  families?: readonly MacroIndustryQueryFamily[];
};

/**
 * Términos de EVIDENCIA de una macro industria.
 *
 * Se evalúan SOLO contra campos que el proveedor declara sobre la empresa
 * (industria, keywords, descripciones). Nunca contra el nombre, el dominio ni la
 * consulta que se emitió.
 */
export type MacroIndustryEvidenceTerms = {
  /**
   * Prueban pertenencia. Una coincidencia en un campo declarado ⇒ `confirmed`.
   * Deliberadamente más estrechos que `discovery.specific`.
   */
  confirming: readonly string[];
  /**
   * Industrias del padre que CONTIENEN a la macro industria sin demostrarla.
   * Producen `ambiguous`, jamás `confirmed`: es exactamente el estado que no
   * admite por sí solo.
   */
  parentIndustries: readonly string[];
  /**
   * Industrias declaradas que la EXCLUYEN. Producen `rejected`, y se comprueban
   * ANTES que nada por precedencia de substring.
   */
  excludingIndustries: readonly string[];
};

export type MacroIndustryDefinition = {
  key: MacroIndustryKey;
  /** Nombre exacto de § 5. No se corrige ni se reinterpreta. */
  displayName: string;
  /** `slug` publicado. Derivado mecánicamente de `key`: `_` → `-`. */
  slug: string;
  /** 1-based. Igual al orden de `MACRO_INDUSTRY_KEYS`. */
  sortOrder: number;
  discovery: MacroIndustryDiscoveryTerms;
  evidence: MacroIndustryEvidenceTerms;
};

// ─── Exclusiones transversales ────────────────────────────────────────────────

/**
 * Industrias declaradas que contradicen a CUALQUIER macro industria que no sea
 * la suya propia. Cada definición las hereda salvo donde la macro industria ES
 * una de ellas — por eso se componen explícitamente y no por defecto.
 */
const FINANCIAL_INDUSTRY_TERMS: readonly string[] = [
  'retail banking',
  'commercial banking',
  'investment banking',
  'banking',
  'financial services',
  'insurance',
  'capital markets',
  'venture capital',
];

const SOFTWARE_INDUSTRY_TERMS: readonly string[] = [
  'computer software',
  'software',
  'saas',
  'information technology',
  'internet',
];

/**
 * Industrias declaradas que nombran el COMERCIO como la actividad de la empresa.
 *
 * AGENT1-PREPAID-TECHNOLOGY-CIIU-FALSE-POSITIVE-CORRECTION § 3.
 *
 * ── El defecto que cierran ───────────────────────────────────────────────────
 *
 * Corrida de Producción del 2026-09-01 (lote `2610bda2`, CO / technology /
 * objetivo 5): la fuente gratuita `co_siis_discovery` devolvió CINCO empresas con
 * CIIU `4791`, «Comercio al por menor por correo y por internet», y las cinco
 * contaron contra el objetivo. Hueco 0, proveedor no requerido, Lusha no ejecutó.
 *
 * La palabra que las admitió fue `internet`, término confirmatorio de Tecnología.
 * Pero ahí `internet` no nombra la actividad: nombra el CANAL por el que un
 * minorista vende. `4791` era, además, el ÚNICO código del índice de Tecnología:
 * la cobertura entera de esa macro era este falso positivo.
 *
 * ── Por qué se corrige aquí y no en el término ni en el adaptador ────────────
 *
 * `internet` NO se degrada ni se borra: es un valor de industria REAL que Apollo
 * declara (`industry: "Internet"`) y quitarlo destruiría un verdadero positivo
 * para probar un falso. Y el adaptador CIIU no puede llevar un `if technology
 * then exclude 4791`: § 2 prohíbe una segunda taxonomía.
 *
 * Lo que faltaba era la regla 1 del evaluador —exclusión ANTES que confirmación,
 * medida SÓLO contra la industria declarada—, que existe exactamente para esta
 * clase de precedencia (ver `assessDeclaredMacroIndustryEvidence`). Una empresa
 * cuya industria declarada dice explícitamente que su actividad es comerciar no
 * puede pertenecer a Tecnología porque su descripción mencione un canal.
 *
 * Se declaran las dos lenguas y las dos escalas —minorista y mayorista— porque el
 * mismo modo de fallo es simétrico: `Comercio al por mayor de computadoras` es un
 * distribuidor, no un fabricante de tecnología. `retail` absorbe por substring a
 * `retail banking`, que por eso deja de listarse aparte.
 *
 * 🔴 Alcance deliberado: hoy SÓLO las compone `technology`. Las demás macros
 * tienen códigos de comercio en su índice cuyo PRODUCTO comerciado sí es su
 * dominio (`4773` farmacéuticos → Salud, `4663` materiales de construcción →
 * Propiedad & Construcción), y esa es una decisión de producto distinta que este
 * hito no toma. Ver el informe de seguimiento.
 */
const TRADE_INDUSTRY_TERMS: readonly string[] = [
  'retail',
  'wholesale',
  'comercio al por menor',
  'comercio al por mayor',
  'comercio minorista',
  'comercio mayorista',
];

const PROFESSIONAL_SERVICES_INDUSTRY_TERMS: readonly string[] = [
  'management consulting',
  'consulting',
  'staffing',
  'outsourcing',
  'marketing and advertising',
];

// ─── Las 12 definiciones ──────────────────────────────────────────────────────

/**
 * Nota sobre el idioma de los términos: el catálogo de Prod demuestra que Apollo
 * responde en INGLÉS en el campo `industry` y con frecuencia en ESPAÑOL en
 * `keywords` y en las descripciones de empresas LATAM. Cada cubeta lleva las dos
 * formas a propósito.
 */
export const MACRO_INDUSTRIES: readonly MacroIndustryDefinition[] = [
  {
    key: 'transport_logistics',
    displayName: 'Transporte & Logística',
    slug: 'transport-logistics',
    sortOrder: 1,
    discovery: {
      specific: [
        'operador logistico',
        'third party logistics',
        'freight forwarder',
        'transporte de carga',
        'agencia de aduana',
        'customs broker',
        'courier',
        'mensajeria empresarial',
        'warehousing',
        'fulfillment',
        'cadena de frio',
        'transporte terrestre de carga',
        'operador portuario',
        'trucking company',
      ],
      broad: ['logistics', 'logistica', 'transportation', 'transporte', 'supply chain'],
      /**
       * V3-A — `third party logistics` vive en `freight_and_trade` y no en
       * `logistics_operations`, que es donde su semántica lo pondría: la familia
       * que lleva amplios no puede contener un término que el amplio `logistics`
       * ya absorbe por substring, porque ahí el término específico es INERTE —
       * exactamente el modo de fallo del § 15.
       */
      families: [
        {
          key: 'logistics_operations',
          terms: [
            'operador logistico',
            'warehousing',
            'fulfillment',
            'cadena de frio',
            'operador portuario',
          ],
        },
        {
          key: 'freight_and_trade',
          terms: [
            'third party logistics',
            'freight forwarder',
            'transporte de carga',
            'transporte terrestre de carga',
            'trucking company',
            'agencia de aduana',
            'customs broker',
            'courier',
            'mensajeria empresarial',
          ],
        },
      ],
      exclusions: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        'oil and gas',
        'mining',
        'hospital',
      ],
    },
    evidence: {
      confirming: [
        'logistics and supply chain',
        'package/freight delivery',
        'freight forwarding',
        'third party logistics',
        '3pl',
        '4pl',
        'operador logistico',
        'freight forwarder',
        'transporte de carga',
        'agencia de aduana',
        'customs brokerage',
        'courier',
        'warehousing',
        'fulfillment',
        'trucking',
        'maritime',
        'airlines/aviation',
        'shipping',
      ],
      parentIndustries: ['transportation', 'transporte', 'logistics', 'logistica', 'supply chain'],
      excludingIndustries: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        'hospital & health care',
        'pharmaceuticals',
        'mining & metals',
        'oil & energy',
      ],
    },
  },
  {
    key: 'technology',
    displayName: 'Tecnología',
    slug: 'technology',
    sortOrder: 2,
    discovery: {
      specific: [
        'software empresarial',
        'enterprise software',
        'saas platform',
        'ciberseguridad',
        'cybersecurity',
        'cloud infrastructure',
        'devops',
        'data analytics',
        'business intelligence',
        'inteligencia artificial',
        'machine learning',
        'software factory',
        'desarrollo de software',
        'plataforma digital',
      ],
      broad: ['software', 'technology', 'tecnologia', 'information technology'],
      /**
       * V3-A — los cuatro términos con `software` dentro (`software empresarial`,
       * `enterprise software`, `software factory`, `desarrollo de software`) van a
       * la familia que NO lleva amplios: el amplio `software` los absorbe.
       */
      families: [
        {
          key: 'platform_infrastructure',
          terms: [
            'saas platform',
            'cloud infrastructure',
            'devops',
            'ciberseguridad',
            'cybersecurity',
            'plataforma digital',
          ],
        },
        {
          key: 'engineering_data_ai',
          terms: [
            'software empresarial',
            'enterprise software',
            'software factory',
            'desarrollo de software',
            'data analytics',
            'business intelligence',
            'inteligencia artificial',
            'machine learning',
          ],
        },
      ],
      exclusions: [
        'retail banking',
        'commercial banking',
        'hospital',
        'mining',
        'oil and gas',
        'construction',
        'agriculture',
      ],
    },
    evidence: {
      confirming: [
        'computer software',
        'information technology and services',
        'internet',
        'computer & network security',
        'saas',
        'software as a service',
        'desarrollo de software',
        'software empresarial',
        'cloud computing',
        'devops',
        'ciberseguridad',
        'artificial intelligence',
        'machine learning',
        'data analytics',
        'business intelligence',
      ],
      parentIndustries: [
        'technology',
        'tecnologia',
        'computer',
        'telecommunications',
        'electronics',
      ],
      excludingIndustries: [
        // 🔴 El COMERCIO declarado gana antes que cualquier término tecnológico.
        // Sin esto, `internet` admitía a un minorista que sólo vende por internet
        // — el falso positivo de CIIU 4791. Ver `TRADE_INDUSTRY_TERMS`.
        ...TRADE_INDUSTRY_TERMS,
        'commercial banking',
        'hospital & health care',
        'pharmaceuticals',
        'mining & metals',
        'oil & energy',
        'construction',
        'farming',
        'government administration',
      ],
    },
  },
  {
    key: 'insurance_financial_services',
    displayName: 'Seguros y Servicios Financieros',
    slug: 'insurance-financial-services',
    sortOrder: 3,
    discovery: {
      specific: [
        'compania de seguros',
        'insurance carrier',
        'seguros generales',
        'seguros de vida',
        'corredor de seguros',
        'insurance broker',
        'banca comercial',
        'commercial banking',
        'cooperativa financiera',
        'factoring',
        'leasing financiero',
        'fondo de inversion',
        'asset management',
        'credito empresarial',
      ],
      broad: ['insurance', 'seguros', 'financial services', 'servicios financieros', 'banking'],
      /**
       * 🔴 V3-A — el ORDEN de estas dos familias está invertido respecto del eje
       * semántico natural (seguros primero), y la inversión es forzada, no
       * estética: los SEIS términos de seguros del catálogo contienen `insurance`
       * o `seguros`, que son los dos amplios que viajan. Una familia de seguros en
       * `families[0]` emitiría seis términos específicos inertes bajo su propio
       * amplio — la consulta genérica que el § 15 prohíbe.
       *
       * Con banca en `families[0]` las dos son emitibles: la de banca lleva
       * amplios que no la absorben, y la de seguros viaja sola y estrecha.
       */
      families: [
        {
          key: 'banking_and_finance',
          terms: [
            'banca comercial',
            'commercial banking',
            'cooperativa financiera',
            'factoring',
            'leasing financiero',
            'fondo de inversion',
            'asset management',
            'credito empresarial',
          ],
        },
        {
          key: 'insurance_carriers_brokers',
          terms: [
            'compania de seguros',
            'insurance carrier',
            'seguros generales',
            'seguros de vida',
            'corredor de seguros',
            'insurance broker',
          ],
        },
      ],
      exclusions: [
        ...SOFTWARE_INDUSTRY_TERMS,
        'hospital',
        'retailer',
        'mining',
        'oil and gas',
        'logistics',
      ],
    },
    evidence: {
      confirming: [
        'insurance',
        'seguros',
        'banking',
        'retail banking',
        'commercial banking',
        'investment banking',
        'capital markets',
        'financial services',
        'servicios financieros',
        'asset management',
        'corredor de seguros',
        'insurance broker',
        'reinsurance',
        'factoring',
        'leasing',
        'cooperativa financiera',
      ],
      parentIndustries: ['finance', 'financial', 'fintech'],
      excludingIndustries: [
        ...SOFTWARE_INDUSTRY_TERMS,
        'hospital & health care',
        'pharmaceuticals',
        'mining & metals',
        'oil & energy',
        'retail',
        'logistics and supply chain',
        'government administration',
      ],
    },
  },
  {
    key: 'health_pharma',
    displayName: 'Salud & Farmacéuticos',
    slug: 'health-pharma',
    sortOrder: 4,
    /**
     * § 16 — la macro industria del retest fallido. Sus `specific` NO contienen
     * `health` ni `healthcare`: eran precisamente los términos que dominaban el
     * OR y devolvían las mismas 20 empresas en dos corridas distintas. Los dos
     * siguen existiendo, pero como `broad`, racionados por el redactor.
     */
    discovery: {
      specific: [
        'clinica',
        'hospital',
        'red hospitalaria',
        'ips salud',
        'laboratorio farmaceutico',
        'pharmaceutical manufacturer',
        'distribuidor farmaceutico',
        'pharmaceutical distribution',
        'dispositivos medicos',
        'medical devices',
        'laboratorio clinico',
        'diagnostico clinico',
        'medicina prepagada',
        'health insurer',
        'entidad promotora de salud',
      ],
      broad: ['health', 'healthcare', 'salud', 'medical', 'medicina'],
      /**
       * V3-A — `health insurer` acompaña al aseguramiento en la segunda familia:
       * el amplio `health` lo absorbe y la primera familia sí lleva amplios.
       */
      families: [
        {
          key: 'providers_and_diagnostics',
          terms: [
            'clinica',
            'hospital',
            'red hospitalaria',
            'ips salud',
            'laboratorio clinico',
            'diagnostico clinico',
          ],
        },
        {
          key: 'pharma_devices_coverage',
          terms: [
            'laboratorio farmaceutico',
            'pharmaceutical manufacturer',
            'distribuidor farmaceutico',
            'pharmaceutical distribution',
            'dispositivos medicos',
            'medical devices',
            'medicina prepagada',
            'health insurer',
            'entidad promotora de salud',
          ],
        },
      ],
      exclusions: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        ...PROFESSIONAL_SERVICES_INDUSTRY_TERMS,
        'tobacco',
        'logistics and supply chain',
        'food production',
      ],
    },
    evidence: {
      confirming: [
        'hospital & health care',
        'hospital and health care',
        'pharmaceuticals',
        'farmaceutico',
        'farmaceutica',
        'biotechnology',
        'medical devices',
        'dispositivos medicos',
        'medical practice',
        'clinica',
        'hospital',
        'laboratorio clinico',
        'clinical laboratory',
        'medical diagnostics',
        'health insurance',
        'medicina prepagada',
        'veterinary',
      ],
      parentIndustries: ['health', 'healthcare', 'salud', 'wellness'],
      excludingIndustries: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        ...PROFESSIONAL_SERVICES_INDUSTRY_TERMS,
        'tobacco',
        'food production',
        'food & beverages',
        'logistics and supply chain',
        'mining & metals',
        'oil & energy',
        'government administration',
      ],
    },
  },
  {
    key: 'retail',
    displayName: 'Retail',
    slug: 'retail',
    sortOrder: 5,
    /**
     * `retail` a secas NO entra en ninguna cubeta positiva: es substring de
     * `retail banking`, y con él Citigroup entraba en una búsqueda de retail
     * — el modo de fallo de v1.16K-AC. Se usan formas que sólo aparecen en un
     * minorista real.
     */
    discovery: {
      specific: [
        'retailer',
        'retail chain',
        'cadena de tiendas',
        'supermercado',
        'hipermercado',
        'grocery store',
        'grocery chain',
        'tienda por departamento',
        'department store',
        'comercio minorista',
        'almacen de cadena',
        'farmacia cadena',
        'tienda de conveniencia',
        'ecommerce retail',
      ],
      broad: ['retail store', 'retail trade', 'consumer services', 'omnicanal'],
      families: [
        {
          key: 'food_retail_and_chains',
          terms: [
            'supermercado',
            'hipermercado',
            'grocery store',
            'grocery chain',
            'retail chain',
            'cadena de tiendas',
            'almacen de cadena',
            'tienda de conveniencia',
          ],
        },
        {
          key: 'non_food_and_ecommerce',
          terms: [
            'retailer',
            'comercio minorista',
            'tienda por departamento',
            'department store',
            'farmacia cadena',
            'ecommerce retail',
          ],
        },
      ],
      exclusions: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        'marketplace software',
        'mining',
        'oil and gas',
        'hospital',
      ],
    },
    evidence: {
      confirming: [
        'retail',
        'supermarkets',
        'supermercado',
        'hipermercado',
        'grocery',
        'department store',
        'tienda por departamento',
        'comercio minorista',
        'apparel & fashion',
        'luxury goods & jewelry',
        'sporting goods',
        'furniture',
        'e-commerce',
      ],
      parentIndustries: ['consumer services', 'consumer goods', 'wholesale', 'comercio'],
      excludingIndustries: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        'hospital & health care',
        'pharmaceuticals',
        'mining & metals',
        'oil & energy',
        'government administration',
        'logistics and supply chain',
      ],
    },
  },
  {
    key: 'property_construction',
    displayName: 'Propiedad & Construcción',
    slug: 'property-construction',
    sortOrder: 6,
    discovery: {
      specific: [
        'constructora',
        'general contractor',
        'obra civil',
        'civil engineering',
        'infraestructura vial',
        'promotora inmobiliaria',
        'real estate developer',
        'desarrollo inmobiliario',
        'property management',
        'administracion de propiedad horizontal',
        'concesion vial',
        'edificacion',
      ],
      broad: ['construction', 'construccion', 'real estate', 'inmobiliaria'],
      families: [
        {
          key: 'construction_and_infrastructure',
          terms: [
            'constructora',
            'general contractor',
            'obra civil',
            'civil engineering',
            'infraestructura vial',
            'concesion vial',
            'edificacion',
          ],
        },
        {
          key: 'real_estate_and_property',
          terms: [
            'promotora inmobiliaria',
            'real estate developer',
            'desarrollo inmobiliario',
            'property management',
            'administracion de propiedad horizontal',
          ],
        },
      ],
      exclusions: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        'hospital',
        'mining',
        'retailer',
      ],
    },
    evidence: {
      confirming: [
        'construction',
        'construccion',
        'civil engineering',
        'building materials',
        'real estate',
        'inmobiliaria',
        'commercial real estate',
        'architecture & planning',
        'constructora',
        'obra civil',
        'property management',
      ],
      parentIndustries: ['engineering', 'infrastructure', 'infraestructura'],
      excludingIndustries: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        'hospital & health care',
        'pharmaceuticals',
        'mining & metals',
        'oil & energy',
        'retail',
        'government administration',
      ],
    },
  },
  {
    key: 'industry_manufacturing_chemicals_automotive',
    displayName: 'Industria / Manufactura / Químicos / Automotor',
    slug: 'industry-manufacturing-chemicals-automotive',
    sortOrder: 7,
    /**
     * § 17 — macro industria deliberadamente amplia. Sin `specific` que nombren
     * un proceso o un producto concreto, cualquier empresa con la palabra
     * «industrial» en su descripción pasaría, y el matcher sería always-true.
     */
    discovery: {
      specific: [
        'planta de produccion',
        'manufacturing plant',
        'metalmecanica',
        'autopartes',
        'auto parts',
        'ensambladora automotriz',
        'automotive manufacturer',
        'industria quimica',
        'chemical manufacturer',
        'plasticos industriales',
        'packaging industrial',
        'bienes de capital',
        'maquinaria industrial',
        'zona franca manufactura',
      ],
      broad: ['manufacturing', 'manufactura', 'industrial', 'chemicals', 'automotive'],
      /**
       * V3-A — la ÚNICA macro industria con TRES familias, y por el motivo que
       * § 17 ya describía: su nombre reúne cuatro dominios sin proceso común. Dos
       * familias dejarían una de ellas con nueve términos de tres dominios
       * distintos, que es el OR plano que este hito parte.
       *
       * `manufacturing plant` y `zona franca manufactura` caen en la tercera
       * familia porque el amplio `manufacturing`/`manufactura` los absorbe.
       */
      families: [
        {
          key: 'automotive_and_metalworking',
          terms: [
            'metalmecanica',
            'autopartes',
            'auto parts',
            'ensambladora automotriz',
            'automotive manufacturer',
          ],
        },
        {
          key: 'chemicals_plastics_packaging',
          terms: [
            'industria quimica',
            'chemical manufacturer',
            'plasticos industriales',
            'packaging industrial',
          ],
        },
        {
          key: 'machinery_and_production_plants',
          terms: [
            'bienes de capital',
            'maquinaria industrial',
            'planta de produccion',
            'manufacturing plant',
            'zona franca manufactura',
          ],
        },
      ],
      exclusions: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        ...PROFESSIONAL_SERVICES_INDUSTRY_TERMS,
        'hospital',
        'retailer',
      ],
    },
    evidence: {
      confirming: [
        'machinery',
        'industrial automation',
        'mechanical or industrial engineering',
        'chemicals',
        'quimicos',
        'plastics',
        'packaging & containers',
        'automotive',
        'automotriz',
        'autopartes',
        'metalmecanica',
        'metal fabrication',
        'electrical & electronic manufacturing',
        'glass, ceramics & concrete',
        'paper & forest products',
        'textiles',
      ],
      parentIndustries: ['manufacturing', 'manufactura', 'industrial', 'production'],
      excludingIndustries: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        ...PROFESSIONAL_SERVICES_INDUSTRY_TERMS,
        'hospital & health care',
        'pharmaceuticals',
        'retail',
        'government administration',
        'logistics and supply chain',
      ],
    },
  },
  {
    key: 'government',
    displayName: 'Gobierno',
    slug: 'government',
    sortOrder: 8,
    discovery: {
      specific: [
        'entidad publica',
        'government agency',
        'alcaldia',
        'gobernacion',
        'ministerio',
        'superintendencia',
        'municipality',
        'public administration',
        'empresa industrial y comercial del estado',
        'instituto publico',
      ],
      broad: ['government', 'gobierno', 'public sector', 'sector publico'],
      /**
       * V3-A — `government agency` viaja con el nivel nacional porque el amplio
       * `government` lo absorbe y la primera familia sí lleva amplios.
       */
      families: [
        {
          key: 'territorial_entities',
          terms: ['alcaldia', 'gobernacion', 'municipality', 'public administration'],
        },
        {
          key: 'national_and_decentralized',
          terms: [
            'entidad publica',
            'government agency',
            'ministerio',
            'superintendencia',
            'instituto publico',
            'empresa industrial y comercial del estado',
          ],
        },
      ],
      exclusions: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        ...PROFESSIONAL_SERVICES_INDUSTRY_TERMS,
        'retailer',
      ],
    },
    evidence: {
      confirming: [
        'government administration',
        'administracion publica',
        'public policy',
        'legislative office',
        'judiciary',
        'international affairs',
        'law enforcement',
        'military',
        'defense & space',
        'entidad publica',
        'alcaldia',
        'gobernacion',
        'ministerio',
      ],
      parentIndustries: ['government', 'gobierno', 'public', 'nonprofit organization management'],
      excludingIndustries: [
        ...SOFTWARE_INDUSTRY_TERMS,
        ...PROFESSIONAL_SERVICES_INDUSTRY_TERMS,
        'retail banking',
        'commercial banking',
        'insurance',
        'retail',
        'pharmaceuticals',
      ],
    },
  },
  {
    key: 'energy_mining_environment',
    displayName: 'Gas / Petróleo / Energía / Minería / Medio Ambiente',
    slug: 'energy-mining-environment',
    sortOrder: 9,
    discovery: {
      specific: [
        'exploracion y produccion de petroleo',
        'oil and gas operator',
        'refineria',
        'gas natural',
        'generacion electrica',
        'power generation',
        'transmision electrica',
        'comercializadora de energia',
        'energia renovable',
        'renewable energy',
        'operacion minera',
        'mining operation',
        'tratamiento de aguas residuales',
        'gestion de residuos',
        'waste management',
      ],
      broad: ['energy', 'energia', 'mining', 'mineria', 'utilities', 'environmental'],
      /**
       * V3-A — los tres términos con `energia`/`energy` dentro caen en la segunda
       * familia, donde ningún amplio viaja para absorberlos.
       */
      families: [
        {
          key: 'hydrocarbons_and_mining',
          terms: [
            'exploracion y produccion de petroleo',
            'oil and gas operator',
            'refineria',
            'gas natural',
            'operacion minera',
            'mining operation',
          ],
        },
        {
          key: 'power_and_environment',
          terms: [
            'generacion electrica',
            'power generation',
            'transmision electrica',
            'comercializadora de energia',
            'energia renovable',
            'renewable energy',
            'tratamiento de aguas residuales',
            'gestion de residuos',
            'waste management',
          ],
        },
      ],
      exclusions: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        ...PROFESSIONAL_SERVICES_INDUSTRY_TERMS,
        'hospital',
        'retailer',
      ],
    },
    evidence: {
      confirming: [
        'oil & energy',
        'oil and energy',
        'petroleo',
        'gas natural',
        'mining & metals',
        'mineria',
        'utilities',
        'renewables & environment',
        'energia renovable',
        'environmental services',
        'waste management',
        'gestion de residuos',
        'electric power',
        'generacion electrica',
        'water treatment',
      ],
      parentIndustries: ['energy', 'energia', 'natural resources', 'recursos naturales'],
      excludingIndustries: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        ...PROFESSIONAL_SERVICES_INDUSTRY_TERMS,
        'hospital & health care',
        'pharmaceuticals',
        'retail',
        'government administration',
      ],
    },
  },
  {
    key: 'consumer_goods',
    displayName: 'Consumo Masivo',
    slug: 'consumer-goods',
    sortOrder: 10,
    /**
     * Consumo Masivo es el FABRICANTE / la marca; Retail es el punto de venta.
     * Se distinguen porque `retailer` y `cadena de tiendas` viven en Retail y
     * aquí son exclusiones: sin esa frontera las dos macro industrias devolverían
     * el mismo conjunto.
     */
    discovery: {
      specific: [
        'fabricante de alimentos',
        'food manufacturer',
        'productor de bebidas',
        'beverage producer',
        'cuidado personal',
        'personal care manufacturer',
        'higiene del hogar',
        'household products',
        'consumo masivo',
        'fast moving consumer goods',
        'marca de consumo',
        'planta de alimentos',
      ],
      broad: ['consumer goods', 'fmcg', 'food', 'beverages', 'bienes de consumo'],
      families: [
        {
          key: 'food_and_beverage',
          terms: [
            'fabricante de alimentos',
            'food manufacturer',
            'productor de bebidas',
            'beverage producer',
            'planta de alimentos',
          ],
        },
        {
          key: 'personal_home_and_brands',
          terms: [
            'cuidado personal',
            'personal care manufacturer',
            'higiene del hogar',
            'household products',
            'consumo masivo',
            'fast moving consumer goods',
            'marca de consumo',
          ],
        },
      ],
      exclusions: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        'retailer',
        'retail chain',
        'cadena de tiendas',
        'supermercado',
        'hospital',
      ],
    },
    evidence: {
      confirming: [
        'consumer goods',
        'consumer products',
        'bienes de consumo',
        'consumo masivo',
        'food production',
        'food & beverages',
        'alimentos y bebidas',
        'cosmetics',
        'cuidado personal',
        'household products',
        'tobacco',
        'wine and spirits',
        'dairy',
        'fmcg',
      ],
      parentIndustries: ['manufacturing', 'manufactura', 'consumer'],
      excludingIndustries: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        'retail',
        'supermarkets',
        'hospital & health care',
        'pharmaceuticals',
        'mining & metals',
        'oil & energy',
        'government administration',
      ],
    },
  },
  {
    key: 'services_company',
    displayName: 'Compañía de Servicios',
    slug: 'services-company',
    sortOrder: 11,
    /**
     * § 17 — la más peligrosa de las 12: «servicios» describe a casi cualquier
     * empresa. Sus `specific` nombran MODELOS DE NEGOCIO concretos (BPO, staffing,
     * facilities, auditoría) y nunca la palabra suelta.
     */
    discovery: {
      specific: [
        'consultoria de gestion',
        'management consulting',
        'firma de auditoria',
        'audit firm',
        'servicios legales corporativos',
        'bpo',
        'business process outsourcing',
        'contact center',
        'staffing',
        'servicios temporales',
        'facility management',
        'aseo industrial',
        'seguridad privada',
        'investigacion de mercados',
      ],
      broad: ['professional services', 'servicios profesionales', 'outsourcing', 'advisory'],
      families: [
        {
          key: 'advisory_and_professional',
          terms: [
            'consultoria de gestion',
            'management consulting',
            'firma de auditoria',
            'audit firm',
            'servicios legales corporativos',
            'investigacion de mercados',
          ],
        },
        {
          key: 'outsourcing_and_facilities',
          terms: [
            'bpo',
            'business process outsourcing',
            'contact center',
            'staffing',
            'servicios temporales',
            'facility management',
            'aseo industrial',
            'seguridad privada',
          ],
        },
      ],
      exclusions: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        'hospital',
        'retailer',
        'mining',
        'oil and gas',
        'construction',
      ],
    },
    evidence: {
      confirming: [
        'management consulting',
        'consultoria',
        'accounting',
        'contabilidad',
        'auditoria',
        'law practice',
        'legal services',
        'servicios legales',
        'outsourcing/offshoring',
        'business process outsourcing',
        'contact center',
        'staffing and recruiting',
        'human resources',
        'facilities services',
        'security and investigations',
        'market research',
        'investigacion de mercados',
      ],
      parentIndustries: [
        'professional services',
        'servicios profesionales',
        'business services',
        'servicios',
      ],
      excludingIndustries: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        'hospital & health care',
        'pharmaceuticals',
        'retail',
        'mining & metals',
        'oil & energy',
        'construction',
        'government administration',
      ],
    },
  },
  {
    key: 'agroindustry',
    displayName: 'Agroindustria',
    slug: 'agroindustry',
    sortOrder: 12,
    discovery: {
      specific: [
        'agroindustria',
        'agribusiness',
        'produccion agricola',
        'crop production',
        'ganaderia',
        'livestock',
        'ingenio azucarero',
        'plantacion de banano',
        'floricultura',
        'flower grower',
        'acuicultura',
        'aquaculture',
        'procesamiento primario agricola',
        'exportador agricola',
      ],
      broad: ['agriculture', 'agricultura', 'farming', 'agro', 'agrícola'],
      families: [
        {
          key: 'crops_and_livestock',
          terms: [
            'produccion agricola',
            'crop production',
            'ganaderia',
            'livestock',
            'plantacion de banano',
            'floricultura',
            'flower grower',
            'acuicultura',
            'aquaculture',
          ],
        },
        {
          key: 'processing_and_export',
          terms: [
            'agroindustria',
            'agribusiness',
            'ingenio azucarero',
            'procesamiento primario agricola',
            'exportador agricola',
          ],
        },
      ],
      exclusions: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        'retailer',
        'supermercado',
        'hospital',
        'mining',
      ],
    },
    evidence: {
      confirming: [
        'farming',
        'agriculture',
        'agricultura',
        'agroindustria',
        'agribusiness',
        'ranching',
        'ganaderia',
        'fishery',
        'acuicultura',
        'aquaculture',
        'horticulture',
        'floricultura',
        'ingenio azucarero',
        'plantation',
        'crop production',
      ],
      parentIndustries: ['agro', 'food production', 'primary sector', 'sector primario'],
      excludingIndustries: [
        ...FINANCIAL_INDUSTRY_TERMS,
        ...SOFTWARE_INDUSTRY_TERMS,
        'retail',
        'supermarkets',
        'hospital & health care',
        'pharmaceuticals',
        'mining & metals',
        'oil & energy',
        'government administration',
      ],
    },
  },
];

// ─── Índices y resolución ─────────────────────────────────────────────────────

const BY_KEY: ReadonlyMap<MacroIndustryKey, MacroIndustryDefinition> = new Map(
  MACRO_INDUSTRIES.map((definition) => [definition.key, definition]),
);

/**
 * Normalización compartida por TODA resolución de esta taxonomía: minúsculas,
 * sin acentos, sin espacios de sobra. La misma que usa el gate sectorial, para
 * que `Salud & Farmacéuticos` y `salud & farmaceuticos` resuelvan a lo mismo.
 */
export function normalizeMacroIndustryLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const BY_NORMALIZED_DISPLAY_NAME: ReadonlyMap<string, MacroIndustryDefinition> = new Map(
  MACRO_INDUSTRIES.map((definition) => [
    normalizeMacroIndustryLabel(definition.displayName),
    definition,
  ]),
);

const BY_SLUG: ReadonlyMap<string, MacroIndustryDefinition> = new Map(
  MACRO_INDUSTRIES.map((definition) => [definition.slug, definition]),
);

/** Definición por clave canónica. `null` cuando la clave no existe. */
export function getMacroIndustryByKey(
  key: string | null | undefined,
): MacroIndustryDefinition | null {
  if (!key) return null;
  return BY_KEY.get(key as MacroIndustryKey) ?? null;
}

/** Definición por `slug` publicado. `null` cuando no existe. */
export function getMacroIndustryBySlug(
  slug: string | null | undefined,
): MacroIndustryDefinition | null {
  if (!slug) return null;
  return BY_SLUG.get(slug.trim()) ?? null;
}

/**
 * Definición por nombre visible EXACTO (ya normalizado).
 *
 * Es la puerta que usa el runtime de descubrimiento, porque el pipeline recibe
 * el nombre canónico del catálogo (`input.industry`), no la clave. La
 * coincidencia es por igualdad de la forma normalizada y NUNCA por `includes`:
 * «Retail» es substring de otras etiquetas y una coincidencia parcial resolvería
 * la macro industria equivocada sin que nadie lo note.
 */
export function resolveMacroIndustryByDisplayName(
  displayName: string | null | undefined,
): MacroIndustryDefinition | null {
  if (!displayName?.trim()) return null;
  return BY_NORMALIZED_DISPLAY_NAME.get(normalizeMacroIndustryLabel(displayName)) ?? null;
}

/** ¿Es esta cadena una clave canónica de la taxonomía macro? */
export function isMacroIndustryKey(value: string | null | undefined): value is MacroIndustryKey {
  return value != null && BY_KEY.has(value as MacroIndustryKey);
}

// ─── Familias semánticas (V3-A § 2) ───────────────────────────────────────────

/**
 * Claves de familia de una macro industria, en orden de emisión.
 *
 * Vacío cuando la macro industria no declara familias. Un consumidor que reciba
 * `[]` debe comportarse EXACTAMENTE como antes de este hito: no hay variante que
 * elegir y las dos rondas siguen el camino de siempre.
 */
export function macroIndustryQueryFamilyKeys(
  definition: MacroIndustryDefinition | null | undefined,
): string[] {
  return (definition?.discovery.families ?? []).map((family) => family.key);
}

/**
 * Familia por clave, con su posición.
 *
 * La posición importa: sólo `families[0]` puede llevar términos amplios, así que
 * quien redacta necesita saber si la variante pedida es la primera o una
 * posterior. `null` cuando la clave no pertenece a esta macro industria — y ahí
 * el llamador NO adivina: cae al comportamiento sin variante.
 */
export function resolveMacroIndustryQueryFamily(
  definition: MacroIndustryDefinition | null | undefined,
  familyKey: string | null | undefined,
): { family: MacroIndustryQueryFamily; index: number } | null {
  const families = definition?.discovery.families ?? [];
  if (!familyKey?.trim()) return null;
  const index = families.findIndex((family) => family.key === familyKey.trim());
  if (index < 0) return null;
  return { family: families[index], index };
}

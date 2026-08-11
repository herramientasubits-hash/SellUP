/**
 * sellup-subindustry-catalog-aliases.ts — los 127 alias REALES del catálogo activo
 * de SellUp, congelados como fixture.
 *
 * AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 2A · §§ 4 y 5.
 *
 * Por qué existe: el § 5 exige una auditoría de colisiones sobre las 73 etiquetas
 * canónicas MÁS sus alias, y hacerla con una consulta viva ataría la suite a la
 * base de datos de Producción. Es el mismo patrón —y el mismo motivo— que
 * `sellup-subindustry-catalog-names.ts`.
 *
 * Origen: lectura de SOLO LECTURA de `public.active_subindustry_aliases` (catálogo
 * `1.0.0`, `catalog_version_id` `e4675daf-65a2-5e26-8640-58f1aeaee5ed`, la única
 * versión publicada) el 2026-08-11. 127 alias sobre 39 de las 73 subindustrias.
 * Cero escrituras, cero créditos, cero llamadas a proveedor.
 *
 * IMPORTANTE — esto NO es una fuente de verdad de runtime y no debe convertirse en
 * una (§ 4). El catálogo publicado puede cambiar sin despliegue, así que ningún
 * módulo de `src/` lo importa: sólo la auditoría de colisiones lo lee, y su
 * conclusión es un HECHO SOBRE ESTA LECTURA, no una promesa sobre el catálogo
 * futuro. Cuando Phase 2B conecte alias a identidad, deberá resolverlos en vivo
 * desde la misma versión publicada que resolvió la selección del wizard.
 *
 * Las 34 subindustrias sin alias no aparecen: no tener alias no es un dato que
 * esta auditoría necesite representar con una lista vacía.
 */

export type SellupSubindustryAliasFixtureEntry = {
  canonicalName: string;
  aliases: readonly string[];
};

/** 39 subindustrias con alias, 127 alias en total. Orden alfabético por canónico. */
export const SELLUP_ACTIVE_SUBINDUSTRY_ALIASES: readonly SellupSubindustryAliasFixtureEntry[] = [
  { canonicalName: 'Agritech', aliases: ['agricultura de precisión', 'agro digital', 'tecnología agrícola'] },
  { canonicalName: 'Agroindustria y Procesamiento Primario', aliases: ['agribusiness', 'agroexportadora', 'agroindustria'] },
  { canonicalName: 'Banca Tradicional', aliases: ['banco', 'bank', 'entidad bancaria'] },
  { canonicalName: 'BPO y Contact Center', aliases: ['BPO', 'call center', 'contact center', 'outsourcing de procesos'] },
  { canonicalName: 'Ciberseguridad', aliases: ['cybersecurity', 'infosec', 'protección de datos', 'seguridad informática'] },
  { canonicalName: 'Construcción e Infraestructura', aliases: ['constructora', 'EPC', 'facility management', 'obra civil'] },
  { canonicalName: 'Data Analytics y Business Intelligence', aliases: ['analítica de datos', 'BI', 'business intelligence', 'data analytics'] },
  { canonicalName: 'Ecommerce Enablement', aliases: ['comercio electrónico B2B', 'plataforma de e-commerce'] },
  { canonicalName: 'Edtech: Plataformas de Aprendizaje', aliases: ['e-learning B2B', 'learning management system', 'plataforma LMS'] },
  { canonicalName: 'Energía, Minería y Servicios Industriales', aliases: ['energías renovables', 'minería', 'oil and gas', 'utilities'] },
  { canonicalName: 'Fabricantes de Alimentos y Bebidas (FMCG)', aliases: ['consumo masivo', 'CPG', 'FMCG alimentos'] },
  { canonicalName: 'Fintech B2B: Servicios Financieros', aliases: ['neobank', 'open banking', 'pagos digitales'] },
  { canonicalName: 'Fintech: Infraestructura y Pagos', aliases: ['fintech', 'infraestructura de pagos', 'payments tech', 'tecnología financiera'] },
  { canonicalName: 'Formación Corporativa y Corporate Training', aliases: ['capacitación empresarial', 'corporate training', 'formación in-company'] },
  { canonicalName: 'Freight Forwarders y Agencias de Aduana', aliases: ['agencia de aduana', 'agente de carga', 'freight forwarder'] },
  { canonicalName: 'Govtech y Ciudades Inteligentes', aliases: ['ciudad inteligente', 'gobierno digital', 'smart city'] },
  { canonicalName: 'Healthtech B2B', aliases: ['digital health', 'salud digital', 'telemedicina B2B'] },
  { canonicalName: 'HRtech y Gestión del Talento', aliases: ['gestión del talento', 'HCM', 'HR tech', 'people tech'] },
  { canonicalName: 'Infraestructura Cloud y DevOps', aliases: ['cloud computing', 'DevOps', 'IaaS', 'plataformas cloud'] },
  { canonicalName: 'Institutos Técnicos y Vocacionales', aliases: ['CONALEP', 'formación técnica', 'OTEC', 'SENA', 'SENATI'] },
  { canonicalName: 'Insurtech', aliases: ['insurance tech', 'seguro digital'] },
  { canonicalName: 'Inteligencia Artificial y Machine Learning', aliases: ['AI', 'IA empresarial', 'IA generativa', 'machine learning'] },
  { canonicalName: 'IoT y Hardware Conectado', aliases: ['hardware conectado', 'Internet de las Cosas', 'IoT'] },
  { canonicalName: 'Laboratorios Farmacéuticos', aliases: ['laboratorio farmacéutico', 'pharma'] },
  { canonicalName: 'Legaltech', aliases: ['contratos digitales', 'firma electrónica', 'legal tech'] },
  { canonicalName: 'Marketing Technology y Sales Tech', aliases: ['marketing automation', 'martech', 'sales enablement'] },
  { canonicalName: 'Medicina Prepagada y EPS', aliases: ['EPS', 'ISAPRE', 'operadora de saúde', 'plan de salud corporativo', 'plano de saúde'] },
  { canonicalName: 'Metalmecánica y Autopartes', aliases: ['autopartes', 'metalmecánica', 'tier 1 automotriz'] },
  { canonicalName: 'Operadores Logísticos 3PL y 4PL', aliases: ['3PL', 'logistics provider', 'operador logístico'] },
  { canonicalName: 'Proptech e Inmobiliaria Digital', aliases: ['inmobiliaria digital', 'real estate tech'] },
  { canonicalName: 'QA, Testing y Automatización (RPA)', aliases: ['automatización de procesos', 'QA testing', 'RPA', 'testing de software'] },
  { canonicalName: 'Redes Hospitalarias y Clínicas', aliases: ['hospital privado', 'red hospitalaria'] },
  { canonicalName: 'Salud Ocupacional y Medicina Laboral', aliases: ['medicina del trabajo', 'SST salud'] },
  { canonicalName: 'Seguros Generales', aliases: ['aseguradoras', 'seguros P&C'] },
  { canonicalName: 'Software Empresarial (SaaS / ERP / CRM)', aliases: ['enterprise software', 'ERP', 'plataforma empresarial', 'SaaS B2B', 'software de gestión empresarial'] },
  { canonicalName: 'Software Factory y Nearshore', aliases: ['desarrollo a medida', 'fábrica de software', 'nearshore', 'staff augmentation'] },
  { canonicalName: 'Staffing y Servicios Temporales', aliases: ['empresa de empleo temporal', 'outsourcing de personal', 'servicios temporales'] },
  { canonicalName: 'Supermercados e Hipermercados', aliases: ['cadena de supermercados', 'hard discount'] },
  { canonicalName: 'Telco y Comunicaciones', aliases: ['comunicaciones unificadas', 'CPaaS', 'telco', 'telecomunicaciones'] },
];

/** Total leído de Prod. Congelado para que un recorte accidental del fixture se note. */
export const SELLUP_ACTIVE_SUBINDUSTRY_ALIAS_COUNT = 127 as const;

/** Subindustrias del catálogo activo que declaran al menos un alias. */
export const SELLUP_SUBINDUSTRIES_WITH_ALIASES_COUNT = 39 as const;

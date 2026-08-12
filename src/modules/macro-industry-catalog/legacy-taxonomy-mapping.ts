/**
 * legacy-taxonomy-mapping.ts — Matriz de correspondencia entre la taxonomía
 * publicada v1.0.0 (8 industrias / 73 subindustrias) y las 12 Macro Industrias.
 *
 * AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 · § 6.
 *
 * ── Qué ES esta matriz ────────────────────────────────────────────────────────
 *
 * Un inventario PROPUESTO, no una migración. Nada de lo que hay aquí se aplica a
 * ninguna fila: las corridas históricas conservan sus ids y sus etiquetas
 * originales (§ 21), y el catálogo v1 sigue archivado y consultable. Esta matriz
 * responde una sola pregunta: «¿qué contenido existente podrá reutilizarse
 * cuando alguien decida reutilizarlo?».
 *
 * ── Por qué los ambiguos NO se aplican solos (§ 6) ────────────────────────────
 *
 * `ambiguous: true` significa que hay más de una macro industria defendible y
 * que la elección es de producto, no de código. Ninguna herramienta debe leer
 * `proposedMacroIndustry` de una fila ambigua y actuar; el consumidor legítimo
 * es una persona revisando la tabla.
 *
 * ── El hallazgo que hay que leer antes que el resto ───────────────────────────
 *
 * **La taxonomía nueva no tiene Educación.** La industria `educacion` de v1 y sus
 * 7 subindustrias no tienen destino: ninguna de las 12 macro industrias las
 * contiene sin forzar la semántica. Quedan `unmapped`, y eso NO es un defecto de
 * esta matriz — es una consecuencia de la taxonomía que el producto eligió, y
 * hay que decidirla explícitamente. Se reporta, no se resuelve por cuenta propia.
 *
 * Puro: datos, sin I/O.
 */

import type { MacroIndustryKey } from './macro-industries';

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * Cuánta confianza merece la propuesta.
 *
 * `high`   Una sola macro industria la contiene y ninguna otra compite.
 * `medium` Una domina pero otra es defendible; la propuesta es la dominante.
 * `none`   Ninguna la contiene. `proposedMacroIndustry` es `null`.
 */
export type LegacyMappingConfidence = 'high' | 'medium' | 'none';

export type LegacyTaxonomyMappingRow = {
  /** `industries.slug` de la versión 1.0.0. */
  oldIndustry: string;
  /** `subindustries.slug` de la versión 1.0.0. `null` = la fila es la industria. */
  oldSubindustry: string | null;
  /** Clave canónica propuesta. `null` cuando no hay destino. */
  proposedMacroIndustry: MacroIndustryKey | null;
  confidence: LegacyMappingConfidence;
  /** Por qué. Una frase, legible por una persona. */
  reason: string;
  /** True ⇒ hay más de un destino defendible. NO aplicar automáticamente. */
  ambiguous: boolean;
};

// ─── Filas de INDUSTRIA (8) ───────────────────────────────────────────────────

const INDUSTRY_ROWS: readonly LegacyTaxonomyMappingRow[] = [
  {
    oldIndustry: 'tecnologia',
    oldSubindustry: null,
    proposedMacroIndustry: 'technology',
    confidence: 'high',
    reason: 'Correspondencia 1:1 de nombre y de alcance.',
    ambiguous: false,
  },
  {
    oldIndustry: 'servicios-financieros',
    oldSubindustry: null,
    proposedMacroIndustry: 'insurance_financial_services',
    confidence: 'high',
    reason: 'La macro industria nueva une seguros y servicios financieros, que en v1 convivían en esta industria.',
    ambiguous: false,
  },
  {
    oldIndustry: 'salud',
    oldSubindustry: null,
    proposedMacroIndustry: 'health_pharma',
    confidence: 'high',
    reason: 'Mismo alcance; la macro industria explicita los farmacéuticos que v1 ya incluía.',
    ambiguous: false,
  },
  {
    oldIndustry: 'educacion',
    oldSubindustry: null,
    proposedMacroIndustry: null,
    confidence: 'none',
    reason:
      'La taxonomía de 12 macro industrias no contiene Educación. Ninguna la absorbe sin forzar la semántica: es una decisión de producto pendiente, no un hueco de esta matriz.',
    ambiguous: false,
  },
  {
    oldIndustry: 'retail',
    oldSubindustry: null,
    proposedMacroIndustry: 'retail',
    confidence: 'medium',
    reason:
      'v1 llamaba "Retail y Consumo" a una industria que mezclaba punto de venta y fabricante. La taxonomía nueva los separa en Retail y Consumo Masivo: la industria padre se parte, y el destino real lo decide cada subindustria.',
    ambiguous: true,
  },
  {
    oldIndustry: 'manufactura',
    oldSubindustry: null,
    proposedMacroIndustry: 'industry_manufacturing_chemicals_automotive',
    confidence: 'medium',
    reason:
      'v1 metía construcción, energía/minería y agroindustria dentro de Manufactura. La taxonomía nueva les da macro industria propia: la industria padre se reparte entre cuatro destinos.',
    ambiguous: true,
  },
  {
    oldIndustry: 'consultoria-servicios-profesionales',
    oldSubindustry: null,
    proposedMacroIndustry: 'services_company',
    confidence: 'high',
    reason: 'Compañía de Servicios cubre el mismo conjunto de modelos de negocio.',
    ambiguous: false,
  },
  {
    oldIndustry: 'logistica-transporte',
    oldSubindustry: null,
    proposedMacroIndustry: 'transport_logistics',
    confidence: 'high',
    reason: 'Correspondencia 1:1 de nombre y de alcance.',
    ambiguous: false,
  },
];

// ─── Filas de SUBINDUSTRIA (73) ───────────────────────────────────────────────

function row(
  oldIndustry: string,
  oldSubindustry: string,
  proposedMacroIndustry: MacroIndustryKey | null,
  confidence: LegacyMappingConfidence,
  reason: string,
  ambiguous = false,
): LegacyTaxonomyMappingRow {
  return { oldIndustry, oldSubindustry, proposedMacroIndustry, confidence, reason, ambiguous };
}

const TECH = 'tecnologia';
const FIN = 'servicios-financieros';
const HEALTH = 'salud';
const EDU = 'educacion';
const RETAIL = 'retail';
const MANUF = 'manufactura';
const CONSULT = 'consultoria-servicios-profesionales';
const LOGI = 'logistica-transporte';

/** Motivo compartido por las 7 subindustrias de Educación. */
const NO_EDUCATION_MACRO =
  'Sin destino: la taxonomía de 12 macro industrias no contiene Educación. Requiere decisión de producto.';

const SUBINDUSTRY_ROWS: readonly LegacyTaxonomyMappingRow[] = [
  // ── Tecnología (20) ─────────────────────────────────────────────────────────
  row(TECH, 'software-empresarial', 'technology', 'high', 'Vendedor de software: núcleo de Tecnología.'),
  row(TECH, 'ciberseguridad', 'technology', 'high', 'Vendedor de software y servicios de seguridad informática.'),
  row(TECH, 'infraestructura-cloud-devops', 'technology', 'high', 'Infraestructura y servicios de TI.'),
  row(TECH, 'fintech-infraestructura-pagos', 'technology', 'medium', 'Vende tecnología a entidades financieras; el comprador es financiero pero la empresa es tecnológica.', true),
  row(TECH, 'hrtech-gestion-talento', 'technology', 'high', 'Plataforma de software vertical.'),
  row(TECH, 'martech-salestech', 'technology', 'high', 'Plataforma de software vertical.'),
  row(TECH, 'inteligencia-artificial-ml', 'technology', 'high', 'Núcleo de Tecnología.'),
  row(TECH, 'ecommerce-enablement', 'technology', 'high', 'Software y servicios para comercio electrónico, no minorista.'),
  row(TECH, 'healthtech-b2b', 'technology', 'medium', 'Vende software al sector salud; la empresa es tecnológica, el comprador sanitario.', true),
  row(TECH, 'proptech', 'technology', 'medium', 'Software para el sector inmobiliario; empresa tecnológica, comprador de Propiedad & Construcción.', true),
  row(TECH, 'legaltech', 'technology', 'high', 'Plataforma de software vertical.'),
  row(TECH, 'insurtech', 'technology', 'medium', 'Software para aseguradoras; empresa tecnológica, comprador financiero.', true),
  row(TECH, 'govtech', 'technology', 'medium', 'Software para el sector público; empresa tecnológica, comprador Gobierno.', true),
  row(TECH, 'agritech', 'technology', 'medium', 'Software para el agro; empresa tecnológica, comprador Agroindustria.', true),
  row(TECH, 'data-analytics-bi', 'technology', 'high', 'Núcleo de Tecnología.'),
  row(TECH, 'iot-hardware-conectado', 'technology', 'medium', 'Hardware conectado: también es manufactura electrónica.', true),
  row(TECH, 'software-factory-nearshore', 'technology', 'high', 'Servicios de desarrollo de software.'),
  row(TECH, 'telecomunicaciones-tech', 'technology', 'medium', 'Telco no tiene macro industria propia; Tecnología es el destino más cercano.', true),
  row(TECH, 'qa-testing-automatizacion', 'technology', 'high', 'Servicios técnicos de software.'),
  row(TECH, 'edtech-plataformas', 'technology', 'medium', 'Plataforma de software; su vertical (Educación) no existe en la taxonomía nueva.', true),

  // ── Servicios Financieros (8) ───────────────────────────────────────────────
  row(FIN, 'banca-tradicional', 'insurance_financial_services', 'high', 'Banca comercial.'),
  row(FIN, 'seguros-generales', 'insurance_financial_services', 'high', 'Aseguradora.'),
  row(FIN, 'seguros-vida-personas', 'insurance_financial_services', 'high', 'Aseguradora.'),
  row(FIN, 'brokers-intermediarios-seguros', 'insurance_financial_services', 'high', 'Intermediación de seguros.'),
  row(FIN, 'fintech-b2b-servicios', 'insurance_financial_services', 'medium', 'Presta el servicio financiero, no sólo la tecnología.', true),
  row(FIN, 'factoring-leasing-credito', 'insurance_financial_services', 'high', 'Crédito y financiación empresarial.'),
  row(FIN, 'fondos-gestion-activos', 'insurance_financial_services', 'high', 'Gestión de activos.'),
  row(FIN, 'cooperativas-financieras', 'insurance_financial_services', 'high', 'Entidad financiera solidaria.'),

  // ── Salud (9) ───────────────────────────────────────────────────────────────
  row(HEALTH, 'redes-hospitalarias-clinicas', 'health_pharma', 'high', 'Prestador de servicios de salud.'),
  row(HEALTH, 'laboratorios-farmaceuticos', 'health_pharma', 'high', 'Farmacéutica.'),
  row(HEALTH, 'distribuidores-farmaceuticos', 'health_pharma', 'medium', 'Distribución farmacéutica: también encaja en Transporte & Logística por su operación.', true),
  row(HEALTH, 'dispositivos-medicos-medtech', 'health_pharma', 'medium', 'Fabricante de dispositivos: también es manufactura.', true),
  row(HEALTH, 'laboratorios-clinicos-diagnostico', 'health_pharma', 'high', 'Diagnóstico clínico.'),
  row(HEALTH, 'salud-ocupacional', 'health_pharma', 'high', 'Servicio médico laboral.'),
  row(HEALTH, 'medicina-prepagada-eps', 'health_pharma', 'medium', 'Asegurador de salud: también encaja en Seguros y Servicios Financieros.', true),
  row(HEALTH, 'cro-investigacion-clinica', 'health_pharma', 'high', 'Investigación clínica.'),
  row(HEALTH, 'equipamiento-hospitalario', 'health_pharma', 'medium', 'Suministro hospitalario: también es manufactura o distribución.', true),

  // ── Educación (7) — sin destino ─────────────────────────────────────────────
  row(EDU, 'universidades-institutos-privados', null, 'none', NO_EDUCATION_MACRO),
  row(EDU, 'universidades-publicas-relevantes', null, 'none', `${NO_EDUCATION_MACRO} Gobierno sería defendible sólo para las públicas.`, true),
  row(EDU, 'escuelas-negocios-ejecutiva', null, 'none', NO_EDUCATION_MACRO),
  row(EDU, 'formacion-corporativa-b2b', null, 'none', `${NO_EDUCATION_MACRO} Compañía de Servicios sería defendible por su modelo B2B.`, true),
  row(EDU, 'institutos-tecnicos-vocacionales', null, 'none', NO_EDUCATION_MACRO),
  row(EDU, 'certificacion-profesional-b2b', null, 'none', `${NO_EDUCATION_MACRO} Compañía de Servicios sería defendible por su modelo B2B.`, true),
  row(EDU, 'grupos-educativos-red', null, 'none', NO_EDUCATION_MACRO),

  // ── Retail y Consumo (7) — se parte en dos macro industrias ─────────────────
  row(RETAIL, 'supermercados-hipermercados', 'retail', 'high', 'Punto de venta minorista.'),
  row(RETAIL, 'tiendas-departamento-moda', 'retail', 'high', 'Punto de venta minorista.'),
  row(RETAIL, 'farmacias-cadena-retail', 'retail', 'medium', 'Cadena minorista de salud: también encaja en Salud & Farmacéuticos.', true),
  row(RETAIL, 'retailers-especializados', 'retail', 'high', 'Punto de venta minorista.'),
  row(RETAIL, 'operadores-omnicanal', 'retail', 'high', 'Punto de venta minorista.'),
  row(RETAIL, 'fabricantes-alimentos-bebidas', 'consumer_goods', 'high', 'Fabricante FMCG, no minorista: la taxonomía nueva los separa.'),
  row(RETAIL, 'cuidado-personal-higiene-hogar', 'consumer_goods', 'high', 'Fabricante FMCG, no minorista.'),

  // ── Manufactura e Industria (7) — se parte en cuatro macro industrias ───────
  row(MANUF, 'metalmecanica-autopartes', 'industry_manufacturing_chemicals_automotive', 'high', 'Metalmecánica y automotor.'),
  row(MANUF, 'quimicos-plasticos-packaging', 'industry_manufacturing_chemicals_automotive', 'high', 'Químicos y plásticos.'),
  row(MANUF, 'bienes-capital-maquinaria', 'industry_manufacturing_chemicals_automotive', 'high', 'Bienes de capital.'),
  row(MANUF, 'manufactura-exportadora', 'industry_manufacturing_chemicals_automotive', 'high', 'Manufactura.'),
  row(MANUF, 'construccion-obra-civil', 'property_construction', 'high', 'Construcción e infraestructura: macro industria propia en la taxonomía nueva.'),
  row(MANUF, 'energia-mineria-servicios', 'energy_mining_environment', 'high', 'Energía y minería: macro industria propia en la taxonomía nueva.'),
  row(MANUF, 'agroindustria-procesadora', 'agroindustry', 'high', 'Agroindustria: macro industria propia en la taxonomía nueva.'),

  // ── Consultoría y Servicios Profesionales (7) ──────────────────────────────
  row(CONSULT, 'consultoria-estrategia-gestion', 'services_company', 'high', 'Consultoría de gestión.'),
  row(CONSULT, 'auditoria-contabilidad', 'services_company', 'high', 'Auditoría y contabilidad.'),
  row(CONSULT, 'servicios-legales-compliance', 'services_company', 'high', 'Servicios legales.'),
  row(CONSULT, 'bpo-contact-center', 'services_company', 'high', 'BPO y contact center.'),
  row(CONSULT, 'staffing-servicios-temporales', 'services_company', 'high', 'Staffing.'),
  row(CONSULT, 'facilities-seguridad-privada', 'services_company', 'high', 'Facilities y seguridad privada.'),
  row(CONSULT, 'investigacion-mercados-inteligencia', 'services_company', 'high', 'Investigación de mercados.'),

  // ── Logística y Transporte (8) ──────────────────────────────────────────────
  row(LOGI, 'operadores-logisticos-3pl-4pl', 'transport_logistics', 'high', 'Operador logístico.'),
  row(LOGI, 'transporte-carga-terrestre', 'transport_logistics', 'high', 'Transporte de carga.'),
  row(LOGI, 'freight-forwarders-aduana', 'transport_logistics', 'high', 'Freight forwarding y aduana.'),
  row(LOGI, 'cadena-frio-farmaceutica', 'transport_logistics', 'medium', 'Logística especializada: también encaja en Salud & Farmacéuticos por su vertical.', true),
  row(LOGI, 'warehousing-fulfillment', 'transport_logistics', 'high', 'Almacenamiento y fulfillment.'),
  row(LOGI, 'operadores-portuarios-aeroportuarios', 'transport_logistics', 'high', 'Operación portuaria y aeroportuaria de carga.'),
  row(LOGI, 'logistica-mineria-energia', 'transport_logistics', 'medium', 'Operador logístico con vertical minero-energética: también encaja en Gas / Petróleo / Energía / Minería.', true),
  row(LOGI, 'courier-mensajeria-empresarial', 'transport_logistics', 'high', 'Courier y mensajería.'),
];

// ─── Matriz completa ──────────────────────────────────────────────────────────

/** Las 8 filas de industria seguidas de las 73 de subindustria. */
export const LEGACY_TAXONOMY_MAPPING: readonly LegacyTaxonomyMappingRow[] = [
  ...INDUSTRY_ROWS,
  ...SUBINDUSTRY_ROWS,
];

export type LegacyTaxonomyMappingSummary = {
  oldIndustries: number;
  oldSubindustries: number;
  /** Filas con destino propuesto, ambiguo o no. */
  mapped: number;
  /** Filas con más de un destino defendible. Subconjunto de `mapped` salvo las `none`. */
  ambiguous: number;
  /** Filas sin destino. */
  unmapped: number;
};

/** Recuento de la matriz. Derivado, nunca escrito a mano. */
export function summarizeLegacyTaxonomyMapping(
  rows: readonly LegacyTaxonomyMappingRow[] = LEGACY_TAXONOMY_MAPPING,
): LegacyTaxonomyMappingSummary {
  return {
    oldIndustries: rows.filter((r) => r.oldSubindustry === null).length,
    oldSubindustries: rows.filter((r) => r.oldSubindustry !== null).length,
    mapped: rows.filter((r) => r.proposedMacroIndustry !== null).length,
    ambiguous: rows.filter((r) => r.ambiguous).length,
    unmapped: rows.filter((r) => r.proposedMacroIndustry === null).length,
  };
}

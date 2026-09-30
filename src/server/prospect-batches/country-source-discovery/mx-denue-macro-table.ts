/**
 * mx-denue-macro-table.ts — qué macro industria corresponde a cada actividad SCIAN
 * de México (DENUE, INEGI), y qué consultar a DENUE para cada macro.
 *
 * SOURCES-MX-DENUE-FREE-DISCOVERY-1.
 *
 * Tabla aprobada por la dueña del producto («tabla MX aprobada», 30-09-2026),
 * con el mismo criterio que República Dominicana y Argentina. Cambiarla es una
 * decisión de producto: no se edita sin su visto bueno.
 *
 * Reglas:
 *   - Gana el prefijo SCIAN MÁS LARGO que esté en la tabla (clase de 6 dígitos →
 *     rama 4 → subsector 3 → sector 2). Así «3254 farmacéutica» gana a «32
 *     manufactura», y «5415 sistemas de cómputo» a «54 servicios».
 *   - `null` en la tabla = «sin macro» explícito (radio y TV, educación,
 *     hoteles…): esas empresas nunca se ofrecen.
 *   - Un prefijo que no esté en la tabla tampoco tiene macro.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

/** Versión de la tabla aprobada. */
export const MX_DENUE_MACRO_TABLE_VERSION = 'mx-scian-denue-macro-v1' as const;

const MANUFACTURING = 'industry_manufacturing_chemicals_automotive' as const;
const ENERGY = 'energy_mining_environment' as const;

/** Prefijo SCIAN → macro (o `null` = sin macro). Aprobada 30-09-2026. */
export const MX_SCIAN_MACRO: Readonly<Record<string, MacroIndustryKey | null>> = Object.freeze({
  // Sectores
  '11': 'agroindustry',
  '21': ENERGY,
  '22': ENERGY,
  '23': 'property_construction',
  '31': MANUFACTURING,
  '32': MANUFACTURING,
  '33': MANUFACTURING,
  '43': 'retail',
  '46': 'retail',
  '48': 'transport_logistics',
  '49': 'transport_logistics',
  '52': 'insurance_financial_services',
  '54': 'services_company',
  '55': 'services_company',
  '56': 'services_company',
  '61': null, // educación
  '62': 'health_pharma',
  '71': null, // esparcimiento
  '72': null, // hoteles y restaurantes
  '81': null, // otros servicios
  '93': 'government',
  // Subsectores
  '311': 'consumer_goods', // alimentos
  '312': 'consumer_goods', // bebidas y tabaco
  '511': null, // editoriales (salvo software, ver 5112)
  '512': null, // cine
  '515': null, // radio y televisión
  '517': 'technology', // telecomunicaciones
  '518': 'technology', // procesamiento de datos y hosting
  '519': 'technology', // otros servicios de información
  '531': 'property_construction', // servicios inmobiliarios
  '532': 'services_company', // alquiler de bienes
  '533': null, // marcas
  '562': ENERGY, // manejo de residuos
  // Ramas
  '3254': 'health_pharma', // farmacéutica
  '3391': 'health_pharma', // equipo médico
  '4641': 'health_pharma', // farmacias
  '5112': 'technology', // edición de software
  '5415': 'technology', // diseño de sistemas de cómputo
  '5417': null, // investigación científica
});

/** Macro de un código SCIAN (clase de 6 dígitos u otro prefijo), o `null`. */
export function resolveScianMacro(code: string | null | undefined): MacroIndustryKey | null {
  if (typeof code !== 'string') return null;
  const digits = code.trim();
  if (!/^\d{2,6}$/.test(digits)) return null;
  for (let length = digits.length; length >= 2; length--) {
    const prefix = digits.slice(0, length);
    if (Object.prototype.hasOwnProperty.call(MX_SCIAN_MACRO, prefix)) {
      return MX_SCIAN_MACRO[prefix];
    }
  }
  return null;
}

/** Un filtro de actividad para `BuscarAreaActEstr` (0 = todos). */
export type DenueActivityFilter = { sector: string; subsector: string; rama: string };

const filter = (code: string): DenueActivityFilter => ({
  sector: code.slice(0, 2),
  subsector: code.length >= 3 ? code.slice(0, 3) : '0',
  rama: code.length >= 4 ? code.slice(0, 4) : '0',
});

/**
 * Qué pedir a DENUE para cada macro. Los resultados se re-clasifican con
 * `resolveScianMacro`, así que un filtro amplio (p. ej. «32» para manufactura)
 * nunca cuela una farmacéutica (3254 → Salud).
 */
export const MX_DENUE_QUERY_PLAN: Readonly<Record<string, readonly DenueActivityFilter[]>> = Object.freeze({
  agroindustry: ['11'].map(filter),
  energy_mining_environment: ['21', '22', '562'].map(filter),
  property_construction: ['23', '531'].map(filter),
  consumer_goods: ['311', '312'].map(filter),
  industry_manufacturing_chemicals_automotive: ['31', '32', '33'].map(filter),
  health_pharma: ['62', '3254', '3391', '4641'].map(filter),
  retail: ['43', '46'].map(filter),
  transport_logistics: ['48', '49'].map(filter),
  technology: ['5112', '517', '518', '519', '5415'].map(filter),
  insurance_financial_services: ['52'].map(filter),
  services_company: ['54', '55', '56', '532'].map(filter),
  government: ['93'].map(filter),
});

/** ¿Hay algo que preguntar a DENUE para esta macro? */
export function macroHasMxCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (MX_DENUE_QUERY_PLAN[macroIndustryKey] ?? []).length > 0;
}

/**
 * Estratos de personal ocupado que se ofrecen, de mayor a menor. Tamaño mínimo
 * 51 personas (propuesto a la dueña con la tabla, 30-09-2026): la capa gratuita no
 * cierra el objetivo con micronegocios. 7 = 251 y más, 6 = 101-250, 5 = 51-100.
 */
export const MX_DENUE_ESTRATOS: readonly string[] = ['7', '6', '5'];

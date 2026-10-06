/**
 * ar-rns-macro-table.ts — qué macro industria corresponde a cada actividad del
 * nomenclador de ARCA (Argentina), basado en CIIU Rev. 4 a 6 dígitos.
 *
 * SOURCES-AR-RNS-1.
 *
 * ── 🔴 Por qué una tabla escrita a mano, igual que en República Dominicana ──
 *
 * Se midió (29-09-2026) sobre las 32.493 sociedades activas argentinas que son
 * proveedoras del Estado: el índice CIIU derivado de Colombia clasifica sólo el
 * 11 % y deja Tecnología, Retail, Transporte y Agroindustria en cero, y el
 * evaluador por palabras sólo el 20 %. Los dos primeros dígitos del código
 * argentino siguen limpiamente la división CIIU Rev. 4, así que una tabla por
 * división cubre casi todo. La dueña del producto la aprobó («tabla AR
 * aprobada», 29-09-2026). Cambiarla es una decisión de producto: no se edita
 * sin su visto bueno.
 *
 * v2 (SOURCES-AR-E2E-1, propuesta a la dueña el 05-10-2026, «sí»): en Retail
 * dominaban mayoristas de informática y de equipo médico. Pasan a su industria:
 * clases 4651 (informática) y 4652 (telefonía y comunicaciones) → Tecnología;
 * código 474010 (venta al por menor de informática, en la práctica
 * integradores) → Tecnología; código 465350 (equipo médico y paramédico) → Salud.
 *
 * Reglas:
 *   - El código (6 dígitos) manda sobre su clase, y la clase (4 dígitos) sobre su
 *     división (mayoristas y farmacias de productos farmacéuticos → Salud).
 *   - Una división que no aparece NO tiene macro: la fuente gratuita nunca ofrece
 *     esas empresas (hoteles, restaurantes, medios, radio y TV, investigación,
 *     veterinarias, educación, cultura y asociaciones).
 *   - ARCA guarda el código como número: las divisiones 01-09 llegan sin el cero
 *     inicial (`11111` es `011111`). Se rellena a 6 dígitos.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

/** Versión de la tabla aprobada. */
export const AR_RNS_MACRO_TABLE_VERSION = 'ar-ciiu4-arca-macro-v2' as const;

const MANUFACTURING = 'industry_manufacturing_chemicals_automotive' as const;
const ENERGY = 'energy_mining_environment' as const;

/** División CIIU Rev. 4 (2 dígitos) → macro industria. Aprobada 29-09-2026. */
export const AR_RNS_DIVISION_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '01': 'agroindustry',
  '02': 'agroindustry',
  '03': 'agroindustry',
  '05': ENERGY,
  '06': ENERGY,
  '07': ENERGY,
  '08': ENERGY,
  '09': ENERGY,
  '10': 'consumer_goods',
  '11': 'consumer_goods',
  '12': 'consumer_goods',
  '13': MANUFACTURING,
  '14': MANUFACTURING,
  '15': MANUFACTURING,
  '16': MANUFACTURING,
  '17': MANUFACTURING,
  '18': MANUFACTURING,
  '19': ENERGY,
  '20': MANUFACTURING,
  '21': 'health_pharma',
  '22': MANUFACTURING,
  '23': MANUFACTURING,
  '24': MANUFACTURING,
  '25': MANUFACTURING,
  '26': MANUFACTURING,
  '27': MANUFACTURING,
  '28': MANUFACTURING,
  '29': MANUFACTURING,
  '30': MANUFACTURING,
  '31': MANUFACTURING,
  '32': MANUFACTURING,
  '33': MANUFACTURING,
  '35': ENERGY,
  '36': ENERGY,
  '37': ENERGY,
  '38': ENERGY,
  '39': ENERGY,
  '41': 'property_construction',
  '42': 'property_construction',
  '43': 'property_construction',
  '45': 'retail',
  '46': 'retail',
  '47': 'retail',
  '49': 'transport_logistics',
  '50': 'transport_logistics',
  '51': 'transport_logistics',
  '52': 'transport_logistics',
  '53': 'transport_logistics',
  '61': 'technology',
  '62': 'technology',
  '63': 'technology',
  '64': 'insurance_financial_services',
  '65': 'insurance_financial_services',
  '66': 'insurance_financial_services',
  '68': 'property_construction',
  '69': 'services_company',
  '70': 'services_company',
  '71': 'services_company',
  '73': 'services_company',
  '74': 'services_company',
  '77': 'services_company',
  '78': 'services_company',
  '79': 'services_company',
  '80': 'services_company',
  '81': 'services_company',
  '82': 'services_company',
  '84': 'government',
  '86': 'health_pharma',
  '87': 'health_pharma',
  '88': 'health_pharma',
});

/** Clase (4 dígitos) → macro. Manda sobre la división. */
export const AR_RNS_CLASS_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '4643': 'health_pharma', // venta al por mayor de productos farmacéuticos
  '4773': 'health_pharma', // venta al por menor de productos farmacéuticos
  '4651': 'technology', // v2: venta al por mayor de equipos y programas informáticos
  '4652': 'technology', // v2: venta al por mayor de equipos de telefonía y comunicaciones
});

/** Código (6 dígitos) → macro. Manda sobre la clase. v2. */
export const AR_RNS_CODE_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '465350': 'health_pharma', // venta al por mayor de equipo médico y paramédico
  '474010': 'technology', // venta al por menor de equipos y programas informáticos
});

/** Código ARCA tal como llega (número, con espacios o sin cero inicial) → 6 dígitos. */
export function normalizeArActivityCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.trim();
  if (!/^\d{1,6}$/.test(digits)) return null;
  return digits.padStart(6, '0');
}

/** Macro de UN código de actividad ARCA, o `null` si no tiene. */
export function resolveArActivityMacro(raw: string | null | undefined): MacroIndustryKey | null {
  const code = normalizeArActivityCode(raw);
  if (code === null) return null;
  return (
    AR_RNS_CODE_MACRO[code] ??
    AR_RNS_CLASS_MACRO[code.slice(0, 4)] ??
    AR_RNS_DIVISION_MACRO[code.slice(0, 2)] ??
    null
  );
}

/** ¿Tiene esta macro alguna actividad argentina clasificada? */
export function macroHasArCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (
    Object.values(AR_RNS_DIVISION_MACRO).includes(macroIndustryKey as MacroIndustryKey) ||
    Object.values(AR_RNS_CLASS_MACRO).includes(macroIndustryKey as MacroIndustryKey) ||
    Object.values(AR_RNS_CODE_MACRO).includes(macroIndustryKey as MacroIndustryKey)
  );
}

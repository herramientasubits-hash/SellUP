/**
 * do-dgii-macro-table.ts — qué macro industria corresponde a cada actividad
 * oficial de República Dominicana (clasificador CIIU.DR 2009 de la DGII).
 *
 * SOURCES-DO-FREE-DISCOVERY-1.
 *
 * ── 🔴 Por qué aquí SÍ hay una tabla escrita a mano ─────────────────────────
 *
 * En Colombia (`macro-ciiu-index.ts`) el índice se DERIVA pasando cada
 * descripción CIIU por el evaluador canónico. Para República Dominicana se midió
 * lo mismo (29-09-2026) y no sirve: con los textos oficiales DGII el evaluador
 * confunde industrias («construcción de barcos a motor» → construcción,
 * «venta al por menor por cualquier medio» → tecnología) y deja Salud, Retail y
 * Agroindustria en cero. La dueña del producto decidió reemplazarlo, sólo para
 * este país, por esta tabla división → macro, revisada y aprobada por ella
 * («tabla aprobada», 29-09-2026). Cambiarla es una decisión de producto: no se
 * edita sin su visto bueno.
 *
 * Reglas:
 *   - La actividad exacta (6 dígitos) manda sobre su clase, y la clase (4 o 3
 *     dígitos) manda sobre su división (farmacias en retail →
 *     Salud; telecomunicaciones en correos → Tecnología).
 *   - Una división que no aparece aquí NO tiene macro: la fuente gratuita nunca
 *     ofrece esas empresas (hoteles, educación, medios, asociaciones…).
 *   - Un texto DGII cuyos códigos apuntan a macros distintas es ambiguo y queda
 *     fuera. La ausencia nunca confirma.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj. El índice se calcula una vez.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { DGII_ACTIVITY_CIIU_DR_CATALOG } from '@/server/source-catalog/connectors/dgii-rd/dgii-activity-ciiu-dr-catalog';

/** Versión de la tabla aprobada. Viaja en la trazabilidad de cada candidato. */
export const DO_DGII_MACRO_TABLE_VERSION = 'do-ciiu-dr-2009-macro-v1' as const;

const MANUFACTURING = 'industry_manufacturing_chemicals_automotive' as const;
const ENERGY = 'energy_mining_environment' as const;

/** División CIIU.DR (2 dígitos) → macro industria. Aprobada 29-09-2026. */
export const DO_DGII_DIVISION_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '01': 'agroindustry',
  '02': 'agroindustry',
  '05': 'agroindustry',
  '10': ENERGY,
  '11': ENERGY,
  '12': ENERGY,
  '13': ENERGY,
  '14': ENERGY,
  '15': 'consumer_goods',
  '16': 'consumer_goods',
  '17': MANUFACTURING,
  '18': MANUFACTURING,
  '19': MANUFACTURING,
  '20': MANUFACTURING,
  '21': MANUFACTURING,
  '22': MANUFACTURING,
  '23': ENERGY,
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
  '34': MANUFACTURING,
  '35': MANUFACTURING,
  '36': MANUFACTURING,
  '37': ENERGY,
  '40': ENERGY,
  '41': ENERGY,
  '45': 'property_construction',
  '50': 'retail',
  '51': 'retail',
  '52': 'retail',
  '60': 'transport_logistics',
  '61': 'transport_logistics',
  '62': 'transport_logistics',
  '63': 'transport_logistics',
  '64': 'transport_logistics',
  '65': 'insurance_financial_services',
  '66': 'insurance_financial_services',
  '67': 'insurance_financial_services',
  '70': 'property_construction',
  '72': 'technology',
  '74': 'services_company',
  '75': 'government',
  '85': 'health_pharma',
  '90': ENERGY,
});

/** Clase CIIU.DR (4 o 3 dígitos) → macro. Manda sobre la división. */
export const DO_DGII_CLASS_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '2423': 'health_pharma', // fabricación de productos farmacéuticos
  '3311': 'health_pharma', // equipo médico y quirúrgico
  '5133': 'health_pharma', // venta al por mayor de productos farmacéuticos
  '5231': 'health_pharma', // farmacias
  '642': 'technology', // telecomunicaciones
});

/**
 * Actividad exacta (6 dígitos) → macro, o `null` para «sin macro». Manda sobre la
 * clase y la división. Decidido 30-09-2026 con el mismo criterio que la tabla de
 * Argentina (la dueña delegó la decisión): radio y TV y los servicios a animales
 * quedan sin macro, el telemarketing es un servicio y las prisiones son gobierno.
 */
export const DO_DGII_ACTIVITY_MACRO: Readonly<Record<string, MacroIndustryKey | null>> = Object.freeze({
  '642010': null, // servicios de transmisión de radio y televisión
  '642091': null, // emisión de programas de televisión
  '642030': 'services_company', // telemarketing / centro de contacto
  '853131': 'government', // administración de prisiones y servicios correccionales
  '014292': null, // albergue y cuidado de animales de terceros
});

/** Macro de UN código CIIU.DR de 6 dígitos, o `null` si no tiene. */
export function resolveCiiuDrMacro(code: string): MacroIndustryKey | null {
  if (!/^\d{6}$/.test(code)) return null;
  if (Object.prototype.hasOwnProperty.call(DO_DGII_ACTIVITY_MACRO, code)) {
    return DO_DGII_ACTIVITY_MACRO[code];
  }
  return (
    DO_DGII_CLASS_MACRO[code.slice(0, 4)] ??
    DO_DGII_CLASS_MACRO[code.slice(0, 3)] ??
    DO_DGII_DIVISION_MACRO[code.slice(0, 2)] ??
    null
  );
}

export type DgiiActivityClassification = {
  macroIndustryKey: MacroIndustryKey;
  /** Código CIIU.DR representativo (el primero del catálogo). Trazabilidad. */
  code: string;
  /** Descripción oficial completa. Es lo que se muestra como industria declarada. */
  description: string;
};

function buildIndex(): {
  byText: ReadonlyMap<string, DgiiActivityClassification>;
  textsByMacro: ReadonlyMap<string, readonly string[]>;
} {
  const byText = new Map<string, DgiiActivityClassification>();
  const textsByMacro = new Map<string, string[]>();

  for (const entry of DGII_ACTIVITY_CIIU_DR_CATALOG) {
    const macros = new Set(entry.codes.map(resolveCiiuDrMacro));
    // Un solo destino, y que no sea «sin macro»: cualquier otra cosa es ambigua.
    if (macros.size !== 1) continue;
    const macro = [...macros][0];
    if (macro === null || entry.codes.length === 0) continue;

    byText.set(entry.text, {
      macroIndustryKey: macro,
      code: entry.codes[0],
      description: entry.description,
    });
    const list = textsByMacro.get(macro) ?? [];
    list.push(entry.text);
    textsByMacro.set(macro, list);
  }

  const frozen = new Map<string, readonly string[]>();
  for (const [macro, texts] of textsByMacro) frozen.set(macro, Object.freeze([...texts].sort()));
  return { byText, textsByMacro: frozen };
}

const INDEX = buildIndex();

/** Textos DGII (tal como están guardados) que pertenecen a esta macro. */
export function resolveDgiiActivityTextsForMacro(
  macroIndustryKey: string | null | undefined,
): readonly string[] {
  if (typeof macroIndustryKey !== 'string') return [];
  return INDEX.textsByMacro.get(macroIndustryKey) ?? [];
}

/** ¿Tiene esta macro alguna actividad DGII clasificada? */
export function macroHasDgiiCoverage(macroIndustryKey: string | null | undefined): boolean {
  return resolveDgiiActivityTextsForMacro(macroIndustryKey).length > 0;
}

/** Clasificación de un texto DGII guardado, o `null` (sin catálogo, ambiguo o sin macro). */
export function classifyDgiiActivityText(
  text: string | null | undefined,
): DgiiActivityClassification | null {
  if (typeof text !== 'string') return null;
  return INDEX.byText.get(text) ?? null;
}

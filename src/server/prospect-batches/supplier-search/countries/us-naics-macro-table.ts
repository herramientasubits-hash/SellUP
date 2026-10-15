/**
 * ✅ APROBADA por la dueña el 15-10-2026 (AGENT1-SUPPLIER-SEARCH-ALL-1).
 * Cambiarla es una decisión de producto.
 *
 * Estados Unidos — qué macro industria corresponde a un proveedor según LO QUE LE VENDE A
 * LA AGENCIA en USAspending: el código NAICS de cada contrato (2022/2017, 6 dígitos).
 * NAICS ya es una taxonomía de industria: el SECTOR (2 dígitos) da la macro y algunos
 * grupos (4 dígitos) y dos clases mayoristas (6) la corrigen. Gana el prefijo más
 * largo. Mismas decisiones que la tabla UNSPSC aprobada de Paraguay: quien revende
 * informática o equipo médico va a Tecnología o Salud; vehículos a Comercio; educación,
 * comida y alojamiento, arte, asociaciones, hogares y administración pública NO tienen
 * macro (nunca se ofrecen). Regla del 50 %: la macro que suma más monto, sólo si pesa al
 * menos la mitad. PSC no hace falta: todos los contratos A–D traen NAICS.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import type { ProcurementClassifier } from '../procurement-links';

/** Versión de la tabla (aprobada por la dueña el 15-10-2026). */
export const US_NAICS_MACRO_TABLE_VERSION = 'us-naics-macro-v1' as const;

/** Peso mínimo de la macro dominante (monto) para clasificar al proveedor. */
export const US_NAICS_DOMINANT_MIN_SHARE = 0.5;

const MANUFACTURING = 'industry_manufacturing_chemicals_automotive' as const;
const ENERGY = 'energy_mining_environment' as const;

/** Prefijo NAICS (2, 4 o 6 dígitos, lo que acepta USAspending) → macro industria. Gana el más largo. */
export const US_NAICS_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  // ── Sectores ──
  '11': 'agroindustry', // agricultura, ganadería, silvicultura y pesca
  '21': ENERGY, // minería, petróleo y gas
  '22': ENERGY, // servicios públicos (electricidad, gas, agua)
  '23': 'property_construction', // construcción
  '31': MANUFACTURING, // manufactura
  '32': MANUFACTURING, // manufactura
  '33': MANUFACTURING, // manufactura
  '42': 'retail', // comercio mayorista
  '44': 'retail', // comercio minorista
  '45': 'retail', // comercio minorista
  '48': 'transport_logistics', // transporte
  '49': 'transport_logistics', // correo, mensajería y almacenamiento
  '51': 'technology', // información (telecomunicaciones, software, datos)
  '52': 'insurance_financial_services', // finanzas y seguros
  '53': 'property_construction', // inmobiliarias
  '54': 'services_company', // servicios profesionales, científicos y técnicos
  '56': 'services_company', // apoyo administrativo, limpieza, vigilancia, personal
  '62': 'health_pharma', // salud
  '81': 'services_company', // otros servicios (reparación y mantenimiento)
  // '55' holdings, '61' educación, '71' arte y recreación, '72' alojamiento y comida,
  // '92' administración pública: sin macro.
  // ── Grupos (4 dígitos) y clases (6) que el sector no distingue. El filtro de
  //    USAspending sólo acepta 2, 4 o 6 dígitos: los subsectores van por sus grupos. ──
  '3111': 'consumer_goods', '3112': 'consumer_goods', '3113': 'consumer_goods', // alimentos
  '3114': 'consumer_goods', '3115': 'consumer_goods', '3116': 'consumer_goods',
  '3117': 'consumer_goods', '3118': 'consumer_goods', '3119': 'consumer_goods',
  '3121': 'consumer_goods', '3122': 'consumer_goods', // bebidas y tabaco
  '3241': ENERGY, // derivados del petróleo y del carbón
  '3254': 'health_pharma', // farmacéutica
  '3256': 'consumer_goods', // jabones, limpieza y cuidado personal
  '3341': 'technology', '3342': 'technology', '3343': 'technology', // computadoras, comunicaciones, audio y video
  '3344': 'technology', '3346': 'technology', // semiconductores, medios magnéticos y ópticos
  // '3345' instrumentos de medición y control: queda en manufactura (mezcla).
  '3391': 'health_pharma', // equipos y suministros médicos
  '4231': 'retail', // vehículos y repuestos (mayorista)
  '4242': 'health_pharma', // medicamentos (mayorista)
  '4244': 'consumer_goods', // alimentos (mayorista)
  '4245': 'agroindustry', // materias primas agrícolas (mayorista)
  '4247': ENERGY, // petróleo y derivados (mayorista)
  '423430': 'technology', // computadoras, periféricos y software (mayorista)
  '423450': 'health_pharma', // equipo médico, dental y hospitalario (mayorista)
  '4461': 'health_pharma', // farmacias y cuidado de la salud (NAICS 2017)
  '4562': 'health_pharma', // farmacias y cuidado de la salud (NAICS 2022)
  '4861': ENERGY, '4862': ENERGY, '4869': ENERGY, // transporte por ductos
  '5111': 'services_company', // editoriales (NAICS 2017)
  '5112': 'technology', // editores de software (NAICS 2017)
  '5131': 'services_company', // editoriales (NAICS 2022)
  '5132': 'technology', // editores de software (NAICS 2022)
  '5121': 'services_company', '5122': 'services_company', // cine y grabación
  '5321': 'services_company', '5322': 'services_company', // alquiler de vehículos y bienes
  '5323': 'services_company', '5324': 'services_company', // alquiler general y de maquinaria
  '5331': 'services_company', // arrendadores de propiedad intelectual
  '5415': 'technology', // diseño de sistemas informáticos
  '5621': ENERGY, '5622': ENERGY, '5629': ENERGY, // gestión de residuos y remediación
});

/**
 * Prefijos SIN macro dentro de un sector que sí la tiene: ganan sobre su sector igual
 * que un prefijo con macro (agencias de viaje, asistencia social, asociaciones, hogares).
 */
export const US_NAICS_NO_MACRO_PREFIXES: ReadonlySet<string> = new Set([
  '5615', // agencias de viaje
  '6241', '6242', '6243', '6244', // asistencia social
  '8131', '8132', '8133', '8134', '8139', // organizaciones religiosas, cívicas y profesionales
  '8141', // hogares privados
]);

/** Rubro en palabras por prefijo (gana el más largo). */
const US_NAICS_RUBRO: Readonly<Record<string, string>> = Object.freeze({
  '23': 'Construcción',
  '31': 'Manufactura',
  '32': 'Manufactura',
  '33': 'Manufactura',
  '3254': 'Productos farmacéuticos',
  '334': 'Computadoras y electrónica',
  '3391': 'Equipos y suministros médicos',
  '42': 'Distribución mayorista',
  '423430': 'Distribución de equipos informáticos',
  '423450': 'Distribución de equipo médico',
  '4242': 'Distribución de medicamentos',
  '48': 'Transporte',
  '49': 'Logística y almacenamiento',
  '51': 'Información y telecomunicaciones',
  '5112': 'Software',
  '517': 'Telecomunicaciones',
  '518': 'Servicios de datos y hosting',
  '52': 'Servicios financieros y seguros',
  '54': 'Servicios profesionales y técnicos',
  '5411': 'Servicios legales',
  '5413': 'Arquitectura e ingeniería',
  '5415': 'Servicios informáticos (software, desarrollo, soporte)',
  '5416': 'Consultoría de gestión',
  '5417': 'Investigación y desarrollo',
  '56': 'Apoyo administrativo y servicios generales',
  '5616': 'Seguridad y vigilancia',
  '5617': 'Limpieza y mantenimiento de edificios',
  '562': 'Gestión de residuos',
  '62': 'Servicios de salud',
  '81': 'Reparación y mantenimiento',
});

/** Código NAICS limpio (2–6 dígitos), o `null`. */
export function usNaicsCode(raw: unknown): string | null {
  const code = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  return /^\d{2,6}$/.test(code) ? code : null;
}

function longestPrefix<T>(table: Readonly<Record<string, T>>, code: string): T | null {
  for (let length = Math.min(6, code.length); length >= 2; length -= 1) {
    const prefix = code.slice(0, length);
    if (prefix in table) return table[prefix];
  }
  return null;
}

/** Macro de UN código NAICS, o `null` si no tiene. */
export function resolveUsNaicsMacro(raw: unknown): MacroIndustryKey | null {
  const code = usNaicsCode(raw);
  if (!code) return null;
  for (let length = Math.min(6, code.length); length >= 2; length -= 1) {
    const prefix = code.slice(0, length);
    if (US_NAICS_NO_MACRO_PREFIXES.has(prefix)) return null;
    if (prefix in US_NAICS_MACRO) return US_NAICS_MACRO[prefix];
  }
  return null;
}

/** Rubro en palabras de un código NAICS, o `null`. */
export function resolveUsNaicsRubro(raw: unknown): string | null {
  const code = usNaicsCode(raw);
  return code ? longestPrefix(US_NAICS_RUBRO, code) : null;
}

/** Macro dominante por monto (regla del 50 %), o `null`. */
export function resolveUsNaicsSupplierMacro(
  amountByNaics: Readonly<Record<string, number>>,
): { macroIndustryKey: MacroIndustryKey; share: number } | null {
  const byMacro = new Map<MacroIndustryKey, number>();
  let total = 0;
  for (const [code, amount] of Object.entries(amountByNaics)) {
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
    const macro = resolveUsNaicsMacro(code);
    if (macro !== null) byMacro.set(macro, (byMacro.get(macro) ?? 0) + amount);
  }
  if (total <= 0) return null;
  let best: { macroIndustryKey: MacroIndustryKey; share: number } | null = null;
  for (const [macro, amount] of byMacro) {
    const share = amount / total;
    if (best === null || share > best.share) best = { macroIndustryKey: macro, share };
  }
  return best !== null && best.share >= US_NAICS_DOMINANT_MIN_SHARE ? best : null;
}

/**
 * Prefijos NAICS que pueden dar la macro (para filtrar la consulta). Un sector con
 * subsectores de OTRA macro entra igual: la clasificación por contrato lo decide.
 * Vacío ⇒ la industria no tiene códigos (Gobierno): no se consulta.
 */
export function usNaicsPrefixesForMacro(macroIndustryKey: string): string[] {
  const codes = Object.entries(US_NAICS_MACRO)
    .filter(([, macro]) => macro === macroIndustryKey)
    .map(([code]) => code)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  // Un código cubierto por otro más corto de la lista sobra.
  return codes.filter((code) => !codes.some((other) => other.length < code.length && code.startsWith(other))).sort();
}

export const US_NAICS_CLASSIFIER: ProcurementClassifier = {
  tableVersion: US_NAICS_MACRO_TABLE_VERSION,
  classify: (amountByFamily) => resolveUsNaicsSupplierMacro(amountByFamily),
  rubroOf: (family) => resolveUsNaicsRubro(family),
};

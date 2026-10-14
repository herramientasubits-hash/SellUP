/**
 * es-free-directory-macro-table.ts — actividad → macro industria de la capa
 * gratuita de España, y los cortes de relevancia.
 *
 * SOURCES-ES-CLOSE-1. Tablas y cortes APROBADOS por la dueña el 13-10-2026.
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Dos vocabularios, según de dónde sale la empresa:
 *
 *   - CNAE 2009 (ayudas públicas de la BDNS y entes de INVENTE). A dos dígitos
 *     coincide con la CIIU Rev. 4: se usa LA MISMA tabla por división aprobada para
 *     Argentina (v2), más la letra de sección sola (así llega el 30 % de las
 *     ayudas) y la clase 4646 (mayoristas farmacéuticos, la 4643 argentina).
 *   - CPV (contratos de la Plataforma de Contratación del Sector Público): tabla
 *     nueva por división (2 dígitos). Una empresa se clasifica por la división que
 *     más contratos le da.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { AR_RNS_DIVISION_MACRO } from './ar-rns-macro-table';

/** Versión de las tablas aprobadas. */
export const ES_FREE_DIRECTORY_MACRO_TABLE_VERSION = 'es-cnae-cpv-macro-v1' as const;

/** Macro de las entidades públicas. */
export const ES_PUBLIC_ENTITY_MACRO: MacroIndustryKey = 'government';

const MANUFACTURING = 'industry_manufacturing_chemicals_automotive' as const;
const ENERGY = 'energy_mining_environment' as const;

/** Letra de sección CNAE → macro. C (industria, mezcla alimentación) y S quedan sin macro. */
export const ES_CNAE_SECTION_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  A: 'agroindustry',
  B: ENERGY,
  D: ENERGY,
  E: ENERGY,
  F: 'property_construction',
  G: 'retail',
  H: 'transport_logistics',
  J: 'technology',
  K: 'insurance_financial_services',
  L: 'property_construction',
  M: 'services_company',
  N: 'services_company',
  O: 'government',
  Q: 'health_pharma',
});

/** Clase CNAE (4 dígitos) → macro. Manda sobre la división. */
export const ES_CNAE_CLASS_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '4646': 'health_pharma', // comercio al por mayor de productos farmacéuticos
  '4773': 'health_pharma', // comercio al por menor de productos farmacéuticos
  '4651': 'technology', // comercio al por mayor de ordenadores y programas informáticos
  '4652': 'technology', // comercio al por mayor de equipos electrónicos y de telecomunicaciones
});

/** División CPV (2 dígitos) → macro. Aprobada 13-10-2026. */
export const ES_CPV_DIVISION_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '03': 'agroindustry',
  '09': ENERGY,
  '14': ENERGY,
  '15': 'consumer_goods',
  '16': MANUFACTURING,
  '18': MANUFACTURING,
  '19': MANUFACTURING,
  '22': MANUFACTURING,
  '24': MANUFACTURING,
  '30': 'technology',
  '31': MANUFACTURING,
  '32': 'technology',
  '33': 'health_pharma',
  '34': MANUFACTURING,
  '35': MANUFACTURING,
  '37': 'consumer_goods',
  '38': MANUFACTURING,
  '39': MANUFACTURING,
  '41': ENERGY,
  '42': MANUFACTURING,
  '43': MANUFACTURING,
  '44': 'property_construction',
  '45': 'property_construction',
  '48': 'technology',
  '50': 'services_company',
  '51': 'services_company',
  '55': 'services_company',
  '60': 'transport_logistics',
  '63': 'transport_logistics',
  '64': 'technology',
  '65': ENERGY,
  '66': 'insurance_financial_services',
  '70': 'property_construction',
  '71': 'services_company',
  '72': 'technology',
  '73': 'services_company',
  '76': ENERGY,
  '77': 'agroindustry',
  '79': 'services_company',
  '85': 'health_pharma',
  '90': ENERGY,
});

/**
 * Código CNAE tal como llega → sección + dígitos. Acepta «88.1», «4646», «M681»
 * (INVENTE: letra + dígitos), «H» (BDNS: sólo la sección) y «08».
 */
export function parseSpainCnae(raw: string | null | undefined): { section: string | null; digits: string | null } | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().toUpperCase().replace(/[.\s]/g, '');
  const match = /^([A-U])?(\d{1,4})?$/.exec(text);
  if (match === null || (match[1] === undefined && match[2] === undefined)) return null;
  const digits = match[2] === undefined ? null : match[2].length === 1 ? `0${match[2]}` : match[2];
  return { section: match[1] ?? null, digits };
}

/** Macro de UN código CNAE, o `null`. */
export function resolveSpainCnaeMacro(raw: string | null | undefined): MacroIndustryKey | null {
  const parsed = parseSpainCnae(raw);
  if (parsed === null) return null;
  if (parsed.digits !== null) {
    const byClass = parsed.digits.length >= 4 ? ES_CNAE_CLASS_MACRO[parsed.digits.slice(0, 4)] : undefined;
    const byDivision = (AR_RNS_DIVISION_MACRO as Readonly<Record<string, MacroIndustryKey>>)[parsed.digits.slice(0, 2)];
    if (byClass !== undefined || byDivision !== undefined) return byClass ?? byDivision ?? null;
    return null;
  }
  return parsed.section === null ? null : ES_CNAE_SECTION_MACRO[parsed.section] ?? null;
}

/** Macro de UN código CPV («72000000», «72212000-4»), o `null`. */
export function resolveSpainCpvMacro(raw: string | null | undefined): MacroIndustryKey | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.trim().replace(/-\d$/, '');
  if (!/^\d{8}$/.test(digits)) return null;
  return ES_CPV_DIVISION_MACRO[digits.slice(0, 2)] ?? null;
}

/** De dónde sale una fila de la capa gratuita. */
export type EsDirectoryKind = 'placsp_awardee' | 'bdns_large' | 'bde_financial' | 'invente_company' | 'public_entity';

/** Macro de una fila según su tipo y su código guardado. */
export function resolveEsDirectoryMacro(kind: string | null, activityCode: string | null): MacroIndustryKey | null {
  switch (kind) {
    case 'placsp_awardee':
      return resolveSpainCpvMacro(activityCode);
    case 'bdns_large':
    case 'invente_company':
      return resolveSpainCnaeMacro(activityCode);
    case 'bde_financial':
      return 'insurance_financial_services';
    case 'public_entity':
      return ES_PUBLIC_ENTITY_MACRO;
    default:
      return null;
  }
}

/** Rubro en palabras para la ficha. */
export function resolveEsDirectoryRubro(kind: string | null, activityCode: string | null): string | null {
  const code = activityCode?.trim() || null;
  switch (kind) {
    case 'placsp_awardee':
      return code === null ? 'Adjudicataria de contratos públicos' : `Contratos públicos (CPV ${code.slice(0, 2)})`;
    case 'bdns_large':
    case 'invente_company':
      return code === null ? null : `CNAE ${code}`;
    case 'bde_financial':
      return 'Entidad supervisada por el Banco de España';
    case 'public_entity':
      return 'Entidad pública';
    default:
      return null;
  }
}

/** ¿Tiene esta macro alguna actividad española clasificada? */
export function macroHasEsCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  const key = macroIndustryKey as MacroIndustryKey;
  return (
    key === ES_PUBLIC_ENTITY_MACRO ||
    Object.values(ES_CPV_DIVISION_MACRO).includes(key) ||
    Object.values(ES_CNAE_SECTION_MACRO).includes(key) ||
    Object.values(AR_RNS_DIVISION_MACRO as Readonly<Record<string, MacroIndustryKey>>).includes(key)
  );
}

// ─── Cortes de relevancia (aprobados 13-10-2026) ────────────────────────────

/** Adjudicatarias: 1 millón de euros o más adjudicado en el periodo cargado. */
export const ES_PLACSP_MIN_AWARDED_EUR = 1_000_000;

/** Trabajadores mínimos de un ente de INVENTE para ofrecerlo (los demás van al filtro de tamaño igual). */
export const ES_INVENTE_MIN_WORKERS = 50;

/** Tipos de entidad del Banco de España que son clientes (sin intermediarios de crédito pequeños). */
export const ES_BDE_CLIENT_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'Banco',
  'Cooperativa de crédito',
  'Caja de ahorros',
  'Establecimiento financiero de crédito',
  'Entidad de pago',
  'Entidad de dinero electrónico',
  'Sociedad de garantía reciproca',
  'Sociedad de tasación',
  'Instituto oficial de crédito',
  'Sucursal de entidad de crédito extranjera comunitaria',
  'Sucursal de entidad de crédito extranjera extracomunitaria',
]);

/** ¿Es relevante esta fila para ofrecerla en la capa gratuita? */
export function isEsDirectoryRelevant(input: {
  kind: string | null;
  awardedEur: number | null;
  workers: number | null;
}): boolean {
  switch (input.kind) {
    case 'placsp_awardee':
      return (input.awardedEur ?? 0) >= ES_PLACSP_MIN_AWARDED_EUR;
    case 'invente_company':
      return input.workers === null || input.workers >= ES_INVENTE_MIN_WORKERS;
    case 'bdns_large':
    case 'bde_financial':
    case 'public_entity':
      return true;
    default:
      return false;
  }
}

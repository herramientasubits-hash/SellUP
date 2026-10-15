/**
 * España — adjudicaciones de la Plataforma de Contratación del Sector Público (PLACSP,
 * sindicación 643, ATOM/CODICE mensual), cargadas en `public_procurement_supplier_links`
 * con el cargador genérico (`--country ES`).
 *
 * Comprador = la ENTIDAD por su NIF (P = corporación local, Q = organismo, S = Administración,
 * A = sociedad pública…): todos sus órganos de contratación («Alcaldía del Ayuntamiento de X»,
 * «Junta de Gobierno del Ayuntamiento de X», «Área de Gobierno … del Ayuntamiento de Madrid»)
 * comparten NIF y se agrupan con el nombre de la entidad.
 *
 * Industria por la tabla CPV (división de 2 dígitos) → macro YA APROBADA por la dueña el
 * 13-10-2026 (`es-free-directory-macro-table.ts`, la de la capa gratuita española).
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import {
  ES_CPV_DIVISION_MACRO,
  ES_FREE_DIRECTORY_MACRO_TABLE_VERSION,
} from '@/server/prospect-batches/country-source-discovery/es-free-directory-macro-table';
import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { normalizeSpainCompanyNif } from '@/server/source-catalog/connectors/placsp-spain/es-placsp-registry-rows';
import type { ProcurementClassifier } from '../procurement-links';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import type { LoadedCountrySource } from './types';

export const ES_PLACSP_AWARDS_SOURCE_KEY = 'es_placsp_awards' as const;

/** Piso acumulado entidad × proveedor en la ventana: € 10.000 (≈ US$ 11 mil). */
export const ES_PLACSP_MIN_PAIR_AMOUNT_EUR = 10_000;

/** Peso mínimo de la división CPV dominante (monto) para clasificar al proveedor. */
export const ES_CPV_DOMINANT_MIN_SHARE = 0.5;

/**
 * Letra inicial del NIF de una EMPRESA: A sociedad anónima, B limitada, C colectiva,
 * D comanditaria, F cooperativa, N entidad extranjera, W establecimiento permanente de no
 * residente. Fuera: P/Q/S (organismos públicos), R (congregaciones), G (asociaciones y
 * fundaciones), U (UTE: uniones temporales, consorcios sin personalidad), E/H/J/V
 * (comunidades de bienes, de propietarios, sociedades civiles, otros), DNI/NIE de personas.
 */
const ES_COMPANY_NIF_LETTERS = new Set(['A', 'B', 'C', 'D', 'F', 'N', 'W']);

/** NIF de proveedor EMPRESA normalizado (control válido), o `null`. */
export function parseEsCompanyNif(raw: string | null | undefined): string | null {
  const nif = normalizeSpainCompanyNif(raw);
  return nif !== null && ES_COMPANY_NIF_LETTERS.has(nif[0]) ? nif : null;
}

const ORGAN_PREFIX =
  /^(?:alcald[ií]a|pleno|junta de gobierno(?: local)?|presidencia|vicepresidencia|consejo de administraci[oó]n|consejo de gobierno|comisi[oó]n ejecutiva|direcci[oó]n(?: gerencia| general)?|director(?:a)?(?: gerente| general)?|gerencia|secretar[ií]a general|[oó]rgano de contrataci[oó]n|mesa de contrataci[oó]n)\s+(?:del|de la|de los|de las|de)\s+/i;
const ORGAN_SUFFIX = /\s*[-–.]\s*(?:presidencia|consejo de administraci[oó]n|direcci[oó]n de contrataci[oó]n|direcci[oó]n econ[oó]mica-gerencia)$/i;
const LOCAL_ENTITY_TAIL = /\s(?:del|de la)\s+((?:ayuntamiento|ajuntament|concello|diputaci[oó]n provincial|diputaci[oó]n foral|cabildo insular|consell insular)\s+de\s+.+)$/i;

/**
 * Nombre del órgano de contratación → nombre de su entidad: «Alcaldía del Ayuntamiento de
 * Arévalo» → «Ayuntamiento de Arévalo»; «Área de Gobierno de Economía … del Ayuntamiento de
 * Madrid» → «Ayuntamiento de Madrid»; «Presidencia de la Autoridad Portuaria de A Coruña» →
 * «Autoridad Portuaria de A Coruña»; «ADIF - Presidencia» → «ADIF»; «Aena. Dirección de
 * Contratación» → «Aena». Lo demás queda igual.
 */
export function esEntityNameOf(organName: string): string {
  const text = organName.replace(/\s+/g, ' ').trim();
  const tail = LOCAL_ENTITY_TAIL.exec(text)?.[1];
  const entity = tail ?? text.replace(ORGAN_PREFIX, '').replace(ORGAN_SUFFIX, '');
  return entity.charAt(0).toUpperCase() + entity.slice(1);
}

export function normalizeEsBuyerName(raw: string): string {
  return normalizePublicEntityName(raw);
}

/** División CPV (2 dígitos) de un código «72212000-4» / «45500000», o `null`. */
export function cpvDivision(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').trim().replace(/-\d$/, '');
  return /^\d{8}$/.test(digits) ? digits.slice(0, 2) : null;
}

/** Nombre corto de cada división CPV de la tabla aprobada (Reglamento (CE) 213/2008). */
export const ES_CPV_DIVISION_LABEL: Readonly<Record<string, string>> = Object.freeze({
  '03': 'Productos agrícolas, ganaderos y pesqueros',
  '09': 'Combustibles y energía',
  '14': 'Productos de la minería',
  '15': 'Alimentos y bebidas',
  '16': 'Maquinaria agrícola',
  '18': 'Prendas de vestir y calzado',
  '19': 'Cuero, textiles y plásticos',
  '22': 'Impresos',
  '24': 'Productos químicos',
  '30': 'Equipos informáticos y de oficina',
  '31': 'Maquinaria y material eléctrico',
  '32': 'Equipos de radio, televisión y telecomunicaciones',
  '33': 'Equipos médicos y productos farmacéuticos',
  '34': 'Equipos de transporte',
  '35': 'Equipos de seguridad y defensa',
  '37': 'Instrumentos musicales, deporte y juegos',
  '38': 'Equipos de laboratorio y de precisión',
  '39': 'Mobiliario y equipamiento',
  '41': 'Agua',
  '42': 'Maquinaria industrial',
  '43': 'Maquinaria de minería y construcción',
  '44': 'Materiales de construcción',
  '45': 'Trabajos de construcción',
  '48': 'Software y sistemas de información',
  '50': 'Reparación y mantenimiento',
  '51': 'Instalación',
  '55': 'Hostelería y restauración',
  '60': 'Transporte',
  '63': 'Servicios de transporte complementarios',
  '64': 'Correos y telecomunicaciones',
  '65': 'Servicios públicos (agua, energía)',
  '66': 'Servicios financieros y seguros',
  '70': 'Servicios inmobiliarios',
  '71': 'Arquitectura, ingeniería e inspección',
  '72': 'Servicios de tecnologías de la información',
  '73': 'Investigación y desarrollo',
  '76': 'Servicios para la industria del petróleo y el gas',
  '77': 'Servicios agrícolas, forestales y de jardinería',
  '79': 'Servicios a empresas',
  '85': 'Servicios de salud y sociales',
  '90': 'Saneamiento, limpieza y medio ambiente',
});

/** Macro del proveedor: la división CPV que suma más monto, si pesa al menos la mitad. */
export function resolveEsCpvSupplierMacro(
  amountByDivision: Readonly<Record<string, number>>,
): { macroIndustryKey: MacroIndustryKey; share: number } | null {
  const byMacro = new Map<MacroIndustryKey, number>();
  let total = 0;
  for (const [division, amount] of Object.entries(amountByDivision)) {
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
    const macro = ES_CPV_DIVISION_MACRO[division];
    if (macro !== undefined) byMacro.set(macro, (byMacro.get(macro) ?? 0) + amount);
  }
  if (total <= 0) return null;
  let best: { macroIndustryKey: MacroIndustryKey; share: number } | null = null;
  for (const [macro, amount] of byMacro) {
    const share = amount / total;
    if (best === null || share > best.share) best = { macroIndustryKey: macro, share };
  }
  return best !== null && best.share >= ES_CPV_DOMINANT_MIN_SHARE ? best : null;
}

export const ES_CPV_CLASSIFIER: ProcurementClassifier = {
  tableVersion: ES_FREE_DIRECTORY_MACRO_TABLE_VERSION,
  classify: (amountByFamily) => resolveEsCpvSupplierMacro(amountByFamily),
  rubroOf: (family) => (family ? ES_CPV_DIVISION_LABEL[family] ?? null : null),
};

export const ES_COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'ES',
  sourceKey: ES_PLACSP_AWARDS_SOURCE_KEY,
  taxIdentifierType: 'NIF',
  currency: 'EUR',
  minPairAmount: ES_PLACSP_MIN_PAIR_AMOUNT_EUR,
  normalizeBuyerName: normalizeEsBuyerName,
  classifier: ES_CPV_CLASSIFIER,
  // En Prod (15-10): es_free_directory 1.049 con web de 12.889; es_public_entities 3.618 (todas,
  // pero son del Estado: sólo sirve para sociedades públicas que venden a otra entidad).
  domainSourceKeys: ['es_free_directory', 'es_public_entities'],
  // `workers` (INVENTE, año 2025): es_free_directory 47 filas, es_official_nif_registry 413.
  workersSourceKeys: ['es_free_directory', 'es_official_nif_registry'],
  workersSourceLabel: 'INVENTE',
  // Todas guardan el NIF en mayúsculas sin separadores («A01001411»).
};

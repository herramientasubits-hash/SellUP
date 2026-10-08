/**
 * ni-free-directory-macro-table.ts — qué macro industria corresponde a una fila del
 * directorio gratuito de Nicaragua (`ni_free_directory` y `ni_free_directory_web`).
 *
 * SOURCES-NI-CLOSE-2. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Nicaragua no publica la actividad codificada de las sociedades. Cinco
 * clasificaciones, todas por lo que la PROPIA fuente oficial dice de la empresa:
 *
 *   1. Grandes Contribuyentes de la DGI: tabla empresa → macro
 *      (`ni-large-taxpayer-macro-table.ts`, pendiente de revisión de la dueña).
 *   2. Directorio Industrial de la Comisión Nacional de Zonas Francas (2025): la
 *      SECCIÓN en que la CNZF pone a la empresa (textil, tabaco, agroindustria,
 *      servicios tercerizados…). Las empresas de la sección «Parques Industriales»
 *      se reparten por su nombre y su actividad (operadoras de parque, tabaco,
 *      textil, agroindustria); lo demás queda sin macro.
 *   3. Licencias sanitarias del MINSA: el TIPO de licencia (farmacia = importadoras,
 *      distribuidoras y laboratorios; dispositivos médicos; establecimientos de
 *      salud → Salud; alimentos y bebidas = fabricantes e importadores → Consumo).
 *   4. Instituciones de microfinanzas registradas en la CONAMI → Servicios
 *      financieros.
 *   5. Entidades públicas con web oficial → Gobierno.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import {
  macroHasNiLargeTaxpayerCoverage,
  NI_LARGE_TAXPAYER_MACRO_TABLE_VERSION,
  resolveNiLargeTaxpayerMacro,
} from './ni-large-taxpayer-macro-table';

export const NI_FREE_DIRECTORY_MACRO_TABLE_VERSION =
  `ni-free-directory-v1(${NI_LARGE_TAXPAYER_MACRO_TABLE_VERSION})` as const;

/** Por qué fuente se clasificó la fila. */
export type NiDirectoryKind = 'large_taxpayer' | 'cnzf' | 'minsa_license' | 'conami_imf' | 'public_entity';

const MANUFACTURING: MacroIndustryKey = 'industry_manufacturing_chemicals_automotive';

/** Sección del directorio de la CNZF → macro (`null` = sin macro a propósito). */
export const NI_CNZF_SECTION_MACRO: Readonly<Record<string, MacroIndustryKey | null>> = Object.freeze({
  operadora_zona_franca: 'property_construction',
  textil_vestuario: MANUFACTURING,
  textilera: MANUFACTURING,
  insumos_servicios_textil: MANUFACTURING,
  remanufactura: MANUFACTURING,
  madera: MANUFACTURING,
  automotriz: MANUFACTURING,
  tabaco: MANUFACTURING,
  agroindustria: 'agroindustry',
  dispositivos_medicos: 'health_pharma',
  servicios_externalizados: 'services_company',
  servicios_logisticos: 'transport_logistics',
  otros: null,
});

/** Rubro en palabras de cada sección de la CNZF. */
const NI_CNZF_SECTION_LABEL: Readonly<Record<string, string>> = Object.freeze({
  operadora_zona_franca: 'Operadora de parque de Zona Franca',
  textil_vestuario: 'Textil y vestuario (Zona Franca)',
  textilera: 'Textilera (Zona Franca)',
  insumos_servicios_textil: 'Insumos y servicios para el textil (Zona Franca)',
  remanufactura: 'Remanufactura (Zona Franca)',
  madera: 'Madera (Zona Franca)',
  automotriz: 'Arneses y autopartes (Zona Franca)',
  tabaco: 'Tabaco y puros (Zona Franca)',
  agroindustria: 'Agroindustria (Zona Franca)',
  dispositivos_medicos: 'Dispositivos médicos (Zona Franca)',
  servicios_externalizados: 'Servicios tercerizados y centros de contacto (Zona Franca)',
  servicios_logisticos: 'Servicios logísticos (Zona Franca)',
});

/**
 * La sección «Parques Industriales» mezcla operadoras de parque con empresas que
 * tienen su propia Zona Franca. Nombre y actividad deciden; si nada coincide, sin macro.
 */
const PARK_SECTION_RULES: ReadonlyArray<{ section: string; pattern: RegExp }> = [
  { section: 'operadora_zona_franca', pattern: /\b(ZONAS? FRANCAS?|PARQUES? (INDUSTRIAL|AGROINDUSTRIAL)|OPERADORA|INDUSTRIAL PARK|FREE TRADE ZONE|PROPERTIES|ZONAS INDUSTRIALES|PARK)\b/ },
  { section: 'tabaco', pattern: /\b(TABAC|CIGAR|PUROS)/ },
  { section: 'textil_vestuario', pattern: /\b(TEXTIL|VESTUARIO|APPAREL|DENIM|SPIN|CONFECCI|ACTIVEWEAR)/ },
  { section: 'agroindustria', pattern: /\b(AGRO|CAMARON|BANAN|FRUT|ACUICULT)/ },
];

const plain = (text: string | null | undefined): string =>
  (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Sección efectiva de una ficha de la CNZF (la de «Parques Industriales» se reparte), o `null`. */
export function niCnzfEffectiveSection(section: string | null | undefined, name: string | null, activity: string | null): string | null {
  if (typeof section !== 'string' || section.length === 0) return null;
  if (section !== 'parque_industrial') return section in NI_CNZF_SECTION_MACRO ? section : null;
  const text = `${plain(name)} ${plain(activity)}`;
  return PARK_SECTION_RULES.find((rule) => rule.pattern.test(text))?.section ?? null;
}

/** Tipo de licencia sanitaria del MINSA → macro. */
export const NI_MINSA_LICENSE_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  farmacia: 'health_pharma',
  dispositivo_medico: 'health_pharma',
  establecimiento_salud: 'health_pharma',
  alimentos_bebidas: 'consumer_goods',
});

const NI_MINSA_LICENSE_LABEL: Readonly<Record<string, string>> = Object.freeze({
  farmacia: 'Importación, distribución o fabricación de medicamentos (MINSA)',
  dispositivo_medico: 'Importación y distribución de dispositivos médicos (MINSA)',
  establecimiento_salud: 'Establecimiento de salud (MINSA)',
  alimentos_bebidas: 'Fabricación o importación de alimentos y bebidas (MINSA)',
});

export const NI_CONAMI_MACRO: MacroIndustryKey = 'insurance_financial_services';
export const NI_PUBLIC_ENTITY_MACRO: MacroIndustryKey = 'government';

/** Macro de una fila según su fuente y su código, o `null`. */
export function resolveNiDirectoryMacro(
  kind: string | null | undefined,
  code: string | null | undefined,
): MacroIndustryKey | null {
  if (kind === 'public_entity') return NI_PUBLIC_ENTITY_MACRO;
  if (kind === 'conami_imf') return NI_CONAMI_MACRO;
  if (typeof code !== 'string') return null;
  if (kind === 'large_taxpayer') return resolveNiLargeTaxpayerMacro(code);
  if (kind === 'cnzf') return NI_CNZF_SECTION_MACRO[code] ?? null;
  if (kind === 'minsa_license') return NI_MINSA_LICENSE_MACRO[code] ?? null;
  return null;
}

/** El rubro en palabras de una fila, o `null`. */
export function resolveNiDirectoryRubro(kind: string | null | undefined, code: string | null | undefined): string | null {
  if (kind === 'conami_imf') return 'Institución de microfinanzas (CONAMI)';
  if (typeof code !== 'string') return null;
  if (kind === 'cnzf') return NI_CNZF_SECTION_LABEL[code] ?? null;
  if (kind === 'minsa_license') return NI_MINSA_LICENSE_LABEL[code] ?? null;
  return null;
}

/** ¿Tiene esta macro alguna fuente nicaragüense clasificada? */
export function macroHasNiCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (
    macroIndustryKey === NI_PUBLIC_ENTITY_MACRO ||
    macroIndustryKey === NI_CONAMI_MACRO ||
    Object.values(NI_CNZF_SECTION_MACRO).includes(macroIndustryKey as MacroIndustryKey) ||
    Object.values(NI_MINSA_LICENSE_MACRO).includes(macroIndustryKey as MacroIndustryKey) ||
    macroHasNiLargeTaxpayerCoverage(macroIndustryKey)
  );
}

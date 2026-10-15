/**
 * Costa Rica — SICOP «Datos abiertos concursos» (CSV mensual, Hacienda), cargado en
 * `public_procurement_supplier_links` con el cargador genérico
 * (`run-public-procurement-load.ts --country CR`).
 *
 *  - El CSV trae la institución y el adjudicatario SÓLO por nombre (sin cédula) y sin
 *    clasificación de producto (sólo BIENES / SERVICIOS / OBRA PÚBLICA).
 *  - El adjudicatario se cruza POR NOMBRE con el registro de Costa Rica ya cargado
 *    (`cr_company_registry` + `cr_company_name_alias`) con una coincidencia FUERTE y
 *    ÚNICA (`matchCrSupplier`); si es ambigua o débil, se descarta. La cédula que se
 *    guarda es la encontrada.
 *  - La industria del proveedor sale de su ACTIVIDAD oficial (decisión de la dueña
 *    15-10-2026), por el gancho de `cr.server.ts`.
 */

import { CR_FREE_DIRECTORY_MACRO_TABLE_VERSION } from '@/server/prospect-batches/country-source-discovery/cr-free-directory-macro-table';
import { PE_SUNAT_MACRO_TABLE_VERSION, resolvePeActivityMacro } from '@/server/prospect-batches/country-source-discovery/pe-sunat-macro-table';
import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import {
  costaRicaNameCore,
  endsWithCostaRicaLegalForm,
  isCostaRicaPublicEntityCore,
} from '@/server/source-catalog/connectors/cr-registry/cr-name-keys';
import type { ProcurementClassifier } from '../procurement-links';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import type { LoadedCountrySource } from './types';

export const CR_SICOP_SOURCE_KEY = 'cr_sicop_awards';

/** Piso entidad × proveedor en la ventana: ≈ US$10.000 (CRC ~450/US$ en 2026). */
export const CR_MIN_PAIR_AMOUNT_CRC = 4_500_000;

/** Descarga mensual anónima de SICOP (acepta GET; ≤ 1 mes por petición). */
export function crSicopMonthUrl(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return `https://www.sicop.go.cr/moduloBid/servlet/report/RE_DatosAbiertosConcursos_CONTROLLER?cmd=downloadCSV&bgnYmd=01/${mm}/${year}&endYmd=${last}/${mm}/${year}`;
}

/**
 * Prefijos de cédula jurídica de EMPRESA: sociedades anónimas (3-101), de
 * responsabilidad limitada (3-102), colectivas y en comandita (3-103/104), EIRL
 * (3-105), sociedades civiles (3-106), de actividades profesionales (3-108),
 * sucursales extranjeras (3-012), cooperativas (3-004) y mutuales (3-009). Fuera los
 * poderes y ministerios (2…), autónomas (4…), entes estatales (3-007), municipalidades
 * (3-014), asociaciones (3-002), fundaciones (3-006), juntas (3-008), temporalidades
 * (3-010) y fondos y fideicomisos (3-110/111/112).
 */
const CR_COMPANY_PREFIXES: ReadonlySet<string> = new Set(['3101', '3102', '3103', '3104', '3105', '3106', '3108', '3012', '3004', '3009']);

export function isCrCompanyCedula(cedula: string): boolean {
  return /^3\d{9}$/.test(cedula) && CR_COMPANY_PREFIXES.has(cedula.slice(0, 4));
}

/** Cédula jurídica escrita dentro del nombre del adjudicatario («3-101-123456 S.A.»). */
export function crCedulaInName(name: string): string | null {
  const match = /(?:^|[^\d])([234])[-\s]?(\d{3})[-\s]?(\d{6})(?!\d)/.exec(name);
  return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

/** Índice del registro: núcleo del nombre (`normalized_legal_name`) → cédulas. */
export type CrNameIndex = ReadonlyMap<string, readonly string[]>;

export type CrSupplierMatch =
  | { cedula: string; by: 'cedula_in_name' | 'name' }
  | { cedula: null; reason: 'no_legal_form' | 'public_entity' | 'not_found' | 'ambiguous' | 'not_company' };

/**
 * Cédula de un adjudicatario por nombre, sólo con coincidencia FUERTE y ÚNICA:
 *  1. la cédula escrita en el propio nombre, si es de empresa;
 *  2. si no, el nombre tiene que terminar en una forma societaria (así una persona
 *     física homónima de una sociedad nunca se cruza) y su núcleo tiene que estar en
 *     el registro (o sus alias) con UNA sola cédula, y ésa ser de empresa.
 * Sin variantes con o sin «de Costa Rica» ni partes del nombre: esas son para lo
 * que escribe un vendedor, no para un archivo oficial con la razón social completa.
 */
export function matchCrSupplier(name: string, index: CrNameIndex): CrSupplierMatch {
  const written = crCedulaInName(name);
  if (written) return isCrCompanyCedula(written) ? { cedula: written, by: 'cedula_in_name' } : { cedula: null, reason: 'not_company' };
  const core = costaRicaNameCore(name);
  if (isCostaRicaPublicEntityCore(core)) return { cedula: null, reason: 'public_entity' };
  if (!endsWithCostaRicaLegalForm(name)) return { cedula: null, reason: 'no_legal_form' };
  const cedulas = [...new Set(index.get(core) ?? [])];
  if (cedulas.length === 0) return { cedula: null, reason: 'not_found' };
  if (cedulas.length > 1) return { cedula: null, reason: 'ambiguous' };
  return isCrCompanyCedula(cedulas[0]) ? { cedula: cedulas[0], by: 'name' } : { cedula: null, reason: 'not_company' };
}

/**
 * CIIU del registro (MEIC: «7490 - Otras actividades…») → macro. El MEIC usa la CAECR
 * (CIIU Rev. 4 adaptada), la MISMA que Zona Franca: se clasifica con la tabla de
 * Perú/Argentina que la dueña aprobó para Costa Rica el 06-10-2026
 * (`cr-free-directory-macro-table.ts`).
 */
export function crActivityMacro(raw: string | null | undefined): MacroIndustryKey | null {
  const match = /^\s*(\d{4})\b/.exec(raw ?? '');
  return match ? resolvePeActivityMacro(match[1]) : null;
}

/** Nunca decide por lo comprado (SICOP no lo clasifica); la versión nombra las tablas de actividad. */
export const CR_ACTIVITY_CLASSIFIER: ProcurementClassifier = {
  tableVersion: `cr-activity(${PE_SUNAT_MACRO_TABLE_VERSION}+${CR_FREE_DIRECTORY_MACRO_TABLE_VERSION})`,
  classify: () => null,
  rubroOf: () => null,
};

export const CR_COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'CR',
  sourceKey: CR_SICOP_SOURCE_KEY,
  taxIdentifierType: 'cedula_juridica',
  currency: 'CRC',
  minPairAmount: CR_MIN_PAIR_AMOUNT_CRC,
  normalizeBuyerName: normalizePublicEntityName,
  classifier: CR_ACTIVITY_CLASSIFIER,
  industryByActivity: true,
  domainSourceKeys: ['cr_free_directory', 'latam_curated_directory'],
  // El MEIC da un tramo (micro/pequeña/mediana), no trabajadores.
  workersSourceKeys: [],
};

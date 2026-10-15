/**
 * Ecuador — SERCOP «Datos Abiertos» (OCDS en CSV, un zip por año), cargado en
 * `public_procurement_supplier_links` con el cargador genérico
 * (`run-public-procurement-load.ts --country EC`).
 *
 *  - Comprador y proveedor con RUC (`EC-RUC-<13>[-sufijo]`; se quita el sufijo).
 *  - Empresa = RUC de 13 dígitos con 3.er dígito 9 (sociedad privada). Fuera el 6
 *    (entidad pública) y 0–5 (persona natural).
 *  - Los datos de compras NO traen clasificación de producto: la industria del
 *    proveedor sale de su ACTIVIDAD oficial (CIIU de su ficha SCVS/SRI) con la tabla
 *    CIIU 4.0 INEC → macro ya aprobada (`ec-scvs-macro-table.ts`, v2). Decisión de la
 *    dueña (15-10-2026). La consulta está en `ec.server.ts`.
 *  - Un ministerio tiene varios RUC (matriz, coordinaciones zonales, distritos): se
 *    agrupa por RUC comprador y el nombre normalizado quita «MATRIZ» / «PLANTA
 *    CENTRAL», así «Ministerio de Salud Pública» reconoce sólo la matriz (las zonales
 *    conservan su nombre y no compiten en la coincidencia exacta).
 */

import { EC_SCVS_MACRO_TABLE_VERSION, resolveEcActivityMacro } from '@/server/prospect-batches/country-source-discovery/ec-scvs-macro-table';
import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import type { ProcurementClassifier } from '../procurement-links';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import type { LoadedCountrySource } from './types';

export const EC_SERCOP_SOURCE_KEY = 'ec_sercop_ocds_awards';

/** Piso entidad × proveedor en la ventana (Ecuador usa dólares). */
export const EC_MIN_PAIR_AMOUNT_USD = 10_000;

/** Descarga anual del portal de datos abiertos de SERCOP (zip de CSV OCDS, sin token). */
export const EC_SERCOP_YEAR_URL = (year: number) =>
  `https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/download?type=csv&year=${year}`;

/** Página pública del procedimiento (prueba que ve el vendedor). */
export function ecProcedureUrl(ocid: string | null | undefined): string | null {
  const id = (ocid ?? '').trim();
  return /^ocds-[a-z0-9]+-[A-Za-z0-9._-]+$/.test(id) ? `https://datosabiertos.compraspublicas.gob.ec/PLATAFORMA/ocds/${id}` : null;
}

/**
 * Identificador OCDS → RUC de 13 dígitos, o `null`. SERCOP escribe `EC-RUC-<RUC>-<n>`
 * (el sufijo es el n.º de registro del proveedor en el portal) y, para unos pocos,
 * `ID-<RUC>-<n>`. Sin quitar el sufijo el mismo RUC se partiría en varios pares.
 */
export function parseEcRuc(raw: string | null | undefined): string | null {
  const match = /^(?:EC-RUC|ID)-(\d{13})(?:-\d+)?$/.exec((raw ?? '').trim());
  return match ? match[1] : null;
}

/** ¿RUC de sociedad privada? (13 dígitos, 3.er dígito 9, establecimiento 001). */
export function isEcCompanyRuc(ruc: string): boolean {
  return /^\d{2}9\d{7}001$/.test(ruc);
}

/** Nombre de la entidad: el común, sin «MATRIZ» / «PLANTA CENTRAL» al final. */
export function normalizeEcBuyerName(raw: string): string {
  return normalizePublicEntityName(raw).replace(/\s+(?:MATRIZ|PLANTA CENTRAL)$/, '');
}

/**
 * CIIU de una ficha de Ecuador → macro (tabla aprobada `ec-scvs-macro-table.ts`).
 * La SCVS escribe `G4649.22`; el SRI, el mismo CIIU 4.0 del INEC sin punto
 * (`G464922`). Sólo códigos de 6 niveles: uno más corto no se adivina.
 */
export function ecActivityMacro(raw: string | null | undefined): MacroIndustryKey | null {
  const code = (raw ?? '').trim().toUpperCase();
  const sri = /^([A-U]\d{4})(\d{2})$/.exec(code);
  return resolveEcActivityMacro(sri ? `${sri[1]}.${sri[2]}` : code);
}

/**
 * Clasificador de compras de Ecuador: sus datos no traen clasificación de producto,
 * así que nunca decide (la industria la pone la actividad del proveedor). Su versión
 * nombra la tabla de actividad que sí decide, para la ficha del candidato.
 */
export const EC_ACTIVITY_CLASSIFIER: ProcurementClassifier = {
  tableVersion: `ec-activity(${EC_SCVS_MACRO_TABLE_VERSION})`,
  classify: () => null,
  rubroOf: () => null,
};

export const EC_COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'EC',
  sourceKey: EC_SERCOP_SOURCE_KEY,
  taxIdentifierType: 'RUC',
  currency: 'USD',
  minPairAmount: EC_MIN_PAIR_AMOUNT_USD,
  normalizeBuyerName: normalizeEcBuyerName,
  classifier: EC_ACTIVITY_CLASSIFIER,
  industryByActivity: true,
  // Directorio SCVS (web medida) primero; la lista curada después.
  domainSourceKeys: ['ec_scvs_directory', 'latam_curated_directory'],
  workersSourceKeys: ['ec_scvs_registry', 'ec_scvs_directory'],
  workersSourceLabel: 'SCVS',
};

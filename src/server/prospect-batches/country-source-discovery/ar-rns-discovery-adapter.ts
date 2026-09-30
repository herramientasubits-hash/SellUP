/**
 * ar-rns-discovery-adapter.ts — descubrimiento gratuito de Argentina sobre el
 * Registro Nacional de Sociedades cruzado con las adjudicaciones de COMPR.AR.
 * PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-AR-RNS-1.
 *
 * ── Qué empresas ofrece ─────────────────────────────────────────────────────
 *
 * Las filas `ar_rns` ya vienen filtradas en la carga: sociedades con actividad
 * PRINCIPAL activa en ARCA que han ganado alguna adjudicación del Estado
 * (`scripts/source-catalog/run-ar-rns-snapshot-etl.ts`). Aquí sólo se piden las de
 * la macro industria pedida, de mayor a menor importe adjudicado (percentil en
 * `priority_score`). Igual que Colombia y República Dominicana, la fuente puede
 * cerrar el objetivo entero.
 *
 * ── Doble comprobación de pertenencia ───────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero la decisión vigente es la de la
 * tabla aprobada (`ar-rns-macro-table.ts`). Cada fila se re-clasifica desde su
 * código de actividad y sólo se ofrece si la tabla de HOY coincide con la macro
 * pedida: si la tabla cambia y la carga no se repite, no se ofrece nada de más.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`ArRnsDiscoveryReads`). Este módulo no construye
 * ningún cliente, no lee env, no escribe y no sale a la red.
 */

import {
  AR_RNS_MACRO_TABLE_VERSION,
  macroHasArCoverage,
  resolveArActivityMacro,
} from './ar-rns-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const AR_RNS_DISCOVERY_SOURCE_KEY = 'ar_rns_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que Colombia). */
export const AR_RNS_DISCOVERY_MAX_ROWS = 200;

/** CUIT de persona jurídica ya normalizada: 11 dígitos con prefijo 30, 33 o 34. */
const LEGAL_ENTITY_CUIT = /^(30|33|34)\d{9}$/;

/** Fila `ar_rns` acotada a lo que esta proyección usa. */
export type ArRnsSnapshotReadRow = {
  record_identity_key: string;
  cuit: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  sector: string | null;
  city: string | null;
  region: string | null;
  activity_code: string | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type ArRnsDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly ArRnsSnapshotReadRow[]>;
};

function toCompany(row: ArRnsSnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const cuit = row.cuit?.trim() ?? '';
  if (legalName === null || !LEGAL_ENTITY_CUIT.test(cuit)) return null;
  // La tabla de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolveArActivityMacro(row.activity_code) !== macroIndustryKey) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: cuit,
    taxIdentifierType: 'CUIT',
    countryCode: 'AR',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // 🔴 El RNS no publica web. No se fabrica ninguna.
    domain: null,
    declaredIndustry: row.sector?.trim() || null,
    industryCode: row.activity_code?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: AR_RNS_MACRO_TABLE_VERSION,
    },
  };
}

/**
 * Construye el adapter de descubrimiento de Argentina.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildArRnsDiscoveryAdapter(reads: ArRnsDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: AR_RNS_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin actividades clasificadas no consulta: nunca una muestra genérica.
    if (!macroHasArCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), AR_RNS_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({
      macroIndustryKey: criteria.macroIndustryKey,
      limit,
    });

    // Una CUIT, una empresa: la primera fila válida gana (la lectura ya viene
    // ordenada por importe adjudicado).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || company.taxId === null || seen.has(company.taxId)) continue;
      seen.add(company.taxId);
      companies.push(company);
    }

    return { sourceKey: AR_RNS_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}

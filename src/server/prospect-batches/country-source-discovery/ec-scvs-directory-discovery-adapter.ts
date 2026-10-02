/**
 * ec-scvs-directory-discovery-adapter.ts — descubrimiento gratuito de Ecuador
 * sobre el directorio de compañías de la Superintendencia de Compañías cruzado
 * con su ranking empresarial. PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-EC-FREE-DISCOVERY-1.
 *
 * ── Qué empresas ofrece ─────────────────────────────────────────────────────
 *
 * Las filas `ec_scvs_directory` ya vienen filtradas en la carga: compañías
 * ACTIVAS con RUC de sociedad y 200 o más empleados en su último año del ranking
 * (`scripts/source-catalog/run-ec-scvs-directory-etl.ts`). Aquí sólo se piden las
 * de la macro industria pedida, de más a menos empleados (percentil en
 * `priority_score`). Igual que Colombia, República Dominicana y Argentina, la
 * fuente puede cerrar el objetivo entero; a diferencia de ellas, nunca con
 * empresas pequeñas.
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero la decisión vigente es la de la
 * tabla (`ec-scvs-macro-table.ts`): cada fila se re-clasifica desde su CIIU y
 * sólo se ofrece si la tabla de HOY coincide. Y el tamaño se vuelve a comprobar:
 * una fila por debajo del umbral no se ofrece aunque esté guardada.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`EcScvsDirectoryDiscoveryReads`). Este módulo no
 * construye ningún cliente, no lee env, no escribe y no sale a la red.
 */

import {
  EC_SCVS_MACRO_TABLE_VERSION,
  macroHasEcCoverage,
  resolveEcActivityMacro,
} from './ec-scvs-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const EC_SCVS_DIRECTORY_DISCOVERY_SOURCE_KEY = 'ec_scvs_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que Colombia y Argentina). */
export const EC_SCVS_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

/** Umbral de tamaño del Agente 1 (mismo que la carga). */
export const EC_SCVS_DIRECTORY_DISCOVERY_MIN_EMPLOYEES = 200;

/**
 * RUC de sociedad: provincia válida (01-24 o 30) + 8 dígitos + 001. Misma regla
 * de formato que `tax-identifier-rules.ts` (EC-RUC-v1), restringida al primer
 * establecimiento.
 */
const COMPANY_RUC = /^(0[1-9]|1[0-9]|2[0-4]|30)\d{8}001$/;

/** Fila `ec_scvs_directory` acotada a lo que esta proyección usa. */
export type EcScvsDirectorySnapshotReadRow = {
  record_identity_key: string;
  ruc: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  ciiu_code: string | null;
  employees: number | null;
  metrics_year: number | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type EcScvsDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly EcScvsDirectorySnapshotReadRow[]>;
};

function toCompany(row: EcScvsDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const ruc = row.ruc?.trim() ?? '';
  if (legalName === null || !COMPANY_RUC.test(ruc)) return null;
  if (row.employees === null || row.employees < EC_SCVS_DIRECTORY_DISCOVERY_MIN_EMPLOYEES) return null;
  // La tabla de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolveEcActivityMacro(row.ciiu_code) !== macroIndustryKey) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: ruc,
    taxIdentifierType: 'RUC',
    countryCode: 'EC',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // 🔴 El directorio no publica web. No se fabrica ninguna.
    domain: null,
    // El directorio sólo trae el código CIIU, no su descripción.
    declaredIndustry: null,
    industryCode: row.ciiu_code?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: EC_SCVS_MACRO_TABLE_VERSION,
    },
    // 🔴 Los empleados NO viajan al candidato: el writer común deja el tamaño
    // como «por validar» y su procedencia es una lista cerrada. Aquí sólo
    // garantizan que no se ofrece ninguna compañía de menos de 200; el número
    // queda en la fila de la fuente (`raw_data.workers`).
  };
}

/**
 * Construye el adapter de descubrimiento de Ecuador.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildEcScvsDirectoryDiscoveryAdapter(reads: EcScvsDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: EC_SCVS_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin actividades clasificadas no consulta: nunca una muestra genérica.
    if (!macroHasEcCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), EC_SCVS_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({
      macroIndustryKey: criteria.macroIndustryKey,
      limit,
    });

    // Un RUC, una empresa: la primera fila válida gana (la lectura ya viene
    // ordenada por empleados).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || company.taxId === null || seen.has(company.taxId)) continue;
      seen.add(company.taxId);
      companies.push(company);
    }

    return { sourceKey: EC_SCVS_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}

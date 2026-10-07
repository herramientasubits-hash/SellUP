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
 * ACTIVAS con RUC de sociedad y 100 o más empleados en su último año del ranking
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
import { buildCountrySourceOfficialWorkforce } from './country-source-types';
import { isRecycledCountrySourceCompany, type CountrySourcePriorSighting } from './country-source-prior-sightings';

/** `source_key` que esta proyección declara. */
export const EC_SCVS_DIRECTORY_DISCOVERY_SOURCE_KEY = 'ec_scvs_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que Colombia y Argentina). */
export const EC_SCVS_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

/** Umbral de tamaño del buscador gratuito (mismo que la carga; dueña 06-10: 100+ como Chile). */
export const EC_SCVS_DIRECTORY_DISCOVERY_MIN_EMPLOYEES = 100;

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
  /** SOURCES-EC-CLOSE-1 — dominio declarado en SERCOP (`ec-sercop-domain.ts`), o `null`. */
  website_domain?: string | null;
  /** SOURCES-EC-CLOSE-1 — ausente o `null` = SellUp no la vio. */
  prior_sighting?: CountrySourcePriorSighting | null;
};

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

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
    // 🔴 El directorio no publica web. El único dominio es el que la compañía
    // declaró en SERCOP y se parece a su razón social (`ec-sercop-domain.ts`).
    // Sin él, no se fabrica ninguno.
    domain: normalizeDomain(row.website_domain),
    // El directorio sólo trae el código CIIU, no su descripción.
    declaredIndustry: null,
    industryCode: row.ciiu_code?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: EC_SCVS_MACRO_TABLE_VERSION,
    },
    // SOURCES-FREE-LAYER-OFFICIAL-SIZE-1 — los empleados de la Superintendencia de
    // Compañías van a la ficha (antes quedaban «por validar»).
    officialWorkforce: buildCountrySourceOfficialWorkforce(row.employees, row.metrics_year, 'Supercias'),
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
      if (companies.length >= limit) break;
      // SOURCES-EC-CLOSE-1 — lo que SellUp ya tiene (candidata o descarte cerrado)
      // no se vuelve a proponer; un descarte sin web sólo vuelve si ahora la tiene.
      if (isRecycledCountrySourceCompany(row.prior_sighting, normalizeDomain(row.website_domain) !== null)) continue;
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || company.taxId === null || seen.has(company.taxId)) continue;
      seen.add(company.taxId);
      companies.push(company);
    }

    return { sourceKey: EC_SCVS_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}

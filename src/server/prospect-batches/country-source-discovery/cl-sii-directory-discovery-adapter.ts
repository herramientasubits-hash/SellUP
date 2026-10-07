/**
 * cl-sii-directory-discovery-adapter.ts — descubrimiento gratuito de Chile sobre
 * las personas jurídicas del SII con 100 o más trabajadores. PROYECCIÓN DE SÓLO
 * LECTURA.
 *
 * SOURCES-CL-SII-FREE-DISCOVERY-1.
 *
 * ── Qué empresas ofrece ─────────────────────────────────────────────────────
 *
 * Las filas `cl_sii_directory` ya vienen filtradas en la carga
 * (`scripts/source-catalog/run-cl-sii-directory-etl.ts`): RUT válido, 100 o más
 * trabajadores dependientes informados y código y texto de actividad que dicen lo
 * mismo. Aquí sólo se piden las de la macro industria pedida, de más a menos
 * trabajadores (percentil en `priority_score`). Igual que Ecuador, la fuente puede
 * cerrar el objetivo entero, nunca con empresas pequeñas.
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero la decisión vigente es la de la
 * tabla (`cl-sii-macro-table.ts`): cada fila se re-clasifica desde su código de
 * actividad y sólo se ofrece si la tabla de HOY coincide. El tamaño y la
 * concordancia código/texto también se vuelven a comprobar.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`ClSiiDirectoryDiscoveryReads`). Este módulo no
 * construye ningún cliente, no lee env, no escribe y no sale a la red.
 */

import { normalizeChileRut } from '@/server/source-catalog/connectors/res-chile/cl-res-registry-row';
import { clSiiActivityTextMatchesCode } from '@/server/source-catalog/connectors/sii-chile/cl-sii-activity-catalog';
import {
  CL_SII_MACRO_TABLE_VERSION,
  macroHasClCoverage,
  resolveClActivityMacro,
} from './cl-sii-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';
import { buildCountrySourceOfficialWorkforce } from './country-source-types';

/** `source_key` que esta proyección declara. */
export const CL_SII_DIRECTORY_DISCOVERY_SOURCE_KEY = 'cl_sii_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que Colombia, Argentina y Ecuador). */
export const CL_SII_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

/** Umbral de tamaño (mismo que la carga; decisión de la dueña, 05-10-2026). */
export const CL_SII_DIRECTORY_DISCOVERY_MIN_WORKERS = 100;

/** Fila `cl_sii_directory` acotada a lo que esta proyección usa. */
export type ClSiiDirectorySnapshotReadRow = {
  record_identity_key: string;
  rut: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  activity_code: string | null;
  activity: string | null;
  workers: number | null;
  metrics_year: number | null;
  priority_score: number | null;
  /**
   * SOURCES-CL-NO-RECYCLE-1 — SellUp ya tiene este RUT como candidato (en
   * cualquier lote) o como descartado del buscador gratuito. `undefined`/`false`
   * ⇒ nueva.
   */
  already_seen?: boolean;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type ClSiiDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly ClSiiDirectorySnapshotReadRow[]>;
};

function toCompany(row: ClSiiDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  // Ya vista: el SII nunca trae web, así que volver a ofrecerla sólo la mandaría
  // otra vez a Descartadas (o la duplicaría en revisión).
  if (row.already_seen === true) return null;
  const legalName = row.legal_name?.trim() || null;
  const rut = normalizeChileRut(row.rut);
  if (legalName === null || rut === null) return null;
  if (row.workers === null || row.workers < CL_SII_DIRECTORY_DISCOVERY_MIN_WORKERS) return null;
  if (!clSiiActivityTextMatchesCode(row.activity_code, row.activity)) return null;
  // La tabla de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolveClActivityMacro(row.activity_code, rut) !== macroIndustryKey) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: rut,
    taxIdentifierType: 'RUT',
    countryCode: 'CL',
    // La nómina del SII no publica dirección.
    city: null,
    region: null,
    // 🔴 El SII no publica web. No se fabrica ninguna.
    domain: null,
    declaredIndustry: row.activity?.trim() || null,
    industryCode: row.activity_code?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: CL_SII_MACRO_TABLE_VERSION,
    },
    // SOURCES-FREE-LAYER-OFFICIAL-SIZE-1 — los trabajadores informados al SII van a
    // la ficha (antes quedaban «por validar»).
    officialWorkforce: buildCountrySourceOfficialWorkforce(row.workers, row.metrics_year, 'SII'),
  };
}

/**
 * Construye el adapter de descubrimiento de Chile.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildClSiiDirectoryDiscoveryAdapter(reads: ClSiiDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: CL_SII_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin actividades clasificadas no consulta: nunca una muestra genérica.
    if (!macroHasClCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), CL_SII_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({
      macroIndustryKey: criteria.macroIndustryKey,
      limit,
    });

    // Un RUT, una empresa: la primera fila válida gana (la lectura ya viene
    // ordenada por trabajadores).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      // La lectura trae de más (para saltar lo ya visto): se corta en el tope pedido.
      if (companies.length >= limit) break;
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || company.taxId === null || seen.has(company.taxId)) continue;
      seen.add(company.taxId);
      companies.push(company);
    }

    return { sourceKey: CL_SII_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}

/**
 * uy-arce-directory-discovery-adapter.ts — descubrimiento gratuito de Uruguay sobre
 * las organizaciones a las que el Estado les adjudicó compras (ARCE) y las
 * entidades públicas. PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-UY-CLOSE-1.
 *
 * ── Qué ofrece ──────────────────────────────────────────────────────────────
 *
 * Las filas ya vienen filtradas en la carga (`scripts/source-catalog/run-uy-sources-etl.ts`):
 *
 *   - `uy_arce_directory`: organizaciones vigentes del RUPE (sin personas,
 *     consorcios ni entes del Estado) con al menos USD 50.000 adjudicados entre
 *     2022 y 2025, alguna adjudicación desde 2024 y una macro dominante por lo que
 *     venden al Estado (catálogo SICE, `uy-arce-macro-table.ts`).
 *   - `uy_public_entities`: ministerios, entes, UdelaR, ANEP, intendencias y
 *     personas públicas no estatales (sólo Gobierno), con su web .gub.uy o propia
 *     y su RUT cuando el RUPE lo tiene.
 *
 * Aquí sólo se piden las de la macro pedida, primero las que venden a más
 * organismos (o, en Gobierno, entes y ministerios primero).
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la tabla de HOY: la clase
 * dominante se re-clasifica y sólo se ofrece si coincide.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`UyArceDirectoryDiscoveryReads`). Este módulo no
 * construye ningún cliente, no lee env, no escribe y no sale a la red.
 */

import {
  macroHasUyArceCoverage,
  resolveUyArceClassMacro,
  UY_ARCE_MACRO_TABLE_VERSION,
  UY_PUBLIC_ENTITY_MACRO_KEY,
} from './uy-arce-macro-table';
import {
  buildCountrySourceOfficialWorkforce,
  type CountrySourceAdapter,
  type CountrySourceCompany,
  type CountrySourceCriteria,
  type CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const UY_ARCE_DIRECTORY_DISCOVERY_SOURCE_KEY = 'uy_arce_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const UY_ARCE_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

const UY_RUT = /^\d{12}$/;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila `uy_arce_directory` o `uy_public_entities` acotada a lo que esta proyección usa. */
export type UyArceDirectorySnapshotReadRow = {
  record_identity_key: string;
  rut: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  directory_kind: string | null;
  sice_class: string | null;
  activity_text: string | null;
  website_domain: string | null;
  /**
   * SOURCES-UY-PUBLIC-ENTITY-SIZE-1 — funcionarios oficiales de una entidad pública
   * (ONSC) y el año del corte. Ausente en las empresas: Uruguay no publica su tamaño.
   */
  official_workers?: number | null;
  official_workers_year?: number | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type UyArceDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly UyArceDirectorySnapshotReadRow[]>;
};

function toCompany(row: UyArceDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  if (legalName === null) return null;
  const rut = UY_RUT.test(row.rut?.trim() ?? '') ? row.rut!.trim() : null;
  const domain = normalizeDomain(row.website_domain);
  const publicEntity = row.directory_kind === 'public_entity';
  if (publicEntity) {
    if (macroIndustryKey !== UY_PUBLIC_ENTITY_MACRO_KEY) return null;
    // Sin RUT en el RUPE, la entidad sólo se identifica por su web.
    if (rut === null && domain === null) return null;
  } else {
    if (rut === null) return null;
    // La tabla de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
    if (resolveUyArceClassMacro(row.sice_class) !== macroIndustryKey) return null;
  }

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: rut,
    taxIdentifierType: rut !== null ? 'RUT' : null,
    countryCode: 'UY',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // La web comprobada por su nombre, la del directorio del MIEM o la .gub.uy de la
    // UAIP. Sin web la empresa va a Descartadas y el rescate con Claude la busca.
    domain,
    // El rubro del catálogo SICE en palabras (la clase), no el artículo suelto.
    declaredIndustry: publicEntity ? 'Entidad pública' : row.activity_text?.trim() || null,
    industryCode: publicEntity ? null : row.sice_class?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: UY_ARCE_MACRO_TABLE_VERSION,
    },
    // SOURCES-UY-PUBLIC-ENTITY-SIZE-1 — los funcionarios de la ONSC llegan a la ficha
    // como tamaño oficial (igual que la dotación del INDEC en Argentina).
    officialWorkforce: publicEntity
      ? buildCountrySourceOfficialWorkforce(row.official_workers ?? null, row.official_workers_year ?? null, 'ONSC')
      : null,
  };
}

/**
 * Construye el adapter de descubrimiento de Uruguay.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildUyArceDirectoryDiscoveryAdapter(reads: UyArceDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: UY_ARCE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin clases clasificadas no consulta: nunca una muestra genérica.
    if (!macroHasUyArceCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), UY_ARCE_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit });

    // Un RUT (o una web, para las entidades sin RUT), una empresa: la primera fila
    // válida gana (la lectura ya viene ordenada).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null) continue;
      const key = company.taxId ?? `domain:${company.domain}`;
      if (seen.has(key)) continue;
      seen.add(key);
      companies.push(company);
    }

    return { sourceKey: UY_ARCE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}

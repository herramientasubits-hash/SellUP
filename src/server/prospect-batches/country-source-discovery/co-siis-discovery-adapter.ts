/**
 * co-siis-discovery-adapter.ts — PROYECCIÓN DE SÓLO LECTURA de las fuentes
 * oficiales de Colombia para descubrimiento, consciente de criterios.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 4, 6, 7, 27 · SOURCES-CO-CLOSE-1.
 *
 * ── 🔴 Qué es co_siis EN PRODUCCIÓN, medido y no supuesto ────────────────────
 *
 * La porción `co_siis` son **10.000 filas exactas, `source_year` 2024**: las
 * sociedades vigiladas que reportan estados financieros (SUPERSOCIEDADES 8.520,
 * SUPERTRANSPORTE 548, SUPERSALUD 467, SUPERSERVICIOS 210, SUPERVIGILANCIA 205,
 * SUPERFINANCIERA 50). Es la franja alta del tejido empresarial colombiano (la
 * más pequeña factura unos 19.600 millones de pesos), no su totalidad.
 *
 * ── SOURCES-CO-CLOSE-1 — lo que cambió (06-10-2026) ──────────────────────────
 *
 *   - La industria sale de la tabla aprobada (`co-siis-macro-table.ts`), no del
 *     índice por palabras, que dejaba Tecnología, Retail y Consumo masivo en cero.
 *   - Se ofrece primero la que más factura (la lectura viene ordenada por
 *     ingresos) y nunca lo que SellUp ya vio: una candidata o un descarte
 *     definitivo no vuelven; un descarte sólo por falta de web vuelve si ahora
 *     tiene web (patrón de Argentina, #611).
 *   - La web sale de la carga de dominios (`raw_data.website_domain`: SECOP II y
 *     correo corporativo de Supersociedades, sólo si lleva el nombre). Sin ella la
 *     empresa iba siempre a «Descartadas» por «sin web».
 *   - Gobierno sale del directorio de entidades públicas (`co_public_entities`:
 *     CHIP de la Contaduría + servidores del SIGEP II), sólo entidades con 200
 *     servidores o más. El SIIS no tiene administración pública.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`CoSiisSnapshotQuery`). Este módulo no construye ningún
 * cliente, no lee env y no escribe jamás.
 */

import { CO_SIIS_MACRO_TABLE_VERSION, listCoCiiuCodesForMacro, resolveCoCiiuMacro } from './co-siis-macro-table';
import { getCiiuSectorDescriptionExact } from '@/server/source-catalog/connectors/socrata-colombia/normalizers';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. NO es el de enriquecimiento. */
export const CO_SIIS_DISCOVERY_SOURCE_KEY = 'co_siis_discovery' as const;

/** `source_primary` canónico con el que se persisten sus candidatos. */
export const CO_SIIS_DISCOVERY_SOURCE_PRIMARY = 'public_source' as const;

/**
 * `prospect_batches.source` canónico para los lotes de esta proyección.
 * AGENT1-COUNTRY-SOURCE-PERSISTENCE-CONTRACT-1 § 2.
 */
export const CO_SIIS_DISCOVERY_BATCH_SOURCE = 'agent_1' as const;

/** Techo duro de empresas devueltas por consulta. Acota la lectura, no el objetivo. */
export const CO_SIIS_DISCOVERY_MAX_ROWS = 200;

/** Macros que se buscan en el directorio de entidades públicas y no en el SIIS. */
export const CO_PUBLIC_ENTITY_DISCOVERY_MACROS: ReadonlySet<string> = new Set(['government']);

/** Servidores públicos mínimos para ofrecer una entidad (umbral ICP, dueña 06-10-2026). */
export const CO_PUBLIC_ENTITY_DISCOVERY_MIN_WORKERS = 200;

/** Versión de la clasificación de entidades públicas (ver la carga). */
export const CO_PUBLIC_ENTITY_MACRO_TABLE_VERSION = 'co-sigep-public-entity-macro-v1' as const;

/** Lo que SellUp ya hizo con esta empresa (por NIT). */
export type CoPriorSighting = 'candidate' | 'definitive_discard' | 'discard';

/** Fila cruda ya acotada a las columnas que esta proyección usa. */
export type CoSiisSnapshotRow = {
  record_identity_key: string;
  legal_name: string | null;
  normalized_legal_name: string | null;
  tax_id: string | null;
  sector: string | null;
  city: string | null;
  department: string | null;
  ciiu: string | null;
  /** Web cargada (`raw_data.website_domain`), o ausente. */
  website_domain?: string | null;
  /** Lo que SellUp ya tiene de este NIT, o ausente. */
  prior_sighting?: CoPriorSighting | null;
  /** Sólo entidades públicas: de qué tabla viene la fila. */
  origin?: 'siis' | 'public_entity';
  /** Sólo entidades públicas: macro asignada al cargar y servidores del SIGEP. */
  macro_industry_key?: string | null;
  workers?: number | null;
};

/**
 * Lectura inyectada. Recibe los códigos CIIU YA resueltos (vacíos para las macros
 * de entidades públicas): el seam no puede ensanchar la elegibilidad por su cuenta.
 */
export type CoSiisSnapshotQuery = (input: {
  macroIndustryKey: string;
  ciiuCodes: readonly string[];
  limit: number;
}) => Promise<readonly CoSiisSnapshotRow[]>;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** NIT de persona jurídica: 9 dígitos que empiezan por 8 o 9. */
const LEGAL_ENTITY_NIT = /^[89]\d{8}$/;

/**
 * ¿SellUp ya vio esta empresa? Una candidata o un descarte definitivo no vuelven;
 * un descarte sólo por falta de web vuelve si ahora la fila trae web.
 */
export function isRecycledCoCompany(row: Pick<CoSiisSnapshotRow, 'prior_sighting' | 'website_domain'>): boolean {
  switch (row.prior_sighting) {
    case 'candidate':
    case 'definitive_discard':
      return true;
    case 'discard':
      return normalizeDomain(row.website_domain) === null;
    default:
      return false;
  }
}

function toSiisCompany(row: CoSiisSnapshotRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const taxId = row.tax_id?.trim() ?? '';
  if (legalName === null || !LEGAL_ENTITY_NIT.test(taxId)) return null;
  // La tabla de HOY manda: la lista de códigos sólo sirvió para filtrar.
  if (resolveCoCiiuMacro(row.ciiu) !== macroIndustryKey) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId,
    taxIdentifierType: 'NIT',
    countryCode: 'CO',
    city: row.city?.trim() || null,
    region: row.department?.trim() || null,
    domain: normalizeDomain(row.website_domain),
    declaredIndustry: getCiiuSectorDescriptionExact(row.ciiu),
    industryCode: row.ciiu?.trim() || null,
    coarseSector: row.sector?.trim() || null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: CO_SIIS_MACRO_TABLE_VERSION,
    },
  };
}

function toPublicEntityCompany(row: CoSiisSnapshotRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const taxId = row.tax_id?.trim() ?? '';
  if (legalName === null || !LEGAL_ENTITY_NIT.test(taxId)) return null;
  if (row.macro_industry_key !== macroIndustryKey) return null;
  if (typeof row.workers !== 'number' || row.workers < CO_PUBLIC_ENTITY_DISCOVERY_MIN_WORKERS) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId,
    taxIdentifierType: 'NIT',
    countryCode: 'CO',
    city: row.city?.trim() || null,
    region: row.department?.trim() || null,
    domain: normalizeDomain(row.website_domain),
    declaredIndustry: row.sector?.trim() || null,
    industryCode: null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: CO_PUBLIC_ENTITY_MACRO_TABLE_VERSION,
    },
    // 🔴 Los servidores NO viajan al candidato (igual que Chile): aquí sólo
    // garantizan que no se ofrece ninguna entidad de menos de 200. El tamaño lo
    // pone después el resolvedor oficial por NIT, que sí lo propaga.
  };
}

/**
 * Construye el adapter de descubrimiento de Colombia.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador, que es
 * quien conoce la política de fail-open hacia el proveedor de pago.
 */
export function buildCoSiisDiscoveryAdapter(query: CoSiisSnapshotQuery): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: CO_SIIS_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };
    const macroIndustryKey = criteria.macroIndustryKey ?? '';
    const isPublicEntityMacro = CO_PUBLIC_ENTITY_DISCOVERY_MACROS.has(macroIndustryKey);
    const ciiuCodes = isPublicEntityMacro ? [] : listCoCiiuCodesForMacro(macroIndustryKey);

    // Fail-closed: sin códigos (ni directorio público) no hay pregunta que hacer.
    // Consultar sin filtro devolvería la población entera y § 4 lo prohíbe.
    if (!isPublicEntityMacro && ciiuCodes.length === 0) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), CO_SIIS_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await query({ macroIndustryKey, ciiuCodes, limit });

    // Un NIT, una empresa: la primera fila válida gana (la lectura ya viene
    // ordenada por ingresos o por servidores).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      // La lectura trae de más (para saltar lo ya visto): se corta en el tope pedido.
      if (companies.length >= limit) break;
      if (isRecycledCoCompany(row)) continue;
      const company = isPublicEntityMacro
        ? toPublicEntityCompany(row, macroIndustryKey)
        : toSiisCompany(row, macroIndustryKey);
      if (company === null || company.taxId === null || seen.has(company.taxId)) continue;
      seen.add(company.taxId);
      companies.push(company);
    }

    return { sourceKey: CO_SIIS_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}

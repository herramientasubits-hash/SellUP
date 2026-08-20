/**
 * co-siis-discovery-adapter.ts — PROYECCIÓN DE SÓLO LECTURA del snapshot co_siis
 * para descubrimiento, consciente de criterios.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 4, 6, 7, 27.
 *
 * ── 🔴 Qué es co_siis EN PRODUCCIÓN, medido y no supuesto ────────────────────
 *
 * El enunciado del hito describía «≈902.212 filas». Ese número es el TOTAL de
 * `source_company_snapshots` sumando todos los países (RD 493k, Ecuador 340k…).
 * La porción `co_siis` son **10.000 filas exactas, `source_year` 2024**, y no es
 * un registro mercantil: son las sociedades vigiladas que reportan estados
 * financieros (SUPERSOCIEDADES 8.520, SUPERTRANSPORTE 548, SUPERSALUD 467,
 * SUPERSERVICIOS 210, SUPERVIGILANCIA 205, SUPERFINANCIERA 50). Es decir, la
 * franja alta del tejido empresarial colombiano, no su totalidad.
 *
 * Eso importa para leer bien lo que esta fuente puede y no puede hacer: la
 * cobertura es PARCIAL por construcción, así que la fuente casi nunca cerrará
 * sola un objetivo grande y el respaldo de pago sigue siendo necesario.
 *
 * ── 🔴 Por qué una proyección aparte y no «ampliar co_siis» (§ 6) ────────────
 *
 * `co_siis` sirve hoy a la identidad legal / enriquecimiento oficial
 * (`colombia-official-source-resolver` vía `querySnapshotByName`). Convertir esa
 * ruta en descubrimiento le cambiaría el significado a un dato del que ya
 * dependen la deduplicación fiscal y el enriquecimiento post-aprobación. Este
 * módulo NO toca aquella ruta: lee la MISMA tabla con una consulta propia,
 * distinta y estrictamente de sólo lectura, y declara su propio `sourceKey`.
 *
 * ── Criterios de verdad, no muestra genérica (§ 4) ──────────────────────────
 *
 * El filtro por CIIU sale del índice DERIVADO del catálogo canónico
 * (`resolveMacroCiiuCodes`). Una macro sin códigos NO consulta: devuelve cero. Sin
 * ese fail-closed la consulta traería la población entera y una constructora
 * genérica reduciría el objetivo de una búsqueda de salud.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`CoSiisSnapshotQuery`). Este módulo no construye ningún
 * cliente, no lee env y no escribe jamás. § 27 prohíbe además llamadas externas
 * en vivo: la tabla es local a Supabase, así que no sale una sola petición HTTP a
 * datos.gov.co ni a ningún proveedor.
 */

import { resolveMacroCiiuCodes } from './macro-ciiu-index';
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

/** Techo duro de filas leídas por consulta. Acota la lectura, no el objetivo. */
export const CO_SIIS_DISCOVERY_MAX_ROWS = 200;

/** Fila cruda del snapshot, ya acotada a las columnas que esta proyección usa. */
export type CoSiisSnapshotRow = {
  record_identity_key: string;
  legal_name: string | null;
  normalized_legal_name: string | null;
  tax_id: string | null;
  sector: string | null;
  city: string | null;
  department: string | null;
  ciiu: string | null;
};

/**
 * Lectura inyectada. Recibe los códigos CIIU YA resueltos: el seam no conoce el
 * catálogo macro y no puede, por tanto, ensanchar la elegibilidad por su cuenta.
 */
export type CoSiisSnapshotQuery = (input: {
  ciiuCodes: readonly string[];
  limit: number;
}) => Promise<readonly CoSiisSnapshotRow[]>;

function toCompany(row: CoSiisSnapshotRow): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  if (legalName === null) return null;

  // Coincidencia EXACTA (con relleno de cero a la izquierda: el snapshot pierde
  // el cero inicial en 575 de 10.000 filas). Un código desconocido deja la
  // industria declarada en `null`, y sin industria declarada nada se confirma.
  const declaredIndustry = getCiiuSectorDescriptionExact(row.ciiu);

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: row.tax_id?.trim() || null,
    taxIdentifierType: row.tax_id?.trim() ? 'NIT' : null,
    countryCode: 'CO',
    city: row.city?.trim() || null,
    region: row.department?.trim() || null,
    // 🔴 co_siis no publica web. No se fabrica ninguna (§ 22(I)).
    domain: null,
    declaredIndustry,
    industryCode: row.ciiu?.trim() || null,
    coarseSector: row.sector?.trim() || null,
  };
}

/**
 * Construye el adapter de descubrimiento de Colombia sobre el snapshot co_siis.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador, que es
 * quien conoce la política de fail-open hacia el proveedor de pago.
 */
export function buildCoSiisDiscoveryAdapter(query: CoSiisSnapshotQuery): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const ciiuCodes = resolveMacroCiiuCodes(criteria.macroIndustryKey);

    // Fail-closed: sin códigos no hay pregunta que hacer. Consultar sin filtro
    // devolvería la población entera y § 4 lo prohíbe expresamente.
    if (ciiuCodes.length === 0) {
      return { sourceKey: CO_SIIS_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };
    }

    const limit = Math.max(
      0,
      Math.min(Math.trunc(criteria.limit), CO_SIIS_DISCOVERY_MAX_ROWS),
    );
    if (limit === 0) {
      return { sourceKey: CO_SIIS_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };
    }

    const rows = await query({ ciiuCodes, limit });

    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = toCompany(row);
      if (company !== null) companies.push(company);
    }

    return {
      sourceKey: CO_SIIS_DISCOVERY_SOURCE_KEY,
      companies,
      recordsRead: rows.length,
    };
  };
}

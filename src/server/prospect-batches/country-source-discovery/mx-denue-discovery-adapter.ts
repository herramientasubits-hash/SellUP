/**
 * mx-denue-discovery-adapter.ts — descubrimiento gratuito de México sobre el
 * DENUE (INEGI), consciente de criterios. Adapter PURO: la consulta en vivo se
 * inyecta (`MxDenueDiscoveryReads`).
 *
 * SOURCES-MX-DENUE-FREE-DISCOVERY-1.
 *
 * Qué empresas ofrece (decisión de la dueña, 30-09-2026):
 *   1. establecimientos cuya actividad SCIAN pertenece a la macro pedida según la
 *      tabla aprobada (`mx-denue-macro-table.ts`),
 *   2. con 51 o más personas ocupadas (estratos 7, 6, 5), de mayor a menor,
 *   3. UNA vez por empresa: DENUE lista establecimientos, así que las sucursales
 *      se agrupan por el núcleo de su razón social.
 *
 * DENUE no publica RFC: las empresas llegan sin identificador fiscal. Sí publica
 * sitio web, que se usa como dominio para detectar duplicados contra SellUp y
 * HubSpot.
 *
 * Por lo demás se comporta igual que Colombia: puede cerrar el objetivo entero.
 */

import {
  macroHasMxCoverage,
  MX_DENUE_ESTRATOS,
  MX_DENUE_MACRO_TABLE_VERSION,
  MX_DENUE_QUERY_PLAN,
  resolveScianMacro,
  type DenueActivityFilter,
} from './mx-denue-macro-table';
import { MEXICO_LEGAL_FORMS, normalizeCompanyNameCore } from '@/server/source-catalog/company-name-core';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const MX_DENUE_DISCOVERY_SOURCE_KEY = 'mx_denue_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que Colombia). */
export const MX_DENUE_DISCOVERY_MAX_ROWS = 200;

/** Establecimientos pedidos por cada combinación filtro × estrato. */
export const MX_DENUE_PAGE_SIZE = 100;

/** Un establecimiento DENUE, acotado a lo que esta proyección usa. */
export type DenueEstablishment = {
  id: string;
  name: string | null;
  legalName: string | null;
  activityCode: string | null;
  activityName: string | null;
  estrato: string | null;
  website: string | null;
  location: string | null;
};

/** Consulta inyectada (en vivo, sólo lectura). Fail-soft: vacío si falla. */
export type MxDenueDiscoveryReads = {
  readEstablishments: (input: {
    filter: DenueActivityFilter;
    estrato: string;
    limit: number;
  }) => Promise<readonly DenueEstablishment[]>;
};

/** Sitio web DENUE («WWW.EMPRESA.COM.MX», «empresa.mx/…») → dominio, o `null`. */
export function denueWebsiteToDomain(website: string | null | undefined): string | null {
  if (typeof website !== 'string') return null;
  const host = website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** «…, Guadalajara, JALISCO» → { city, region }. */
function splitLocation(location: string | null): { city: string | null; region: string | null } {
  if (!location) return { city: null, region: null };
  const parts = location.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return { city: null, region: null };
  return {
    region: parts[parts.length - 1] ?? null,
    city: parts.length >= 2 ? parts[parts.length - 2] : null,
  };
}

function toCompany(row: DenueEstablishment, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legalName?.trim() || row.name?.trim() || null;
  if (legalName === null) return null;
  const { city, region } = splitLocation(row.location);
  return {
    recordIdentityKey: `denue:${row.id}`,
    legalName,
    normalizedLegalName: normalizeCompanyNameCore(legalName, MEXICO_LEGAL_FORMS) || null,
    taxId: null,
    taxIdentifierType: null,
    countryCode: 'MX',
    city,
    region,
    domain: denueWebsiteToDomain(row.website),
    declaredIndustry: row.activityName?.trim() || null,
    industryCode: row.activityCode?.trim() || null,
    coarseSector: row.estrato?.trim() || null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: MX_DENUE_MACRO_TABLE_VERSION,
    },
  };
}

/** Construye el adapter de descubrimiento de México. Nunca lanza. */
export function buildMxDenueDiscoveryAdapter(reads: MxDenueDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: MX_DENUE_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };
    if (!macroHasMxCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), MX_DENUE_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const filters = MX_DENUE_QUERY_PLAN[criteria.macroIndustryKey] ?? [];
    let recordsRead = 0;
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];

    // Estrato a estrato, de mayor a menor: se piden en paralelo los filtros de un
    // estrato y sólo se baja al siguiente si todavía falta cubrir el límite.
    for (const estrato of MX_DENUE_ESTRATOS) {
      if (companies.length >= limit) break;
      const pages = await Promise.all(
        filters.map((filter) => reads.readEstablishments({ filter, estrato, limit: MX_DENUE_PAGE_SIZE })),
      );
      for (const page of pages) {
        recordsRead += page.length;
        for (const row of page) {
          if (companies.length >= limit) break;
          // La tabla de HOY manda: un filtro amplio nunca cuela otra macro.
          if (resolveScianMacro(row.activityCode) !== criteria.macroIndustryKey) continue;
          const company = toCompany(row, criteria.macroIndustryKey);
          if (company === null) continue;
          const identity = company.normalizedLegalName ?? company.legalName ?? row.id;
          if (seen.has(identity)) continue;
          seen.add(identity);
          companies.push(company);
        }
      }
    }

    return { sourceKey: MX_DENUE_DISCOVERY_SOURCE_KEY, companies, recordsRead };
  };
}

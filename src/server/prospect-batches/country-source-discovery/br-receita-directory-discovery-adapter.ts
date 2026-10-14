/**
 * br-receita-directory-discovery-adapter.ts — descubrimiento gratuito de Brasil
 * sobre el subconjunto liviano del cadastro CNPJ de la Receita. PROYECCIÓN DE
 * SÓLO LECTURA.
 *
 * SOURCES-BR-LIGHT-1.
 *
 * ── Qué empresas ofrece ─────────────────────────────────────────────────────
 *
 * Las filas `br_receita_directory` ya vienen filtradas en la carga
 * (`scripts/source-catalog/run-br-receita-light-etl.ts`): matrices ACTIVAS de
 * sociedades privadas DEMAIS con capital ≥ R$ 1 M o 3+ sucursales activas (el
 * corte que da más empresas gratis, aprobado el 13-10-2026), sin holdings, fondos
 * ni SPE inmobiliarias, con macro por su CNAE principal; más las cabezas de entes
 * públicos con web `.gov.br` que lleva su nombre o sigla. Aquí se piden las de la
 * macro pedida, de más a menos capital y sucursales.
 *
 * DEMAIS no prueba 200+ empleados: la empresa llega sin número de personas y el
 * filtro de tamaño la trata como hoy.
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó al cargar, pero manda la tabla de HOY
 * (`br-receita-macro-table.ts`) para las privadas.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA. Este módulo no construye clientes, no lee env, no
 * escribe y no sale a la red.
 */

import { normalizeBrazilCnpj } from '@/server/source-catalog/connectors/br-receita-cnpj/br-cnpj';
import {
  brCnaeAllowedInDiscovery,
  BR_RECEITA_MACRO_TABLE_VERSION,
  macroHasBrReceitaCoverage,
  resolveBrCnaeMacro,
} from './br-receita-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const BR_RECEITA_DIRECTORY_DISCOVERY_SOURCE_KEY = 'br_receita_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const BR_RECEITA_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila `br_receita_directory` acotada a lo que esta proyección usa. */
export type BrReceitaDirectorySnapshotReadRow = {
  record_identity_key: string;
  cnpj: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  cnae: string | null;
  activity_text: string | null;
  website_domain: string | null;
  public_entity: boolean;
  porte: string | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type BrReceitaDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly BrReceitaDirectorySnapshotReadRow[]>;
};

function toCompany(row: BrReceitaDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const cnpj = normalizeBrazilCnpj(row.cnpj ?? '');
  if (legalName === null || cnpj.status !== 'valid' || cnpj.normalized === null) return null;
  if (!row.public_entity) {
    // ME y EPP nunca deberían estar aquí; si llegaran, no se ofrecen.
    if (row.porte !== '05') return null;
    if (!brCnaeAllowedInDiscovery(row.cnae)) return null;
    // La tabla de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
    if (resolveBrCnaeMacro(row.cnae) !== macroIndustryKey) return null;
  }

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: cnpj.normalized,
    taxIdentifierType: 'CNPJ',
    countryCode: 'BR',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // La web que encaja con el nombre (CVM o correo del cadastro). Sin web la
    // empresa va a Descartadas y el rescate con Claude la busca.
    domain: normalizeDomain(row.website_domain),
    declaredIndustry: row.activity_text?.trim() || null,
    industryCode: row.cnae?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: BR_RECEITA_MACRO_TABLE_VERSION,
    },
  };
}

/** Construye el adapter de descubrimiento de Brasil. Devuelve SIEMPRE un resultado. */
export function buildBrReceitaDirectoryDiscoveryAdapter(reads: BrReceitaDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: BR_RECEITA_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin actividades clasificadas no consulta: nunca una muestra genérica.
    if (!macroHasBrReceitaCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), BR_RECEITA_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit });

    // Un CNPJ, una empresa; y una empresa por web (la carga ya deja sólo la cabeza
    // del grupo; esto la protege si quedara una fila vieja). La lectura ya viene ordenada.
    const seen = new Set<string>();
    const seenDomains = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || company.taxId === null || seen.has(company.taxId)) continue;
      if (company.domain !== null && seenDomains.has(company.domain)) continue;
      seen.add(company.taxId);
      if (company.domain !== null) seenDomains.add(company.domain);
      companies.push(company);
    }

    return { sourceKey: BR_RECEITA_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}

/**
 * bo-official-discovery-adapter.ts — descubrimiento gratuito de Bolivia.
 * PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-BO-CLOSE-1. Bolivia no publica un padrón con actividad y tamaño. Esta
 * fuente junta dos tablas oficiales ya cargadas:
 *
 *   - `bo_large_taxpayers`: las sociedades que Impuestos Nacionales categoriza como
 *     PRICO o GRACO (y los operadores PRIO/OEA de la Aduana), con nombre, NIT y
 *     objeto social del SEPREC. Sólo las de matrícula RENOVADA. La macro sale de la
 *     tabla de palabras (`bo-activity-macro-table.ts`).
 *   - `bo_public_entities`: las entidades del portal gob.bo que el buscador ofrece
 *     (gobernaciones, ministerios, organismos nacionales, alcaldías de las capitales
 *     y El Alto, empresas públicas nacionales, cajas de salud). Traen la web
 *     oficial; no traen NIT.
 *
 * Ser gran contribuyente es la señal de relevancia: entre ~400.000 unidades del
 * SEPREC, sólo unas 5.000 sociedades lo son. No es un tamaño en personas: el filtro
 * ICP decide después, como para cualquier otra empresa.
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la tabla de HOY: cada
 * empresa se re-clasifica desde su razón social y su objeto social y sólo se ofrece
 * si coincide. Las entidades públicas usan la macro con la que se cargaron (su tipo
 * no cambia con la tabla).
 *
 * ── Lo que SellUp ya tiene ──────────────────────────────────────────────────
 *
 * Igual que Ecuador: una empresa que ya es candidata o cuyo descarte se cerró no se
 * vuelve a proponer; un descarte sin web sólo vuelve si ahora la trae.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`BoOfficialDiscoveryReads`). Este módulo no construye
 * ningún cliente, no lee env, no escribe y no sale a la red.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import {
  BO_ACTIVITY_MACRO_TABLE_VERSION,
  classifyBoliviaActivity,
  macroHasBoCoverage,
} from './bo-activity-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';
import { isRecycledCountrySourceCompany, type CountrySourcePriorSighting } from './country-source-prior-sightings';

/** `source_key` que esta proyección declara. */
export const BO_OFFICIAL_DISCOVERY_SOURCE_KEY = 'bo_official_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const BO_OFFICIAL_DISCOVERY_MAX_ROWS = 200;

/** Versión de la clasificación de las entidades públicas (por tipo de entidad). */
export const BO_PUBLIC_ENTITY_MACRO_VERSION = 'bo-gobbo-entity-kind-v1' as const;

/** NIT de persona jurídica: el penúltimo dígito es 2. */
const COMPANY_NIT = /^\d{5,11}2\d$/;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase().replace(/^www\d?\./, '') ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila de `bo_large_taxpayers` acotada a lo que esta proyección usa. */
export type BoLargeTaxpayerReadRow = {
  record_identity_key: string;
  nit: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  department: string | null;
  social_purpose: string | null;
  matricula_renewed: boolean;
  taxpayer_category: string | null;
  priority_score: number | null;
  prior_sighting?: CountrySourcePriorSighting | null;
};

/** Fila de `bo_public_entities` acotada a lo que esta proyección usa. */
export type BoPublicEntityReadRow = {
  record_identity_key: string;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  department: string | null;
  entity_kind: string | null;
  website_domain: string | null;
  macro_industry_key: string | null;
};

/** Lecturas inyectadas: sólo lectura, fail-soft (vacío si fallan). */
export type BoOfficialDiscoveryReads = {
  readLargeTaxpayersByMacro: (input: { macroIndustryKey: string; limit: number }) => Promise<readonly BoLargeTaxpayerReadRow[]>;
  readPublicEntitiesByMacro: (input: { macroIndustryKey: string; limit: number }) => Promise<readonly BoPublicEntityReadRow[]>;
};

function taxpayerToCompany(row: BoLargeTaxpayerReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const nit = row.nit?.trim() ?? '';
  if (legalName === null || !COMPANY_NIT.test(nit) || !row.matricula_renewed) return null;
  // La tabla de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  const activity = classifyBoliviaActivity(legalName, row.social_purpose);
  if (activity.macroIndustryKey !== macroIndustryKey) return null;
  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: nit,
    taxIdentifierType: 'NIT',
    countryCode: 'BO',
    city: null,
    region: row.department?.trim() || null,
    // 🔴 Ni Impuestos ni el SEPREC publican la web: llega por el rescate.
    domain: null,
    declaredIndustry: activity.rule,
    industryCode: activity.ciiu,
    coarseSector: row.taxpayer_category,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey as MacroIndustryKey],
      tableVersion: BO_ACTIVITY_MACRO_TABLE_VERSION,
    },
  };
}

function entityToCompany(row: BoPublicEntityReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  if (legalName === null || row.macro_industry_key !== macroIndustryKey) return null;
  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    // 🔴 Ninguna fuente oficial gratuita publica el NIT de las entidades públicas.
    taxId: null,
    taxIdentifierType: null,
    countryCode: 'BO',
    city: row.city?.trim() || null,
    region: row.department?.trim() || null,
    domain: normalizeDomain(row.website_domain),
    declaredIndustry: null,
    industryCode: null,
    coarseSector: row.entity_kind,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey as MacroIndustryKey],
      tableVersion: BO_PUBLIC_ENTITY_MACRO_VERSION,
    },
  };
}

/** ¿Hay algo boliviano que ofrecer para esta macro? */
export function macroHasBoDiscoveryCoverage(macroIndustryKey: string | null | undefined): boolean {
  return macroIndustryKey === 'government' || macroHasBoCoverage(macroIndustryKey);
}

/**
 * Construye el adapter de descubrimiento de Bolivia.
 *
 * Orden: primero las entidades públicas de la macro con web (las únicas en Gobierno;
 * en otras macros, empresas públicas nacionales y cajas de salud), luego los grandes
 * contribuyentes (PRICO antes que GRACO), luego las entidades sin web.
 */
export function buildBoOfficialDiscoveryAdapter(reads: BoOfficialDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: BO_OFFICIAL_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };
    if (!macroHasBoDiscoveryCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), BO_OFFICIAL_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const [entities, taxpayers] = await Promise.all([
      reads.readPublicEntitiesByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit }),
      macroHasBoCoverage(criteria.macroIndustryKey)
        ? reads.readLargeTaxpayersByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit })
        : Promise.resolve([] as readonly BoLargeTaxpayerReadRow[]),
    ]);

    // Una empresa pública que también es gran contribuyente (mismo núcleo de nombre)
    // sale UNA vez: con el NIT de la lista y la web de gob.bo.
    const entityWebByCore = new Map<string, string>();
    for (const row of entities) {
      const core = row.normalized_legal_name?.trim();
      const domain = normalizeDomain(row.website_domain);
      if (core && domain) entityWebByCore.set(core, domain);
    }
    const taxpayerCores = new Set(
      taxpayers.map((row) => row.normalized_legal_name?.trim()).filter((core): core is string => Boolean(core)),
    );
    const notAlsoTaxpayer = (row: BoPublicEntityReadRow) => !taxpayerCores.has(row.normalized_legal_name?.trim() ?? '');
    const withWeb = entities.filter((row) => normalizeDomain(row.website_domain) !== null && notAlsoTaxpayer(row));
    const withoutWeb = entities.filter((row) => normalizeDomain(row.website_domain) === null && notAlsoTaxpayer(row));

    const seenKeys = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    const push = (company: CountrySourceCompany | null) => {
      if (company === null || companies.length >= limit) return;
      const key = company.taxId ? `tax:${company.taxId}` : company.recordIdentityKey;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      companies.push(company);
    };

    for (const row of withWeb) push(entityToCompany(row, criteria.macroIndustryKey));
    for (const row of taxpayers) {
      // Lo que SellUp ya tiene (candidata o descarte cerrado) no se vuelve a proponer.
      if (isRecycledCountrySourceCompany(row.prior_sighting, false)) continue;
      const company = taxpayerToCompany(row, criteria.macroIndustryKey);
      const web = company?.normalizedLegalName ? entityWebByCore.get(company.normalizedLegalName) : undefined;
      push(company !== null && web !== undefined ? { ...company, domain: web } : company);
    }
    for (const row of withoutWeb) push(entityToCompany(row, criteria.macroIndustryKey));

    return {
      sourceKey: BO_OFFICIAL_DISCOVERY_SOURCE_KEY,
      companies,
      recordsRead: entities.length + taxpayers.length,
    };
  };
}

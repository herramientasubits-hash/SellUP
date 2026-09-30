/**
 * do-dgii-discovery-adapter.ts — descubrimiento gratuito de República Dominicana
 * sobre el padrón DGII, consciente de criterios. PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-DO-FREE-DISCOVERY-1.
 *
 * ── Qué empresas ofrece, y por qué sólo esas ────────────────────────────────
 *
 * El padrón DGII (`rd_dgii_bulk`) es el universo entero de personas jurídicas
 * —493.548 RNC, 233.540 activas— y no publica tamaño. Ofrecerlo tal cual
 * cerraría el objetivo con microempresas sin que Apollo llegara a ejecutarse.
 * Por decisión de la dueña (29-09-2026) sólo se ofrecen empresas:
 *
 *   1. ACTIVAS en DGII,
 *   2. cuya actividad oficial pertenece a la macro pedida según la tabla
 *      aprobada (`do-dgii-macro-table.ts`),
 *   3. que además son PROVEEDORAS DEL ESTADO (aparecen en `do_dgcp`, señal de
 *      empresa operativa),
 *
 * ordenadas por importe total adjudicado, de mayor a menor. Por lo demás se
 * comporta igual que Colombia: puede cerrar el objetivo entero.
 *
 * ── Criterios de verdad, no muestra genérica ────────────────────────────────
 *
 * Una macro sin actividades clasificadas NO consulta: devuelve cero. La lectura
 * se acota a `DO_DGII_DISCOVERY_READ_CAP` filas del padrón (orden estable por
 * RNC), así que en las macros más grandes se ofrece la franja de RNC más
 * antiguos, no todo el universo.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * Las dos lecturas se INYECTAN (`DoDgiiDiscoveryReads`). Este módulo no
 * construye ningún cliente, no lee env, no escribe y no sale a la red.
 */

import {
  classifyDgiiActivityText,
  resolveDgiiActivityTextsForMacro,
  DO_DGII_MACRO_TABLE_VERSION,
} from './do-dgii-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const DO_DGII_DISCOVERY_SOURCE_KEY = 'do_dgii_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que Colombia). */
export const DO_DGII_DISCOVERY_MAX_ROWS = 200;

/** Techo de filas del padrón leídas antes de cruzar con compras públicas. */
export const DO_DGII_DISCOVERY_READ_CAP = 2000;

const BUSINESS_RNC = /^\d{9}$/;

/** Fila del padrón DGII ya acotada a lo que esta proyección usa. */
export type DoDgiiActiveRow = {
  record_identity_key: string;
  rnc: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  sector: string | null;
};

/** Lecturas inyectadas. Ambas de sólo lectura y fail-soft (vacío si fallan). */
export type DoDgiiDiscoveryReads = {
  /** Contribuyentes ACTIVOS cuya actividad es uno de estos textos DGII. */
  readActiveCompaniesByActivity: (input: {
    activityTexts: readonly string[];
    limit: number;
  }) => Promise<readonly DoDgiiActiveRow[]>;
  /** Importe total adjudicado (DOP) por RNC en compras públicas (`do_dgcp`). */
  readProcurementTotals: (rncs: readonly string[]) => Promise<ReadonlyMap<string, number>>;
};

function toCompany(row: DoDgiiActiveRow, rnc: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  if (legalName === null) return null;
  const classification = classifyDgiiActivityText(row.sector);
  if (classification === null) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: rnc,
    taxIdentifierType: 'RNC',
    countryCode: 'DO',
    city: null,
    region: null,
    // 🔴 DGII no publica web. No se fabrica ninguna.
    domain: null,
    declaredIndustry: classification.description,
    industryCode: classification.code,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [classification.macroIndustryKey],
      tableVersion: DO_DGII_MACRO_TABLE_VERSION,
    },
  };
}

/**
 * Construye el adapter de descubrimiento de República Dominicana.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildDoDgiiDiscoveryAdapter(reads: DoDgiiDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: DO_DGII_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    const activityTexts = resolveDgiiActivityTextsForMacro(criteria.macroIndustryKey);
    if (activityTexts.length === 0) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), DO_DGII_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readActiveCompaniesByActivity({
      activityTexts,
      limit: DO_DGII_DISCOVERY_READ_CAP,
    });

    // Un RNC, una empresa: la primera fila válida gana (orden estable por RNC).
    const byRnc = new Map<string, DoDgiiActiveRow>();
    for (const row of rows) {
      const rnc = row.rnc?.trim() ?? '';
      if (!BUSINESS_RNC.test(rnc) || byRnc.has(rnc)) continue;
      byRnc.set(rnc, row);
    }
    if (byRnc.size === 0) return { ...empty, recordsRead: rows.length };

    const totals = await reads.readProcurementTotals([...byRnc.keys()]);

    const ranked = [...byRnc.entries()]
      .filter(([rnc]) => totals.has(rnc))
      .sort(([rncA], [rncB]) => {
        const diff = (totals.get(rncB) ?? 0) - (totals.get(rncA) ?? 0);
        return diff !== 0 ? diff : rncA.localeCompare(rncB);
      });

    const companies: CountrySourceCompany[] = [];
    for (const [rnc, row] of ranked) {
      if (companies.length >= limit) break;
      const company = toCompany(row, rnc);
      if (company !== null) companies.push(company);
    }

    return { sourceKey: DO_DGII_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}

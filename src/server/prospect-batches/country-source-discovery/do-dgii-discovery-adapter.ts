/**
 * do-dgii-discovery-adapter.ts — descubrimiento gratuito de República Dominicana,
 * consciente de criterios. PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-DO-FREE-DISCOVERY-1 · SOURCES-DO-SIZE-SIGNAL-1.
 *
 * ── Qué empresas ofrece, y por qué sólo esas ────────────────────────────────
 *
 * El padrón DGII (`rd_dgii_bulk`) es el universo entero de personas jurídicas
 * —493.548 RNC, 233.571 activas— y no publica tamaño. Ofrecerlo tal cual
 * cerraría el objetivo con microempresas sin que Apollo llegara a ejecutarse.
 *
 * Desde el 05-10-2026 (decisión de la dueña, «Lista DGII + DGCP») la fuente es
 * `do_dgii_size_registry`, ya filtrada en la carga
 * (`scripts/source-catalog/run-do-size-registry-etl.ts`): empresas ACTIVAS en la
 * DGII, con actividad de la tabla aprobada, y con señal de tamaño — Grandes
 * Contribuyentes Nacionales, Grandes Locales y Medianos de la DGII, o
 * proveedoras del Estado (DGCP) que no son micro ni pequeñas. Se ordenan por
 * nivel de tamaño y, dentro del nivel, por importe adjudicado.
 *
 * Antes se leían las 2.000 empresas de RNC más antiguo de la macro y luego se
 * cruzaban con compras públicas: en Retail quedaba fuera el 89 % de las
 * proveedoras. La carga precalculada evita esa ventana.
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero la decisión vigente es la de la
 * tabla (`do-dgii-macro-table.ts`): cada fila se re-clasifica desde su texto de
 * actividad y sólo se ofrece si la tabla de HOY coincide. Y el nivel de tamaño
 * se vuelve a comprobar.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`DoDgiiDiscoveryReads`). Este módulo no construye
 * ningún cliente, no lee env, no escribe y no sale a la red.
 */

import {
  classifyDgiiActivityText,
  macroHasDgiiCoverage,
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

/**
 * Filas leídas por cada empresa pedida: margen para las que la tabla de hoy ya
 * no reconoce, que repiten RNC o que SellUp ya vio en otra corrida
 * (SOURCES-DO-NO-RECYCLE-1: antes era 2).
 */
export const DO_DGII_DISCOVERY_READ_FACTOR = 3;

/**
 * SOURCES-DO-NO-RECYCLE-1 — lo que SellUp ya sabe de un RNC antes de esta
 * corrida: `candidate` (está en algún lote), `definitive_discard` (descartada y el
 * rescate cerró el caso: otra industria, otro tamaño o duplicada) o `discard`
 * (descartada sin cierre, típicamente por falta de web). Mismo criterio que
 * Argentina (SOURCES-AR-NO-RECYCLE-1, #611).
 */
export type DoDgiiPriorSighting = 'candidate' | 'definitive_discard' | 'discard';

const BUSINESS_RNC = /^\d{9}$/;
const VALID_TIERS: ReadonlySet<number> = new Set([1, 2, 3, 4]);

/** Fila de `do_dgii_size_registry` acotada a lo que esta proyección usa. */
export type DoDgiiActiveRow = {
  record_identity_key: string;
  rnc: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  sector: string | null;
  size_tier: number | null;
  /** SOURCES-DO-DGCP-DOMAIN-1 — dominio del correo corporativo en la DGCP, o `null`. */
  website_domain?: string | null;
  /** SOURCES-DO-NO-RECYCLE-1 — ausente o `null` = SellUp no la vio. */
  prior_sighting?: DoDgiiPriorSighting | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type DoDgiiDiscoveryReads = {
  /** Empresas con señal de tamaño de esta macro, de mayor a menor. */
  readSizedCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly DoDgiiActiveRow[]>;
};

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/**
 * SOURCES-DO-NO-RECYCLE-1 — ¿proponerla otra vez sólo repetiría una corrida
 * anterior? La lectura de la fuente es determinista (mismo orden), así que sin
 * esto la 2.ª corrida de la misma industria relee las mismas empresas: lo que ya
 * está en revisión sale como duplicado y lo que no tiene web vuelve a
 * Descartadas. Sí se repite si ya es candidata, si su descarte quedó cerrado, o
 * si fue descartada y SIGUE sin web. Una descartada que AHORA tiene dominio
 * vuelve a ofrecerse. Las cuentas y HubSpot los cubre el detector de duplicados
 * de la capa; esto cubre lo que ese detector no mira.
 */
export function isRecycledDoCompany(row: Pick<DoDgiiActiveRow, 'prior_sighting' | 'website_domain'>): boolean {
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

function toCompany(row: DoDgiiActiveRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const rnc = row.rnc?.trim() ?? '';
  if (legalName === null || !BUSINESS_RNC.test(rnc)) return null;
  if (row.size_tier === null || !VALID_TIERS.has(row.size_tier)) return null;
  // La tabla de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  const classification = classifyDgiiActivityText(row.sector);
  if (classification === null || classification.macroIndustryKey !== macroIndustryKey) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: rnc,
    taxIdentifierType: 'RNC',
    countryCode: 'DO',
    city: null,
    region: null,
    // 🔴 DGII no publica web. El único dominio es el que la carga sacó del correo
    // corporativo que la empresa declaró a la DGCP, y sólo si se parece a su
    // razón social (`do-dgcp-domain.ts`). Sin él, no se fabrica ninguno.
    domain: normalizeDomain(row.website_domain),
    declaredIndustry: classification.description,
    industryCode: classification.code,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [classification.macroIndustryKey],
      tableVersion: DO_DGII_MACRO_TABLE_VERSION,
    },
    // 🔴 El nivel de tamaño NO viaja al candidato: el writer común deja el tamaño
    // como «por validar» y su procedencia es una lista cerrada. Aquí sólo
    // garantiza que no se ofrece ninguna micro o pequeña conocida.
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

    // Una macro sin actividades clasificadas no consulta: nunca una muestra genérica.
    if (!macroHasDgiiCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), DO_DGII_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readSizedCompaniesByMacro({
      macroIndustryKey: criteria.macroIndustryKey,
      limit: limit * DO_DGII_DISCOVERY_READ_FACTOR,
    });

    // Un RNC, una empresa: la primera fila válida gana (la lectura ya viene
    // ordenada por tamaño e importe adjudicado).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      if (companies.length >= limit) break;
      if (isRecycledDoCompany(row)) continue;
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || company.taxId === null || seen.has(company.taxId)) continue;
      seen.add(company.taxId);
      companies.push(company);
    }

    return { sourceKey: DO_DGII_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}

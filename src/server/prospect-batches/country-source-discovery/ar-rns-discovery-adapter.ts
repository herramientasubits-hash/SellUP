/**
 * ar-rns-discovery-adapter.ts — descubrimiento gratuito de Argentina sobre el
 * Registro Nacional de Sociedades cruzado con las adjudicaciones de COMPR.AR.
 * PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-AR-RNS-1.
 *
 * ── Qué empresas ofrece ─────────────────────────────────────────────────────
 *
 * Las filas `ar_rns` ya vienen filtradas en la carga: sociedades con actividad
 * PRINCIPAL activa en ARCA que han ganado alguna adjudicación del Estado
 * (`scripts/source-catalog/run-ar-rns-snapshot-etl.ts`). Aquí sólo se piden las de
 * la macro industria pedida, de mayor a menor importe adjudicado (percentil en
 * `priority_score`). Igual que Colombia y República Dominicana, la fuente puede
 * cerrar el objetivo entero.
 *
 * ── Dos orígenes intercalados (SOURCES-AR-E2E-1) ───────────────────────────
 *
 * Además de las proveedoras del Estado (`procurement`, por importe adjudicado)
 * se leen los empleadores ATP 2020 con ≥100 trabajadores (`employer`, por
 * trabajadores). Se intercalan uno y uno respetando el orden de cada lista, y
 * una CUIT presente en las dos sale una sola vez. Así ninguna de las dos listas
 * se come el objetivo entero.
 *
 * ── Doble comprobación de pertenencia ───────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero la decisión vigente es la de la
 * tabla aprobada (`ar-rns-macro-table.ts`). Cada fila se re-clasifica desde su
 * código de actividad y sólo se ofrece si la tabla de HOY coincide con la macro
 * pedida: si la tabla cambia y la carga no se repite, no se ofrece nada de más.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`ArRnsDiscoveryReads`). Este módulo no construye
 * ningún cliente, no lee env, no escribe y no sale a la red.
 */

import {
  AR_RNS_MACRO_TABLE_VERSION,
  macroHasArCoverage,
  resolveArActivityMacro,
} from './ar-rns-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const AR_RNS_DISCOVERY_SOURCE_KEY = 'ar_rns_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que Colombia). */
export const AR_RNS_DISCOVERY_MAX_ROWS = 200;

/** CUIT de persona jurídica ya normalizada: 11 dígitos con prefijo 30, 33 o 34. */
const LEGAL_ENTITY_CUIT = /^(30|33|34)\d{9}$/;

/**
 * SOURCES-AR-NO-RECYCLE-1 — lo que SellUp ya sabe de una CUIT antes de esta
 * corrida: `candidate` (está en algún lote), `definitive_discard` (descartada y
 * el rescate cerró el caso: otra industria, otro tamaño o duplicada) o `discard`
 * (descartada sin cierre, típicamente por falta de web).
 */
export type ArRnsPriorSighting = 'candidate' | 'definitive_discard' | 'discard';

/** De qué carga viene una fila. */
export type ArRnsDiscoveryOrigin = 'procurement' | 'employer';

/** Fila `ar_rns` / `ar_atp_employers` acotada a lo que esta proyección usa. */
export type ArRnsSnapshotReadRow = {
  /** Ausente = `procurement` (filas leídas antes de SOURCES-AR-E2E-1). */
  origin?: ArRnsDiscoveryOrigin;
  record_identity_key: string;
  cuit: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  sector: string | null;
  city: string | null;
  region: string | null;
  activity_code: string | null;
  priority_score: number | null;
  /** SOURCES-AR-SIPRO-DOMAIN-1 — dominio del correo del SIPRO histórico, o `null`. */
  website_domain?: string | null;
  /** SOURCES-AR-NO-RECYCLE-1 — ausente o `null` = SellUp no la vio. */
  prior_sighting?: ArRnsPriorSighting | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type ArRnsDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly ArRnsSnapshotReadRow[]>;
};

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

function toCompany(row: ArRnsSnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const cuit = row.cuit?.trim() ?? '';
  if (legalName === null || !LEGAL_ENTITY_CUIT.test(cuit)) return null;
  // La tabla de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolveArActivityMacro(row.activity_code) !== macroIndustryKey) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: cuit,
    taxIdentifierType: 'CUIT',
    countryCode: 'AR',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // 🔴 Ni el RNS ni ATP publican web. El único dominio es el que la carga sacó
    // del correo que la sociedad declaró en el SIPRO histórico, y sólo si se
    // parece a su razón social de entonces Y a la de hoy (`ar-sipro-domain.ts`).
    // Sin él, no se fabrica ninguno.
    domain: normalizeDomain(row.website_domain),
    declaredIndustry: row.sector?.trim() || null,
    industryCode: row.activity_code?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: AR_RNS_MACRO_TABLE_VERSION,
    },
  };
}

/**
 * SOURCES-AR-NO-RECYCLE-1 — ¿proponerla otra vez sólo repetiría lo de una corrida
 * anterior? Sí si ya es candidata en SellUp, si su descarte quedó cerrado, o si
 * fue descartada y SIGUE sin web (volvería a Descartadas igual). Una descartada
 * que AHORA tiene dominio vuelve a ofrecerse: ése es justo el caso que el dominio
 * del SIPRO vino a resolver. Las cuentas y HubSpot los cubre el detector de
 * duplicados de la capa; esto cubre lo que ese detector no mira.
 */
export function isRecycledArCompany(row: Pick<ArRnsSnapshotReadRow, 'prior_sighting' | 'website_domain'>): boolean {
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

/**
 * Alterna las filas de cada origen (procurement, employer, procurement…)
 * conservando el orden dentro de cada uno. Puro.
 */
export function interleaveByOrigin(
  rows: readonly ArRnsSnapshotReadRow[],
): ArRnsSnapshotReadRow[] {
  const procurement = rows.filter((row) => (row.origin ?? 'procurement') === 'procurement');
  const employer = rows.filter((row) => row.origin === 'employer');
  const out: ArRnsSnapshotReadRow[] = [];
  for (let i = 0; i < Math.max(procurement.length, employer.length); i++) {
    if (i < procurement.length) out.push(procurement[i]);
    if (i < employer.length) out.push(employer[i]);
  }
  return out;
}

/**
 * Construye el adapter de descubrimiento de Argentina.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildArRnsDiscoveryAdapter(reads: ArRnsDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: AR_RNS_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin actividades clasificadas no consulta: nunca una muestra genérica.
    if (!macroHasArCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), AR_RNS_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({
      macroIndustryKey: criteria.macroIndustryKey,
      limit,
    });

    // Una CUIT, una empresa: la primera fila válida gana (cada lista ya viene
    // ordenada; el intercalado alterna procurement / employer).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of interleaveByOrigin(rows)) {
      if (companies.length >= limit) break;
      if (isRecycledArCompany(row)) continue;
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || company.taxId === null || seen.has(company.taxId)) continue;
      seen.add(company.taxId);
      companies.push(company);
    }

    return { sourceKey: AR_RNS_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}

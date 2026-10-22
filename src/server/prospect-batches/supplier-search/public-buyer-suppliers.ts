/**
 * AGENT1-SUPPLIER-SEARCH-PUBLIC-1 — «Proveedores de una empresa», Fase 2: cuando la
 * empresa de referencia es una ENTIDAD PÚBLICA, sus proveedores salen de las compras
 * públicas oficiales (gratis) antes de pagar a Claude.
 *
 *  1. ¿La referencia es una entidad pública del país? Sólo con una coincidencia única
 *     por nombre (exacta, o el comienzo del nombre prefiriendo la cabeza de la
 *     entidad). Una empresa privada («Bancolombia») no coincide y el paso no corre.
 *  2. Sus proveedores en la industria pedida, de más a menos monto (fuente del país:
 *     hoy SECOP II en Colombia; Chile entra igual cuando tenga su ticket).
 *  3. Fuera las otras entidades públicas (convenios interadministrativos: ESU, ITM…).
 *  4. Con web (registro oficial) ⇒ al lote con el escritor de fuentes oficiales.
 *     Sin web ⇒ a Descartadas «sin sitio» con su NIT: el rescate de Claude busca el
 *     sitio (regla de la dueña 01-10: sin web no cuenta para la meta).
 *  5. Al final de la corrida, a cada candidato con ese NIT se le pone «Proveedor de X»
 *     con la página del contrato en SECOP como prueba.
 *
 * Puro: dependencias inyectadas. 0 escrituras en HubSpot (su revisión es de lectura).
 */

import {
  buildCountrySourceOfficialWorkforce,
  type CountrySourceCompany,
} from '@/server/prospect-batches/country-source-discovery/country-source-types';
import { normalizeEntityNit } from '@/server/source-catalog/connectors/co-public-entities/co-public-entity-rows';
import {
  isUbitsCompetitorDomain,
  isUbitsCompetitorName,
} from '@/server/agents/prospecting-toolkit/claude-classifier/ubits-competitors';
import { PUBLIC_BUYER_COUNTRY_CODES } from './countries/codes';
import { isProcurementDataStale } from './countries/reload-plan';

/**
 * Países con compras públicas conectadas a «Proveedores»: Colombia (SECOP II en vivo)
 * y Chile (órdenes de compra mensuales de ChileCompra cargadas en
 * `public_procurement_supplier_links`; sin carga, el paso no reconoce a nadie).
 */
export const PUBLIC_BUYER_SUPPLIER_COUNTRIES: readonly string[] = PUBLIC_BUYER_COUNTRY_CODES;
/** Proveedores que se ofrecen como mucho (con y sin web). */
export const PUBLIC_BUYER_MAX_SUPPLIERS = 12;
/**
 * AGENT1-SUPPLIER-SKIP-KNOWN-1 — cuántas de las primeras del orden se miran en SellUp para
 * saltar las ya vistas (5 tandas de 12): repetir la búsqueda trae las siguientes.
 */
export const ALREADY_IN_SELLUP_LOOKAHEAD = PUBLIC_BUYER_MAX_SUPPLIERS * 5;
/** Nombres de las ya vistas que se guardan para el resumen. */
export const ALREADY_IN_SELLUP_NAMES_MAX = 5;
/**
 * AGENT1-RESCUE-SIZE-UNFILTERED-1 — con el tamaño oficial a mano (Chile: trabajadores del
 * SII), las de menos de esto no se ofrecen (umbral aprobado de Chile) y las de más van
 * primero: el rescate de Claude busca su web en ese orden y su ventana es corta.
 */
export const PUBLIC_BUYER_MIN_OFFICIAL_WORKERS = 100;
/** Clave del bloque del lote con lo que hizo el paso. */
export const SUPPLIER_PUBLIC_BUYER_METADATA_KEY = 'supplier_public_buyer';

/** Un proveedor de la entidad, con su industria por lo que le vende. */
export type PublicBuyerSupplier = {
  taxId: string;
  name: string;
  totalAmount: number;
  contractCount: number;
  lastSignedAt: string | null;
  macroIndustryKey: string;
  macroShare: number;
  /** Rubro en palabras de lo que más le vende («Servicios informáticos»). */
  rubro: string | null;
  evidenceUrl: string | null;
  /** Trabajadores según el registro oficial del país (Chile: SII), si se conocen. */
  officialWorkers?: { workers: number; year: number | null; sourceLabel: string } | null;
  /** AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — «frecuentes»: a cuántas entidades le vende. */
  buyerCount?: number;
  /** AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — «frecuentes»: sus entidades de más monto (hasta 3). */
  topBuyerNames?: readonly string[];
};

export type PublicBuyerSuppliersResult =
  | {
      ok: true;
      suppliers: PublicBuyerSupplier[];
      read: number;
      outsideIndustry: number;
      tableVersion: string;
      /** Año desde el que se miran las compras (frase de la prueba). Ausente = año en curso − 2. */
      sinceYear?: string;
      /** AGENT1-SUPPLIER-RELOAD-1 — fin de la ventana cargada (AAAA-MM-DD); ausente en los «en vivo». */
      windowEnd?: string;
    }
  | { ok: false; reason: 'industry_without_unspsc' | 'source_unavailable' };

/** Una entidad pública candidata a ser la referencia. */
export type PublicEntityRow = {
  taxId: string;
  /** Nombre normalizado del registro (mayúsculas, sin tildes ni puntuación). */
  normalizedLegalName: string;
  /** Nombre corto que publica la fuente («Santiago de Cali»), si lo hay. */
  shortName: string | null;
  isHead: boolean;
};

/**
 * Entidades candidatas con aviso de tope: `truncated` = había más candidatas que las que
 * se leyeron. Elegir de una lista cortada podría dar OTRA entidad ⇒ el paso no corre
 * (`ambiguous_entity`, fail-closed).
 */
export type PublicEntityLookup = { rows: PublicEntityRow[]; truncated: boolean };

export type PublicBuyerRelationship = {
  taxId: string;
  name: string;
  evidenceUrl: string | null;
  evidence: string;
  /**
   * AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — «Proveedor de …» propio de esta empresa (en
   * «frecuentes», sus entidades: «IMSS, ISSSTE y 5 más»). Ausente = la referencia del lote.
   */
  referenceName?: string;
};

export type PublicBuyerStepSkipReason =
  | 'country_not_supported'
  | 'not_public_entity'
  | 'ambiguous_entity'
  | 'industry_without_unspsc'
  | 'source_unavailable'
  // AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — nadie le vende a varias entidades en esa industria.
  | 'no_frequent_suppliers'
  | 'failed';

export type PublicBuyerStepOutcome =
  | { executed: false; reason: PublicBuyerStepSkipReason | string }
  | {
      executed: true;
      /** AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — sin referencia: empresas que le venden a varias entidades. */
      scope?: 'frequent_public';
      buyer: {
        taxId: string;
        name: string;
        matchedBy: 'exact' | 'prefix';
        /** La sigla con la que se nombró a la entidad («ICBF»), cuando la referencia era una sigla conocida. */
        viaAlias?: string;
      };
      sourceKey: string;
      tableVersion: string;
      read: number;
      outsideIndustry: number;
      publicEntitiesExcluded: number;
      /** Consorcios y uniones temporales (no son la empresa a prospectar): no se ofrecen. */
      consortiaExcluded?: number;
      /** Con tamaño oficial menor que `PUBLIC_BUYER_MIN_OFFICIAL_WORKERS`: no se ofrecen. */
      knownSmallExcluded?: number;
      /** AGENT1-SUPPLIER-AUDIT-NOW-1 — competidores de UBITS (por nombre o sitio): no se ofrecen. */
      ubitsCompetitorsExcluded?: number;
      /** AGENT1-SUPPLIER-WEB-BY-NAME-1 — ofrecidas cuya web salió por nombre (no por número fiscal). */
      websitesByName?: number;
      /** AGENT1-SUPPLIER-FREQUENT-POLISH-1 — sin web y ya en el CRM: no se pagó su rescate. */
      knownInCrmSkipped?: number;
      /**
       * AGENT1-SUPPLIER-SKIP-KNOWN-1 — ya vistas en SellUp (candidata del país o revisada hace
       * poco): se saltan para ofrecer las siguientes. Con sus primeros nombres, para el resumen.
       */
      alreadyInSellUpSkipped?: number;
      alreadyInSellUpNames?: string[];
      /** AGENT1-SUPPLIER-RELOAD-1 — hasta cuándo llegan los datos cargados, y si ya están viejos. */
      dataWindowEnd?: string;
      dataStale?: boolean;
      offered: number;
      /** Filas con web escritas en el lote (después del reclamo «un vendedor»). */
      written: number;
      writeFailed: boolean;
      /** Sin web, a Descartadas para que el rescate de Claude busque su sitio. */
      recordedWithoutWebsite: number;
      /** AGENT1-SUPPLIER-AUDIT-NOW-1 — guardar las sin web en Descartadas falló. */
      recordWithoutWebsiteFailed?: boolean;
      relationships: PublicBuyerRelationship[];
    };

export type PublicBuyerStepInput = {
  batchId: string;
  referenceCompanyName: string;
  countryCode: string;
  macroIndustryKey: string;
  nowIso: string;
};

export type PublicBuyerStepDeps = {
  sourceKey: string;
  /** Tipo de número fiscal del país (Colombia NIT, Chile RUT). */
  taxIdentifierType?: CountrySourceCompany['taxIdentifierType'];
  /** Cómo normaliza el país el nombre del comprador (Chile quita «I»/«Ilustre»). */
  normalizeName?: (raw: string) => string;
  /**
   * AUDIT-HARDENING-1 — si la referencia ES una sigla conocida de una entidad pública
   * («ICBF», «SENA», «DIAN»), el nombre oficial al que se traduce; `null` si no. Sólo
   * cambia el texto que se busca: la elección sigue siendo `pickPublicBuyer` (una sola
   * entidad o ninguna). Ausente ⇒ el país no tiene tabla de siglas y todo sigue igual.
   */
  resolveReferenceAlias?: (reference: string) => string | null;
  /**
   * Entidades públicas del país cuyo nombre es o empieza por el normalizado. Si la
   * consulta tiene tope, debe avisar con `truncated` cuando lo alcanza (ver `PublicEntityLookup`).
   */
  findPublicEntities: (normalizedName: string) => Promise<PublicEntityRow[] | PublicEntityLookup>;
  listSuppliers: (input: { buyerTaxId: string; macroIndustryKey: string; nowIso: string }) => Promise<PublicBuyerSuppliersResult>;
  /** NIT que son entidades públicas y NO empresas del registro mercantil. */
  listPublicOnlyTaxIds: (taxIds: readonly string[]) => Promise<ReadonlySet<string>>;
  findDomainsByTaxId: (taxIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  /**
   * AGENT1-SUPPLIER-WEB-BY-NAME-1 — web por NOMBRE exacto en las fichas del país, para los
   * que el número fiscal no la dio (ver `website-by-name.ts`). Ausente = sólo por número.
   */
  findDomainsByName?: (companies: ReadonlyArray<{ taxId: string; name: string }>) => Promise<ReadonlyMap<string, string>>;
  /**
   * AGENT1-SUPPLIER-FREQUENT-POLISH-1 — de las que siguen SIN web, cuáles ya están en el CRM
   * (HubSpot por número fiscal o por el mismo nombre). Esas no pasan al rescate: Prod 22-10,
   * Mainbit y Microsoft se pagaron la búsqueda de web y salieron «duplicadas». Ausente o con
   * error ⇒ todas van al rescate como antes.
   */
  findKnownInCrm?: (companies: ReadonlyArray<{ taxId: string; name: string }>) => Promise<ReadonlySet<string>>;
  /**
   * AGENT1-SUPPLIER-SKIP-KNOWN-1 — de estos números fiscales, cuáles ya vio SellUp: candidata
   * del país en cualquier lote o revisada hace poco en Descartadas. Prod 22-10: repetir
   * «frecuentes» México × Tecnología volvió con las mismas 12 y dejó 0 nuevas. Ausente o con
   * error ⇒ no se salta ninguna (como antes).
   */
  listAlreadyInSellUp?: (taxIds: readonly string[]) => Promise<ReadonlySet<string>>;
  writeWithWebsite: (companies: readonly CountrySourceCompany[]) => Promise<{ written: number; failed: boolean }>;
  recordWithoutWebsite: (companies: readonly CountrySourceCompany[]) => Promise<number>;
};

/** «Alcaldía de Medellín» → «ALCALDIA DE MEDELLIN» (como `normalized_legal_name`). */
export function normalizePublicEntityName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Consorcios y uniones temporales: asociaciones armadas para UN contrato, no la empresa a
 * prospectar (muchas sin número fiscal propio; sus socios salen por su cuenta). Antes sólo
 * los sacaban algunos lectores al cargar (PE/PY/HN/GT); ahora el paso los saca en todos
 * los países. Se mira el nombre ya normalizado (sin tildes ni comillas: «Unión Temporal»,
 * «Consórcio», «"CONSORCIO X"»).
 */
const CONSORTIUM_NAME_PATTERNS: readonly RegExp[] = [
  /^CONSORCIO\b/, // «CONSORCIO VIAL 2025», «Consórcio …» (Brasil)
  /^UTE\b/, // «UTE …» (unión temporal de empresas)
  /\bUNION TEMPORAL\b/, // «UNIÓN TEMPORAL SALUD 2024», «… UNION TEMPORAL»
];

/** ¿El nombre es de un consorcio o una unión temporal? */
export function isConsortiumSupplierName(raw: string | null | undefined): boolean {
  const name = normalizePublicEntityName(raw ?? '');
  return CONSORTIUM_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function uniqueByTaxId(rows: readonly PublicEntityRow[]): PublicEntityRow[] {
  const seen = new Map<string, PublicEntityRow>();
  for (const row of rows) if (!seen.has(row.taxId)) seen.set(row.taxId, row);
  return [...seen.values()];
}

/** Una sola entidad, o ninguna: mejor no correr que comprarle a otra entidad. */
function pickOne(rows: readonly PublicEntityRow[]): PublicEntityRow | 'ambiguous' | null {
  const unique = uniqueByTaxId(rows);
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];
  const heads = unique.filter((row) => row.isHead);
  return heads.length === 1 ? heads[0] : 'ambiguous';
}

export function pickPublicBuyer(
  referenceCompanyName: string,
  rows: readonly PublicEntityRow[],
  normalize: (raw: string) => string = normalizePublicEntityName,
): { entity: PublicEntityRow; matchedBy: 'exact' | 'prefix' } | { entity: null; reason: 'not_public_entity' | 'ambiguous_entity' } {
  const wanted = normalize(referenceCompanyName);
  if (wanted.length < 4) return { entity: null, reason: 'not_public_entity' };
  const names = (row: PublicEntityRow) => [row.normalizedLegalName, row.shortName ? normalize(row.shortName) : null];
  const exact = pickOne(rows.filter((row) => names(row).includes(wanted)));
  if (exact === 'ambiguous') return { entity: null, reason: 'ambiguous_entity' };
  if (exact) return { entity: exact, matchedBy: 'exact' };
  const prefix = pickOne(rows.filter((row) => names(row).some((n) => n?.startsWith(`${wanted} `))));
  if (prefix === 'ambiguous') return { entity: null, reason: 'ambiguous_entity' };
  if (prefix) return { entity: prefix, matchedBy: 'prefix' };
  return { entity: null, reason: 'not_public_entity' };
}

const MILLIONS = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

/** La frase que el vendedor ve en «Por qué fue encontrado». */
export function describePublicBuyerSupplier(supplier: PublicBuyerSupplier, buyerName: string, sinceYear: string): string {
  const contracts = supplier.contractCount === 1 ? '1 contrato' : `${supplier.contractCount} contratos`;
  const amount =
    supplier.totalAmount >= 1_000_000
      ? `$${MILLIONS.format(Math.round(supplier.totalAmount / 1_000_000))} millones`
      : `$${MILLIONS.format(Math.round(supplier.totalAmount))}`;
  const last = supplier.lastSignedAt ? `; el último firmado el ${supplier.lastSignedAt}` : '';
  const rubro = supplier.rubro ? ` (${supplier.rubro.toLowerCase()})` : '';
  return `${contracts}${rubro} con ${buyerName} en compras públicas desde ${sinceYear} por ${amount}${last}.`;
}

function toCompany(
  supplier: PublicBuyerSupplier,
  input: {
    countryCode: string;
    sourceKey: string;
    tableVersion: string;
    taxIdentifierType: CountrySourceCompany['taxIdentifierType'];
  },
  domain: string | null,
): CountrySourceCompany {
  const workforce = supplier.officialWorkers
    ? buildCountrySourceOfficialWorkforce(supplier.officialWorkers.workers, supplier.officialWorkers.year, supplier.officialWorkers.sourceLabel)
    : null;
  return {
    recordIdentityKey: `tax:${supplier.taxId}`,
    legalName: supplier.name,
    normalizedLegalName: null,
    taxId: supplier.taxId,
    taxIdentifierType: input.taxIdentifierType,
    ...(workforce ? { officialWorkforce: workforce } : {}),
    countryCode: input.countryCode,
    city: null,
    region: null,
    domain,
    declaredIndustry: supplier.rubro,
    industryCode: null,
    coarseSector: null,
    // La industria la prueba lo que le vende al Estado (tabla UNSPSC aprobada).
    officialMacroIndustry: { macroIndustryKeys: [supplier.macroIndustryKey], tableVersion: input.tableVersion },
    originSourceKey: input.sourceKey,
    // Compras públicas no filtran por tamaño: el rescate lo comprueba como con cualquiera.
    sizeNotFilteredBySource: true,
  };
}

/** ¿El tamaño oficial ya la deja fuera? Sin dato, no se sabe y sigue. */
function isKnownSmall(supplier: PublicBuyerSupplier): boolean {
  return supplier.officialWorkers ? supplier.officialWorkers.workers < PUBLIC_BUYER_MIN_OFFICIAL_WORKERS : false;
}

/** Las grandes según el registro oficial primero (de más a menos trabajadores); el resto, por monto. */
export function prioritizeLargeSuppliers(suppliers: readonly PublicBuyerSupplier[]): PublicBuyerSupplier[] {
  const large = suppliers
    .filter((s) => (s.officialWorkers?.workers ?? 0) >= PUBLIC_BUYER_MIN_OFFICIAL_WORKERS)
    .sort((a, b) => (b.officialWorkers?.workers ?? 0) - (a.officialWorkers?.workers ?? 0));
  return [...large, ...suppliers.filter((s) => !large.includes(s))];
}

export async function runPublicBuyerSupplierStep(
  input: PublicBuyerStepInput,
  deps: PublicBuyerStepDeps,
): Promise<PublicBuyerStepOutcome> {
  if (!PUBLIC_BUYER_SUPPLIER_COUNTRIES.includes(input.countryCode)) {
    return { executed: false, reason: 'country_not_supported' };
  }
  const normalize = deps.normalizeName ?? normalizePublicEntityName;
  // Una sigla conocida se busca por el nombre oficial de su entidad (ver `resolveReferenceAlias`).
  const aliasOfficialName = deps.resolveReferenceAlias?.(input.referenceCompanyName) ?? null;
  const searchedName = aliasOfficialName ?? input.referenceCompanyName;
  const normalized = normalize(searchedName);
  const found = await deps.findPublicEntities(normalized);
  const lookup: PublicEntityLookup = Array.isArray(found) ? { rows: found, truncated: false } : found;
  // Con tope alcanzado la lista está cortada: lo que se elija de ella podría ser otra entidad.
  if (lookup.truncated) return { executed: false, reason: 'ambiguous_entity' };
  const picked = pickPublicBuyer(searchedName, lookup.rows, normalize);
  if (picked.entity === null) return { executed: false, reason: picked.reason };
  const buyer = picked.entity;

  const listed = await deps.listSuppliers({
    buyerTaxId: buyer.taxId,
    macroIndustryKey: input.macroIndustryKey,
    nowIso: input.nowIso,
  });
  if (!listed.ok) return { executed: false, reason: listed.reason };

  const buyerName = input.referenceCompanyName.trim();
  const sinceYear = listed.sinceYear ?? String(Number(input.nowIso.slice(0, 4)) - 2);
  const offered = await offerPublicSuppliers(listed, input, deps, (s) => ({
    evidence: describePublicBuyerSupplier(s, buyerName, sinceYear),
  }));
  return {
    executed: true,
    buyer: {
      taxId: buyer.taxId,
      name: buyer.normalizedLegalName,
      matchedBy: picked.matchedBy,
      ...(aliasOfficialName ? { viaAlias: input.referenceCompanyName.trim() } : {}),
    },
    ...offered,
  };
}

/** Lo que el paso ofrece, escribe y deja como prueba (común a una entidad y a «frecuentes»). */
type OfferedPublicSuppliers = Omit<Extract<PublicBuyerStepOutcome, { executed: true }>, 'executed' | 'buyer' | 'scope'>;

/**
 * Común a los dos pasos de compras públicas: fuera consorcios, otras entidades públicas,
 * las chicas por tamaño oficial y los competidores de UBITS; las grandes primero; como
 * mucho 12; con web al lote y sin web a Descartadas (para el rescate). `describe` arma la
 * prueba de cada una (y, en «frecuentes», a quién le vende).
 */
async function offerPublicSuppliers(
  listed: Extract<PublicBuyerSuppliersResult, { ok: true }>,
  input: { batchId: string; countryCode: string; nowIso: string },
  deps: Pick<
    PublicBuyerStepDeps,
    | 'sourceKey'
    | 'taxIdentifierType'
    | 'listPublicOnlyTaxIds'
    | 'findDomainsByTaxId'
    | 'findDomainsByName'
    | 'findKnownInCrm'
    | 'listAlreadyInSellUp'
    | 'writeWithWebsite'
    | 'recordWithoutWebsite'
  >,
  describe: (supplier: PublicBuyerSupplier) => { evidence: string; referenceName?: string },
): Promise<OfferedPublicSuppliers> {
  // Común a todos los países: fuera consorcios y uniones temporales.
  const consortia = listed.suppliers.filter((s) => isConsortiumSupplierName(s.name));
  const companies = listed.suppliers.filter((s) => !isConsortiumSupplierName(s.name));
  const publicOnly = companies.length > 0 ? await deps.listPublicOnlyTaxIds(companies.map((s) => s.taxId)) : new Set<string>();
  const notPublic = companies.filter((s) => !publicOnly.has(s.taxId));
  const knownSmall = notPublic.filter(isKnownSmall);
  // AGENT1-SUPPLIER-AUDIT-NOW-1 — los competidores de UBITS no son prospectos (como en la
  // ruta de Claude): por nombre antes de elegir y por sitio cuando se conoce.
  const competitorsByName = notPublic.filter((s) => !isKnownSmall(s) && isUbitsCompetitorName(s.name));
  const eligible = prioritizeLargeSuppliers(notPublic.filter((s) => !isKnownSmall(s) && !isUbitsCompetitorName(s.name)));
  // AGENT1-SUPPLIER-SKIP-KNOWN-1 — las ya vistas en SellUp se saltan y entran las siguientes.
  const lookahead = eligible.slice(0, ALREADY_IN_SELLUP_LOOKAHEAD);
  const alreadyInSellUp =
    lookahead.length > 0 && deps.listAlreadyInSellUp
      ? await deps.listAlreadyInSellUp(lookahead.map((s) => s.taxId)).catch((err: unknown) => {
          console.error(
            `[supplier-public-buyer:${input.countryCode}] ya vistas en SellUp (lote ${input.batchId}):`,
            err instanceof Error ? err.message : String(err),
          );
          return new Set<string>();
        })
      : new Set<string>();
  const skippedKnown = lookahead.filter((s) => alreadyInSellUp.has(s.taxId));
  const shortlist = eligible.filter((s) => !alreadyInSellUp.has(s.taxId)).slice(0, PUBLIC_BUYER_MAX_SUPPLIERS);
  const byTaxId = shortlist.length > 0 ? await deps.findDomainsByTaxId(shortlist.map((s) => s.taxId)) : new Map<string, string>();
  // AGENT1-SUPPLIER-WEB-BY-NAME-1 — los que siguen sin web, por nombre exacto (gratis; si
  // falla, siguen sin web y van al rescate como antes).
  const missing = shortlist.filter((s) => !byTaxId.has(s.taxId));
  const byName =
    missing.length > 0 && deps.findDomainsByName
      ? await deps.findDomainsByName(missing.map((s) => ({ taxId: s.taxId, name: s.name }))).catch((err: unknown) => {
          console.error(
            `[supplier-public-buyer:${input.countryCode}] web por nombre (lote ${input.batchId}):`,
            err instanceof Error ? err.message : String(err),
          );
          return new Map<string, string>();
        })
      : new Map<string, string>();
  const domains = new Map<string, string>([...byName, ...byTaxId]);
  const isCompetitorSite = (s: PublicBuyerSupplier): boolean => {
    const domain = domains.get(s.taxId);
    return !!domain && isUbitsCompetitorDomain(domain);
  };
  const offered = shortlist.filter((s) => !isCompetitorSite(s));
  const ubitsCompetitorsExcluded = competitorsByName.length + (shortlist.length - offered.length);
  const companyInput = {
    countryCode: input.countryCode,
    sourceKey: deps.sourceKey,
    tableVersion: listed.tableVersion,
    taxIdentifierType: deps.taxIdentifierType ?? ('NIT' as const),
  };
  const withWebsite = offered.filter((s) => domains.has(s.taxId)).map((s) => toCompany(s, companyInput, domains.get(s.taxId) ?? null));
  const missingWeb = offered.filter((s) => !domains.has(s.taxId));
  // AGENT1-SUPPLIER-FREQUENT-POLISH-1 — las que ya son del CRM no se rescatan (el rescate cuesta).
  const knownInCrm =
    missingWeb.length > 0 && deps.findKnownInCrm
      ? await deps.findKnownInCrm(missingWeb.map((s) => ({ taxId: s.taxId, name: s.name }))).catch((err: unknown) => {
          console.error(
            `[supplier-public-buyer:${input.countryCode}] CRM antes del rescate (lote ${input.batchId}):`,
            err instanceof Error ? err.message : String(err),
          );
          return new Set<string>();
        })
      : new Set<string>();
  const withoutWebsite = missingWeb.filter((s) => !knownInCrm.has(s.taxId)).map((s) => toCompany(s, companyInput, null));

  const write = withWebsite.length > 0 ? await deps.writeWithWebsite(withWebsite) : { written: 0, failed: false };
  // AGENT1-SUPPLIER-AUDIT-NOW-1 — un fallo aquí queda registrado y marcado en el paso
  // (antes valía 0 en silencio y la corrida decía «ya eran de alguien»).
  let recordWithoutWebsiteFailed = false;
  const recordedWithoutWebsite =
    withoutWebsite.length > 0
      ? await deps.recordWithoutWebsite(withoutWebsite).catch((err: unknown) => {
          recordWithoutWebsiteFailed = true;
          console.error(
            `[supplier-public-buyer:${input.countryCode}] guardar sin web (lote ${input.batchId}):`,
            err instanceof Error ? err.message : String(err),
          );
          return 0;
        })
      : 0;

  // AGENT1-SUPPLIER-RELOAD-1 — datos viejos no tumban la corrida, pero quedan a la vista.
  const dataStale = listed.windowEnd ? isProcurementDataStale(input.countryCode, listed.windowEnd, new Date(input.nowIso)) : false;
  if (dataStale) {
    console.warn(`[supplier-public-buyer:${input.countryCode}] datos hasta ${listed.windowEnd}: toca recargar (lote ${input.batchId}).`);
  }
  return {
    ...(listed.windowEnd ? { dataWindowEnd: listed.windowEnd, dataStale } : {}),
    sourceKey: deps.sourceKey,
    tableVersion: listed.tableVersion,
    read: listed.read,
    outsideIndustry: listed.outsideIndustry,
    publicEntitiesExcluded: companies.filter((s) => publicOnly.has(s.taxId)).length,
    consortiaExcluded: consortia.length,
    knownSmallExcluded: knownSmall.length,
    ubitsCompetitorsExcluded,
    websitesByName: offered.filter((s) => byName.has(s.taxId) && !byTaxId.has(s.taxId)).length,
    knownInCrmSkipped: missingWeb.filter((s) => knownInCrm.has(s.taxId)).length,
    ...(skippedKnown.length > 0
      ? {
          alreadyInSellUpSkipped: skippedKnown.length,
          alreadyInSellUpNames: skippedKnown.slice(0, ALREADY_IN_SELLUP_NAMES_MAX).map((s) => s.name),
        }
      : {}),
    offered: offered.length,
    written: write.written,
    writeFailed: write.failed,
    recordedWithoutWebsite,
    ...(recordWithoutWebsiteFailed ? { recordWithoutWebsiteFailed: true } : {}),
    relationships: offered.map((s) => {
      const described = describe(s);
      return {
        taxId: s.taxId,
        name: s.name,
        evidenceUrl: s.evidenceUrl,
        evidence: described.evidence,
        ...(described.referenceName ? { referenceName: described.referenceName } : {}),
      };
    }),
  };
}

/**
 * Clave para cruzar el número fiscal del candidato con el del proveedor: el NIT
 * colombiano sin dígito de verificación; si no lo es (RUT chileno «96505260-7»), sólo
 * dígitos y K.
 */
export function taxIdKey(raw: string | null | undefined): string | null {
  const nit = normalizeEntityNit(raw);
  if (nit) return nit;
  // UEI de EE. UU. («DT2KS3HH5FP5»): 12 caracteres alfanuméricos; sus letras son parte de él.
  const alnum = (raw ?? '').trim().toUpperCase();
  if (/^[A-Z0-9]{12}$/.test(alnum) && /[A-Z]/.test(alnum)) return alnum;
  // AGENT1-SUPPLIER-AUDIT-NOW-1 — con letras que no son el dígito K del RUT (NIF de España
  // «B12345678», RFC de México), las letras son parte del número: quitarlas hacía que
  // «A12345678» y «B12345678» cruzaran como la misma empresa.
  if (/[A-JL-Z]/.test(alnum)) {
    const kept = alnum.replace(/[^A-Z0-9]/g, '');
    return kept.length >= 7 ? kept : null;
  }
  const generic = (raw ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
  return generic.length >= 7 ? generic : null;
}

/** Candidato del lote, lo justo para etiquetarlo. */
export type TaggableCandidate = { id: string; taxIdentifier: string | null; metadata: Record<string, unknown> | null };

/**
 * «Proveedor de X» con la prueba de SECOP en cada candidato del lote con ese NIT —
 * los escritos con web y los que el rescate de Claude rescató. No pisa una relación
 * que ya trae (la de Claude, con su caso de éxito). Devuelve cuántos etiquetó.
 */
export async function tagPublicBuyerSuppliers(
  input: { batchId: string; referenceCompanyName: string; relationships: readonly PublicBuyerRelationship[] },
  deps: {
    loadCandidates: (batchId: string) => Promise<TaggableCandidate[]>;
    /**
     * Agrega `relationship` a la metadata ACTUAL del candidato (relee antes de escribir) y
     * no pisa una «Proveedor de» que ya tenga. `true` = la escribió.
     */
    updateRelationship: (candidateId: string, relationship: Record<string, unknown>) => Promise<boolean>;
  },
): Promise<number> {
  if (input.relationships.length === 0) return 0;
  const byTaxId = new Map(input.relationships.map((r) => [taxIdKey(r.taxId), r]));
  let tagged = 0;
  for (const candidate of await deps.loadCandidates(input.batchId)) {
    const taxId = taxIdKey(candidate.taxIdentifier);
    const relationship = taxId ? byTaxId.get(taxId) : undefined;
    if (!relationship) continue;
    const metadata = candidate.metadata ?? {};
    const existing = metadata.relationship as { kind?: unknown } | undefined;
    if (existing && typeof existing === 'object' && existing.kind === 'supplier_of') continue;
    const ok = await deps.updateRelationship(candidate.id, {
      kind: 'supplier_of',
      reference_company_name: relationship.referenceName ?? input.referenceCompanyName.trim(),
      evidence_url: relationship.evidenceUrl,
      evidence: relationship.evidence,
      source: 'public_procurement',
    });
    if (ok) tagged += 1;
  }
  return tagged;
}

// ── «Proveedores frecuentes del Estado» (AGENT1-SUPPLIER-FREQUENT-PUBLIC-1) ──────────

/** Entidades distintas a las que tiene que venderle una empresa para ser «frecuente». */
export const FREQUENT_PUBLIC_MIN_BUYERS = 3;
/** El nombre del lote y de su referencia: no hay una empresa, hay varias entidades. */
export const FREQUENT_PUBLIC_REFERENCE_LABEL = 'el Estado';

export type FrequentPublicStepInput = {
  batchId: string;
  countryCode: string;
  /** Para la frase de la prueba («entidades públicas de México»). */
  countryName: string;
  macroIndustryKey: string;
  nowIso: string;
};

export type FrequentPublicStepDeps = Pick<
  PublicBuyerStepDeps,
  | 'sourceKey'
  | 'taxIdentifierType'
  | 'listPublicOnlyTaxIds'
  | 'findDomainsByTaxId'
  | 'findDomainsByName'
  | 'findKnownInCrm'
  | 'listAlreadyInSellUp'
  | 'writeWithWebsite'
  | 'recordWithoutWebsite'
> & {
  /** Empresas que le venden a `minBuyers` o más entidades, en la industria pedida (más entidades primero). */
  listFrequentSuppliers: (input: { macroIndustryKey: string; minBuyers: number }) => Promise<PublicBuyerSuppliersResult>;
};

/** Largo máximo de cada entidad dentro de «Proveedor de …». */
const BUYER_NAME_MAX_CHARS = 32;

/** Corta en una palabra completa y agrega «…» si no cabe. */
function shortEntityName(raw: string): string {
  // Tal como viene de la fuente: pasar a tipo título rompía siglas («IMSS» → «Imss»).
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length <= BUYER_NAME_MAX_CHARS) return name;
  const cut = name.slice(0, BUYER_NAME_MAX_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 12 ? cut.lastIndexOf(' ') : BUYER_NAME_MAX_CHARS).replace(/[\s,.;:]+$/, '')}…`;
}

/**
 * A quién le vende, para «Proveedor de …»: el número y las DOS de más monto, cortas
 * (Prod 22-10, dueña: tres nombres completos y «y 26 más» no se leían).
 * «29 entidades públicas (Banco Nacional del Ejército…, Centro de Investigación y…)».
 */
export function describeFrequentBuyers(supplier: PublicBuyerSupplier, countryName: string): string {
  const names = (supplier.topBuyerNames ?? []).map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 2);
  const count = Math.max(supplier.buyerCount ?? 0, names.length);
  if (names.length === 0) return `${count} entidades públicas de ${countryName}`;
  if (count === 1) return shortEntityName(names[0]);
  return `${count} entidades públicas (${names.map(shortEntityName).join(', ')})`;
}

/** La frase que el vendedor ve en «Por qué fue encontrado». */
export function describeFrequentPublicSupplier(supplier: PublicBuyerSupplier, countryName: string, sinceYear: string): string {
  const entities = `${supplier.buyerCount ?? 0} entidades públicas de ${countryName}`;
  const contracts = supplier.contractCount === 1 ? '1 contrato' : `${supplier.contractCount} contratos`;
  const amount =
    supplier.totalAmount >= 1_000_000
      ? `$${MILLIONS.format(Math.round(supplier.totalAmount / 1_000_000))} millones`
      : `$${MILLIONS.format(Math.round(supplier.totalAmount))}`;
  const rubro = supplier.rubro ? ` (${supplier.rubro.toLowerCase()})` : '';
  const top = (supplier.topBuyerNames ?? []).map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const among = top.length > 0 ? `, entre ellas ${top.join(', ')}` : '';
  return `Le vende a ${entities}${among}: ${contracts}${rubro} en compras públicas desde ${sinceYear} por ${amount}.`;
}

/**
 * Sin empresa de referencia: empresas que le venden a VARIAS entidades públicas del país
 * en la industria pedida. Son empresas medianas o grandes, con contratos como prueba, y
 * gratis. Mismo camino que el paso de una entidad (filtros, 12 como mucho, web, rescate).
 */
export async function runFrequentPublicSupplierStep(
  input: FrequentPublicStepInput,
  deps: FrequentPublicStepDeps,
): Promise<PublicBuyerStepOutcome> {
  const listed = await deps.listFrequentSuppliers({
    macroIndustryKey: input.macroIndustryKey,
    minBuyers: FREQUENT_PUBLIC_MIN_BUYERS,
  });
  if (!listed.ok) return { executed: false, reason: listed.reason };
  if (listed.suppliers.length === 0) return { executed: false, reason: 'no_frequent_suppliers' };
  const sinceYear = listed.sinceYear ?? String(Number(input.nowIso.slice(0, 4)) - 2);
  const offered = await offerPublicSuppliers(listed, input, deps, (s) => ({
    evidence: describeFrequentPublicSupplier(s, input.countryName, sinceYear),
    referenceName: describeFrequentBuyers(s, input.countryName),
  }));
  return {
    executed: true,
    scope: 'frequent_public',
    buyer: { taxId: 'frequent_public', name: FREQUENT_PUBLIC_REFERENCE_LABEL, matchedBy: 'exact' },
    ...offered,
  };
}

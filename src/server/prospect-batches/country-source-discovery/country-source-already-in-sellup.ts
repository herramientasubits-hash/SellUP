/**
 * country-source-already-in-sellup.ts — lo que SellUp YA tiene de la capa gratuita
 * (SOURCES-FREE-LAYER-ALREADY-SEEN-1).
 *
 * Prod 06-10: la lectura de cada fuente es determinista (mismo orden), así que la
 * 2.ª corrida del mismo país × industria vuelve a proponer las mismas empresas.
 * El detector canónico de duplicados sólo mira `accounts` + HubSpot, no los
 * candidatos de otros lotes ni Descartadas: en México AXTEL, BICENTEL, CELULAR DE
 * TELEFONIA y TV CABLE DEL GUADIANA quedaron TRES veces en revisión. (Argentina lo
 * resolvió sólo para su fuente en #611; esto lo cubre para todas.)
 *
 * Se salta una empresa de la fuente cuando SellUp ya la tiene:
 *   · como candidata VIVA (en revisión, aprobada…) de cualquier lote, por número
 *     fiscal o por el mismo registro de la fuente (`source_trace.sourceRecordId`);
 *   · en Descartadas (`prospect_discarded_dispositions`, descartada o ya enviada a
 *     revisión) por el mismo identificador (`tax:<id>` o el del registro).
 *   · SOURCES-FREE-LAYER-ACTIVE-DOMAIN-1 — como candidata VIVA del MISMO país con
 *     la misma web canónica (sin `www.`, protocolo ni ruta). Prod 06-10, Colombia:
 *     8 de 22 empresas del buscador gratuito (Fiscalía, Contraloría, Experian,
 *     SoftwareOne…) ya estaban en revisión desde Lusha o la búsqueda web, sin
 *     número fiscal y con «www.fiscalia.gov.co»: ni el número ni el registro las
 *     veían. Otro país con la misma web es otra sociedad (SoftwareOne RD ≠ CO).
 * Una candidata DESCARTADA (p. ej. por ser de otra industria) NO bloquea: el
 * descarte histórico no es una lista negra perpetua (§ 9).
 *
 * Un descarte de Descartadas SÓLO por falta de web (`missing_domain_final`) que
 * nadie cerró (el rescate de Claude no decidió `discard` ni `duplicate`) bloquea
 * únicamente mientras la empresa siga sin dominio: si la fuente ahora lo trae, la
 * empresa vuelve (Prod 06-10, Argentina: Telecom Argentina, descartada sin web y
 * aceptada después con el dominio del SIPRO; RD pasará igual con la DGCP).
 *
 * Puro: la lectura se inyecta. Nunca lanza (fail-open: sin lectura no se salta nada).
 */

import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import type { CountrySourceCompany } from './country-source-types';

/** Web canónica de una empresa de la fuente (sin `www.`), o `null`. */
export function canonicalCompanyDomain(company: Pick<CountrySourceCompany, 'domain'>): string | null {
  return company.domain ? normalizeDomain(company.domain) : null;
}

/** Las claves de identidad con las que SellUp guarda una empresa de la fuente. */
export function sellupKeysOf(company: CountrySourceCompany): string[] {
  const keys = [company.recordIdentityKey];
  if (company.taxId) keys.push(`tax:${company.taxId}`);
  // Fuentes por número fiscal (co_siis, DGII…) ya usan `tax:<id>` como registro.
  return [...new Set(keys)];
}

export type AlreadyInSellup = {
  /** Claves que SellUp ya tiene y que bloquean siempre. */
  blocked: ReadonlySet<string>;
  /** Claves descartadas sólo por falta de web: bloquean mientras no haya dominio. */
  blockedUnlessDomain: ReadonlySet<string>;
  /** Webs canónicas de candidatas VIVAS del mismo país: bloquean siempre. */
  blockedDomains?: ReadonlySet<string>;
};

/** READ-ONLY: devuelve las claves que SellUp ya tiene. */
export type FindAlreadyInSellup = (input: {
  countryCode: string;
  taxIds: readonly string[];
  recordIdentityKeys: readonly string[];
  /** Webs canónicas (sin `www.`) de las empresas leídas. */
  domains?: readonly string[];
}) => Promise<AlreadyInSellup>;

export async function splitAlreadyInSellup(
  companies: readonly CountrySourceCompany[],
  countryCode: string,
  find: FindAlreadyInSellup | null | undefined,
): Promise<{ fresh: CountrySourceCompany[]; alreadyInSellup: number }> {
  if (!find || companies.length === 0) return { fresh: [...companies], alreadyInSellup: 0 };
  let seen: AlreadyInSellup;
  try {
    seen = await find({
      countryCode,
      taxIds: [...new Set(companies.map((c) => c.taxId).filter((id): id is string => Boolean(id)))],
      recordIdentityKeys: [...new Set(companies.map((c) => c.recordIdentityKey))],
      domains: [...new Set(companies.map(canonicalCompanyDomain).filter((d): d is string => d !== null))],
    });
  } catch {
    return { fresh: [...companies], alreadyInSellup: 0 };
  }
  const fresh = companies.filter((company) => {
    const keys = sellupKeysOf(company);
    if (keys.some((key) => seen.blocked.has(key))) return false;
    if (!company.domain && keys.some((key) => seen.blockedUnlessDomain.has(key))) return false;
    const domain = canonicalCompanyDomain(company);
    if (domain !== null && seen.blockedDomains?.has(domain)) return false;
    return true;
  });
  return { fresh, alreadyInSellup: companies.length - fresh.length };
}

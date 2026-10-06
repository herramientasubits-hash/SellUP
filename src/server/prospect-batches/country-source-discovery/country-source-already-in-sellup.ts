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

import type { CountrySourceCompany } from './country-source-types';

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
};

/** READ-ONLY: devuelve las claves que SellUp ya tiene. */
export type FindAlreadyInSellup = (input: {
  countryCode: string;
  taxIds: readonly string[];
  recordIdentityKeys: readonly string[];
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
    });
  } catch {
    return { fresh: [...companies], alreadyInSellup: 0 };
  }
  const fresh = companies.filter((company) => {
    const keys = sellupKeysOf(company);
    if (keys.some((key) => seen.blocked.has(key))) return false;
    if (!company.domain && keys.some((key) => seen.blockedUnlessDomain.has(key))) return false;
    return true;
  });
  return { fresh, alreadyInSellup: companies.length - fresh.length };
}

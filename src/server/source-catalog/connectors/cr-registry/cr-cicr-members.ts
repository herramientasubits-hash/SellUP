/**
 * cr-cicr-members.ts — la web de los socios de la Cámara de Industrias de Costa Rica
 * (CICR), cruzada con el registro de cédulas.
 *
 * SOURCES-CR-CICR-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * CICR publica en https://cicr.com/asociados/ el nombre, la web y la actividad de
 * sus socios, pero no la cédula. Aquí cada socio se cruza POR NOMBRE con el registro
 * (`cr_company_registry`) y, si encuentra UNA sola cédula, su web pasa a la carga
 * como alias `web:<dominio>`: la candidata de la corrida con esa web encuentra la
 * cédula aunque su nombre comercial no sea la razón social.
 *
 * No crea empresas ni toca la clasificación por industria (la tabla de Costa Rica
 * es decisión de producto): sólo enriquece cédulas que el registro ya conoce.
 *
 * Quedan FUERA: personas físicas (el nombre no termina en forma societaria), socios
 * sin web propia y los nombres que apuntan a más de una cédula.
 */

import { costaRicaCandidateNameVariants, endsWithCostaRicaLegalForm } from './cr-name-keys';
import { costaRicaWebAliasKey } from './cr-domain';

/** Un socio tal como lo escribe `extract-cr-cicr-members.py`. */
export type CrCicrMember = {
  name: string;
  domain: string | null;
  activity?: string | null;
  legal_form?: boolean;
};

export type CrCicrExclusion = 'not_company' | 'no_domain' | 'invalid_domain' | 'no_match' | 'ambiguous_name';

/** Un socio con la cédula única que le encontró el registro. */
export type CrCicrMatch = { cedula: string; member: CrCicrMember };

export type CrCicrMatchReport = {
  total: number;
  matched: number;
  excluded: Readonly<Record<CrCicrExclusion, number>>;
};

/** Variantes que identifican a la sociedad; la web del nombre («x.co.cr») no es un nombre. */
const MATCHING_ORIGINS: ReadonlySet<string> = new Set(['name', 'part', 'without_costa_rica', 'with_costa_rica']);

/**
 * Cédula → web de los socios de CICR que el registro conoce sin ambigüedad.
 * `registry` trae el núcleo normalizado del nombre de cada cédula.
 */
export function matchCrCicrMembers(
  members: readonly CrCicrMember[],
  registry: readonly { tax_id: string; normalized_legal_name: string }[],
): { websitesByCedula: ReadonlyMap<string, string>; matches: readonly CrCicrMatch[]; report: CrCicrMatchReport } {
  const cedulasByCore = new Map<string, Set<string>>();
  for (const row of registry) {
    cedulasByCore.set(row.normalized_legal_name, (cedulasByCore.get(row.normalized_legal_name) ?? new Set()).add(row.tax_id));
  }

  const excluded: Record<CrCicrExclusion, number> = {
    not_company: 0,
    no_domain: 0,
    invalid_domain: 0,
    no_match: 0,
    ambiguous_name: 0,
  };
  const webs = new Map<string, string>();
  const matches: CrCicrMatch[] = [];
  let matched = 0;

  for (const member of members) {
    if (member.legal_form === false && !endsWithCostaRicaLegalForm(member.name)) {
      excluded.not_company += 1;
      continue;
    }
    if (member.domain === null || member.domain.trim().length === 0) {
      excluded.no_domain += 1;
      continue;
    }
    const url = `https://${member.domain.trim().toLowerCase()}/`;
    if (costaRicaWebAliasKey(url) === null) {
      excluded.invalid_domain += 1;
      continue;
    }

    // La primera variante que encuentra algo decide; si encuentra varias cédulas, no se adivina.
    let owners: Set<string> | undefined;
    for (const variant of costaRicaCandidateNameVariants(member.name)) {
      if (!MATCHING_ORIGINS.has(variant.origin)) continue;
      owners = cedulasByCore.get(variant.core);
      if (owners !== undefined) break;
    }
    if (owners === undefined) {
      excluded.no_match += 1;
      continue;
    }
    if (owners.size !== 1) {
      excluded.ambiguous_name += 1;
      continue;
    }
    const cedula = [...owners][0];
    if (!webs.has(cedula)) {
      webs.set(cedula, url);
      matches.push({ cedula, member });
      matched += 1;
    }
  }

  return { websitesByCedula: webs, matches, report: { total: members.length, matched, excluded } };
}

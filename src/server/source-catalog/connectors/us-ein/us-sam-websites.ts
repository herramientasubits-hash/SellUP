/**
 * us-sam-websites.ts — la web oficial de las organizaciones del buscador gratuito
 * de Estados Unidos, tomada de su registro en SAM.gov.
 *
 * SOURCES-US-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Ni el IRS ni la SEC publican la web. SAM.gov (registro de proveedores del
 * Gobierno federal, extracto público de entidades activas) sí trae `entityURL`,
 * pero no el EIN: se cruza por el núcleo del nombre (razón social o DBA) y el
 * estado de la dirección física. Sólo cuando ese par apunta a UNA web.
 *
 * Una web, una organización: si la misma web encaja con varias filas (hospitales
 * de un mismo sistema de salud), se la queda la de mayor relevancia y las demás
 * siguen sin web («una empresa, un vendedor»).
 *
 * Del extracto sólo se usan el nombre, el DBA, el estado, la web y el UEI; nunca
 * los contactos (POC) que también trae.
 */

import { normalizeUsCompanyCore } from './us-ein-registry-rows';
import type { UsFreeDirectoryRow } from './us-free-directory-rows';
import { ipedsWebsiteDomain } from './us-free-directory-rows';

/** Hosts que no son la web de la organización (redes, constructores de páginas, correo gratuito). */
const NOT_A_COMPANY_WEB =
  /(^|\.)(facebook|linkedin|instagram|twitter|x|youtube|google|gmail|yahoo|hotmail|outlook|aol|icloud|wix|wixsite|squarespace|godaddysites|weebly|wordpress|blogspot|sam|usaspending)\.(com|net|org|gov|site)$/;

/** Registro de SAM acotado a lo que se usa. */
export type SamEntityWebRecord = {
  legalBusinessName: string | null;
  dbaName: string | null;
  state: string | null;
  entityUrl: string | null;
  uei: string | null;
};

/** Web de SAM → dominio útil, o `null` («null», redes sociales, correo gratuito…). */
export function samWebsiteDomain(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '' || value.toLowerCase() === 'null') return null;
  const domain = ipedsWebsiteDomain(value);
  return domain !== null && !NOT_A_COMPANY_WEB.test(domain) ? domain : null;
}

/** Clave de cruce: núcleo del nombre + estado. */
export function samWebKey(name: string | null | undefined, state: string | null | undefined): string | null {
  const core = normalizeUsCompanyCore(name);
  const region = state?.trim().toUpperCase() ?? '';
  return core.length >= 2 && /^[A-Z]{2}$/.test(region) ? `${core}|${region}` : null;
}

/** Índice (nombre + estado) → webs distintas y UEI, desde los registros de SAM. */
export type SamWebIndex = ReadonlyMap<string, { domains: ReadonlySet<string>; uei: string | null }>;

export function buildSamWebIndex(records: Iterable<SamEntityWebRecord>): SamWebIndex {
  const index = new Map<string, { domains: Set<string>; uei: string | null }>();
  for (const record of records) {
    const domain = samWebsiteDomain(record.entityUrl);
    if (domain === null) continue;
    for (const name of [record.legalBusinessName, record.dbaName]) {
      const key = samWebKey(name, record.state);
      if (key === null) continue;
      const entry = index.get(key) ?? { domains: new Set<string>(), uei: record.uei?.trim() || null };
      entry.domains.add(domain);
      index.set(key, entry);
    }
  }
  return index;
}

/**
 * Pone la web de SAM a las filas que aún no la tienen. Devuelve filas NUEVAS (no
 * modifica las recibidas) y cuántas ganaron web.
 */
export function attachSamWebsites(
  rows: readonly UsFreeDirectoryRow[],
  index: SamWebIndex,
): { rows: UsFreeDirectoryRow[]; attached: number } {
  // Candidata por fila: la web única de su par nombre + estado.
  const candidate = new Map<number, { domain: string; uei: string | null }>();
  const owners = new Map<string, number>();
  const taken = new Set(
    rows.map((row) => row.raw_data['website_domain']).filter((domain): domain is string => typeof domain === 'string'),
  );
  rows.forEach((row, position) => {
    if (typeof row.raw_data['website_domain'] === 'string') return;
    const key = samWebKey(row.legal_name, row.region);
    const entry = key !== null ? index.get(key) : undefined;
    if (entry === undefined || entry.domains.size !== 1) return;
    const domain = [...entry.domains][0]!;
    if (taken.has(domain)) return;
    candidate.set(position, { domain, uei: entry.uei });
    const owner = owners.get(domain);
    if (owner === undefined || rows[owner]!.priority_score < row.priority_score) owners.set(domain, position);
  });

  let attached = 0;
  const next = rows.map((row, position) => {
    const hit = candidate.get(position);
    if (hit === undefined || owners.get(hit.domain) !== position) return row;
    attached++;
    return {
      ...row,
      raw_data: { ...row.raw_data, website_domain: hit.domain, website_source: 'SAM.gov', sam_uei: hit.uei },
    };
  });
  return { rows: next, attached };
}

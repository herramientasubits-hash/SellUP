/**
 * ec-sercop-domain.ts — sitio web de una compañía ecuatoriana a partir de lo que
 * declaró en el Sistema Oficial de Contratación Pública (SERCOP, datos abiertos
 * OCDS, publicación 110 de data.open-contracting.org).
 *
 * SOURCES-EC-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué ─────────────────────────────────────────────────────────────────
 *
 * Ni el directorio de compañías ni el ranking de la Superintendencia publican
 * web, así que toda empresa del buscador gratuito de Ecuador llegaría sin dominio
 * y, por la regla #525, iría a «Descartadas» (lo que pasó en Argentina antes del
 * SIPRO). En SERCOP cada parte de un proceso trae `contactPoint.url` cuando la
 * empresa la registró.
 *
 * ── La regla: la MISMA que Argentina y República Dominicana ─────────────────
 *
 * `domainMatchesCompanyName` (do-dgcp-domain.ts): el dominio sólo vale si su
 * nombre se parece a la razón social (o a su sigla). Encima, aquí:
 *   · redes sociales, constructores de sitios y acortadores, nunca;
 *   · dominios de gobierno (gob.ec, gov.ec, mil.ec), nunca para una compañía;
 *   · un dominio que aparece en 3 o más RUC distintos no es de ninguno;
 *   · un RUC con dos dominios distintos que se parecen a su nombre: ninguno.
 *
 * Sólo se guarda el DOMINIO: nunca correo, teléfono ni dirección. El candidato
 * sigue pasando por revisión humana.
 */

import { domainMatchesCompanyName } from '../dgcp-rd/do-dgcp-domain';
import { registrableDomain } from '../rns-argentina/ar-sipro-domain';
import { ecCompanyNameAlias, normalizeEcCompanyCore } from './ec-company-name-core';

/** Origen que se guarda junto al dominio en `raw_data.website_domain_source`. */
export const EC_SERCOP_DOMAIN_SOURCE = 'sercop_ocds_contact_url' as const;

/** Un dominio en tantos RUC distintos o más no es de ninguno de ellos. */
export const EC_SERCOP_SHARED_DOMAIN_MIN_RUCS = 3;

/** Hosts que nunca son el sitio propio de una compañía. */
export const EC_NON_CORPORATE_HOSTS: ReadonlySet<string> = new Set([
  'facebook.com', 'faceboook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
  'youtube.com', 'tiktok.com', 'wa.me', 'whatsapp.com', 'google.com', 'sites.google.com', 'gmail.com',
  'hotmail.com', 'outlook.com', 'yahoo.com', 'blogspot.com', 'wordpress.com', 'wixsite.com', 'wix.com',
  'jimdo.com', 'weebly.com', 'bit.ly', 'linktr.ee', 'compraspublicas.gob.ec',
]);

const GOVERNMENT_DOMAIN = /\.(gob|gov|mil)\.ec$/;
const HOST_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** URL declarada → host sin «www.», o `null` si no parece un sitio. */
export function hostFromDeclaredUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const host = url
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .split(/[/?#:\s]/)[0]
    .replace(/^www\d?\./, '')
    .replace(/\.$/, '');
  return HOST_SHAPE.test(host) ? host : null;
}

/** ¿El host es (o cuelga de) uno que nunca es sitio propio? */
function isNonCorporate(host: string): boolean {
  if (GOVERNMENT_DOMAIN.test(host)) return true;
  for (const blocked of EC_NON_CORPORATE_HOSTS) {
    if (host === blocked || host.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

/** El dominio de una compañía a partir de las URL que declaró, o `null`. */
export function ecCorporateDomainFromUrls(input: {
  legalName: string;
  urls: readonly string[];
}): string | null {
  const names = [normalizeEcCompanyCore(input.legalName), ecCompanyNameAlias(input.legalName)].filter(
    (name): name is string => typeof name === 'string' && name.length >= 2,
  );
  if (names.length === 0) return null;
  const accepted = new Set<string>();
  for (const url of input.urls) {
    const host = hostFromDeclaredUrl(url);
    if (host === null || isNonCorporate(host)) continue;
    if (!names.some((name) => domainMatchesCompanyName(host, name))) continue;
    accepted.add(registrableDomain(host));
  }
  return accepted.size === 1 ? [...accepted][0] : null;
}

/** Una parte de un proceso de SERCOP: RUC, nombre y URL declarada. */
export type EcSercopPartyUrl = { ruc: string; name: string; url: string | null };

/** RUC del identificador OCDS de SERCOP: «EC-RUC-0990004196001-1016150». */
const SERCOP_PARTY_ID = /^EC-RUC-(\d{13})(?:-|$)/;

/** Partes de una entrega OCDS de SERCOP con RUC (pura; ignora lo que no entiende). */
export function readSercopPartyUrls(release: unknown): EcSercopPartyUrl[] {
  if (!release || typeof release !== 'object') return [];
  const parties = (release as Record<string, unknown>)['parties'];
  if (!Array.isArray(parties)) return [];
  const out: EcSercopPartyUrl[] = [];
  for (const party of parties) {
    if (!party || typeof party !== 'object') continue;
    const p = party as Record<string, unknown>;
    const match = typeof p['id'] === 'string' ? SERCOP_PARTY_ID.exec(p['id']) : null;
    if (match === null) continue;
    const contact = p['contactPoint'];
    const url =
      contact && typeof contact === 'object' && typeof (contact as Record<string, unknown>)['url'] === 'string'
        ? ((contact as Record<string, unknown>)['url'] as string)
        : null;
    out.push({ ruc: match[1], name: typeof p['name'] === 'string' ? p['name'] : '', url });
  }
  return out;
}

/**
 * RUC → dominio, a partir de todas las partes leídas de SERCOP. `legalNameOf`
 * da la razón social VIGENTE (la del directorio de la Superintendencia): el
 * dominio se compara con ella, no con el nombre que tenía en el proceso.
 */
export function buildEcSercopDomainMap(
  parties: Iterable<EcSercopPartyUrl>,
  legalNameOf: (ruc: string) => string | null,
): Map<string, string> {
  const urlsByRuc = new Map<string, Set<string>>();
  for (const party of parties) {
    if (!party.url) continue;
    const urls = urlsByRuc.get(party.ruc) ?? new Set<string>();
    urls.add(party.url);
    urlsByRuc.set(party.ruc, urls);
  }

  const byRuc = new Map<string, string>();
  for (const [ruc, urls] of urlsByRuc) {
    const legalName = legalNameOf(ruc);
    if (!legalName) continue;
    const domain = ecCorporateDomainFromUrls({ legalName, urls: [...urls] });
    if (domain !== null) byRuc.set(ruc, domain);
  }

  const rucsPerDomain = new Map<string, number>();
  for (const domain of byRuc.values()) rucsPerDomain.set(domain, (rucsPerDomain.get(domain) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const [ruc, domain] of byRuc) {
    if ((rucsPerDomain.get(domain) ?? 0) < EC_SERCOP_SHARED_DOMAIN_MIN_RUCS) out.set(ruc, domain);
  }
  return out;
}

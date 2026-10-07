/**
 * cr-domain.ts — dominios web de Costa Rica: el dominio registrable («.co.cr»,
 * «.go.cr», «.fi.cr»…) y la confirmación de un nombre de una sola palabra por la
 * web de la candidata.
 *
 * SOURCES-CR-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import {
  isNonCorporateDomain,
  normalizeWebsiteHost,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';

/**
 * Segundos niveles de «.cr» (NIC Costa Rica): comercial, gobierno, financiero,
 * académico, salud, educación y organizaciones.
 */
const SECOND_LEVEL: ReadonlySet<string> = new Set(['co', 'go', 'fi', 'ac', 'sa', 'ed', 'or', 'com', 'net', 'org']);

/** Dominios del Estado costarricense y de sus entes: gobierno, salud pública, financiero. */
const CR_PUBLIC_SECTOR_DOMAIN = /(^|\.)(go|sa|fi)\.cr$/;

/** El dominio registrable: «www.ice.go.cr» → «ice.go.cr», «a.purdy.co.cr» → «purdy.co.cr». */
export function registrableCostaRicaDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  const keep =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** ¿Dominio del Estado costarricense («.go.cr», «.sa.cr», «.fi.cr»)? */
export function isCostaRicaPublicSectorDomain(domain: string | null | undefined): boolean {
  return typeof domain === 'string' && CR_PUBLIC_SECTOR_DOMAIN.test(domain.toLowerCase());
}

const compact = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ¿La web de la candidata confirma un nombre de UNA palabra? Sólo si la etiqueta
 * propia del dominio es exactamente esa palabra («ccss.sa.cr» ↔ CCSS,
 * «purdy.co.cr» ↔ PURDY). Un dominio del Estado sólo confirma a una entidad pública.
 */
export function costaRicaSingleWordConfirmedByDomain(
  domain: string | null,
  core: string,
  options: { publicEntity: boolean },
): boolean {
  const host = normalizeWebsiteHost(domain);
  if (host === null || isNonCorporateDomain(registrableCostaRicaDomain(host)) || isNonCorporateDomain(host)) return false;
  if (isCostaRicaPublicSectorDomain(host) && !options.publicEntity) return false;
  const label = compact(registrableCostaRicaDomain(host).split('.')[0] ?? '');
  const word = compact(core);
  return word.length >= 3 && label === word;
}

/** Prefijo de la clave de alias por web (nunca choca con un núcleo de nombre: lleva «:» y «.»). */
export const CR_WEB_ALIAS_PREFIX = 'web:' as const;

/**
 * Clave de alias por la web OFICIAL de una entidad pública («https://www.tec.ac.cr/»
 * → «web:tec.ac.cr»), o `null` si no es un dominio propio (red social, correo
 * gratuito, un segundo nivel suelto como «go.cr»).
 */
export function costaRicaWebAliasKey(url: string | null | undefined): string | null {
  const host = normalizeWebsiteHost(url ?? null);
  if (host === null) return null;
  const domain = registrableCostaRicaDomain(host);
  const label = domain.split('.')[0] ?? '';
  if (label.length < 2 || SECOND_LEVEL.has(label) || label === 'cr') return null;
  if (isNonCorporateDomain(domain) || isNonCorporateDomain(host)) return null;
  if (/^(facebook|instagram|twitter|x|google|youtube|linkedin|wix|wordpress|blogspot)\./.test(domain)) return null;
  return `${CR_WEB_ALIAS_PREFIX}${domain}`;
}

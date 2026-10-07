/**
 * py-domain.ts — dominios web de Paraguay: el host comparable de la web que publica
 * una fuente y el dominio del correo de contacto, sin correos gratuitos ni de
 * proveedores de internet.
 *
 * SOURCES-PY-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import {
  emailDomain,
  isNonCorporateDomain,
  normalizeWebsiteHost,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';

/**
 * Correo de proveedores de internet y telefonía de Paraguay: el cliente usa el
 * dominio del proveedor, que no es el de su empresa.
 */
export const PY_NON_CORPORATE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'tigo.com.py', 'personal.com.py', 'claro.com.py', 'copaco.com.py', 'rieder.net.py', 'click.com.py',
  'highway.com.py', 'conexion.com.py', 'uninet.com.py', 'telesurf.com.py', 'pla.net.py', 'quanta.com.py',
  'cmm.com.py', 'tvd.com.py', 'chaconet.com.py', 'vox.com.py', 'hotmail.com.py', 'yahoo.com.py',
  'outlook.com.py', 'gmail.com.py', 'live.com.py', 'hotmail.com.ar', 'yahoo.com.ar', 'hotmail.com.br',
]);

/** Dominios del Estado paraguayo (`.gov.py`, `.mil.py`). */
const PY_PUBLIC_SECTOR_DOMAIN = /(^|\.)(gov|mil)\.py$/;

const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gov', 'mil', 'coop', 'una', 'int']);

/** El dominio registrable: «www.dnit.gov.py» → «dnit.gov.py», «a.konecta.com.py» → «konecta.com.py». */
export function registrableParaguayDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  const keep =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** ¿Dominio del Estado paraguayo? */
export function isParaguayPublicSectorDomain(domain: string | null | undefined): boolean {
  return typeof domain === 'string' && PY_PUBLIC_SECTOR_DOMAIN.test(domain.toLowerCase());
}

/**
 * Un host armado con dos direcciones pegadas («www.x.com.py.http://www.google.com»
 * llega como «x.com.py.http»): no es un dominio.
 */
function isGluedUrl(host: string): boolean {
  return /\.(https?|www)(\.|$)/.test(host);
}

/** Correo gratuito (gmail, hotmail…): nunca es la web de una empresa. */
function isFreeMailDomain(host: string): boolean {
  return isNonCorporateDomain(registrableParaguayDomain(host)) || isNonCorporateDomain(host);
}

/**
 * Además, en un CORREO, el dominio de un proveedor de internet es del proveedor,
 * no del cliente («x@tigo.com.py»). Como web declarada sí vale: «copaco.com.py»
 * es la web de COPACO.
 */
function isPersonalOrProviderEmailDomain(host: string): boolean {
  return isFreeMailDomain(host) || PY_NON_CORPORATE_EMAIL_DOMAINS.has(registrableParaguayDomain(host));
}

/**
 * La web de una empresa a partir de lo que publica la fuente: primero la web
 * declarada; si no hay, el dominio del correo cuando es corporativo. `null` si
 * sólo hay un correo gratuito o de un proveedor de internet.
 */
export function paraguayCompanyDomain(input: {
  url?: string | null;
  email?: string | null;
}): { domain: string; origin: 'url' | 'email' } | null {
  const fromUrl = normalizeWebsiteHost(input.url ?? null);
  if (fromUrl !== null && !isGluedUrl(fromUrl) && !isFreeMailDomain(fromUrl)) {
    return { domain: registrableParaguayDomain(fromUrl), origin: 'url' };
  }
  const fromEmail = emailDomain(input.email ?? null);
  if (fromEmail !== null && !isPersonalOrProviderEmailDomain(fromEmail)) {
    return { domain: registrableParaguayDomain(fromEmail), origin: 'email' };
  }
  return null;
}

const compact = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ¿La web de la candidata confirma un nombre de UNA palabra? Sólo si la etiqueta
 * propia del dominio es exactamente esa palabra («bancard.com.py» ↔ BANCARD,
 * «ande.gov.py» ↔ ANDE). Un dominio del Estado sólo confirma a una entidad pública.
 */
export function paraguaySingleWordConfirmedByDomain(
  domain: string | null,
  core: string,
  options: { publicEntity: boolean },
): boolean {
  const host = normalizeWebsiteHost(domain);
  if (host === null || isFreeMailDomain(host)) return false;
  if (isParaguayPublicSectorDomain(host) && !options.publicEntity) return false;
  const label = compact(registrableParaguayDomain(host).split('.')[0] ?? '');
  const word = compact(core);
  return word.length >= 3 && label === word;
}

/**
 * co-domain.ts — dominios web en las fuentes oficiales de Colombia.
 *
 * SOURCES-CO-CLOSE-1. Las fuentes publican la web de muchas formas
 * («WWW.POSTOBON.COM», «http://www.hci.gov.co», «https://x.gov.co/inicio») y el
 * correo de contacto («NOTIFICACIONES@AB-INBEV.COM»). Aquí se reducen al host
 * comparable y se descartan los correos gratuitos y de proveedores de internet,
 * que no son de ninguna empresa.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

/** Correo gratuito y de proveedores de internet (Colombia y genéricos). */
export const CO_NON_CORPORATE_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'gmail.es', 'hotmail.com', 'hotmail.es', 'hotmail.co', 'hotmail.com.co',
  'outlook.com', 'outlook.es', 'outlook.com.co', 'live.com', 'live.com.co', 'msn.com',
  'yahoo.com', 'yahoo.es', 'yahoo.com.co', 'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mail.com',
  'protonmail.com', 'proton.me', 'zoho.com',
  'une.net.co', 'etb.net.co', 'emcali.net.co', 'telecom.com.co', 'epm.net.co', 'cable.net.co',
  'colomsat.net.co', 'latinmail.com', 'starmedia.com', 'telmex.net.co', 'claro.net.co', 'tigo.net.co',
  'unete.com', 'andinet.com',
]);

/** Dominios del Estado colombiano: una empresa privada nunca se identifica con uno. */
const CO_PUBLIC_SECTOR_DOMAIN = /(^|\.)(gov|mil)\.co$/;

/** Dominios de instituciones educativas (públicas y privadas). */
const CO_EDUCATION_DOMAIN = /(^|\.)edu\.co$/;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** Web tal como la publica la fuente → host sin «www.», o `null`. */
export function normalizeWebsiteHost(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim().toLowerCase();
  if (text === '' || text.includes('@') || text.includes(' ')) return null;
  text = text.replace(/^[a-z]+:\/\//, '');
  const host = (text.split(/[/?#:]/)[0] ?? '').replace(/^www\d?\./, '').replace(/\.$/, '');
  return DOMAIN_SHAPE.test(host) ? host : null;
}

/** Dominio de un correo («ventas@x.com.co»), o `null`. */
export function emailDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const match = /@([a-z0-9.-]+)/i.exec(raw.trim());
  return match ? normalizeWebsiteHost(match[1]) : null;
}

/** ¿Es un correo gratuito o de un proveedor de internet? */
export function isNonCorporateDomain(domain: string): boolean {
  return CO_NON_CORPORATE_DOMAINS.has(domain.toLowerCase());
}

/** ¿Dominio del Estado (`.gov.co`, `.mil.co`)? */
export function isColombianPublicSectorDomain(domain: string | null | undefined): boolean {
  return typeof domain === 'string' && CO_PUBLIC_SECTOR_DOMAIN.test(domain.toLowerCase());
}

/** ¿Dominio institucional (`.gov.co`, `.mil.co`, `.edu.co`)? */
export function isColombianInstitutionalDomain(domain: string | null | undefined): boolean {
  return (
    typeof domain === 'string' &&
    (CO_PUBLIC_SECTOR_DOMAIN.test(domain.toLowerCase()) || CO_EDUCATION_DOMAIN.test(domain.toLowerCase()))
  );
}

/** Segundo nivel genérico bajo un dominio de país («com.co», «gov.co»…). */
const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gov', 'mil', 'nom', 'int']);

/** El dominio registrable: «sed.narino.gov.co» → «narino.gov.co». */
export function registrableCoDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  const keep =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/**
 * Las formas de un host con las que se busca en las fuentes: él mismo y su
 * dominio registrable («www.sed.narino.gov.co» → [«sed.narino.gov.co»,
 * «narino.gov.co»]). Sin duplicados.
 */
export function coDomainLookupKeys(raw: string | null | undefined): string[] {
  const host = normalizeWebsiteHost(raw);
  if (host === null) return [];
  return [...new Set([host, registrableCoDomain(host)])];
}

const compact = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ¿La web de la candidata confirma una marca de UNA palabra? Sólo si la etiqueta
 * propia del dominio es exactamente esa palabra («koombea.com» ↔ KOOMBEA) y el
 * dominio no es institucional: «supersalud.gov.co» nunca confirma a la empresa
 * privada «SUPERSALUD S.A.».
 */
export function coSingleWordConfirmedByDomain(domain: string | null, core: string): boolean {
  const host = normalizeWebsiteHost(domain);
  if (host === null || isColombianInstitutionalDomain(host) || isNonCorporateDomain(host)) return false;
  const label = compact(registrableCoDomain(host).split('.')[0] ?? '');
  const word = compact(core);
  return word.length >= 3 && label === word;
}

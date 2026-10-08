/**
 * ni-domain.ts — dominios web de Nicaragua: la web publicada por la fuente (CONAMI,
 * entidades públicas) o el DOMINIO de los correos corporativos del directorio de
 * Zonas Francas (el correo, el contacto y el teléfono nunca se guardan), sin
 * correos gratuitos ni de proveedores de internet, y la confirmación de un nombre de
 * UNA palabra por la web de la candidata.
 *
 * SOURCES-NI-CLOSE-2. Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import {
  emailDomain,
  isNonCorporateDomain,
  normalizeWebsiteHost,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';

/** Proveedores de internet de Nicaragua (el dominio es del proveedor, no de la empresa). */
export const NI_NON_CORPORATE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'ibw.com.ni', 'turbonett.com.ni', 'cablenet.com.ni', 'yota.com.ni', 'latinmail.com', 'yopmail.com',
]);

/** Primer nivel del dominio de los correos gratuitos, con cualquier terminación. */
const FREE_MAIL_LABEL = /^(gmail|gmaill|googlemail|hotmail|outlook|live|msn|yahoo|ymail|aol|icloud|me|mail|protonmail|proton|zoho|gmx)$/;

/**
 * Redes sociales, enlaces y alojamiento gratuito: la «web» es de la plataforma, no de
 * la empresa («facebook.com/CrediFacilNic», «x.wixsite.com», «sites.google.com/…»).
 */
const PLATFORM_HOST =
  /(^|\.)(facebook|fb|instagram|twitter|x|tiktok|youtube|youtu|linkedin|whatsapp|wa|linktr|google|goo|blogspot|blogger|wordpress|wixsite|wix|weebly|jimdo|jimdofree|site123|webnode|godaddysites|carrd|bit|tinyurl)\.[a-z.]+$/;

/** ¿Host de una red social o de un alojamiento gratuito? */
export function isNicaraguaPlatformHost(host: string): boolean {
  const lower = host.toLowerCase();
  return PLATFORM_HOST.test(lower) || /(^|\.)(linktr\.ee|wa\.me|bit\.ly|business\.site|negocio\.site)$/.test(lower);
}

/** Dominios del Estado de Nicaragua (`.gob.ni`, `.mil.ni`). */
const NI_PUBLIC_SECTOR_DOMAIN = /(^|\.)(gob|mil)\.ni$/;

const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gob', 'mil', 'co', 'nom', 'in', 'ac', 'biz', 'info']);

/** El dominio registrable: «ventas.casapellas.com.ni» → «casapellas.com.ni», «ni.hansae.com» → «hansae.com». */
export function registrableNicaraguaDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  const keep =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** ¿Dominio del Estado nicaragüense? */
export function isNicaraguaPublicSectorDomain(domain: string | null | undefined): boolean {
  return typeof domain === 'string' && NI_PUBLIC_SECTOR_DOMAIN.test(domain.toLowerCase());
}

/** ¿Correo gratuito o de un proveedor de internet? */
export function isNicaraguaPersonalEmailDomain(host: string): boolean {
  const registrable = registrableNicaraguaDomain(host);
  const label = registrable.split('.')[0] ?? '';
  return (
    isNonCorporateDomain(registrable) ||
    isNonCorporateDomain(host) ||
    FREE_MAIL_LABEL.test(label) ||
    NI_NON_CORPORATE_EMAIL_DOMAINS.has(registrable) ||
    !registrable.includes('.')
  );
}

/**
 * La web de una empresa a partir de una web publicada o del dominio de un correo:
 * `null` si es un correo personal o un dominio del Estado (una empresa privada no
 * tiene web `.gob.ni`). Acepta un correo, una URL o sólo el dominio.
 */
export function nicaraguaCompanyDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const host = raw.includes('@') ? emailDomain(raw) : normalizeWebsiteHost(raw);
  if (host === null || isNicaraguaPersonalEmailDomain(host) || isNicaraguaPublicSectorDomain(host)) return null;
  if (isNicaraguaPlatformHost(host)) return null;
  return registrableNicaraguaDomain(host);
}

const compact = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ¿La web de la candidata confirma un nombre de UNA palabra? Sólo si la etiqueta
 * propia del dominio es exactamente esa palabra («cemex.com.ni» ↔ CEMEX). Un
 * dominio del Estado sólo confirma a una entidad pública.
 */
export function nicaraguaSingleWordConfirmedByDomain(
  domain: string | null,
  word: string,
  options: { publicEntity: boolean },
): boolean {
  const host = normalizeWebsiteHost(domain);
  if (host === null || isNicaraguaPersonalEmailDomain(host)) return false;
  if (isNicaraguaPublicSectorDomain(host) && !options.publicEntity) return false;
  const label = compact(registrableNicaraguaDomain(host).split('.')[0] ?? '');
  const target = compact(word);
  return target.length >= 3 && label === target;
}

/**
 * ve-domain.ts — dominios web de Venezuela: la web que publica la fuente (Bolsa de
 * Caracas, Wikidata, entes públicos) o el DOMINIO de los correos corporativos de la
 * Bolsa (el correo y el contacto nunca se guardan), sin correos gratuitos ni de
 * proveedores de internet, y la confirmación de un nombre de UNA palabra por la web
 * de la candidata.
 *
 * SOURCES-VE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import {
  emailDomain,
  isNonCorporateDomain,
  normalizeWebsiteHost,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';
import { isPlatformHostByLabel } from '@/server/agents/prospecting-toolkit/shared-hosts';

/** Proveedores de internet de Venezuela (el dominio es del proveedor, no de la empresa). */
export const VE_NON_CORPORATE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'cantv.net', 'cantv.com.ve', 'movistar.net.ve', 'inter.net.ve', 'supercable.net.ve', 'netuno.net', 'telcel.net.ve', 'cvg.net.ve',
]);

/** Primer nivel del dominio de los correos gratuitos, con cualquier terminación. */
const FREE_MAIL_LABEL = /^(gmail|gmaill|googlemail|hotmail|outlook|live|msn|yahoo|ymail|aol|icloud|me|mail|protonmail|proton|zoho|gmx|cantv)$/;

/**
 * ¿Host de una red social o de un alojamiento gratuito? La lista vive en UN solo
 * sitio (`shared-hosts.ts`, AGENT1-SHARED-HOSTS-1): antes era una copia local que
 * ya se había separado de la de Nicaragua y de la de Ecuador.
 */
export function isVenezuelaPlatformHost(host: string): boolean {
  return isPlatformHostByLabel(host);
}

/** Dominios del Estado de Venezuela (`.gob.ve`, `.mil.ve`). */
const VE_PUBLIC_SECTOR_DOMAIN = /(^|\.)(gob|mil)\.ve$/;

const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gob', 'mil', 'co', 'info', 'web', 'tec', 'int', 'nom', 'bib', 'arts', 'firm', 'rec', 'store']);

/** El dominio registrable: «www.bancaribe.com.ve» → «bancaribe.com.ve», «ve.ambafrance.org» → «ambafrance.org». */
export function registrableVenezuelaDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  const keep =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** ¿Dominio del Estado venezolano? */
export function isVenezuelaPublicSectorDomain(domain: string | null | undefined): boolean {
  return typeof domain === 'string' && VE_PUBLIC_SECTOR_DOMAIN.test(domain.toLowerCase());
}

/** ¿Correo gratuito o de un proveedor de internet? */
export function isVenezuelaPersonalEmailDomain(host: string): boolean {
  const registrable = registrableVenezuelaDomain(host);
  const label = registrable.split('.')[0] ?? '';
  return (
    isNonCorporateDomain(registrable) ||
    isNonCorporateDomain(host) ||
    FREE_MAIL_LABEL.test(label) ||
    VE_NON_CORPORATE_EMAIL_DOMAINS.has(registrable) ||
    !registrable.includes('.')
  );
}

/**
 * La web de una EMPRESA a partir de una web publicada o del dominio de un correo:
 * `null` si es un correo personal, una plataforma o un dominio del Estado (una empresa
 * privada no tiene web `.gob.ve`). Acepta un correo, una URL o sólo el dominio.
 */
export function venezuelaCompanyDomain(raw: string | null | undefined): string | null {
  const host = venezuelaHost(raw);
  if (host === null || isVenezuelaPublicSectorDomain(host)) return null;
  return registrableVenezuelaDomain(host);
}

/**
 * La web de un ENTE PÚBLICO: el dominio `.gob.ve` se guarda entero (cada ente tiene
 * su subdominio o su dominio propio; «www.» fuera); un dominio propio (`ucv.ve`,
 * `cantv.com.ve`) se guarda registrable.
 */
export function venezuelaPublicEntityDomain(raw: string | null | undefined): string | null {
  const host = venezuelaHost(raw);
  if (host === null) return null;
  return isVenezuelaPublicSectorDomain(host) ? host.replace(/^www\d?\./, '') : registrableVenezuelaDomain(host);
}

function venezuelaHost(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const host = raw.includes('@') ? emailDomain(raw) : normalizeWebsiteHost(raw);
  if (host === null || isVenezuelaPersonalEmailDomain(host) || isVenezuelaPlatformHost(host)) return null;
  return host.toLowerCase();
}

const compact = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ¿La web de la candidata confirma un nombre de UNA palabra? Sólo si la etiqueta
 * propia del dominio es exactamente esa palabra («digitel.com.ve» ↔ DIGITEL). Un
 * dominio del Estado sólo confirma a una entidad pública.
 */
export function venezuelaSingleWordConfirmedByDomain(
  domain: string | null,
  word: string,
  options: { publicEntity: boolean },
): boolean {
  const host = normalizeWebsiteHost(domain);
  if (host === null || isVenezuelaPersonalEmailDomain(host)) return false;
  if (isVenezuelaPublicSectorDomain(host) && !options.publicEntity) return false;
  const label = compact(registrableVenezuelaDomain(host).split('.')[0] ?? '');
  const target = compact(word);
  return target.length >= 3 && label === target;
}

/**
 * uy-domain.ts — dominios web de Uruguay: la web de una entidad pública desde el
 * correo institucional que publica la UAIP, el dominio registrable, los correos que
 * nunca son la web de una empresa y la confirmación de un nombre de UNA palabra por
 * la web de la candidata.
 *
 * SOURCES-UY-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj. Misma regla que
 * Honduras (`hn-domain.ts`) y el rescate (#640): la web de una entidad del Estado
 * sólo vale si su dirección la NOMBRA (sigla, iniciales o una palabra distintiva).
 */

import {
  emailDomain,
  isNonCorporateDomain,
  normalizeWebsiteHost,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';

/** Proveedores de internet y de correo de Uruguay (el dominio no es de la empresa). */
export const UY_NON_CORPORATE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'adinet.com.uy', 'montevideo.com.uy', 'internet.com.uy', 'netgate.com.uy', 'vera.com.uy', 'anteldata.net.uy',
  'antel.net.uy', 'dedicado.net.uy', 'chasque.net', 'chasque.apc.org', 'movinet.com.uy', 'hotmail.com.uy',
  'yahoo.com.uy', 'outlook.com.uy', 'gmail.com.uy', 'hotmail.com.ar', 'yahoo.com.ar',
]);

/** Primer nivel del dominio de los correos gratuitos, con cualquier terminación. */
const FREE_MAIL_LABEL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|aol|icloud|me|mail|protonmail|proton|zoho|gmx)$/;

/** Dominios del Estado uruguayo (`.gub.uy`, `.mil.uy`). */
const UY_PUBLIC_SECTOR_DOMAIN = /(^|\.)(gub|mil)\.uy$/;

const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gub', 'mil']);

/** El dominio registrable: «www.ute.com.uy» → «ute.com.uy», «a.b.com» → «b.com». */
export function registrableUruguayDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  const keep =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** ¿Dominio del Estado uruguayo? */
export function isUruguayPublicSectorDomain(domain: string | null | undefined): boolean {
  return typeof domain === 'string' && UY_PUBLIC_SECTOR_DOMAIN.test(domain.toLowerCase());
}

/** ¿Correo gratuito o de un proveedor de internet? */
export function isUruguayPersonalEmailDomain(host: string): boolean {
  const registrable = registrableUruguayDomain(host);
  const label = registrable.split('.')[0] ?? '';
  return (
    isNonCorporateDomain(registrable) ||
    isNonCorporateDomain(host) ||
    FREE_MAIL_LABEL.test(label) ||
    UY_NON_CORPORATE_EMAIL_DOMAINS.has(registrable) ||
    UY_NON_CORPORATE_EMAIL_DOMAINS.has(host) ||
    !registrable.includes('.')
  );
}

/** Palabras que no distinguen a una entidad pública de otra. */
const GENERIC_ENTITY_WORDS: ReadonlySet<string> = new Set([
  'INTENDENCIA', 'DEPARTAMENTAL', 'MUNICIPIO', 'MINISTERIO', 'DIRECCION', 'GENERAL', 'NACIONAL', 'INSTITUTO',
  'PROGRAMA', 'COMISION', 'SERVICIO', 'SERVICIOS', 'UNIDAD', 'CENTRO', 'EMPRESA', 'PUBLICA', 'PUBLICO', 'GOBIERNO',
  'REPUBLICA', 'CONSEJO', 'FONDO', 'OFICINA', 'SISTEMA', 'ADMINISTRACION', 'REGIONAL', 'HOSPITAL', 'UNIVERSIDAD',
  'ESCUELA', 'DESARROLLO', 'SOCIAL', 'PROMOCION', 'PROTECCION', 'AGENCIA', 'PODER', 'TRIBUNAL', 'SUPERIOR',
  'SECRETARIA', 'ORIENTAL', 'URUGUAY', 'ESTADO', 'JUNTA', 'CORPORACION', 'BANCO', 'DESPACHO', 'ORGANISMO',
]);

const ENTITY_LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'EN', 'PARA', 'POR', 'A']);

/**
 * ¿La dirección de la web nombra a la entidad? Sí si contiene una de sus siglas
 * («UTE» ↔ ute.com.uy, «ASSE» ↔ asse.com.uy), la sigla de sus iniciales o el
 * comienzo (5 letras) de una palabra distintiva («Intendencia de Canelones» ↔
 * imcanelones.gub.uy, «Ministerio del Interior» ↔ minterior.gub.uy). El correo de
 * otro organismo («Dirección General de Secretaría - MDN» con msp.gub.uy) no la nombra.
 */
export function uruguayDomainNamesEntity(domain: string, entityName: string, acronyms: readonly string[] = []): boolean {
  const host = domain.toUpperCase().replace(/[^A-Z0-9.]/g, '');
  const label = host
    .split('.')
    .filter((part) => !['WWW', 'GUB', 'EDU', 'MIL', 'ORG', 'COM', 'NET', 'UY', 'INFO'].includes(part))
    .join('');
  if (label.length < 2) return false;
  const plain = entityName.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const tags = [...acronyms, ...[...plain.matchAll(/\(([^()]{2,20})\)/g)].map((m) => m[1])]
    .map((t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter((t) => t.length >= 2);
  const words = plain.replace(/\([^()]*\)/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 0);
  const content = words.filter((w) => !ENTITY_LINK_WORDS.has(w));
  const initials = content.map((w) => w[0]).join('');
  // Una sigla de 2-3 letras sólo vale si ES la etiqueta («ute», no «computer»).
  if (tags.some((tag) => (tag.length <= 3 ? label === tag : label.includes(tag)))) return true;
  if (initials.length >= 3 && label.includes(initials)) return true;
  return content
    .filter((w) => w.length >= 5 && !GENERIC_ENTITY_WORDS.has(w))
    .some((w) => label.includes(w.slice(0, 5)));
}

/**
 * La web de una ENTIDAD PÚBLICA desde sus correos institucionales: el primero que
 * no sea gratuito y cuya dirección nombre a la entidad. Un `.gub.uy` se guarda
 * entero («minterior.gub.uy»).
 */
export function uruguayPublicEntityDomain(input: {
  name: string;
  acronyms?: readonly string[];
  emails: readonly string[];
}): string | null {
  for (const email of input.emails) {
    const host = emailDomain(email);
    if (host === null || isUruguayPersonalEmailDomain(host)) continue;
    const domain = isUruguayPublicSectorDomain(host)
      ? host.replace(/^(www|intranet|correo|mail)\./, '')
      : registrableUruguayDomain(host);
    if (uruguayDomainNamesEntity(domain, input.name, input.acronyms ?? [])) return domain;
  }
  return null;
}

/** La web declarada en una fuente («www.asesp.com.uy») → dominio registrable, o `null`. */
export function uruguayDeclaredWebsiteDomain(raw: string | null | undefined): string | null {
  const host = normalizeWebsiteHost(raw);
  if (host === null || isUruguayPersonalEmailDomain(host)) return null;
  return isUruguayPublicSectorDomain(host) ? host.replace(/^www\./, '') : registrableUruguayDomain(host);
}

/** El dominio del correo de una empresa privada (nunca gratuito ni del Estado), o `null`. */
export function uruguayCompanyEmailDomain(email: string | null | undefined): string | null {
  const host = emailDomain(email ?? null);
  if (host === null || isUruguayPersonalEmailDomain(host) || isUruguayPublicSectorDomain(host)) return null;
  if (/(^|\.)edu\.uy$/.test(host)) return null;
  return registrableUruguayDomain(host);
}

const compact = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ¿La web de la candidata confirma un nombre de UNA palabra? Sólo si la etiqueta
 * propia del dominio es exactamente esa palabra («tilsor.com.uy» ↔ TILSOR,
 * «ute.com.uy» ↔ UTE). Un dominio del Estado sólo confirma a una entidad pública.
 */
export function uruguaySingleWordConfirmedByDomain(
  domain: string | null,
  word: string,
  options: { publicEntity: boolean },
): boolean {
  const host = normalizeWebsiteHost(domain);
  if (host === null) return false;
  const registrable = isUruguayPublicSectorDomain(host) ? host.replace(/^www\./, '') : registrableUruguayDomain(host);
  const label = compact(registrable.split('.')[0] ?? '');
  const target = compact(word);
  if (target.length < 3 || label !== target) return false;
  if (isUruguayPublicSectorDomain(host)) return options.publicEntity;
  return !FREE_MAIL_LABEL.test(label.toLowerCase());
}

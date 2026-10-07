/**
 * hn-domain.ts — dominios web de Honduras: el dominio del correo de contacto que
 * publican HonduCompras y SIAFI como web de la empresa o de la entidad, sin correos
 * gratuitos, de proveedores de internet ni de relleno, y la confirmación de un
 * nombre de UNA palabra por la web de la candidata.
 *
 * SOURCES-HN-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Medido el 07-10-2026 sobre las 6.203 personas jurídicas proveedoras (OCDS
 * 2018-2026): gmail/yahoo/hotmail/outlook con cualquier terminación y con erratas
 * («gmai.com», «gamil.com», «homail.com»), correos de relleno («notiene.com»,
 * «noposee.com»), proveedores de internet locales (Cablecolor, Amnet, Sulanet,
 * Globalnet) y 81 correos de SEFIN pegados a proveedores (no son su web).
 */

import {
  emailDomain,
  isNonCorporateDomain,
  normalizeWebsiteHost,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';

/** Proveedores de internet, de correo y de relleno de Honduras (el dominio no es de la empresa). */
export const HN_NON_CORPORATE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'cablecolor.hn', 'cablecolor.net', 'amnettgu.com', 'amnet.hn', 'amnetmail.com', 'sulanet.net', 'sulanet.hn',
  'globalnet.hn', 'globanet.hn', 'tevisat.net', 'tigo.com.hn', 'claro.com.hn', 'hondutel.hn', 'navegante.com.hn',
  'multidata.hn', 'redhonduras.com', 'notiene.com', 'notiene.hn', 'noposee.com', 'yopmail.com', 'latinmail.com',
  'starmedia.com', 'terra.com', 'prodigy.net.mx',
]);

/**
 * Dominios del sistema de compras: el correo de la mesa de ayuda de HonduCompras
 * aparece en muchas entidades y nunca es la web de ninguna.
 */
const HN_PROCUREMENT_SYSTEM_DOMAINS: ReadonlySet<string> = new Set(['honducompras.gob.hn', 'oncae.gob.hn']);

/** Primer nivel del dominio de los correos gratuitos, con cualquier terminación. */
const FREE_MAIL_LABEL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|aol|icloud|me|mail|protonmail|proton|zoho|gmx)$/;

/** Erratas de los correos gratuitos («gmai», «gamil», «gmil», «homail», «hotmial»). */
const FREE_MAIL_TYPO = /^(hot?m[aio]{1,2}l|hotamil|homail|hotmil|gm[ai]{1,2}l?|gamil|gimail|gmal|gmaill|yaho|yahooo|outlok|outlock)$/;

/** Dominios del Estado de Honduras (`.gob.hn`, `.mil.hn`, y `.gob` suelto mal escrito). */
const HN_PUBLIC_SECTOR_DOMAIN = /(^|\.)(gob|mil)(\.hn)?$/;

/** Dominios educativos (`.edu.hn`): sólo valen como web de una universidad o escuela. */
const EDUCATION_DOMAIN = /(^|\.)edu(\.hn)?$/;

const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gob', 'mil', 'ind', 'int']);

/** El dominio registrable: «ventas.lacthosa.com.hn» → «lacthosa.com.hn», «a.b.com» → «b.com». */
export function registrableHondurasDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  const keep =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** ¿Dominio del Estado hondureño? */
export function isHondurasPublicSectorDomain(domain: string | null | undefined): boolean {
  return typeof domain === 'string' && HN_PUBLIC_SECTOR_DOMAIN.test(domain.toLowerCase());
}

/** ¿Correo gratuito, con errata, de relleno o de un proveedor de internet? */
export function isHondurasPersonalEmailDomain(host: string): boolean {
  const registrable = registrableHondurasDomain(host);
  const label = registrable.split('.')[0] ?? '';
  return (
    isNonCorporateDomain(registrable) ||
    isNonCorporateDomain(host) ||
    FREE_MAIL_LABEL.test(label) ||
    FREE_MAIL_TYPO.test(label) ||
    HN_NON_CORPORATE_EMAIL_DOMAINS.has(registrable) ||
    HN_NON_CORPORATE_EMAIL_DOMAINS.has(host) ||
    !registrable.includes('.')
  );
}

/**
 * La web de una empresa privada a partir de sus correos de contacto: el dominio del
 * primero que sea corporativo. `null` si sólo hay correos personales, de
 * universidad o del Estado (una sociedad privada no tiene web `.gob.hn`).
 */
export function hondurasCompanyDomainFromEmails(emails: readonly string[]): string | null {
  for (const email of emails) {
    const host = emailDomain(email);
    if (host === null || isHondurasPersonalEmailDomain(host)) continue;
    if (EDUCATION_DOMAIN.test(host) || isHondurasPublicSectorDomain(host)) continue;
    return registrableHondurasDomain(host);
  }
  return null;
}

/** Palabras que no distinguen a una entidad pública de otra. */
const GENERIC_ENTITY_WORDS: ReadonlySet<string> = new Set([
  'ALCALDIA', 'MUNICIPAL', 'MUNICIPALIDAD', 'MUNICIPIO', 'CORPORACION', 'SECRETARIA', 'ESTADO', 'DESPACHO', 'DESPACHOS',
  'DIRECCION', 'GENERAL', 'NACIONAL', 'INSTITUTO', 'PROGRAMA', 'COMISION', 'SERVICIO', 'SERVICIOS', 'UNIDAD', 'CENTRO',
  'EMPRESA', 'PUBLICA', 'PUBLICO', 'GOBIERNO', 'REPUBLICA', 'CONSEJO', 'FONDO', 'OFICINA', 'GABINETE', 'SISTEMA',
  'ADMINISTRACION', 'REGIONAL', 'DEPARTAMENTAL', 'HOSPITAL', 'UNIVERSIDAD', 'ESCUELA', 'MANCOMUNIDAD', 'MUNICIPIOS',
  'DESARROLLO', 'SOCIAL', 'PROMOCION', 'PROTECCION', 'AGENCIA', 'MINISTERIO', 'PODER', 'TRIBUNAL', 'SUPERIOR',
]);

const ENTITY_LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'EN', 'PARA', 'POR', 'A']);

/**
 * ¿La dirección de la web nombra a la entidad? Sí si contiene su sigla entre
 * paréntesis («… (SENASA)» ↔ senasa-sag.gob.hn), la sigla de sus iniciales
 * («Universidad Nacional Autónoma de Honduras» ↔ unah.edu.hn) o el comienzo (5
 * letras) de una palabra distintiva («Municipalidad de San Pedro Sula» ↔
 * sanpedrosula.hn, «Secretaría de Salud» ↔ salud.gob.hn). Un correo de la entidad
 * madre o de otra oficina («Gabinete…» con bch.hn) no la nombra. Misma idea que la
 * regla común del rescate para las webs del Estado (Ecuador, PR #640).
 */
export function hondurasDomainNamesEntity(domain: string, entityName: string): boolean {
  const host = domain.toUpperCase().replace(/[^A-Z0-9.]/g, '');
  const label = host.split('.').filter((part) => !['WWW', 'GOB', 'EDU', 'MIL', 'ORG', 'COM', 'NET', 'HN', 'INFO'].includes(part)).join('');
  if (label.length < 3) return false;
  const plain = entityName.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  // «aguasdesiguatepeque.com» es la empresa de aguas, no la Municipalidad de Siguatepeque.
  if (/^(AGUAS|ALCANTARILLADO)/.test(label) && !/^\s*(AGUAS|ALCANTARILLADO|UNIDAD|EMPRESA)/.test(plain)) return false;
  const tags = [...plain.matchAll(/\(([^()]{2,20})\)/g)].map((m) => m[1].replace(/[^A-Z0-9]/g, '')).filter((t) => t.length >= 3);
  const words = plain.replace(/\([^()]*\)/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 0);
  const content = words.filter((w) => !ENTITY_LINK_WORDS.has(w));
  const initials = content.map((w) => w[0]).join('');
  if (tags.some((tag) => label.includes(tag))) return true;
  if (initials.length >= 3 && label.includes(initials)) return true;
  return content
    .filter((w) => w.length >= 5 && !GENERIC_ENTITY_WORDS.has(w) && !w.startsWith('HONDUR'))
    .some((w) => label.includes(w.slice(0, 5)));
}

/**
 * La web de una ENTIDAD PÚBLICA: primero la web que publica ONCAE, si no el
 * dominio de un correo institucional (`.gob.hn`, `.edu.hn` o propio); en los dos
 * casos sólo si la dirección nombra a la entidad (`hondurasDomainNamesEntity`).
 * Nunca un correo gratuito ni el de la mesa de ayuda de HonduCompras.
 */
export function hondurasPublicEntityDomain(input: {
  name: string;
  urls: readonly string[];
  emails: readonly string[];
}): string | null {
  const hosts: string[] = [];
  for (const url of input.urls) {
    const host = normalizeWebsiteHost(url);
    if (host !== null) hosts.push(host);
  }
  for (const email of input.emails) {
    const host = emailDomain(email);
    if (host !== null) hosts.push(host);
  }
  for (const host of hosts) {
    if (isHondurasPersonalEmailDomain(host)) continue;
    const registrable = registrableHondurasDomain(host);
    if (HN_PROCUREMENT_SYSTEM_DOMAINS.has(registrable)) continue;
    // Un `.gob.hn` se guarda entero («salud.gob.hn»): «gob.hn» solo no es de nadie.
    const domain = isHondurasPublicSectorDomain(host) ? host.replace(/^(www|intranet|correo|mail)\./, '') : registrable;
    if (hondurasDomainNamesEntity(domain, input.name)) return domain;
  }
  return null;
}

const compact = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ¿La web de la candidata confirma un nombre de UNA palabra? Sólo si la etiqueta
 * propia del dominio es exactamente esa palabra («lacthosa.com» ↔ LACTHOSA,
 * «hondutel.hn» ↔ HONDUTEL). Un dominio del Estado sólo confirma a una entidad pública.
 */
export function hondurasSingleWordConfirmedByDomain(
  domain: string | null,
  word: string,
  options: { publicEntity: boolean },
): boolean {
  const host = normalizeWebsiteHost(domain);
  if (host === null) return false;
  const registrable = registrableHondurasDomain(host);
  // «hondutel.hn» es un proveedor de correo para otros, pero es la web de Hondutel.
  const label = compact(registrable.split('.')[0] ?? '');
  const target = compact(word);
  if (target.length < 3 || label !== target) return false;
  if (isHondurasPublicSectorDomain(host)) return options.publicEntity;
  return !FREE_MAIL_LABEL.test(label.toLowerCase()) && !FREE_MAIL_TYPO.test(label.toLowerCase());
}

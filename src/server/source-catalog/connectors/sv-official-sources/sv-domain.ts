/**
 * sv-domain.ts — web de las entidades públicas de El Salvador y confirmación de un
 * nombre de UNA palabra por la web de la candidata.
 *
 * SOURCES-SV-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * La web de una entidad sale SÓLO del dominio institucional que publica el Portal de
 * Transparencia (el del correo del oficial de información y la dirección de su
 * portal propio), y sólo si la dirección NOMBRA a la entidad (sigla, iniciales o
 * una palabra distintiva): `seguridad.gob.sv` ↔ «Ministerio de Justicia y Seguridad
 * Pública». Medido el 07-10-2026 sobre las 430 instituciones: las 210 alcaldías
 * anteriores a la reforma de 2024 usan casi todas gmail/hotmail (sin web) y los 35
 * hospitales comparten `salud.gob.sv` (de nadie en particular).
 *
 * COMPRASAL no publica correos de proveedores: las empresas de la capa gratuita van
 * sin web (el rescate con Claude la busca).
 */

import {
  emailDomain,
  isNonCorporateDomain,
  normalizeWebsiteHost,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';

/** Primer nivel del dominio de los correos gratuitos, con cualquier terminación. */
const FREE_MAIL_LABEL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|aol|icloud|me|mail|protonmail|proton|zoho|gmx)$/;

/** Dominios del Estado salvadoreño (`.gob.sv`, `.mil.sv`). */
const SV_PUBLIC_SECTOR_DOMAIN = /(^|\.)(gob|mil)\.sv$/;

const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gob', 'mil']);

/** Prefijos de servicio que no son parte de la web de la entidad. */
const SERVICE_PREFIX = /^(www|transparencia|portaldetransparencia|intranet|correo|mail|webmail)\./;

/** El dominio registrable: «ventas.empresa.com.sv» → «empresa.com.sv». */
export function registrableSalvadorDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  const keep =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** ¿Dominio del Estado salvadoreño? */
export function isSalvadorPublicSectorDomain(domain: string | null | undefined): boolean {
  return typeof domain === 'string' && SV_PUBLIC_SECTOR_DOMAIN.test(domain.toLowerCase());
}

/** ¿Correo gratuito o de relleno? */
export function isSalvadorPersonalEmailDomain(host: string): boolean {
  const registrable = registrableSalvadorDomain(host);
  const label = registrable.split('.')[0] ?? '';
  return isNonCorporateDomain(registrable) || isNonCorporateDomain(host) || FREE_MAIL_LABEL.test(label) || !registrable.includes('.');
}

/** Palabras que no distinguen a una entidad pública de otra. */
const GENERIC_ENTITY_WORDS: ReadonlySet<string> = new Set([
  'ALCALDIA', 'MUNICIPAL', 'MUNICIPALIDAD', 'MUNICIPIO', 'CORPORACION', 'SECRETARIA', 'ESTADO', 'DIRECCION', 'GENERAL',
  'NACIONAL', 'INSTITUTO', 'PROGRAMA', 'COMISION', 'SERVICIO', 'SERVICIOS', 'UNIDAD', 'CENTRO', 'EMPRESA', 'PUBLICA',
  'PUBLICO', 'GOBIERNO', 'REPUBLICA', 'CONSEJO', 'FONDO', 'OFICINA', 'SISTEMA', 'ADMINISTRACION', 'REGIONAL',
  'DEPARTAMENTAL', 'HOSPITAL', 'UNIVERSIDAD', 'ESCUELA', 'DESARROLLO', 'SOCIAL', 'PROMOCION', 'PROTECCION', 'AGENCIA',
  'MINISTERIO', 'TRIBUNAL', 'SUPERIOR', 'SALVADORENO', 'SALVADORENA', 'GOBERNACION', 'AUTORIDAD', 'SUPERINTENDENCIA',
]);

const ENTITY_LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'EN', 'PARA', 'POR', 'A', 'AL']);

const plain = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * ¿La dirección de la web nombra a la entidad? Sí si contiene su sigla (la que
 * publica Transparencia o la que va entre paréntesis), la sigla de sus iniciales o
 * el comienzo (5 letras) de una palabra distintiva («Ministerio de Justicia y
 * Seguridad Pública» ↔ seguridad.gob.sv). Un correo de otra oficina no la nombra.
 */
export function salvadorDomainNamesEntity(domain: string, entityName: string, acronym: string | null = null): boolean {
  const host = domain.toUpperCase().replace(/[^A-Z0-9.]/g, '');
  const label = host
    .split('.')
    .filter((part) => !['WWW', 'GOB', 'EDU', 'MIL', 'ORG', 'COM', 'NET', 'SV', 'INFO', 'TRANSPARENCIA'].includes(part))
    .join('');
  if (label.length < 3) return false;
  const text = plain(entityName);
  const tags = [...text.matchAll(/\(([^()]{2,20})\)/g)].map((m) => m[1].replace(/[^A-Z0-9]/g, ''));
  if (acronym !== null) tags.push(plain(acronym).replace(/[^A-Z0-9]/g, ''));
  const words = text.replace(/\([^()]*\)/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 0);
  const content = words.filter((w) => !ENTITY_LINK_WORDS.has(w));
  const initials = content.map((w) => w[0]).join('');
  if (tags.some((tag) => tag.length >= 3 && label.includes(tag))) return true;
  if (initials.length >= 3 && label.includes(initials)) return true;
  return content
    .filter((w) => w.length >= 5 && !GENERIC_ENTITY_WORDS.has(w) && !w.startsWith('SALVADOR'))
    .some((w) => label.includes(w.slice(0, 5)));
}

/**
 * La web de una ENTIDAD PÚBLICA a partir de lo que publica Transparencia: primero
 * el dominio del correo institucional, si no la dirección de su portal propio; en
 * los dos casos sólo si la dirección nombra a la entidad. Nunca un correo gratuito.
 * Un `.gob.sv` se guarda entero sin el prefijo de servicio («asamblea.gob.sv»).
 */
export function salvadorPublicEntityDomain(input: {
  name: string;
  acronym: string | null;
  siteUrl: string | null;
  emailDomain: string | null;
}): string | null {
  // El dominio del correo institucional primero: la dirección «propia» que publica
  // Transparencia suele ser su portal de transparencia (informacionpublicapgr.gob.sv).
  const hosts: string[] = [];
  const fromEmail = input.emailDomain !== null ? emailDomain(`x@${input.emailDomain}`) : null;
  if (fromEmail !== null) hosts.push(fromEmail);
  const site = normalizeWebsiteHost(input.siteUrl);
  if (site !== null) hosts.push(site);
  for (const host of hosts) {
    if (isSalvadorPersonalEmailDomain(host)) continue;
    const domain = isSalvadorPublicSectorDomain(host) ? host.replace(SERVICE_PREFIX, '') : registrableSalvadorDomain(host);
    if (salvadorDomainNamesEntity(domain, input.name, input.acronym)) return domain;
  }
  return null;
}

const compact = (text: string): string => plain(text).replace(/[^A-Z0-9]/g, '');

/**
 * ¿La web de la candidata confirma un nombre de UNA palabra? Sólo si la etiqueta
 * propia del dominio es exactamente esa palabra («duralita.com» ↔ DURALITA). Un
 * dominio del Estado sólo confirma a una entidad pública.
 */
export function salvadorSingleWordConfirmedByDomain(
  domain: string | null,
  word: string,
  options: { publicEntity: boolean },
): boolean {
  const host = normalizeWebsiteHost(domain);
  if (host === null) return false;
  const registrable = isSalvadorPublicSectorDomain(host) ? host.replace(SERVICE_PREFIX, '') : registrableSalvadorDomain(host);
  const label = compact(registrable.split('.')[0] ?? '');
  const target = compact(word);
  if (target.length < 3 || label !== target) return false;
  if (isSalvadorPublicSectorDomain(host)) return options.publicEntity;
  return !FREE_MAIL_LABEL.test(label.toLowerCase());
}

/**
 * es-domain.ts — la web (dominio) de empresas y entidades públicas de España a
 * partir de lo que publican las fuentes oficiales: la web del órgano de
 * contratación (PLACSP), la web y el correo de INVENTE y la web del registro del
 * Banco de España.
 *
 * SOURCES-ES-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Reglas (las mismas que Honduras y Nicaragua):
 *
 *   - Nunca un correo gratuito («gmail», «hotmail», «telefonica.net»…), con
 *     cualquier terminación, ni el dominio de la propia plataforma de contratación.
 *   - La web de una ENTIDAD PÚBLICA sólo vale si la dirección la nombra (sigla,
 *     iniciales o una palabra distintiva): «Ayuntamiento de Cuenca» ↔ cuenca.es,
 *     «Agencia Estatal de Meteorología (AEMET)» ↔ aemet.es. Un dominio regional
 *     compartido por muchos organismos («juntadeandalucia.es», «gva.es») se guarda
 *     con su subdominio («sas.juntadeandalucia.es») y también tiene que nombrarla.
 *   - Un nombre de UNA palabra sólo es fuerte si la etiqueta propia del dominio es
 *     exactamente esa palabra («mapfre.com» ↔ MAPFRE).
 */

import {
  emailDomain,
  isNonCorporateDomain,
  normalizeWebsiteHost,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';

/** Proveedores de internet y de correo de España (el dominio no es de la empresa). */
export const ES_NON_CORPORATE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'telefonica.net', 'movistar.es', 'terra.es', 'terra.com', 'wanadoo.es', 'orange.es', 'ya.com', 'ono.com', 'ono.es',
  'jazztel.es', 'jazzfree.com', 'eresmas.com', 'eresmas.net', 'mixmail.com', 'euskaltel.net', 'telecable.es',
  'menta.net', 'auna.com', 'retevision.es', 'lycos.es', 'latinmail.com', 'yopmail.com', 'correo.com',
]);

/** Dominios de las plataformas de contratación: nunca la web de nadie. */
const ES_PROCUREMENT_SYSTEM_DOMAINS: ReadonlySet<string> = new Set([
  'contrataciondelestado.es', 'contrataciondelsectorpublico.gob.es', 'hacienda.gob.es', 'minhap.es', 'face.gob.es',
]);

/**
 * Dominios del sector público compartidos por muchos organismos: se guarda el host
 * completo (sin «www»), nunca el registrable solo.
 */
const ES_SHARED_PUBLIC_DOMAINS: ReadonlySet<string> = new Set([
  'gob.es', 'juntadeandalucia.es', 'gva.es', 'gencat.cat', 'xunta.gal', 'xunta.es', 'euskadi.eus', 'euskadi.net',
  'navarra.es', 'madrid.org', 'jcyl.es', 'juntaex.es', 'castillalamancha.es', 'aragon.es', 'carm.es', 'caib.es',
  'gobiernodecanarias.org', 'larioja.org', 'cantabria.es', 'asturias.es', 'asturias.org', 'mju.es', 'defensa.gob.es',
  'seg-social.es', 'sanidad.gob.es', 'administracion.gob.es', 'mitma.es', 'diba.cat', 'dival.es', 'dipucadiz.es',
]);

/** Primer nivel del dominio de los correos gratuitos, con cualquier terminación. */
const FREE_MAIL_LABEL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|aol|icloud|me|mail|protonmail|proton|zoho|gmx)$/;

/** Erratas de los correos gratuitos. */
const FREE_MAIL_TYPO = /^(hot?m[aio]{1,2}l|hotamil|homail|hotmil|gm[ai]{1,2}l?|gamil|gimail|gmal|gmaill|yaho|yahooo|outlok|outlock)$/;

/** Dominios con segundo nivel genérico (`.com.es`, `.org.es`, `.gob.es`, `.edu.es`). */
const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gob', 'nom']);

/** El dominio registrable: «www.cuenca.es» → «cuenca.es», «a.empresa.com.es» → «empresa.com.es». */
export function registrableSpainDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  const keep =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** ¿Dominio del sector público (`.gob.es` o uno regional compartido)? */
export function isSpainPublicSectorDomain(domain: string | null | undefined): boolean {
  if (typeof domain !== 'string') return false;
  return ES_SHARED_PUBLIC_DOMAINS.has(registrableSpainDomain(domain));
}

/** ¿Correo gratuito, con errata, de relleno o de un proveedor de internet? */
export function isSpainPersonalEmailDomain(host: string): boolean {
  const registrable = registrableSpainDomain(host);
  const label = registrable.split('.')[0] ?? '';
  return (
    isNonCorporateDomain(registrable) ||
    isNonCorporateDomain(host) ||
    FREE_MAIL_LABEL.test(label) ||
    FREE_MAIL_TYPO.test(label) ||
    ES_NON_CORPORATE_EMAIL_DOMAINS.has(registrable) ||
    ES_NON_CORPORATE_EMAIL_DOMAINS.has(host) ||
    !registrable.includes('.')
  );
}

/** El dominio a guardar de un host: completo si es un dominio público compartido. */
function storedDomain(host: string): string {
  const clean = host.toLowerCase().replace(/^(?:(?:www\d?|intranet|correo|mail|sede|portal|contratacion|licitacion|perfilcontratante)\.)+/, '');
  return isSpainPublicSectorDomain(clean) ? clean : registrableSpainDomain(clean);
}

/**
 * La web de una EMPRESA a partir de su web publicada o de sus correos: el primer
 * dominio corporativo. `null` si sólo hay correos personales o del sector público
 * (una sociedad no tiene web `.gob.es`).
 */
export function spainCompanyDomain(input: { urls: readonly string[]; emails: readonly string[] }): string | null {
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
    if (isSpainPersonalEmailDomain(host) || isSpainPublicSectorDomain(host)) continue;
    const domain = registrableSpainDomain(host);
    if (ES_PROCUREMENT_SYSTEM_DOMAINS.has(domain)) continue;
    return domain;
  }
  return null;
}

/** Palabras que no distinguen a una entidad pública de otra. */
const GENERIC_ENTITY_WORDS: ReadonlySet<string> = new Set([
  'AYUNTAMIENTO', 'AJUNTAMENT', 'CONCELLO', 'MUNICIPAL', 'MUNICIPIO', 'DIPUTACION', 'PROVINCIAL', 'CONSEJERIA',
  'MINISTERIO', 'SECRETARIA', 'ESTADO', 'DIRECCION', 'GENERAL', 'NACIONAL', 'ESTATAL', 'INSTITUTO', 'AGENCIA',
  'CONSORCIO', 'SERVICIO', 'SERVICIOS', 'CENTRO', 'EMPRESA', 'PUBLICA', 'PUBLICO', 'GOBIERNO', 'CONSEJO', 'FONDO',
  'OFICINA', 'ADMINISTRACION', 'REGIONAL', 'AUTONOMA', 'COMUNIDAD', 'HOSPITAL', 'UNIVERSIDAD', 'UNIVERSITAT',
  'ESCUELA', 'MANCOMUNIDAD', 'JUNTA', 'GOBIERNO', 'ALCALDIA', 'PLENO', 'PRESIDENCIA', 'ORGANISMO', 'AUTONOMO',
  'ENTIDAD', 'SOCIEDAD', 'MERCANTIL', 'FUNDACION', 'GERENCIA', 'COMPLEJO', 'UNIVERSITARIO', 'CABILDO', 'INSULAR',
  'CONSELL', 'COMARCAL', 'COMARCA', 'GENERALITAT', 'ESPANA', 'ESPANOLA', 'ESPANOL',
]);

const ENTITY_LINK_WORDS: ReadonlySet<string> = new Set([
  'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'EN', 'PARA', 'POR', 'A', 'D', 'L', 'I', 'S', 'M',
]);

/**
 * ¿La dirección de la web nombra a la entidad? Sí si contiene su sigla entre
 * paréntesis, la sigla de sus iniciales o el comienzo (5 letras) de una palabra
 * distintiva. «Junta de Gobierno del Ayuntamiento de Cuenca» ↔ cuenca.es: sí;
 * «Consejería de Salud» ↔ juntadeandalucia.es: no (el dominio es de toda la Junta).
 */
export function spainDomainNamesEntity(domain: string, entityName: string): boolean {
  // En un dominio público compartido sólo cuenta el subdominio («sas» de
  // «sas.juntadeandalucia.es»): «aragon.es» no nombra al «Instituto Aragonés…».
  const lower = domain.toLowerCase();
  const registrable = registrableSpainDomain(lower);
  const own = isSpainPublicSectorDomain(lower) ? lower.slice(0, Math.max(0, lower.length - registrable.length - 1)) : lower;
  const host = own.toUpperCase().replace(/[^A-Z0-9.]/g, '');
  const label = host
    .split('.')
    .filter((part) => !['WWW', 'GOB', 'EDU', 'ORG', 'COM', 'NET', 'ES', 'EUS', 'CAT', 'GAL', 'INFO', 'EU'].includes(part))
    .join('');
  if (label.length < 2) return false;
  const plain = entityName.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const tags = [...plain.matchAll(/\(([^()]{2,20})\)/g)].map((m) => m[1].replace(/[^A-Z0-9]/g, '')).filter((t) => t.length >= 3);
  const words = plain.replace(/\([^()]*\)/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 0);
  const content = words.filter((w) => !ENTITY_LINK_WORDS.has(w));
  const initials = content.map((w) => w[0]).join('');
  if (tags.some((tag) => label.includes(tag))) return true;
  if (initials.length >= 3 && label.includes(initials)) return true;
  // Siglas de dos letras sólo si son TODA la etiqueta («Universidad de Alicante» ↔ ua.es).
  if (initials.length === 2 && label === initials) return true;
  if (label.length < 3) return false;
  return content
    .filter((w) => w.length >= 5 && !GENERIC_ENTITY_WORDS.has(w))
    .some((w) => label.includes(w.slice(0, 5)));
}

/**
 * La web de una ENTIDAD PÚBLICA: la web publicada y, si no, el dominio de un correo
 * institucional; en los dos casos sólo si la dirección nombra a la entidad. Nunca
 * un correo gratuito ni el de la plataforma de contratación.
 */
export function spainPublicEntityDomain(input: {
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
    if (isSpainPersonalEmailDomain(host)) continue;
    if (ES_PROCUREMENT_SYSTEM_DOMAINS.has(registrableSpainDomain(host))) continue;
    const domain = storedDomain(host);
    if (spainDomainNamesEntity(domain, input.name)) return domain;
  }
  return null;
}

const compact = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ¿La web de la candidata confirma un nombre de UNA palabra? Sólo si la etiqueta
 * propia del dominio es exactamente esa palabra («mapfre.com» ↔ MAPFRE). Un dominio
 * del sector público sólo confirma a una entidad pública.
 */
export function spainSingleWordConfirmedByDomain(
  domain: string | null,
  word: string,
  options: { publicEntity: boolean },
): boolean {
  const host = normalizeWebsiteHost(domain);
  if (host === null) return false;
  const registrable = registrableSpainDomain(host);
  const label = compact(registrable.split('.')[0] ?? '');
  const target = compact(word);
  if (target.length < 3 || label !== target) return false;
  if (isSpainPublicSectorDomain(host)) return options.publicEntity;
  return !FREE_MAIL_LABEL.test(label.toLowerCase()) && !FREE_MAIL_TYPO.test(label.toLowerCase());
}

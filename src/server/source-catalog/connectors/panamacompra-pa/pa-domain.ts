/**
 * pa-domain.ts — dominios web de Panamá: el dominio del correo que la proveedora
 * registró en PanamaCompra como web de la empresa (sólo el DOMINIO: el correo, el
 * nombre y el teléfono del representante nunca se guardan), sin correos
 * gratuitos, de proveedores de internet ni de universidades, y la confirmación de
 * un nombre de UNA palabra por la web de la candidata.
 *
 * SOURCES-PA-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj. Aprobado por la
 * dueña el 07-10-2026 (decisión 5 del informe: web desde el dominio del correo).
 */

import {
  emailDomain,
  isNonCorporateDomain,
  normalizeWebsiteHost,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';

/** Proveedores de internet y de correo de Panamá (el dominio es del proveedor). */
export const PA_NON_CORPORATE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'cwpanama.net', 'cwp.net.pa', 'cableonda.net', 'cableonda.com', 'sinfo.net', 'psi.net.pa', 'pty.com', 'tutopia.com',
  'orbi.net', 'telecarrier.net', 'mastec.net', 'yopmail.com', 'latinmail.com', 'starmedia.com', 'prodigy.net.mx',
]);

/** Primer nivel del dominio de los correos gratuitos, con cualquier terminación. */
const FREE_MAIL_LABEL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|aol|icloud|me|mail|protonmail|proton|zoho|gmx)$/;

/** Erratas de los correos gratuitos («hotmial», «gmial», «hotamil», «homail»). */
const FREE_MAIL_TYPO = /^(hot?m[aio]{1,2}l|hotamil|homail|hotmil|gm[ai]{1,2}l|gmal|yaho|outlok)$/;

/** Dominios del Estado de Panamá (`.gob.pa`, `.gov.pa`). */
const PA_PUBLIC_SECTOR_DOMAIN = /(^|\.)(gob|gov|mil)\.pa$/;

/** Dominios de universidades: no son la web de una empresa. */
const EDUCATION_DOMAIN = /(^|\.)(edu|ac)(\.pa)?$/;

const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gob', 'gov', 'mil', 'ac', 'ing', 'med', 'sld', 'abo', 'nom']);

/** El dominio registrable: «ventas.grupomelo.com.pa» → «grupomelo.com.pa», «a.b.com» → «b.com». */
export function registrablePanamaDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  const keep =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** ¿Dominio del Estado panameño? */
export function isPanamaPublicSectorDomain(domain: string | null | undefined): boolean {
  return typeof domain === 'string' && PA_PUBLIC_SECTOR_DOMAIN.test(domain.toLowerCase());
}

/** ¿Correo gratuito, con errata o de un proveedor de internet? */
export function isPanamaPersonalEmailDomain(host: string): boolean {
  const registrable = registrablePanamaDomain(host);
  const label = registrable.split('.')[0] ?? '';
  return (
    isNonCorporateDomain(registrable) ||
    isNonCorporateDomain(host) ||
    FREE_MAIL_LABEL.test(label) ||
    FREE_MAIL_TYPO.test(label) ||
    PA_NON_CORPORATE_EMAIL_DOMAINS.has(registrable) ||
    !registrable.includes('.')
  );
}

/**
 * La web de una sociedad a partir del dominio de su correo registrado: `null` si es
 * un correo personal, de universidad o del Estado (una sociedad privada no tiene
 * web `.gob.pa`). Acepta un correo entero o sólo su dominio.
 */
export function panamaCompanyDomainFromEmailDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const host = raw.includes('@') ? emailDomain(raw) : normalizeWebsiteHost(raw);
  if (host === null || isPanamaPersonalEmailDomain(host)) return null;
  if (EDUCATION_DOMAIN.test(host) || isPanamaPublicSectorDomain(host)) return null;
  return registrablePanamaDomain(host);
}

const compact = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ¿La web de la candidata confirma un nombre de UNA palabra? Sólo si la etiqueta
 * propia del dominio es exactamente esa palabra («banistmo.com» ↔ BANISTMO). Un
 * dominio del Estado sólo confirma a una entidad pública.
 */
export function panamaSingleWordConfirmedByDomain(
  domain: string | null,
  word: string,
  options: { publicEntity: boolean },
): boolean {
  const host = normalizeWebsiteHost(domain);
  if (host === null || isPanamaPersonalEmailDomain(host)) return false;
  if (isPanamaPublicSectorDomain(host) && !options.publicEntity) return false;
  const label = compact(registrablePanamaDomain(host).split('.')[0] ?? '');
  const target = compact(word);
  return target.length >= 3 && label === target;
}

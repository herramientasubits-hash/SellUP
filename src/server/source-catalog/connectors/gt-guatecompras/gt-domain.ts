/**
 * gt-domain.ts — dominios web de Guatemala: el dominio del correo de contacto que
 * publica Guatecompras como web de la empresa, sin correos gratuitos, de
 * proveedores de internet ni de universidades, y la confirmación de un nombre de
 * UNA palabra por la web de la candidata.
 *
 * SOURCES-GT-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Medido el 06-10-2026 sobre las 13.933 personas individuales de Guatecompras
 * (2023-2026): usan gmail/hotmail/yahoo/outlook con cualquier terminación
 * («yahoo.com.mx»), erratas («hotmial.com», «gmial.com»), correos de estudiante
 * (ufm.edu, uvg.edu.gt, miumg.edu.gt) y de proveedores de internet locales.
 */

import {
  emailDomain,
  isNonCorporateDomain,
  normalizeWebsiteHost,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';

/** Proveedores de internet y de correo de Guatemala (el dominio es del proveedor). */
export const GT_NON_CORPORATE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'intelnett.com', 'intelnet.net.gt', 'itelgua.com', 'itelgua.net', 'guate.net', 'terra.com.gt', 'turbonett.com.gt',
  'tigo.com.gt', 'claro.com.gt', 'telgua.com.gt', 'yopmail.com', 'starmedia.com', 'latinmail.com',
]);

/** Primer nivel del dominio de los correos gratuitos, con cualquier terminación. */
const FREE_MAIL_LABEL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|aol|icloud|me|mail|protonmail|proton|zoho|gmx)$/;

/** Erratas de los correos gratuitos («hotmial», «gmial», «hotamil», «homail»). */
const FREE_MAIL_TYPO = /^(hot?m[aio]{1,2}l|hotamil|homail|hotmil|gm[ai]{1,2}l|gmal|yaho|outlok)$/;

/** Dominios del Estado de Guatemala (`.gob.gt`, `.mil.gt`). */
const GT_PUBLIC_SECTOR_DOMAIN = /(^|\.)(gob|mil)\.gt$/;

/** Dominios de universidades (correos de estudiante y docente): no son la web de una empresa. */
const EDUCATION_DOMAIN = /(^|\.)edu(\.gt)?$/;

const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gob', 'mil', 'ind', 'int']);

/** El dominio registrable: «ventas.cmi.com.gt» → «cmi.com.gt», «a.b.com» → «b.com». */
export function registrableGuatemalaDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  const keep =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** ¿Dominio del Estado guatemalteco? */
export function isGuatemalaPublicSectorDomain(domain: string | null | undefined): boolean {
  return typeof domain === 'string' && GT_PUBLIC_SECTOR_DOMAIN.test(domain.toLowerCase());
}

/** ¿Correo gratuito, con errata o de un proveedor de internet? */
export function isGuatemalaPersonalEmailDomain(host: string): boolean {
  const registrable = registrableGuatemalaDomain(host);
  const label = registrable.split('.')[0] ?? '';
  return (
    isNonCorporateDomain(registrable) ||
    isNonCorporateDomain(host) ||
    FREE_MAIL_LABEL.test(label) ||
    FREE_MAIL_TYPO.test(label) ||
    GT_NON_CORPORATE_EMAIL_DOMAINS.has(registrable) ||
    !registrable.includes('.')
  );
}

/**
 * La web de una empresa a partir de sus correos de contacto: el dominio del
 * primero que sea corporativo. `null` si sólo hay correos personales, de
 * universidad o del Estado (una sociedad privada no tiene web `.gob.gt`).
 */
export function guatemalaCompanyDomainFromEmails(emails: readonly string[]): string | null {
  for (const email of emails) {
    const host = emailDomain(email);
    if (host === null || isGuatemalaPersonalEmailDomain(host)) continue;
    if (EDUCATION_DOMAIN.test(host) || isGuatemalaPublicSectorDomain(host)) continue;
    return registrableGuatemalaDomain(host);
  }
  return null;
}

const compact = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * ¿La web de la candidata confirma un nombre de UNA palabra? Sólo si la etiqueta
 * propia del dominio es exactamente esa palabra («tecun.com» ↔ TECUN,
 * «igssgt.org» no ↔ IGSS). Un dominio del Estado sólo confirma a una entidad pública.
 */
export function guatemalaSingleWordConfirmedByDomain(
  domain: string | null,
  word: string,
  options: { publicEntity: boolean },
): boolean {
  const host = normalizeWebsiteHost(domain);
  if (host === null || isGuatemalaPersonalEmailDomain(host)) return false;
  if (isGuatemalaPublicSectorDomain(host) && !options.publicEntity) return false;
  const label = compact(registrableGuatemalaDomain(host).split('.')[0] ?? '');
  const target = compact(word);
  return target.length >= 3 && label === target;
}

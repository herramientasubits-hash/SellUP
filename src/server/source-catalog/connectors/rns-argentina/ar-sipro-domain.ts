/**
 * ar-sipro-domain.ts — dominio web de una sociedad argentina a partir del correo
 * que declaró como proveedora del Estado en el SIPRO histórico.
 *
 * SOURCES-AR-SIPRO-DOMAIN-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué ─────────────────────────────────────────────────────────────────
 *
 * Ni el Registro Nacional de Sociedades ni ATP publican sitio web, así que toda
 * empresa del buscador gratuito de Argentina llegaba sin dominio y, por la regla
 * #525, iba a «Descartadas». En la 1.ª corrida real (AR×Tecnología, lote
 * 17da92cf, 06-10) 50 de 50 fueron allí y el rescate con Claude sólo recuperó 9.
 * El SIPRO actual (COMPR.AR) no trae correo, pero el SIPRO histórico
 * («proveedores-sistema-legacy.csv», datos.gob.ar, CC-BY 4.0) sí: una columna
 * `email` por proveedor (35.275 personas jurídicas, casi todas con correo).
 *
 * ── La regla: la MISMA que República Dominicana ─────────────────────────────
 *
 * `domainMatchesCompanyName` (do-dgcp-domain.ts): el dominio sólo vale si su
 * nombre se parece a la razón social —entera, sin palabras genéricas, sus
 * iniciales, su primera palabra distintiva o su comienzo—. Encima, aquí:
 *   · la razón social se compara SIN su forma societaria argentina, incluidas
 *     las compuestas («S A I C F», «SACIFIA») y sin «Argentina» final;
 *   · correo gratuito y de proveedores de internet argentinos, nunca;
 *   · dominios de gobierno (gob.ar, gov.ar), nunca;
 *   · un dominio que aparece en 3 o más CUIT distintas es de un estudio contable
 *     o un proveedor de servicios, no de la empresa: ninguna lo recibe;
 *   · una CUIT con dos dominios distintos: ninguno.
 *
 * Sólo se guarda el DOMINIO: nunca el correo, ni el teléfono, ni la dirección.
 * Los correos son anteriores a 2016: un dominio puede haber cambiado. Por eso el
 * candidato sigue pasando por revisión humana.
 */

import { domainMatchesCompanyName, emailDomains } from '../dgcp-rd/do-dgcp-domain';
import { AR_REGISTRY_COMPOSITE_FORMS, normalizeArCompanyCore } from './ar-company-name-core';
import { isLegalEntityCuit, normalizeCuit } from './ar-rns-snapshot-builder';

/** Correo gratuito y de proveedores de internet (Argentina y genéricos). */
export const AR_NON_CORPORATE_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.ar', 'hotmail.es', 'outlook.com',
  'outlook.com.ar', 'live.com', 'live.com.ar', 'msn.com', 'yahoo.com', 'yahoo.com.ar', 'yahoo.es',
  'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mail.com', 'argentina.com',
  'arnet.com.ar', 'arnetbiz.com.ar', 'speedy.com.ar', 'fibertel.com.ar', 'ciudad.com.ar',
  'infovia.com.ar', 'uolsinectis.com.ar', 'sinectis.com.ar', 'uol.com.ar', 'sion.com',
  'satlink.com.ar', 'elsitio.net', 'telecentro.com.ar', 'gigared.com', 'datamarkets.com.ar',
  'rcc.com.ar', 'itc.com.ar', 'netverk.com.ar', 'overnet.com.ar', 'interlink.com.ar',
  'argenet.com.ar', 'ssdnet.com.ar', 'eplaneta.com.ar', 'fullzero.com.ar', 'tutopia.com',
  'house.com.ar', 'coopenet.com.ar', 'cpcipc.org.ar',
]);

/** Un dominio en tantas CUIT distintas o más no es de ninguna de ellas. */
export const AR_SIPRO_SHARED_DOMAIN_MIN_CUITS = 3;

const GOVERNMENT_DOMAIN = /\.(gob|gov|mil)\.ar$/;
const COUNTRY_SUFFIXES = [' DE ARGENTINA', ' ARGENTINA'] as const;

/** Razón social para comparar: sin forma societaria (también compuesta) ni «Argentina» final. */
export function arNameForDomainMatch(legalName: string): string {
  let core = normalizeArCompanyCore(legalName);
  let changed = true;
  while (changed) {
    changed = false;
    for (const form of AR_REGISTRY_COMPOSITE_FORMS) {
      if (core.endsWith(` ${form}`)) {
        core = core.slice(0, core.length - form.length - 1).trim();
        changed = true;
      }
    }
    for (const suffix of COUNTRY_SUFFIXES) {
      if (core.endsWith(suffix) && core.length > suffix.length) {
        core = core.slice(0, core.length - suffix.length).trim();
        changed = true;
      }
    }
  }
  return core;
}

/** Segundo nivel genérico bajo un dominio de país («com.ar», «org.ar»…). */
const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gob', 'gov', 'int', 'mil', 'tur', 'coop', 'mutual']);

/** El dominio registrable: «tmhm.toyota-industries.com.ar» → «toyota-industries.com.ar». */
export function registrableDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  const keep =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** El dominio corporativo de un correo del SIPRO histórico, o `null`. */
export function arCorporateDomainFromSiproEmail(input: {
  legalName: string;
  email: string | null | undefined;
}): string | null {
  const name = arNameForDomainMatch(input.legalName);
  if (name.length < 2) return null;
  const accepted = emailDomains(input.email).filter(
    (domain) =>
      !AR_NON_CORPORATE_DOMAINS.has(domain) &&
      !GOVERNMENT_DOMAIN.test(domain) &&
      domainMatchesCompanyName(domain, name),
  );
  const registrable = new Set(accepted.map(registrableDomain));
  return registrable.size === 1 ? [...registrable][0] : null;
}

/**
 * ¿El dominio sigue pareciéndose al nombre ACTUAL de la sociedad? Una CUIT puede
 * haber cambiado de razón social desde que se registró el correo (SIPRO
 * «SYSTEMNET S.A.» → hoy «EC SISTEMAS S R L»): entonces el dominio no se usa.
 */
export function domainMatchesCurrentArName(domain: string, currentLegalName: string | null | undefined): boolean {
  const name = arNameForDomainMatch(currentLegalName ?? '');
  return name.length >= 2 && domainMatchesCompanyName(domain, name);
}

/**
 * CUIT → dominio a partir de las filas del SIPRO histórico (columnas `cuit`,
 * `denominacion`, `email`). Sólo personas jurídicas (30/33/34) con CUIT válida.
 */
export function buildArSiproDomainMap(rows: Iterable<Record<string, string>>): Map<string, string> {
  const byCuit = new Map<string, string>();
  const conflicted = new Set<string>();
  for (const row of rows) {
    const cuit = normalizeCuit(row['cuit']);
    if (cuit === null || !isLegalEntityCuit(cuit) || conflicted.has(cuit)) continue;
    const domain = arCorporateDomainFromSiproEmail({
      legalName: (row['denominacion'] ?? '').trim(),
      email: row['email'],
    });
    if (domain === null) continue;
    const previous = byCuit.get(cuit);
    if (previous !== undefined && previous !== domain) {
      byCuit.delete(cuit);
      conflicted.add(cuit);
      continue;
    }
    byCuit.set(cuit, domain);
  }

  const cuitsPerDomain = new Map<string, number>();
  for (const domain of byCuit.values()) cuitsPerDomain.set(domain, (cuitsPerDomain.get(domain) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const [cuit, domain] of byCuit) {
    if ((cuitsPerDomain.get(domain) ?? 0) < AR_SIPRO_SHARED_DOMAIN_MIN_CUITS) out.set(cuit, domain);
  }
  return out;
}

/** Origen que se guarda junto al dominio en `raw_data.website_domain_source`. */
export const AR_SIPRO_DOMAIN_SOURCE = 'sipro_legacy_email' as const;

/**
 * SOURCES-AR-DOMAIN-ON-RELOAD-1 — los campos de dominio de una fila del buscador
 * gratuito, listos para `raw_data`. Una recarga de `ar_rns` o `ar_atp_employers`
 * que reciba el mapa del SIPRO histórico escribe el dominio en el mismo paso, con
 * la MISMA regla que el script de dominios (también contra el nombre actual).
 * Sin dominio (o sin mapa) ⇒ `null`: nunca se fabrica uno.
 */
export function arWebsiteDomainFields(
  siproDomain: string | null | undefined,
  currentLegalName: string | null | undefined,
): { website_domain: string | null; website_domain_source: string | null } {
  const domain = typeof siproDomain === 'string' && siproDomain.trim() ? siproDomain.trim().toLowerCase() : null;
  if (domain === null || !domainMatchesCurrentArName(domain, currentLegalName)) {
    return { website_domain: null, website_domain_source: null };
  }
  return { website_domain: domain, website_domain_source: AR_SIPRO_DOMAIN_SOURCE };
}

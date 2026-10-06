/**
 * co-siis-domain.ts — la web de cada empresa del SIIS a partir de fuentes
 * gratuitas de datos.gov.co.
 *
 * SOURCES-CO-CLOSE-1. El SIIS (10.000 empresas grandes) no publica web, y el
 * buscador gratuito manda a «Descartadas» toda empresa sin web: medido el
 * 02-10-2026, las 100 que propuso en Manufactura terminaron ahí. Dos fuentes la
 * dan por NIT:
 *
 *   - SECOP II · Proveedores registrados (qmzu-gj57): `sitio_web` y `correo`.
 *   - Supersociedades · Sujetos obligados (dd55-74ss): `email` de notificaciones.
 *
 * Muestra de 300 empresas al azar: 270 tendrían algún dominio. Un dominio sólo se
 * acepta si LLEVA EL NOMBRE de la empresa (misma regla que República Dominicana y
 * Argentina): «WWW.POSTOBON.COM» publicado por Gaseosas Lux no es de Gaseosas Lux.
 * Nunca se guardan correos ni contactos: sólo el dominio.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import { domainMatchesCompanyName, registrableLabel } from '../dgcp-rd/do-dgcp-domain';
import {
  emailDomain,
  isColombianPublicSectorDomain,
  isNonCorporateDomain,
  normalizeWebsiteHost,
  registrableCoDomain,
} from '../co-public-entities/co-domain';
import { normalizeEntityNit } from '../co-public-entities/co-public-entity-rows';
import { normalizeColombiaCompanyNameCore } from '../personas-juridicas-cc-colombia/co-company-name-core';

/** Origen que se guarda junto al dominio en `raw_data.website_domain_source`. */
export type CoSiisDomainSource = 'secop_web' | 'secop_email' | 'supersociedades_email';

/** Un dominio en tantos NIT distintos o más es de un grupo, no de una empresa. */
export const CO_SIIS_SHARED_DOMAIN_MIN_NITS = 3;

/** Fila de SECOP II · Proveedores registrados. */
export type SecopProviderRow = { nit?: string; nombre?: string; sitio_web?: string; correo?: string };

/** Fila de Supersociedades · Sujetos obligados. */
export type SupersociedadesSubjectRow = { nit?: string; razon_social?: string; email?: string; fecha_corte?: string };

const COUNTRY_TAIL = / (DE COLOMBIA|COLOMBIA|COLOMBIANA|COLOMBIANO)$/;

/** Razón social para comparar con un dominio: sin forma societaria ni «Colombia» final. */
export function coNameForDomainMatch(legalName: string | null | undefined): string {
  let core = normalizeColombiaCompanyNameCore(legalName);
  while (COUNTRY_TAIL.test(core) && core.replace(COUNTRY_TAIL, '').length >= 2) core = core.replace(COUNTRY_TAIL, '');
  return core;
}

/**
 * Palabras con las que empiezan muchas razones sociales colombianas y que no
 * distinguen a nadie («INDUSTRIAS HACEB» se llama haceb.com).
 */
const CO_GENERIC_NAME_WORDS: ReadonlySet<string> = new Set([
  'INDUSTRIAS', 'INDUSTRIA', 'COMPANIA', 'ORGANIZACION', 'DISTRIBUIDORA', 'DISTRIBUCIONES', 'LABORATORIOS',
  'LABORATORIO', 'ALMACENES', 'INVERSIONES', 'COMERCIALIZADORA', 'CONSTRUCTORA', 'TRANSPORTES', 'SOCIEDAD',
  'GRUPO', 'EMPRESA', 'EMPRESAS', 'CORPORACION', 'COLOMBIA', 'COLOMBIANA', 'NACIONAL', 'ANDINA', 'INTERNACIONAL',
  'SERVICIOS', 'SOLUCIONES', 'CLINICA', 'HOSPITAL', 'FUNDACION', 'COOPERATIVA', 'AGENCIA', 'PRODUCTOS',
  'ALIMENTOS', 'TECNOLOGIA', 'CONSULTORES', 'INGENIERIA', 'CENTRO', 'SUPERMERCADOS', 'PLATAFORMA',
  'COMERCIAL', 'DE', 'DEL', 'LA', 'LOS', 'LAS', 'EL', 'Y',
]);

/** Sin las palabras genéricas iniciales: «INDUSTRIAS HACEB» → «HACEB». */
function withoutLeadingGenericWords(name: string): string {
  const words = name.split(' ');
  let i = 0;
  while (i < words.length - 1 && CO_GENERIC_NAME_WORDS.has(words[i])) i += 1;
  return words.slice(i).join(' ');
}

/** ¿La etiqueta del dominio es una palabra distintiva (5+ letras) del nombre? */
function labelIsDistinctiveWord(registrable: string, name: string): boolean {
  const label = registrableLabel(registrable).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (label.length < 5) return false;
  return name.split(' ').some((word) => word.length >= 5 && !CO_GENERIC_NAME_WORDS.has(word) && word === label);
}

/** Un dominio candidato vale si es corporativo, privado y lleva el nombre. */
function acceptable(domain: string | null, legalName: string): string | null {
  if (domain === null || isNonCorporateDomain(domain) || isColombianPublicSectorDomain(domain)) return null;
  const registrable = registrableCoDomain(domain);
  const name = coNameForDomainMatch(legalName);
  if (name.length < 2) return null;
  // Las reglas por prefijo se aplican al nombre SIN palabras genéricas iniciales:
  // «PLATAFORMA DE COMUNICACIONES» no es plataformaav.com. El nombre entero sólo
  // vale si la etiqueta es exactamente él («laboratoriosx.com»).
  const label = registrableLabel(registrable).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const accepted =
    label === name.replace(/[^A-Z0-9]/g, '') ||
    domainMatchesCompanyName(registrable, withoutLeadingGenericWords(name)) ||
    labelIsDistinctiveWord(registrable, name);
  return accepted ? registrable : null;
}

/**
 * NIT → dominio. Prioridad: la web publicada en SECOP, luego su correo, luego el de
 * Supersociedades. Si las fuentes dan dominios distintos que llevan el nombre, gana
 * la web; si no hay web y discrepan, ninguno. Un dominio repetido en 3 NIT o más se
 * descarta (es de un grupo).
 */
export function buildCoSiisDomainMap(input: {
  siis: Iterable<{ nit: string; legalName: string }>;
  secop: Iterable<SecopProviderRow>;
  supersociedades: Iterable<SupersociedadesSubjectRow>;
}): Map<string, { domain: string; source: CoSiisDomainSource }> {
  const names = new Map<string, string>();
  for (const { nit, legalName } of input.siis) {
    const normalized = normalizeEntityNit(nit);
    if (normalized !== null && legalName.trim()) names.set(normalized, legalName);
  }

  const found = new Map<string, Map<CoSiisDomainSource, Set<string>>>();
  const add = (nit: string | null, source: CoSiisDomainSource, domain: string | null) => {
    if (nit === null) return;
    const legalName = names.get(nit);
    if (legalName === undefined) return;
    const accepted = acceptable(domain, legalName);
    if (accepted === null) return;
    const bySource = found.get(nit) ?? new Map<CoSiisDomainSource, Set<string>>();
    const set = bySource.get(source) ?? new Set<string>();
    set.add(accepted);
    bySource.set(source, set);
    found.set(nit, bySource);
  };

  for (const row of input.secop) {
    const nit = normalizeEntityNit(row.nit);
    add(nit, 'secop_web', normalizeWebsiteHost(row.sitio_web));
    add(nit, 'secop_email', emailDomain(row.correo));
  }
  for (const row of input.supersociedades) {
    add(normalizeEntityNit(row.nit), 'supersociedades_email', emailDomain(row.email));
  }

  const chosen = new Map<string, { domain: string; source: CoSiisDomainSource }>();
  for (const [nit, bySource] of found) {
    const web = bySource.get('secop_web');
    if (web !== undefined && web.size === 1) {
      chosen.set(nit, { domain: [...web][0], source: 'secop_web' });
      continue;
    }
    if (web !== undefined && web.size > 1) continue;
    const all = new Set<string>();
    for (const set of bySource.values()) for (const d of set) all.add(d);
    if (all.size !== 1) continue;
    const domain = [...all][0];
    const source: CoSiisDomainSource = bySource.get('secop_email')?.has(domain) ? 'secop_email' : 'supersociedades_email';
    chosen.set(nit, { domain, source });
  }

  const nitsPerDomain = new Map<string, number>();
  for (const { domain } of chosen.values()) nitsPerDomain.set(domain, (nitsPerDomain.get(domain) ?? 0) + 1);
  for (const [nit, { domain }] of chosen) {
    if ((nitsPerDomain.get(domain) ?? 0) >= CO_SIIS_SHARED_DOMAIN_MIN_NITS) chosen.delete(nit);
  }
  return chosen;
}

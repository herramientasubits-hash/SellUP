/**
 * pe-renamu-domain.ts — sitio web de las municipalidades del Perú a partir del
 * Registro Nacional de Municipalidades (RENAMU) del INEI.
 *
 * SOURCES-PE-MUNICIPAL-DOMAIN-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué ─────────────────────────────────────────────────────────────────
 *
 * Ninguna fuente oficial del Perú publica la web de las empresas ni de las
 * entidades con su RUC (revisado el 06-10-2026: SUNAT, OECE, gob.pe, Portal de
 * Transparencia, RENIPRESS, SUNEDU). En la 1.ª corrida real (Perú × Salud, lote
 * e963023c) las 52 propuestas del buscador gratuito fueron a «Descartadas» por no
 * tener web. El RENAMU (datos abiertos del INEI, ODbL) es la única fuente con la
 * web en una columna: la de cada municipalidad (P09) y su correo institucional
 * (P08), por ubigeo. Archivo 2025: 1.891 municipalidades.
 *
 * ── La regla ────────────────────────────────────────────────────────────────
 *
 *   · Primero la web declarada; si no sirve, el dominio del correo institucional.
 *   · Nunca correo gratuito, redes sociales, alojamientos gratuitos (blogspot,
 *     wixsite…) ni la página genérica `gob.pe/<entidad>`.
 *   · Se queda el dominio registrable («enlinea.munivinchos.gob.pe» →
 *     «munivinchos.gob.pe»).
 *   · El dominio sólo vale si su nombre contiene el del distrito (o, en una
 *     municipalidad provincial, el de la provincia o su distrito capital), entero o
 *     una palabra suya de 5+ letras: «munitacna.gob.pe» para Tacna sí;
 *     «mdcc.gob.pe» (siglas) no.
 *   · Un dominio en dos municipalidades distintas no es de ninguna.
 *   · Una errata («muniquilcas-gob.pe») no se corrige: se descarta.
 *
 * Medido el 06-10-2026: 771 municipalidades con dominio que cumple la regla.
 * Sólo se guarda el DOMINIO: nunca el correo, el teléfono ni la dirección.
 */

/** Fuente que se anota junto al dominio. */
export const PE_RENAMU_DOMAIN_SOURCE = 'inei_renamu_2025' as const;

/** Columnas del RENAMU que usa esta pieza. */
export type PeRenamuRow = {
  Ubigeo?: string;
  Tipomuni?: string;
  Provincia?: string;
  Distrito?: string;
  P08?: string;
  P09?: string;
};

/** Dominios que nunca son de la municipalidad. */
const NON_INSTITUTIONAL_DOMAINS: ReadonlySet<string> = new Set([
  'gob.pe', 'facebook.com', 'fb.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 'youtube.com',
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'hotmail.com.pe', 'outlook.com', 'outlook.es',
  'live.com', 'yahoo.com', 'yahoo.es', 'yahoo.com.pe', 'icloud.com', 'google.com',
]);
const FREE_HOSTING_SUFFIXES = ['.blogspot.com', '.wixsite.com', '.wordpress.com', '.000webhostapp.com', '.google.com', '.facebook.com'];
/** Segundos niveles peruanos: «x.gob.pe» se queda con tres partes. */
const PE_SECOND_LEVEL: ReadonlySet<string> = new Set(['gob', 'com', 'org', 'edu', 'net', 'mil', 'nom']);
const DOMAIN_SHAPE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function plain(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** «https://www.MuniTacna.gob.pe/inicio» → «munitacna.gob.pe»; `null` si no es un dominio. */
export function peDomainFromText(value: string | null | undefined): string | null {
  const text = (value ?? '').trim().toLowerCase();
  if (text.length === 0) return null;
  const host = (text.includes('@') ? text.split('@').pop()! : text)
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#\s]/)[0]
    .trim();
  return DOMAIN_SHAPE.test(host) ? host : null;
}

/** Dominio registrable: dos partes, o tres con un segundo nivel peruano («munitacna.gob.pe»). */
export function peRegistrableDomain(domain: string): string {
  const parts = domain.split('.').filter((p) => p.length > 0);
  const keep = parts.length >= 3 && parts[parts.length - 1] === 'pe' && PE_SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** Errata frecuente: «muniquilcas-gob.pe» por «muniquilcas.gob.pe». No se corrige: se descarta. */
const MISTYPED_GOB = /-gob\.pe$/;

function isInstitutional(domain: string): boolean {
  return (
    !NON_INSTITUTIONAL_DOMAINS.has(domain) &&
    !FREE_HOSTING_SUFFIXES.some((suffix) => domain.endsWith(suffix)) &&
    !MISTYPED_GOB.test(domain)
  );
}

/** ¿El nombre del dominio contiene el lugar (entero o una palabra de 5+ letras)? */
function labelNamesPlace(domain: string, places: readonly string[]): boolean {
  const label = plain(domain.split('.')[0]);
  return places.some((place) => {
    const whole = plain(place);
    if (whole.length >= 3 && label.includes(whole)) return true;
    return place.split(/\s+/).some((word) => {
      const w = plain(word);
      return w.length >= 5 && label.includes(w);
    });
  });
}

/** Clave de una municipalidad: ubigeo + tipo (1 provincial, 2 distrital). */
export function peRenamuKey(ubigeo: string | null | undefined, tipo: 'provincial' | 'distrital'): string | null {
  const code = (ubigeo ?? '').trim();
  return /^\d{6}$/.test(code) ? `${code}|${tipo}` : null;
}

/** El dominio de UNA fila del RENAMU, o `null`. */
export function peMunicipalDomainFromRenamu(row: PeRenamuRow): string | null {
  const provincial = (row.Tipomuni ?? '').trim() === '1';
  const places = provincial ? [row.Provincia ?? '', row.Distrito ?? ''] : [row.Distrito ?? ''];
  for (const raw of [row.P09, row.P08]) {
    const found = peDomainFromText(raw);
    if (found === null) continue;
    const domain = peRegistrableDomain(found);
    if (isInstitutional(found) && isInstitutional(domain) && labelNamesPlace(domain, places)) return domain;
  }
  return null;
}

/**
 * Mapa municipalidad (`ubigeo|tipo`) → dominio, sin los dominios que aparecen en
 * dos municipalidades distintas.
 */
export function buildPeRenamuDomainMap(rows: Iterable<PeRenamuRow>): Map<string, string> {
  const byKey = new Map<string, string>();
  const keysByDomain = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = peRenamuKey(row.Ubigeo, (row.Tipomuni ?? '').trim() === '1' ? 'provincial' : 'distrital');
    const domain = peMunicipalDomainFromRenamu(row);
    if (key === null || domain === null) continue;
    byKey.set(key, domain);
    keysByDomain.set(domain, (keysByDomain.get(domain) ?? new Set<string>()).add(key));
  }
  for (const [key, domain] of byKey) {
    if ((keysByDomain.get(domain)?.size ?? 0) > 1) byKey.delete(key);
  }
  return byKey;
}

/**
 * Tipo de una municipalidad por su razón social en SUNAT, o `null` si no es una
 * municipalidad provincial o distrital (las de centro poblado no están en el RENAMU).
 */
export function peMunicipalityTypeFromLegalName(legalName: string): 'provincial' | 'distrital' | null {
  const upper = legalName.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (!upper.startsWith('MUNICIPALIDAD') || upper.includes('CENTRO POBLADO')) return null;
  if (/^MUNICIPALIDAD\s+PROVINCIAL\b/.test(upper) || /^MUNICIPALIDAD\s+METROPOLITANA\b/.test(upper)) return 'provincial';
  if (/^MUNICIPALIDAD\s+DISTRITAL\b/.test(upper)) return 'distrital';
  return null;
}

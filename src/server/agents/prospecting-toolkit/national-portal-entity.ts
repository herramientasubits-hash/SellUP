/**
 * AUDIT-A1-WS7 (16-10) — entidades públicas que viven como RUTA del portal
 * nacional del Estado.
 *
 * Perú, México, Argentina, Uruguay y Ecuador publican sus ministerios dentro del
 * portal único: `gob.pe/minsa`, `gob.mx/sep`, `argentina.gob.ar/salud`,
 * `gub.uy/ministerio-salud-publica`, `gob.ec/msp`. Deduplicar por hostname las
 * fundía en UNA y el filtro de ruido, por coincidencia exacta con el portal, la
 * descartaba como «Portal nacional». Aquí la identidad es portal + primer
 * segmento de la ruta. La portada del portal (sin ruta) y las secciones genéricas
 * (`/tramites`, `/noticias`, `/busqueda`…) siguen sin ser una entidad.
 *
 * Puro: sin red.
 */

/** Portales nacionales cuyo primer segmento de ruta es una entidad. */
const NATIONAL_PORTALS_WITH_ENTITY_PATHS = new Set([
  'gob.pe',
  'gob.mx',
  'argentina.gob.ar',
  'gub.uy',
  'gob.ec',
]);

/** Secciones del portal que no son una entidad. */
const PORTAL_GENERIC_SEGMENTS = new Set([
  'tramites', 'tramite', 'noticias', 'noticia', 'busqueda', 'buscar', 'search', 'buscador',
  'instituciones', 'institucion', 'entidades', 'dependencias', 'organismos', 'servicios', 'servicio',
  'temas', 'tema', 'gobierno', 'normas', 'normas-legales', 'normatividad', 'campanas', 'campana',
  'agenda', 'acciones-y-programas', 'documentos', 'documento', 'prensa', 'articulos', 'articulo',
  'consulta', 'consultas', 'contacto', 'portal', 'es', 'en', 'pt', 'inicio', 'home', 'index',
  'informes-publicaciones', 'publicaciones', 'transparencia', 'datos', 'datos-abiertos',
  'participacion', 'participa', 'ayuda', 'mapa-del-sitio', 'sitemap', 'login', 'mi-argentina',
  'presidencia', 'estado', 'pais', 'guia', 'guias', 'convocatorias', 'empleo', 'empleos',
]);

const ENTITY_SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;

export type NationalPortalEntity = {
  /** Portal sin `www.` (p. ej. `gob.pe`). */
  host: string;
  /** Primer segmento de ruta que nombra a la entidad (p. ej. `minsa`). */
  slug: string;
  /** Clave de identidad / deduplicación: `gob.pe/minsa`. */
  key: string;
  /** Portada de la entidad dentro del portal: `https://www.gob.pe/minsa`. */
  website: string;
};

/** ¿Es (exactamente) uno de los portales nacionales con entidades por ruta? */
export function isNationalPortalWithEntityPaths(host: string | null | undefined): boolean {
  if (!host) return false;
  return NATIONAL_PORTALS_WITH_ENTITY_PATHS.has(host.toLowerCase().replace(/^www\./, ''));
}

/**
 * La entidad que publica una URL del portal nacional, o `null` si la URL no es
 * de esos portales, es su portada o una sección genérica.
 * En `gob.pe` las páginas interiores van como `/institucion/<entidad>/…`.
 */
export function readNationalPortalEntity(url: string | null | undefined): NationalPortalEntity | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!NATIONAL_PORTALS_WITH_ENTITY_PATHS.has(host)) return null;
  const segments = parsed.pathname
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment).toLowerCase();
      } catch {
        return segment.toLowerCase();
      }
    })
    .filter(Boolean);
  let slug = segments[0] ?? null;
  if (host === 'gob.pe' && slug === 'institucion') slug = segments[1] ?? null;
  if (!slug || PORTAL_GENERIC_SEGMENTS.has(slug) || !ENTITY_SLUG.test(slug)) return null;
  return {
    host,
    slug,
    key: `${host}/${slug}`,
    website: `https://www.${host}/${slug}`,
  };
}

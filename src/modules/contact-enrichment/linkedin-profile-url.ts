// Agente 2A — URL de perfil de LinkedIn: validar y normalizar (F2 · AGENT2A-LINKEDIN-CONTACT-SEARCH).
//
// Puro: sin red, sin Supabase. Lo usan la búsqueda por LinkedIn (la URL que pega el usuario) y
// la deduplicación en SellUp (las URLs que ya están guardadas en `contacts` y en candidatos):
// las dos partes se comparan con la MISMA clave, así que «https://es.linkedin.com/in/ana-perez/»
// y «linkedin.com/in/Ana-Perez?trk=x» son la misma persona.
//
// Reglas:
//   - sólo perfiles personales `/in/<slug>`; `/company/`, `/school/` y `/showcase/` se rechazan
//     con un mensaje propio;
//   - se quitan protocolo, cualquier subdominio (`www.`, `es.`, `cl.`, `m.`…), parámetros,
//     ancla, la barra final y lo que venga después del slug (`/es`, `/details/…`);
//   - el slug se decodifica (`%C3%A9` → `é`) y se pasa a minúsculas;
//   - formatos que no se pueden llevar a un slug estable (`/pub/…`, `/sales/…`) se rechazan.
//
// La URL canónica que se guarda y se envía a los proveedores es
// `https://www.linkedin.com/in/<slug>` (con el slug codificado de nuevo si tiene tildes).

export type LinkedinProfileUrlRejection =
  | 'empty'
  | 'not_linkedin'
  | 'company_page'
  | 'not_profile'
  | 'unsupported_profile_format';

export type LinkedinProfileUrlResult =
  | { ok: true; slug: string; canonicalUrl: string }
  | { ok: false; reason: LinkedinProfileUrlRejection };

/** Mensajes para el usuario. Nunca repiten la URL (dato personal). */
export const LINKEDIN_PROFILE_URL_ERROR_COPY: Record<LinkedinProfileUrlRejection, string> = {
  empty: 'Pega el enlace del perfil de LinkedIn de la persona.',
  not_linkedin: 'Ese enlace no es de LinkedIn. Pega el enlace del perfil, por ejemplo linkedin.com/in/nombre-apellido.',
  company_page:
    'Ese enlace es de una página de empresa (o institución), no de una persona. Para buscar contactos de una empresa usa «Por empresa»; aquí pega el perfil de la persona (linkedin.com/in/…).',
  not_profile: 'Ese enlace de LinkedIn no es un perfil de persona. Debe tener la forma linkedin.com/in/nombre-apellido.',
  unsupported_profile_format:
    'No podemos leer ese formato de perfil (enlaces antiguos /pub/ o de Sales Navigator). Abre el perfil en LinkedIn y copia el enlace linkedin.com/in/….',
};

const ORGANIZATION_SECTIONS = new Set(['company', 'school', 'showcase']);
const UNSUPPORTED_PROFILE_SECTIONS = new Set(['pub', 'sales', 'profile']);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Valida y normaliza el enlace de un perfil de LinkedIn. Nunca lanza.
 */
export function normalizeLinkedinProfileUrl(raw: string | null | undefined): LinkedinProfileUrlResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  // Sin protocolo, sin parámetros ni ancla.
  const withoutProtocol = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const withoutQuery = withoutProtocol.replace(/[?#].*$/, '');
  const slashIndex = withoutQuery.indexOf('/');
  const host = (slashIndex === -1 ? withoutQuery : withoutQuery.slice(0, slashIndex)).toLowerCase().replace(/:\d+$/, '');
  const path = slashIndex === -1 ? '' : withoutQuery.slice(slashIndex);

  // linkedin.com o cualquier subdominio (www., es., cl., m., …). Nada de lnkd.in u otros dominios.
  if (!(host === 'linkedin.com' || host.endsWith('.linkedin.com'))) {
    return { ok: false, reason: 'not_linkedin' };
  }

  const segments = path.split('/').filter((segment) => segment.length > 0);
  const section = segments[0]?.toLowerCase();
  if (!section) return { ok: false, reason: 'not_profile' };
  if (ORGANIZATION_SECTIONS.has(section)) return { ok: false, reason: 'company_page' };
  if (UNSUPPORTED_PROFILE_SECTIONS.has(section)) return { ok: false, reason: 'unsupported_profile_format' };
  if (section !== 'in') return { ok: false, reason: 'not_profile' };

  const rawSlug = safeDecode(segments[1] ?? '').trim();
  // `/in/ACoAA…`: id interno de LinkedIn (Sales Navigator / API), no el enlace público.
  if (/^ACo[A-Za-z0-9_-]{10,}$/.test(rawSlug)) return { ok: false, reason: 'unsupported_profile_format' };
  const slug = rawSlug.toLowerCase();
  if (!slug || /[\s/]/.test(slug)) return { ok: false, reason: 'not_profile' };

  return { ok: true, slug, canonicalUrl: `https://www.linkedin.com/in/${encodeURIComponent(slug)}` };
}

/**
 * Clave de comparación de un perfil (el slug normalizado), o null si el valor no es un perfil
 * `/in/` legible. Sirve para las dos partes de una comparación.
 */
export function linkedinProfileKey(value: string | null | undefined): string | null {
  const result = normalizeLinkedinProfileUrl(value);
  return result.ok ? result.slug : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Patrones `ilike` para preseleccionar en la base de datos las filas cuyo `linkedin_url` contiene
 * `/in/<slug>`, tal cual o codificado (`%C3%A9`) si el slug tiene tildes. Sólo preseleccionan:
 * cada fila se confirma después con `linkedinProfileKey`. Se escapan `%`, `_` y `\`.
 */
export function linkedinSlugIlikePatterns(slug: string): string[] {
  const forms = new Set([slug, encodeURIComponent(slug)]);
  return [...forms].map((form) => `%/in/${escapeLike(form)}%`);
}

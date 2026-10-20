/**
 * AGENT1-SHARED-HOSTS-1 — hosts COMPARTIDOS: la «web» es de una plataforma, no de
 * la empresa.
 *
 * Antes cada lugar tenía su propia lista: `external-platform-blocklist.ts` (sin
 * `sites.google.com`, `linktr.ee`, `business.site`, `wa.me`, `bit.ly`…) y tres
 * copias por país (`ve-domain.ts`, `ni-domain.ts`, `ec-sercop-domain.ts`) que ya
 * se habían separado entre sí. Y la identidad de empresa no usaba NINGUNA: dos
 * empresas con su página en Google Sites salían con el MISMO dominio
 * (`sites.google.com`) y el reclamo global de la primera apartaba a la segunda.
 *
 * Este módulo es la ÚNICA lista. Dos formas de mirarla, a propósito distintas:
 *
 *   · `isSharedPlatformHost` — coincidencia EXACTA o por subdominio contra
 *     `SHARED_PLATFORM_HOSTS`. Es la que usa la IDENTIDAD de empresa
 *     (`normalizeIdentityDomain`): no adivina por la etiqueta, así que una
 *     empresa real cuyo dominio empiece por «bit» o «wa» no pierde su dominio.
 *   · `isPlatformHostByLabel` — la regla por ETIQUETA con cualquier terminación
 *     (`facebook.com.ve`, `x.wixsite.com`) que ya usaban los conectores de
 *     Venezuela y Nicaragua, más amplia, para limpiar webs publicadas por
 *     fuentes de un país.
 *
 * Puro: sin env, sin I/O, sin reloj.
 */

/**
 * Hosts que NUNCA son el sitio propio de una empresa: redes sociales,
 * acortadores, enlaces en bio, constructores de sitios gratuitos y correo
 * gratuito. Un subdominio de cualquiera de ellos (`acme.wixsite.com`,
 * `sites.google.com`) también lo es.
 */
export const SHARED_PLATFORM_HOSTS: ReadonlySet<string> = new Set([
  // Redes sociales y mensajería
  'facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'youtube.com', 'youtu.be', 'linkedin.com', 'lnkd.in', 'whatsapp.com', 'wa.me', 'wa.link',
  'pinterest.com', 'threads.net', 't.me', 'telegram.me',
  // Acortadores y enlaces en bio
  'bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 'linktr.ee', 'linkin.bio', 'beacons.ai',
  // Google: Sites, perfiles de negocio, mapas
  'google.com', 'business.site', 'negocio.site', 'g.page',
  // Constructores de sitios y blogs gratuitos
  'blogspot.com', 'blogger.com', 'wordpress.com', 'wixsite.com', 'wix.com', 'weebly.com',
  'jimdo.com', 'jimdofree.com', 'site123.me', 'webnode.com', 'webnode.es', 'godaddysites.com',
  'carrd.co', 'es.tl', 'square.site', 'mystrikingly.com', 'strikingly.com',
  // Correo gratuito
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com',
  'icloud.com',
]);

/** ¿El host es (o cuelga de) uno de `SHARED_PLATFORM_HOSTS`? */
export function isSharedPlatformHost(host: string | null | undefined): boolean {
  if (typeof host !== 'string') return false;
  const lower = host.trim().toLowerCase().replace(/\.$/, '');
  if (!lower) return false;
  for (const shared of SHARED_PLATFORM_HOSTS) {
    if (lower === shared || lower.endsWith(`.${shared}`)) return true;
  }
  return false;
}

/**
 * Redes sociales, enlaces y alojamiento gratuito reconocidos por la ETIQUETA, con
 * cualquier terminación (`facebook.com.ve`, `x.wixsite.com`). Es la regla que ya
 * aplicaban `ve-domain.ts` y `ni-domain.ts`, movida aquí sin cambiarla.
 */
const PLATFORM_HOST_LABEL =
  /(^|\.)(facebook|fb|instagram|twitter|x|tiktok|youtube|youtu|linkedin|whatsapp|wa|linktr|google|goo|blogspot|blogger|wordpress|wixsite|wix|weebly|jimdo|jimdofree|site123|webnode|godaddysites|carrd|bit|tinyurl)\.[a-z.]+$/;

/** Hosts de enlaces/sitios gratuitos sin etiqueta reconocible (`linktr.ee`, `es.tl`…). */
const PLATFORM_HOST_EXACT_SUFFIX = /(^|\.)(linktr\.ee|wa\.me|bit\.ly|business\.site|negocio\.site|es\.tl)$/;

/**
 * Regla amplia por etiqueta para webs publicadas por fuentes de un país: la de
 * `isSharedPlatformHost` MÁS la coincidencia por etiqueta con cualquier
 * terminación.
 */
export function isPlatformHostByLabel(host: string | null | undefined): boolean {
  if (typeof host !== 'string') return false;
  const lower = host.trim().toLowerCase();
  if (!lower) return false;
  return (
    PLATFORM_HOST_LABEL.test(lower) ||
    PLATFORM_HOST_EXACT_SUFFIX.test(lower) ||
    isSharedPlatformHost(lower)
  );
}

/**
 * ¿La búsqueda web respalda este dominio? (puro)
 *
 * Igual, o subdominio de un resultado, o padre de un resultado SÓLO si el padre es un
 * dominio registrable propio. Sin esta guarda, un resultado `x.blogspot.com` o
 * `alcaldia.gov.co` respaldaría `blogspot.com` o `gov.co` (revisión 01-10).
 */

/** Partes de sufijo público habituales en la región (no identifican a nadie). */
const PUBLIC_SUFFIX_PARTS = new Set([
  'com', 'net', 'org', 'co', 'gob', 'gov', 'edu', 'ac', 'mil', 'int', 'info', 'biz', 'nom', 'web',
  'mx', 'pe', 'cl', 'ar', 'ec', 'uy', 'py', 'bo', 've', 'cr', 'pa', 'gt', 'hn', 'sv', 'ni', 'do',
  'br', 'es', 'us', 'io', 'app', 'dev', 'ai', 'tech', 'online', 'site',
]);

/** Alojamientos compartidos: el dominio padre es de la plataforma, no de la empresa. */
const SHARED_HOSTS = new Set([
  'blogspot.com', 'wordpress.com', 'github.io', 'vercel.app', 'netlify.app', 'herokuapp.com',
  'wixsite.com', 'squarespace.com', 'webnode.com', 'weebly.com', 'sites.google.com', 'google.com',
  'azurewebsites.net', 'cloudfront.net', 'firebaseapp.com', 'web.app', 'pages.dev', 'myshopify.com',
]);

/** ¿Tiene al menos una etiqueta propia antes del sufijo público? */
export function isRegistrableDomain(domain: string): boolean {
  if (SHARED_HOSTS.has(domain)) return false;
  const labels = domain.split('.').filter(Boolean);
  let end = labels.length;
  while (end > 0 && PUBLIC_SUFFIX_PARTS.has(labels[end - 1])) end -= 1;
  return end >= 1 && labels.length >= 2;
}

export function searchConfirmsDomain(claimed: string, searchDomain: string): boolean {
  if (claimed === searchDomain) return true;
  // Subdominio de un resultado (resultado `unam.mx`, propuesto `portal.unam.mx`).
  if (claimed.endsWith(`.${searchDomain}`)) return isRegistrableDomain(searchDomain);
  // Padre de un resultado (resultado `portal.unam.mx`, propuesto `unam.mx`).
  if (searchDomain.endsWith(`.${claimed}`)) return isRegistrableDomain(claimed);
  return false;
}

export function anySearchConfirms(claimed: string, searchDomains: readonly string[]): boolean {
  return searchDomains.some((d) => searchConfirmsDomain(claimed, d));
}

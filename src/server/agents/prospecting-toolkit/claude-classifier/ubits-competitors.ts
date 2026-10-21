/**
 * AGENT1-SUPPLIER-SEARCH-2 — competidores de UBITS (formación corporativa / e-learning).
 *
 * En «Proveedores de una empresa» aparecen solos: los casos de éxito de plataformas de
 * aprendizaje con grandes empresas son justo lo que la búsqueda encuentra (Prod 14-10:
 * Degreed como «proveedor de Ecopetrol»). Son competidores, no prospectos.
 *
 * Se reconoce por la etiqueta propia del dominio (degreed.com, crehana.co, platzi.com…),
 * así que cubre sus dominios por país. Lista cerrada a propósito: una palabra suelta como
 * «academia» descartaría universidades y colegios, que SÍ son clientes de UBITS.
 */

import { normalizeDomain } from '../normalization';
import { ownDomainLabel } from './site-match';

/** Etiqueta propia del dominio de cada competidor conocido. */
export const UBITS_COMPETITOR_DOMAIN_LABELS: ReadonlySet<string> = new Set([
  'ubits',
  'degreed',
  'crehana',
  'platzi',
  'coursera',
  'udemy',
  'edx',
  'docebo',
  'cornerstoneondemand',
  'skillsoft',
  'pluralsight',
  '360learning',
  'talentlms',
  'absorblms',
  'go1',
  'domestika',
  'acamica',
  'workera',
  'valamis',
  'totaralearning',
  'learnworlds',
  'thinkific',
  'teachable',
  'emagister',
  'goconqr',
]);

/**
 * AGENT1-SUPPLIER-AUDIT-NOW-1 — ¿el nombre es de un competidor de UBITS? Para lo que llega
 * sin sitio (compras públicas: «COURSERA INC», «UDEMY IRELAND LIMITED»). Una palabra
 * completa del nombre debe ser la etiqueta: «Platzi» sí; «Edxcel» no.
 */
export function isUbitsCompetitorName(name: string | null | undefined): boolean {
  const words = (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((word) => UBITS_COMPETITOR_DOMAIN_LABELS.has(word));
}

/** ¿El sitio es de un competidor de UBITS? */
export function isUbitsCompetitorDomain(urlOrDomain: string): boolean {
  const domain = normalizeDomain(urlOrDomain);
  if (!domain) return false;
  const label = ownDomainLabel(domain);
  return !!label && UBITS_COMPETITOR_DOMAIN_LABELS.has(label.toLowerCase());
}

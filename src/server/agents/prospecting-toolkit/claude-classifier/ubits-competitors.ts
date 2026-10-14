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

/** ¿El sitio es de un competidor de UBITS? */
export function isUbitsCompetitorDomain(urlOrDomain: string): boolean {
  const domain = normalizeDomain(urlOrDomain);
  if (!domain) return false;
  const label = ownDomainLabel(domain);
  return !!label && UBITS_COMPETITOR_DOMAIN_LABELS.has(label.toLowerCase());
}

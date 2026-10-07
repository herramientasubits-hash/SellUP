/**
 * SOURCES-EC-GOV-HEAD-ONLY-1 (dueña 07-10: «adelante la A») — en Ecuador una
 * entidad PÚBLICA sólo cuenta como prospecto si es la CABEZA de una institución
 * (ministerio, secretaría, prefectura, municipio grande, universidad pública,
 * hospital grande: la regla por tipo de `classifyEcPublicEntity`).
 *
 * El SRI no informa servidores (y el SIITH está bloqueado fuera de Ecuador), así
 * que el tamaño de una CABEZA viaja como un tramo «200+» (pasa el filtro de tamaño
 * como estimado), para cualquier proveedor. Sólo se completa cuando la fuente no
 * trajo tamaño; las sociedades privadas no cambian.
 *
 * Lo que NO es cabeza sólo se saca cuando llega por Tavily (decisión A, sólo
 * Tavily): una web .gob/.edu de Ecuador con RUC público que no es cabeza
 * (dependencia, junta parroquial, municipio chico) o sin RUC (portales como
 * «Quito Informa», programas, institutos chicos) se marca pequeña para el mismo
 * filtro. Apollo no cambia: su tamaño viene del proveedor.
 *
 * Puro salvo el reloj (año del dato).
 */

import { classifyEcPublicEntity } from '@/server/source-catalog/connectors/ec-scvs/ec-public-entity-classifier';
import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
  OfficialWorkforce,
} from '@/server/agents/prospect-intake/source-enrichment';

/** RUC de una entidad pública: tercer dígito 6. */
const EC_PUBLIC_RUC = /^\d{2}6\d{7}001$/;

export const EC_PUBLIC_ENTITY_SIZE_SOURCE = 'SRI · regla por tipo de entidad pública';
export const EC_PUBLIC_HEAD_FLOOR = 200;
export const EC_PUBLIC_SMALL_CEILING = 49;
export const EC_PUBLIC_HEAD_BAND = 'entidad cabeza';

/** Rango que el filtro de tamaño lee como «pequeña» para una web institucional que no es cabeza. */
export const EC_INSTITUTION_NOT_HEAD_SIZE = `1-${EC_PUBLIC_SMALL_CEILING}`;

const EC_INSTITUTION_HOST = /\.(gob|edu|mil)\.ec$/;

export function isEcPublicRuc(taxId: string | null | undefined): boolean {
  return typeof taxId === 'string' && EC_PUBLIC_RUC.test(taxId.trim());
}

/** ¿RUC público de una entidad CABEZA? */
export function isEcPublicHead(taxId: string | null | undefined, legalName: string | null | undefined): boolean {
  return isEcPublicRuc(taxId) && classifyEcPublicEntity(legalName) !== null;
}

/** El tamaño «200+» de una entidad pública cabeza, o `null` si no lo es. */
export function ecPublicEntityWorkforce(
  taxId: string | null | undefined,
  legalName: string | null | undefined,
  year: number,
): OfficialWorkforce | null {
  if (!isEcPublicHead(taxId, legalName)) return null;
  return { workers: EC_PUBLIC_HEAD_FLOOR, year, source: EC_PUBLIC_ENTITY_SIZE_SOURCE, maxWorkers: null, sizeBand: EC_PUBLIC_HEAD_BAND };
}

/** Añade el tamaño por tipo a un RUC público encontrado sin tamaño. */
export function withEcPublicEntitySize(
  inner: OfficialSourceResolver,
  nowYear: () => number = () => new Date().getUTCFullYear(),
): OfficialSourceResolver {
  return {
    ...inner,
    canResolve: (input) => inner.canResolve(input),
    async resolve(input) {
      const result: OfficialSourceEnrichmentResult = await inner.resolve(input);
      if (result.status !== 'matched' || result.workforce) return result;
      const workforce = ecPublicEntityWorkforce(result.taxIdentifier, result.legalName, nowYear());
      return workforce ? { ...result, workforce } : result;
    },
  };
}

/**
 * Tavily: ¿web .gob/.edu/.mil de Ecuador que NO es una entidad cabeza confirmada?
 * Sin RUC, o con RUC público que no es cabeza. Con RUC PRIVADO (universidad o
 * colegio privado con .edu.ec) no se toca: su tamaño lo decide la Superintendencia.
 */
export function isEcTavilyInstitutionNotHead(params: {
  countryCode: string | null | undefined;
  domain: string | null | undefined;
  taxId: string | null | undefined;
  legalName: string | null | undefined;
}): boolean {
  if ((params.countryCode ?? '').toUpperCase() !== 'EC' || !isEcInstitutionHost(params.domain)) return false;
  const taxId = params.taxId?.trim() ? params.taxId : null;
  if (taxId === null) return true;
  return isEcPublicRuc(taxId) && !isEcPublicHead(taxId, params.legalName);
}

/** ¿Web de gobierno/educación/militar de Ecuador? */
export function isEcInstitutionHost(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return EC_INSTITUTION_HOST.test(domain.toLowerCase().trim().replace(/^www\./, '').replace(/\/.*$/, ''));
}

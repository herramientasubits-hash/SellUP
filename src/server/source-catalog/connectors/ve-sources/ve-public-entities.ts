/**
 * ve-public-entities.ts — entes públicos de Venezuela con su web oficial, para la
 * capa gratuita de Gobierno.
 *
 * SOURCES-VE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * (Tabla en construcción: se genera a partir de los dominios comprobados.)
 */

export type VePublicEntityKind =
  | 'national'
  | 'territorial_state'
  | 'territorial_municipality'
  | 'state_company'
  | 'public_university'
  | 'hospital';

export type VePublicEntity = {
  domain: string;
  name: string;
  kind: VePublicEntityKind;
  /** RIF que muestra la propia portada (con verificador), o `null`. */
  rif: string | null;
  /** Wikidata (Q…), si la entidad está allí. */
  wikidata: string | null;
};

export const VE_PUBLIC_ENTITIES: readonly VePublicEntity[] = Object.freeze([]);

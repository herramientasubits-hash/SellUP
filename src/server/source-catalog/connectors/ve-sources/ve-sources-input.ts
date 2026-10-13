/**
 * ve-sources-input.ts — las líneas que escriben los extractores de Venezuela
 * (`scripts/source-catalog/extract-ve-official-sources.py`), ya validadas.
 *
 * SOURCES-VE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Fuentes (medidas el 13-10-2026; ninguna da tamaño):
 *
 *   1. Bolsa de Caracas — emisoras (114) y casas de bolsa (36): RIF, sector de la
 *      Bolsa, objeto social y web. Consulta pública de su propia web (`admin-ajax`,
 *      permitida por su robots.txt).
 *   2. SUDEASEG — sujetos regulados del sector asegurador: 240 personas jurídicas con
 *      RIF y categoría (aseguradoras, medicina prepagada, corretaje, reaseguro,
 *      ajustadores, financiadoras de primas, cooperativas). Las personas naturales
 *      nunca se leen.
 *   3. SUNAVAL — mercado de valores (copia del Internet Archive del 03-07-2022):
 *      emisores, fondos mutuales, sociedades administradoras, calificadoras, asesores
 *      de inversión y firmas de contadores, con RIF.
 *   4. GLEIF — personas jurídicas venezolanas con identificador LEI; el RIF viene en
 *      «registeredAs» cuando la entidad lo declaró.
 *   5. Webs comprobadas (tablas estáticas): entes públicos, universidades y empresas
 *      con web propia que responde; el RIF sólo si la propia portada lo muestra con
 *      su dígito verificador.
 *
 * Nunca se guardan correos, teléfonos, direcciones ni nombres de personas.
 */

import { calculateVenezuelaRifCheckDigit } from '@/modules/prospect-batches/tax-identifier-rules';

/** RIF de persona jurídica (J) o de ente público (G): letra + 8 dígitos + verificador. */
export const VE_ENTITY_RIF = /^[JG]-\d{8}-\d$/;

const cleanText = (value: string | null | undefined): string | null => {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 0 ? text : null;
};

/**
 * RIF crudo → RIF de empresa o ente público canónico («J-00282860-9»), o `null`.
 * Acepta «J - 301664710», «J002828609», «J-00282860-9» y nueve dígitos con la letra
 * pegada. Exige el dígito verificador: un RIF mal copiado no se guarda.
 */
export function canonicalVenezuelaRif(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.toUpperCase().replace(/[\s.\-–—]/g, '');
  const match = /^([JG])(\d{8})(\d)$/.exec(compact);
  if (match === null || match[2] === '12345678' || /^0{8}$/.test(match[2])) return null;
  if (calculateVenezuelaRifCheckDigit(match[1], match[2]) !== Number(match[3])) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Emisora de la Bolsa de Caracas. */
export type VeBvcIssuer = {
  code: string;
  name: string;
  rif: string;
  sector: string | null;
  activity: string | null;
  web: string | null;
  emailDomains: readonly string[];
};

/** Casa de bolsa miembro de la Bolsa de Caracas (sólo las activas). */
export type VeBvcMember = { code: string; name: string; rif: string; web: string | null; emailDomains: readonly string[] };

/** Persona jurídica regulada por la SUDEASEG (sólo las activas). */
export type VeSudeasegEntity = { name: string; rif: string; category: string };

/** Entidad del registro de la SUNAVAL (copia de 2022; sólo las activas). */
export type VeSunavalEntity = { name: string; rif: string; kind: string };

/** Persona jurídica venezolana en GLEIF con su RIF declarado. */
export type VeGleifEntity = { name: string; otherNames: readonly string[]; rif: string; active: boolean };

/** Qué es una entidad con web comprobada. */
export type VeWebListingKind = 'public_entity' | 'state_company' | 'private_university' | 'company';

/** Entidad con web propia comprobada (tablas `ve-web-entities.ts` y `ve-public-entities.ts`). */
export type VeWebListing = {
  kind: VeWebListingKind;
  /** Clave estable: el Q de Wikidata o `gob:<dominio>` para un ente sin Q. */
  qid: string;
  name: string;
  domain: string;
  /** Tipo de ente público (`ve-public-entities.ts`) o `null`. */
  publicKind: string | null;
  /** RIF que muestra la propia portada (con verificador), o `null`. */
  rif: string | null;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const str = (value: unknown): string | null => (typeof value === 'string' ? cleanText(value) : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter((v): v is string => v !== null) : [];

export function parseVeBvcIssuer(raw: unknown): VeBvcIssuer | null {
  const r = record(raw);
  const rif = canonicalVenezuelaRif(str(r?.['rif']));
  const name = str(r?.['name']);
  const code = str(r?.['code']);
  if (r === null || rif === null || name === null || code === null) return null;
  return { code, name, rif, sector: str(r['sector']), activity: str(r['activity']), web: str(r['web']), emailDomains: strings(r['email_domains']) };
}

export function parseVeBvcMember(raw: unknown): VeBvcMember | null {
  const r = record(raw);
  const rif = canonicalVenezuelaRif(str(r?.['rif']));
  const name = str(r?.['name']);
  const code = str(r?.['code']);
  if (r === null || rif === null || name === null || code === null || str(r['status']) !== 'A') return null;
  return { code, name, rif, web: str(r['web']), emailDomains: strings(r['email_domains']) };
}

export function parseVeSudeasegEntity(raw: unknown): VeSudeasegEntity | null {
  const r = record(raw);
  const rif = canonicalVenezuelaRif(str(r?.['rif']));
  const name = str(r?.['name']);
  const category = str(r?.['category']);
  if (r === null || rif === null || name === null || category === null) return null;
  if (str(r['status'])?.toLowerCase() !== 'activo') return null;
  return { name, rif, category };
}

export function parseVeSunavalEntity(raw: unknown): VeSunavalEntity | null {
  const r = record(raw);
  const rif = canonicalVenezuelaRif(str(r?.['rif']));
  const name = str(r?.['name']);
  const kind = str(r?.['kind']);
  if (r === null || rif === null || name === null || kind === null) return null;
  if (str(r['status'])?.toUpperCase() !== 'ACTIVO') return null;
  return { name, rif, kind };
}

export function parseVeGleifEntity(raw: unknown): VeGleifEntity | null {
  const r = record(raw);
  const rif = canonicalVenezuelaRif(str(r?.['registered_as']));
  const name = str(r?.['name']);
  if (r === null || rif === null || name === null) return null;
  return { name, otherNames: strings(r['other_names']), rif, active: str(r['entity_status']) === 'ACTIVE' };
}

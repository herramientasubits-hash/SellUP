/**
 * Qué escribió quien busca (dueña 25-11: «que el buscador encuentre por ID, NIT, dominio,
 * nombre, correo y teléfono, en SellUp y en HubSpot»). Puro: sin red ni Supabase.
 *
 * Lo escrito se lee UNA vez y se dice qué puede ser —a la vez puede ser varias cosas: «900123456»
 * puede ser un NIT, un teléfono o un ID de HubSpot— y cada fuente busca por lo que tiene:
 *
 * | Criterio                  | SellUp empresas            | SellUp contactos         | HubSpot empresas                 | HubSpot contactos                     |
 * |---------------------------|----------------------------|--------------------------|----------------------------------|---------------------------------------|
 * | Nombre                    | nombre, razón social       | nombre completo          | texto libre (nombre)             | texto libre (nombre, empresa)         |
 * | ID de SellUp (uuid)       | id                         | id                       | —                                | —                                     |
 * | ID de HubSpot (dígitos)   | hubspot_company_id         | hubspot_contact_id       | Company ID                       | Contact ID                            |
 * | Número fiscal (NIT, RFC…) | tax_identifier (por dígitos)| —                       | identificaci_n_fiscal, rfc_mx_   | —                                     |
 * | Dominio / web             | domain, website            | correo (@dominio)        | texto libre (domain, website)    | texto libre (correo)                  |
 * | Correo                    | —                          | email                    | —                                | texto libre (email)                   |
 * | Teléfono / celular        | —                          | phone, mobile_phone      | texto libre (phone)              | teléfono y celular (últimos dígitos)  |
 *
 * Los teléfonos y los números fiscales se comparan por sus DÍGITOS en orden (los separadores
 * no importan: «+57 300 123 4567» = «3001234567»; «900.123.456-7» = «9001234567»).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Sólo lo que puede tener un teléfono escrito a mano. */
const PHONE_SHAPE = /^\+?[\d\s().-]+$/;
/** Sólo lo que puede tener un NIT/RUT/CUIT escrito a mano (con su dígito «K» de Chile). */
const NUMERIC_TAX_SHAPE = /^[\d.\s-]+[kK]?$/;
/** RFC de México (persona moral o física). */
const RFC_SHAPE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;
const DOMAIN_SHAPE = /^(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/?#].*)?$/i;

/** Mínimo de dígitos para buscar por teléfono (evita que «2024» encuentre cualquier número). */
export const MIN_PHONE_DIGITS = 7;
/** Mínimo de dígitos para buscar por número fiscal. */
export const MIN_TAX_DIGITS = 6;
/** Los teléfonos se comparan por sus últimos dígitos: así da igual el indicativo del país. */
export const PHONE_SUFFIX_DIGITS = 8;

export interface SearchCriteria {
  /** Lo escrito, recortado y con espacios colapsados. */
  text: string;
  /** Un id de SellUp (uuid). */
  sellupId: string | null;
  /** Un ID de HubSpot (sólo dígitos). */
  hubspotId: string | null;
  /** Correo completo, en minúsculas. */
  email: string | null;
  /** Dominio (de una web o de lo que va tras la @), sin `www.`. */
  domain: string | null;
  /** Número fiscal: sus dígitos (NIT, RUT, CUIT, RUC…). */
  taxDigits: string | null;
  /** Número fiscal alfanumérico (RFC), en mayúsculas. */
  taxText: string | null;
  /** Teléfono: sus dígitos. */
  phoneDigits: string | null;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Lee lo escrito. Puede ser varias cosas a la vez (p. ej. NIT y teléfono). */
export function parseSearchCriteria(raw: string): SearchCriteria {
  const text = raw.replace(/\s+/g, ' ').trim();
  const compact = text.replace(/\s/g, '');
  const digits = onlyDigits(text);

  const isEmail = EMAIL_SHAPE.test(text);
  const email = isEmail ? text.toLowerCase() : null;
  const domainMatch = isEmail ? null : DOMAIN_SHAPE.exec(compact);
  const domain = isEmail
    ? text.split('@')[1].toLowerCase()
    : domainMatch
      ? domainMatch[1].toLowerCase()
      : null;

  const isPhoneShaped = PHONE_SHAPE.test(text);
  const isNumericTax = NUMERIC_TAX_SHAPE.test(text);
  return {
    text,
    sellupId: UUID.test(text) ? text.toLowerCase() : null,
    hubspotId: /^\d{1,20}$/.test(compact) ? compact : null,
    email,
    domain,
    taxDigits: isNumericTax && digits.length >= MIN_TAX_DIGITS ? digits : null,
    taxText: RFC_SHAPE.test(compact) ? compact.toUpperCase() : null,
    phoneDigits: isPhoneShaped && digits.length >= MIN_PHONE_DIGITS ? digits.slice(0, 15) : null,
  };
}

/** Los últimos dígitos de un teléfono (sin el indicativo del país, que se escribe o no). */
export function phoneSuffix(digits: string): string {
  return digits.length > PHONE_SUFFIX_DIGITS ? digits.slice(-PHONE_SUFFIX_DIGITS) : digits;
}

/**
 * Patrón `ilike` que encuentra los dígitos en orden aunque el valor guardado tenga
 * separadores: «3001234567» → `%3%0%0%1%2%3%4%5%6%7%` encuentra «+57 300 123 4567».
 * Sólo dígitos: no puede inyectar nada en el filtro.
 */
export function digitsInOrderPattern(digits: string): string {
  const clean = onlyDigits(digits);
  return clean.length === 0 ? '' : `%${clean.split('').join('%')}%`;
}

/** ¿Es algo más que un nombre? (Decide si vale la pena una consulta por criterio.) */
export function hasStructuredCriteria(criteria: SearchCriteria): boolean {
  return Boolean(
    criteria.sellupId ||
      criteria.hubspotId ||
      criteria.email ||
      criteria.domain ||
      criteria.taxDigits ||
      criteria.taxText ||
      criteria.phoneDigits,
  );
}

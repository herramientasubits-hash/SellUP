/**
 * Lista corta y editable de países para `PhoneInput`: LATAM + España + EE. UU.
 *
 * No es un catálogo mundial a propósito. Son los mercados donde operamos; si
 * hace falta otro país, se añade aquí (y solo aquí) con su prefijo, la longitud
 * del número nacional y cómo se agrupa al escribirlo.
 */

export type CountryCode =
  | "CO"
  | "MX"
  | "AR"
  | "BR"
  | "CL"
  | "PE"
  | "EC"
  | "VE"
  | "BO"
  | "PY"
  | "UY"
  | "CR"
  | "PA"
  | "GT"
  | "SV"
  | "HN"
  | "NI"
  | "DO"
  | "ES"
  | "US"

export interface Country {
  /** ISO 3166-1 alfa-2. */
  code: CountryCode
  /** Nombre en español, como se lee en la lista. */
  name: string
  /** Prefijo internacional, con el «+» incluido. */
  dialCode: string
  /** Bandera como emoji; decorativa, nunca la única pista. */
  flag: string
  /** Longitud esperada del número nacional (sin prefijo). */
  length: number
  /** Cómo se agrupan los dígitos al escribir: `[3, 3, 4]` → «300 123 4567». */
  groups: number[]
}

export const PHONE_COUNTRIES: readonly Country[] = [
  { code: "CO", name: "Colombia", dialCode: "+57", flag: "🇨🇴", length: 10, groups: [3, 3, 4] },
  { code: "MX", name: "México", dialCode: "+52", flag: "🇲🇽", length: 10, groups: [2, 4, 4] },
  { code: "AR", name: "Argentina", dialCode: "+54", flag: "🇦🇷", length: 10, groups: [2, 4, 4] },
  { code: "BO", name: "Bolivia", dialCode: "+591", flag: "🇧🇴", length: 8, groups: [4, 4] },
  { code: "BR", name: "Brasil", dialCode: "+55", flag: "🇧🇷", length: 11, groups: [2, 5, 4] },
  { code: "CL", name: "Chile", dialCode: "+56", flag: "🇨🇱", length: 9, groups: [1, 4, 4] },
  { code: "CR", name: "Costa Rica", dialCode: "+506", flag: "🇨🇷", length: 8, groups: [4, 4] },
  { code: "EC", name: "Ecuador", dialCode: "+593", flag: "🇪🇨", length: 9, groups: [2, 3, 4] },
  { code: "SV", name: "El Salvador", dialCode: "+503", flag: "🇸🇻", length: 8, groups: [4, 4] },
  { code: "GT", name: "Guatemala", dialCode: "+502", flag: "🇬🇹", length: 8, groups: [4, 4] },
  { code: "HN", name: "Honduras", dialCode: "+504", flag: "🇭🇳", length: 8, groups: [4, 4] },
  { code: "NI", name: "Nicaragua", dialCode: "+505", flag: "🇳🇮", length: 8, groups: [4, 4] },
  { code: "PA", name: "Panamá", dialCode: "+507", flag: "🇵🇦", length: 8, groups: [4, 4] },
  { code: "PY", name: "Paraguay", dialCode: "+595", flag: "🇵🇾", length: 9, groups: [3, 3, 3] },
  { code: "PE", name: "Perú", dialCode: "+51", flag: "🇵🇪", length: 9, groups: [3, 3, 3] },
  { code: "DO", name: "República Dominicana", dialCode: "+1", flag: "🇩🇴", length: 10, groups: [3, 3, 4] },
  { code: "UY", name: "Uruguay", dialCode: "+598", flag: "🇺🇾", length: 8, groups: [4, 4] },
  { code: "VE", name: "Venezuela", dialCode: "+58", flag: "🇻🇪", length: 10, groups: [3, 3, 4] },
  { code: "ES", name: "España", dialCode: "+34", flag: "🇪🇸", length: 9, groups: [3, 3, 3] },
  { code: "US", name: "Estados Unidos", dialCode: "+1", flag: "🇺🇸", length: 10, groups: [3, 3, 4] },
]

export const DEFAULT_PHONE_COUNTRY: CountryCode = "CO"

export function findCountry(
  code: CountryCode | undefined,
  countries: readonly Country[] = PHONE_COUNTRIES
): Country {
  return countries.find((country) => country.code === code) ?? countries[0]
}

/**
 * Parte un E.164 en país + número nacional.
 *
 * `+1` lo comparten EE. UU. y República Dominicana, así que si el país actual
 * ya casa con el prefijo se respeta esa elección en vez de reasignarlo; para el
 * resto gana el prefijo más largo que coincida.
 */
export function parseE164(
  value: string,
  countries: readonly Country[] = PHONE_COUNTRIES,
  preferred?: CountryCode
): { country?: Country; national: string } {
  const digits = value.replace(/[^\d+]/g, "")
  if (!digits.startsWith("+")) return { national: digits.replace(/\D/g, "") }

  const preferredCountry = countries.find((country) => country.code === preferred)
  if (preferredCountry && digits.startsWith(preferredCountry.dialCode)) {
    return { country: preferredCountry, national: digits.slice(preferredCountry.dialCode.length) }
  }

  const match = countries
    .filter((country) => digits.startsWith(country.dialCode))
    .sort((a, b) => b.dialCode.length - a.dialCode.length)[0]

  if (!match) return { national: digits.replace(/\D/g, "") }
  return { country: match, national: digits.slice(match.dialCode.length) }
}

/** Agrupa los dígitos nacionales para leerlos: «3001234567» → «300 123 4567». */
export function formatNational(digits: string, groups: number[]): string {
  const parts: string[] = []
  let cursor = 0
  for (const group of groups) {
    if (cursor >= digits.length) break
    parts.push(digits.slice(cursor, cursor + group))
    cursor += group
  }
  if (cursor < digits.length) parts.push(digits.slice(cursor))
  return parts.join(" ")
}

/**
 * ¿Se puede editar este teléfono guardado con `PhoneInput` sin perder nada?
 *
 * (Añadido de SellUp; no está en Thema.) Los teléfonos guardados antes de que
 * existiera el campo son texto libre: pueden traer una extensión, un país fuera
 * de la lista o más dígitos de los que el campo deja escribir. `PhoneInput`
 * recorta a la longitud del país, así que mostrar ahí uno de esos números lo
 * enseñaría cortado. Vacío sí es editable (es un teléfono nuevo).
 */
export function canEditAsE164(
  value: string,
  countries: readonly Country[] = PHONE_COUNTRIES
): boolean {
  const trimmed = value.trim()
  if (trimmed === "") return true
  if (!/^\+[\d\s().-]+$/.test(trimmed)) return false
  const { country, national } = parseE164(trimmed, countries)
  return country !== undefined && national.length > 0 && national.length <= country.length
}

/**
 * ¿Son el mismo número, escrito con o sin espacios y guiones?
 *
 * (Añadido de SellUp.) Sirve para que un formulario de edición devuelva el
 * texto guardado TAL CUAL cuando lo escrito vuelve a ser el mismo número: así
 * «+57 300 123 4567» no se reescribe como «+573001234567» por tocar y deshacer.
 */
export function isSamePhoneNumber(a: string, b: string): boolean {
  const strip = (value: string) => value.replace(/[^\d+]/g, "")
  return strip(a) !== "" && strip(a) === strip(b)
}

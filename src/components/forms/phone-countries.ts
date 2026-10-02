import { LATAM_COUNTRIES } from "@/modules/accounts/types"

/**
 * Los países de `PhoneInput`: los que SellUp ya maneja.
 *
 * La lista NO se escribe aquí: sale del catálogo de países de la aplicación
 * (`LATAM_COUNTRIES` de `modules/accounts/types`, las mismas opciones de país
 * de los formularios de empresa), con su código ISO, su nombre y su orden. Un
 * país que entre a ese catálogo aparece en el teléfono en cuanto tenga su
 * fila en `DIALING` (la prueba de runtime exige que ninguno se quede sin
 * ella).
 *
 * El catálogo no trae prefijos telefónicos, así que aquí vive solo esa tabla
 * ISO → prefijo, longitud del número nacional y cómo se agrupa al escribirlo.
 * La bandera se deriva del propio código ISO.
 */

/** ISO 3166-1 alfa-2 de un país del catálogo de SellUp. */
export type CountryCode = string

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

interface Dialing {
  dialCode: string
  length: number
  groups: number[]
}

/** ISO → cómo se marca. Solo para los países del catálogo de SellUp. */
export const DIALING: Readonly<Record<string, Dialing>> = {
  CO: { dialCode: "+57", length: 10, groups: [3, 3, 4] },
  MX: { dialCode: "+52", length: 10, groups: [2, 4, 4] },
  CL: { dialCode: "+56", length: 9, groups: [1, 4, 4] },
  AR: { dialCode: "+54", length: 10, groups: [2, 4, 4] },
  BR: { dialCode: "+55", length: 11, groups: [2, 5, 4] },
  PE: { dialCode: "+51", length: 9, groups: [3, 3, 3] },
  UY: { dialCode: "+598", length: 8, groups: [4, 4] },
  EC: { dialCode: "+593", length: 9, groups: [2, 3, 4] },
  PY: { dialCode: "+595", length: 9, groups: [3, 3, 3] },
  BO: { dialCode: "+591", length: 8, groups: [4, 4] },
  VE: { dialCode: "+58", length: 10, groups: [3, 3, 4] },
  GT: { dialCode: "+502", length: 8, groups: [4, 4] },
  HN: { dialCode: "+504", length: 8, groups: [4, 4] },
  SV: { dialCode: "+503", length: 8, groups: [4, 4] },
  NI: { dialCode: "+505", length: 8, groups: [4, 4] },
  CR: { dialCode: "+506", length: 8, groups: [4, 4] },
  PA: { dialCode: "+507", length: 8, groups: [4, 4] },
  DO: { dialCode: "+1", length: 10, groups: [3, 3, 4] },
  US: { dialCode: "+1", length: 10, groups: [3, 3, 4] },
  ES: { dialCode: "+34", length: 9, groups: [3, 3, 3] },
}

/** La bandera de un país a partir de su código ISO (indicadores regionales). */
function flagOf(code: string): string {
  return [...code.toUpperCase()]
    .map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 0x1f1e6 - 65))
    .join("")
}

/**
 * Los países del catálogo de SellUp, en su orden, con cómo se marca cada uno.
 * Un país del catálogo sin fila en `DIALING` no se ofrece (no se inventa un
 * prefijo).
 */
export const PHONE_COUNTRIES: readonly Country[] = LATAM_COUNTRIES.flatMap((country) => {
  const dialing = DIALING[country.code]
  return dialing ? [{ code: country.code, name: country.name, flag: flagOf(country.code), ...dialing }] : []
})

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
 * resto gana el prefijo más largo que coincida (y, a igualdad, el primero del
 * catálogo).
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

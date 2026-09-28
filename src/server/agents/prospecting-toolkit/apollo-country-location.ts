/**
 * apollo-country-location.ts — cómo se le nombra cada país a Apollo.
 *
 * AGENT1-APOLLO-COUNTRY-LOCATION-1.
 *
 * `organization_locations` filtra por la SEDE de la empresa y Apollo lo documenta
 * con nombres en inglés («Examples: `texas`; `tokyo`; `spain`», especificación
 * OpenAPI oficial de Organization Search). Hasta este corte se enviaba el nombre
 * en español del mago tal cual: para Colombia, Chile o Ecuador da igual porque se
 * escriben igual, pero «México», «Perú», «Brasil», «Panamá», «Rep. Dominicana»,
 * «Estados Unidos» y «España» no son nombres que Apollo documente.
 *
 * Se decide por el CÓDIGO del país, nunca por el nombre visible. Los nombres
 * conservan la capitalización del nombre en inglés: para Colombia el valor es
 * exactamente el de siempre («Colombia»), así que su petición y su huella no
 * cambian ni un byte.
 *
 * Puro: sin env, sin I/O.
 */

/** Código ISO del mago → nombre de país que Apollo documenta (inglés). */
export const APOLLO_COUNTRY_LOCATION_BY_CODE: Readonly<Record<string, string>> = Object.freeze({
  CO: 'Colombia',
  MX: 'Mexico',
  CL: 'Chile',
  AR: 'Argentina',
  BR: 'Brazil',
  PE: 'Peru',
  UY: 'Uruguay',
  EC: 'Ecuador',
  PY: 'Paraguay',
  BO: 'Bolivia',
  VE: 'Venezuela',
  GT: 'Guatemala',
  HN: 'Honduras',
  SV: 'El Salvador',
  NI: 'Nicaragua',
  CR: 'Costa Rica',
  PA: 'Panama',
  DO: 'Dominican Republic',
  US: 'United States',
  ES: 'Spain',
});

/**
 * El valor de `organization_locations` para un país.
 *
 * Con código conocido, su nombre en inglés. Sin código conocido se conserva el
 * comportamiento anterior (el nombre recibido, recortado): este corte no inventa
 * países que el mago no ofrece.
 */
export function resolveApolloCountryLocation(
  countryCode: string | null | undefined,
  countryName: string | null | undefined,
): string | null {
  const code = typeof countryCode === 'string' ? countryCode.trim().toUpperCase() : '';
  const mapped = code ? APOLLO_COUNTRY_LOCATION_BY_CODE[code] : undefined;
  if (mapped) return mapped;
  const name = typeof countryName === 'string' ? countryName.trim() : '';
  return name.length > 0 ? name : null;
}

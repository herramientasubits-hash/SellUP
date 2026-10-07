/**
 * pa-ruc.ts — RUC panameño canónico de una PERSONA JURÍDICA o de una ENTIDAD
 * PÚBLICA, sin el dígito verificador.
 *
 * SOURCES-PA-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 *   Sociedad:          tomo-folio-asiento con primer tramo de 3 o más dígitos
 *                      («155641197-2-2016», «280-134-61098»).
 *   Entidad pública:   provincia-NT-tomo-asiento («8-NT-2-4249» = Caja de Seguro
 *                      Social). Así figuran las entidades compradoras en
 *                      PanamaCompraEnCifras (aprobado por la dueña el 07-10-2026).
 *
 * El DV se quita en las dos formas («… DV 53», «…-43»). Las cédulas de personas
 * naturales (E-…, N-…, PE-…, «8-123-456») nunca son un RUC válido aquí. Un tomo de
 * sólo ceros es relleno («000-2-2015»).
 *
 * Sociedades antiguas con tomo de 1 o 2 dígitos («82-30-15216» = Nestlé Panamá,
 * «44-242-5856» = Coca-Cola FEMSA): por su forma son iguales a una cédula. Sólo se
 * aceptan con `allowShortTomo` (una fuente que sólo trae sociedades, como la lista
 * de Grandes Contribuyentes de la DGI, o al leer lo ya cargado), nunca desde
 * PanamaCompra, donde también venden personas naturales.
 */

const JURIDICAL = /^(\d{3,})-(\d{1,4})-(\d{1,7})(?:-?(?:DV)?(\d{1,2}))?$/;
const SHORT_TOMO_JURIDICAL = /^(\d{1,2})-(\d{1,4})-(\d{1,7})(?:-?(?:DV)?(\d{1,2}))?$/;
const PUBLIC_ENTITY = /^(\d{1,2})-?NT-?(\d{1,4})-(\d{1,7})(?:-?(?:DV)?(\d{1,2}))?$/;

/** Forma canónica que se guarda en las fuentes de Panamá. */
export const PANAMA_RUC_SHAPE = /^(?:\d{1,}-\d{1,4}-\d{1,7}|\d{1,2}-NT-\d{1,4}-\d{1,7})$/;

const unpad = (part: string): string => part.replace(/^0+(?=\d)/, '');

/** RUC crudo → { ruc canónico, dv, entidad pública? }, o `null`. */
export function parsePanamaRuc(
  raw: string | null | undefined,
  options: { allowShortTomo?: boolean } = {},
): { ruc: string; dv: string | null; publicEntity: boolean } | null {
  if (typeof raw !== 'string') return null;
  const compact = raw
    .toUpperCase()
    .replace(/D\.?\s*V\.?/g, 'DV')
    .replace(/\s+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/-+$/, '');
  const juridical = JURIDICAL.exec(compact);
  // El tomo cuenta SIN los ceros de relleno: «0008-0123-0456» es una cédula.
  if (juridical !== null && unpad(juridical[1]).length >= 3) {
    // «0000015344-0041-0148061» (relleno de algunos sistemas) = «15344-41-148061».
    return {
      ruc: `${unpad(juridical[1])}-${unpad(juridical[2])}-${unpad(juridical[3])}`,
      dv: juridical[4] ?? null,
      publicEntity: false,
    };
  }
  const entity = PUBLIC_ENTITY.exec(compact);
  if (entity !== null && !/^0+$/.test(entity[1]) && !/^0+$/.test(entity[3])) {
    // «8-NT-01-12761» y «8-NT-1-12761» son el mismo RUC.
    const tomo = String(Number(entity[2]));
    return { ruc: `${Number(entity[1])}-NT-${tomo}-${entity[3]}`, dv: entity[4] ?? null, publicEntity: true };
  }
  if (options.allowShortTomo !== true) return null;
  const shortTomo = SHORT_TOMO_JURIDICAL.exec(compact) ?? (juridical !== null && /[1-9]/.test(juridical[1]) ? juridical : null);
  if (shortTomo !== null && /[1-9]/.test(shortTomo[1])) {
    return {
      ruc: `${unpad(shortTomo[1])}-${unpad(shortTomo[2])}-${unpad(shortTomo[3])}`,
      dv: shortTomo[4] ?? null,
      publicEntity: false,
    };
  }
  return null;
}

/**
 * RUC canónico de una fila YA CARGADA (registro, alias, directorio) o `null`. Acepta
 * el tomo corto: esas filas ya pasaron la regla de su fuente al cargarse.
 */
export function canonicalPanamaRuc(raw: string | null | undefined): string | null {
  return parsePanamaRuc(raw, { allowShortTomo: true })?.ruc ?? null;
}

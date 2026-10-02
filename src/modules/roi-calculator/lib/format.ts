/**
 * Formato es-CO para toda la app.
 *
 * No se usa Intl con style:'currency': bajo JavaScriptCore (bun) el ICU de
 * es-CO emite "US$ 42.138,00" con espacio duro y decimales forzados. El
 * prefijo va manual y el numero por NumberFormat, que si es estable.
 *
 * Convencion del modelo: los valores en USD van sin decimales (US$42.138) y
 * solo los precios unitarios y el costo por curso llevan dos (US$50,00).
 */

export const GUION = '—';

const nf = (min: number, max: number): Intl.NumberFormat =>
  new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  });

const enteros = nf(0, 0);
const dosDecimales = nf(2, 2);
const unDecimal = nf(1, 1);

/** Redondeo a centavos, estable frente al error de punto flotante. */
export const round2 = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/** Redondeo a USD entero. Es el unico redondeo que aplica a un valor de palanca. */
export const roundUSD = (n: number): number => Math.round(n + Number.EPSILON);

/** US$42.138 */
export const fmtUSD = (n: number | null): string =>
  n === null || !Number.isFinite(n) ? GUION : `US$${enteros.format(Math.round(n))}`;

/** US$2,12 — precios unitarios y costo por curso */
export const fmtUSD2 = (n: number | null): string =>
  n === null || !Number.isFinite(n) ? GUION : `US$${dosDecimales.format(round2(n))}`;

/** 67% — recibe una razon 0-1 */
export const fmtPct0 = (r: number | null): string =>
  r === null || !Number.isFinite(r) ? GUION : `${enteros.format(r * 100)}%`;

/** 24,87% — recibe una razon 0-1 */
export const fmtPct2 = (r: number | null): string =>
  r === null || !Number.isFinite(r) ? GUION : `${dosDecimales.format(r * 100)}%`;

/** 3,5x */
export const fmtMultiplo = (r: number | null): string =>
  r === null || !Number.isFinite(r) ? GUION : `${unDecimal.format(r)}x`;

/** 274 */
export const fmtEntero = (n: number | null): string =>
  n === null || !Number.isFinite(n) ? GUION : enteros.format(Math.round(n));

/** 74,6 — para bases que no son enteras, como poblacion x ASR */
export const fmtDecimal1 = (n: number | null): string =>
  n === null || !Number.isFinite(n) ? GUION : unDecimal.format(n);

/** Un decimal solo cuando el numero lo necesita: 74,6 pero 189. */
export const fmtCantidad = (n: number | null): string =>
  n === null || !Number.isFinite(n)
    ? GUION
    : Number.isInteger(n)
      ? enteros.format(n)
      : unDecimal.format(n);

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

/** 7 -> "julio". Fuera de rango devuelve el numero. */
export const nombreMes = (mes: number): string => MESES[mes - 1] ?? String(mes);

/** "julio a diciembre de 2026" */
export const rangoMeses = (mesInicio: number, mesFin: number, anio: number): string =>
  mesInicio === mesFin
    ? `${nombreMes(mesInicio)} de ${anio}`
    : `${nombreMes(mesInicio)} a ${nombreMes(mesFin)} de ${anio}`;

/** Slug para nombres de archivo: "Grupo SIES" -> "Grupo_SIES" */
export const slugArchivo = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'cliente';

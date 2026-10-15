/**
 * Países con compras públicas conectadas a «Proveedores de una empresa». Sin imports a
 * propósito (lo usa el paso puro y la corrida del asistente).
 *
 * Para enchufar un país: su código aquí, su configuración en `index.ts`, sus consultas
 * en `index.server.ts` y, si se carga por archivos, su lector en `loaders.ts`.
 * Un país «loaded» sin carga hecha no reconoce a nadie: la corrida sigue sólo con Claude.
 */
export const PUBLIC_BUYER_COUNTRY_CODES: readonly string[] = [
  'CO', // SECOP II, en vivo
  'CL', // ChileCompra, órdenes de compra mensuales cargadas
  'PA', // PanamaCompra en Cifras (OCDS mensual), adjudicaciones cargadas
  'DO', // DGCP (datos abiertos), en vivo
];

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
  'PE', // OECE Contrataciones Abiertas (OCDS), cargadas
  'HN', // ONCAE/HonduCompras (OCDS), cargadas
  'GT', // Guatecompras (OCDS), cargadas
  'PY', // DNCP, adjudicaciones (ZIP masivo OCDS) cargadas
  'PA', // PanamaCompra en Cifras (OCDS mensual), adjudicaciones cargadas
  'DO', // DGCP (datos abiertos), en vivo
  'BR', // Compras.gov.br (federal) y PNCP, en vivo
  'US', // USAspending, en vivo
  'AR', // COMPR.AR, adjudicaciones cargadas (tabla de rubros BORRADOR)
  'UY', // ARCE, adjudicaciones OCDS cargadas (tabla SICE aprobada)
  'ES', // PLACSP, adjudicaciones ATOM/CODICE mensuales cargadas (tabla CPV aprobada)
  'CR', // SICOP datos abiertos (mensual), cargado; proveedor por nombre → cédula, industria por CIIU
  'EC', // SERCOP datos abiertos OCDS (anual), cargado; industria por CIIU del proveedor
];

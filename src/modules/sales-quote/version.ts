/**
 * Versiones de precios del cotizador.
 *
 * La 2026 se puede usar hasta el 31 de diciembre de 2026; desde el 1 de enero
 * de 2027 (hora de Bogotá) solo se cotiza con la 2027. Una cotización guardada
 * conserva la versión con que se hizo.
 */

export const PRICING_VERSIONS = ['2026', '2027'] as const;
export type PricingVersion = (typeof PRICING_VERSIONS)[number];

/** Inicio de la versión 2027: medianoche del 1 de enero de 2027 en Bogotá. */
export const PRICING_2027_STARTS_AT = new Date('2027-01-01T00:00:00-05:00');

/** ¿Todavía se puede cotizar con la versión 2026? */
export function isPricing2026Available(now: Date = new Date()): boolean {
  return now.getTime() < PRICING_2027_STARTS_AT.getTime();
}

/** Las versiones que se ofrecen para cotizar hoy. */
export function availablePricingVersions(now: Date = new Date()): PricingVersion[] {
  return isPricing2026Available(now) ? ['2026', '2027'] : ['2027'];
}

/** La versión con la que abre el cotizador: la vigente. */
export function defaultPricingVersion(now: Date = new Date()): PricingVersion {
  return isPricing2026Available(now) ? '2026' : '2027';
}

export function isPricingVersion(value: unknown): value is PricingVersion {
  return typeof value === 'string' && (PRICING_VERSIONS as readonly string[]).includes(value);
}

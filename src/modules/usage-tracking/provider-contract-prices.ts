/**
 * provider-contract-prices.ts — precio por crédito de los contratos vigentes.
 *
 * AGENT1-PROVIDER-CONTRACT-PRICES-1. Datos confirmados por la dueña el
 * 2026-09-24; los dos planes son ANUALES:
 *
 *   · Apollo: 484.335 créditos/año por USD 4.200  ⇒ 0,00867168 USD/crédito.
 *   · Lusha:   61.200 créditos/año por USD 4.174,57 ⇒ 0,06821193 USD/crédito
 *     (~5.100 créditos/mes).
 *
 * Los valores anteriores (Apollo 0,00875 = 4.200/480.000; Lusha 0,08823529 =
 * 3.600/40.800) salían de supuestos que no correspondían al contrato.
 *
 * 🔴 La autoridad en ejecución sigue siendo `provider_pricing_config` (filas con
 * `effective_from = 2026-09-24`, ya aplicadas en Producción). Estas constantes
 * sólo sirven donde el código no lee la tabla: el costo de
 * `organizations_search` y el modelo de costo declarativo del registro de
 * proveedores. Deben coincidir con la tabla; si el contrato cambia, se cambian
 * las dos cosas a la vez.
 *
 * Puro: sin env, sin I/O.
 */

export const APOLLO_CONTRACT = {
  annualCredits: 484_335,
  annualUsd: 4_200,
  usdPerCredit: 0.00867168,
} as const;

export const LUSHA_CONTRACT = {
  annualCredits: 61_200,
  annualUsd: 4_174.57,
  usdPerCredit: 0.06821193,
} as const;

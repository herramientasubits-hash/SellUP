/**
 * Apollo Contact Enrichment — guardrails de costo y calidad.
 * Seguro para frontend: sin secretos, sin imports de servidor.
 * Importado por backend (contact-completion-adapter) y por frontend (wizard UI).
 */

export const APOLLO_CONTACT_ENRICHMENT_GUARDRAILS = {
  /** Tope duro de candidatos a completar por run. */
  maxCompletionCandidates: 3,

  /** Presupuesto máximo de créditos de completion por run. */
  maxCompletionCreditsPerRun: 10,

  /**
   * Reveal automático de teléfono desactivado por control de costo (~8 créditos).
   * SellUp conserva teléfonos que Apollo ya entregó en la búsqueda inicial;
   * solo el reveal adicional mediante people/match está desactivado hasta
   * que el operador lo confirme explícitamente.
   */
  automaticPhoneRevealEnabled: false,

  /** Crédito estimado por email revelado. */
  emailRevealCredits: 1,

  /** Crédito estimado por teléfono revelado (mucho más caro que email). */
  phoneRevealCredits: 8,
} as const;

export type ApolloContactEnrichmentGuardrails =
  typeof APOLLO_CONTACT_ENRICHMENT_GUARDRAILS;

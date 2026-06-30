/**
 * Apollo Contact Enrichment — guardrails de costo y calidad.
 * Seguro para frontend: sin secretos, sin imports de servidor.
 * Importado por backend (contact-completion-adapter, apollo-people-adapter) y
 * por frontend (wizard UI, preflight card).
 */

export const APOLLO_CONTACT_ENRICHMENT_GUARDRAILS = {
  // ── Guardrails de búsqueda (people_search) ──────────────────
  /** Máximo de intentos de búsqueda por capas (fallback) por run. */
  maxSearchAttempts: 3,

  /** Máximo de resultados que pedimos a Apollo por intento (per_page). */
  maxResultsPerSearchAttempt: 5,

  /** Tope duro de resultados crudos acumulados por run (todos los intentos). */
  maxSearchResultsPerRun: 15,

  /**
   * Créditos máximos estimados de búsqueda por run.
   * Apollo cobra 1 crédito por resultado devuelto en people_search.
   */
  maxEstimatedSearchCreditsPerRun: 15,

  /**
   * Contactos revisables que bastan para detenerse antes de agotar intentos.
   * Evita buscar más capas cuando ya tenemos candidatos suficientes.
   */
  targetReviewableContacts: 2,

  // ── Guardrails de completion (people/match) ──────────────────
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

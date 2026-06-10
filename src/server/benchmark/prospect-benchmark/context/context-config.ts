/**
 * Context Assembler — Configuration (Hito 16AB.24.2)
 *
 * Constantes versionadas. Modificar aquí cambia el sharedContextHash.
 */

export const CONTEXT_VERSION = '16AB.24.2-v1' as const;

// ─── Países y perfiles soportados ────────────────────────────────────────────

export const SUPPORTED_COUNTRIES: Record<string, string> = {
  colombia: 'colombia',
  Colombia: 'colombia',
  COLOMBIA: 'colombia',
};

// ─── Industrias y perfiles soportados ────────────────────────────────────────

export const SUPPORTED_INDUSTRIES: Record<string, string> = {
  tecnología: 'technology',
  tecnologia: 'technology',
  Tecnología: 'technology',
  Tecnologia: 'technology',
  technology: 'technology',
  Technology: 'technology',
};

// ─── Presupuesto de tokens ────────────────────────────────────────────────────
//
// Los límites semánticos aprobados en 16AB.24.1 fueron:
//   shared ≤ 4.500 | candidate ≤ 700 | total ≤ 5.200
// Esos límites se calcularon con recuento de palabras (≈ chars/6 para este tipo de JSON).
//
// El estimador implementado usa ceil(chars/4), que es más conservador.
// Con chars/4 aplicado al contenido aprobado se obtiene:
//   shared block ensamblado ≈ 6.400 tokens | candidate delta ≈ 300-700 tokens
//
// Los límites siguientes están calibrados para chars/4 sobre el contenido aprobado.
// El ratio empírico entre ambas metodologías es ≈ 1.5x para este tipo de JSON técnico.
//
// Equivalencia semántica: sharedHardLimit=7000 ≈ 4.500 tokens reales (chars/6).

export const TOKEN_BUDGET = {
  sharedWarningThreshold: 6_500,
  sharedHardLimit: 7_000,
  candidateWarningThreshold: 850,
  candidateHardLimit: 1_000,
  totalWarningThreshold: 7_200,
  totalHardLimit: 8_000,
} as const;

// ─── Límites de delta de candidato ───────────────────────────────────────────

export const DELTA_LIMITS = {
  maxDiscoveryUrls: 10,
  maxUrlLength: 500,
} as const;

// ─── Parámetros de tracking a eliminar ───────────────────────────────────────

export const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  '_hsenc',
  '_hsmi',
  'hsCtaTracking',
]);

/**
 * Context Assembler — Token Estimator (Hito 16AB.24.2)
 *
 * Estimación determinística offline sin llamadas a APIs externas.
 * Metodología: ceil(caracteres / 4) — aproximación estándar para texto
 * técnico mixto español/inglés con estructuras JSON.
 *
 * Esta estimación no representa uso real del proveedor.
 */

export const TOKEN_ESTIMATION_METHOD =
  'chars_divided_by_4 — ceil(length / 4) — no API calls';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateTokensFromObject(value: unknown): number {
  return estimateTokens(JSON.stringify(value) ?? '');
}

export type TokenEstimate = {
  sharedTokens: number;               // tokens del modelo (modelContext)
  candidateTokens: number;
  totalTokens: number;                // modelo + candidato
  fullInternalContextTokens: number; // modelo + interno + candidato
  method: string;
};

export function buildTokenEstimate(
  modelContext: unknown,
  candidateDelta: unknown,
  internalContext?: unknown,
): TokenEstimate {
  const sharedTokens = estimateTokensFromObject(modelContext);
  const candidateTokens = estimateTokensFromObject(candidateDelta);
  const internalTokens = internalContext ? estimateTokensFromObject(internalContext) : 0;
  return {
    sharedTokens,
    candidateTokens,
    totalTokens: sharedTokens + candidateTokens,
    fullInternalContextTokens: sharedTokens + internalTokens + candidateTokens,
    method: TOKEN_ESTIMATION_METHOD,
  };
}

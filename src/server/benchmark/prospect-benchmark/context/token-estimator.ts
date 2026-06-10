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
  sharedTokens: number;
  candidateTokens: number;
  totalTokens: number;
  method: string;
};

export function buildTokenEstimate(
  sharedContext: unknown,
  candidateDelta: unknown
): TokenEstimate {
  const sharedTokens = estimateTokensFromObject(sharedContext);
  const candidateTokens = estimateTokensFromObject(candidateDelta);
  return {
    sharedTokens,
    candidateTokens,
    totalTokens: sharedTokens + candidateTokens,
    method: TOKEN_ESTIMATION_METHOD,
  };
}

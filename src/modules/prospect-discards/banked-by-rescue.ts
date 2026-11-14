// Dueña 14-11 — la que el rescate de la IA guardó en el banco no es una descartada.
// Aparte de `queries.ts` porque ese archivo es 'use server' (sólo exporta funciones async).

/** ¿El rescate de la IA la guardó en el banco? (`claude_rescue.banked`) */
export function isBankedByRescue(metadata: unknown): boolean {
  const rescue = (metadata as { claude_rescue?: { banked?: unknown } } | null | undefined)?.claude_rescue;
  return rescue?.banked === true;
}

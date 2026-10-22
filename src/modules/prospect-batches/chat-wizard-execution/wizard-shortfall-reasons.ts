/**
 * wizard-shortfall-reasons.ts — POR QUÉ una corrida por criterios no llegó a la
 * meta, en palabras del vendedor (AGENT1-CRITERIA-QUICK-WINS-1 § 2).
 *
 * ── El defecto ───────────────────────────────────────────────────────────────
 *
 * La ruta ya decidía los motivos (Apollo sin tiempo, Claude sin tiempo, una capa
 * que falló…) y los dejaba en la traza del lote, pero el vendedor sólo veía
 * «Prospectos generados correctamente» con 1 de 5, o «no encontramos empresas
 * nuevas» sin saber si era el mercado o el sistema. En el historial real, 74 de
 * 198 lotes por criterios quedaron sin empresas útiles sin explicación visible.
 *
 * ── El arreglo ───────────────────────────────────────────────────────────────
 *
 * Una función PURA que traduce lo que la ruta YA decidió a una lista corta de
 * motivos. No decide nada nuevo, no cuenta filas y no cambia estado ni
 * aceptación: sólo nombra. Con la meta cumplida devuelve `[]`.
 */

export type WizardShortfallReasonCode =
  | 'free_layer_failed'
  | 'tavily_failed'
  | 'tavily_no_time'
  | 'apollo_no_time'
  | 'apollo_quota_exhausted'
  | 'apollo_pending_continuation'
  | 'industry_unmapped'
  | 'lusha_failed'
  | 'claude_no_time'
  | 'claude_failed';

export type WizardShortfallReason = {
  code: WizardShortfallReasonCode;
  /** Frase para el vendedor (sin jerga de proveedores). */
  message: string;
};

export type WizardShortfallInput = {
  targetReached: boolean;
  /** La capa gratuita lanzó (no «no aportó»: falló). */
  freeLayerFailed: boolean;
  /** `outcome` de Tavily primero, si corrió. */
  tavilyFirstOutcome: string | null;
  /** Motivo por el que Apollo no arrancó, si no arrancó. */
  apolloNotStartedReason: 'quota_exhausted' | 'no_time' | null;
  /** Lusha: motivo del salto, o código de fallo si corrió y falló. */
  lushaSkipReason: string | null;
  lushaFailureCode: string | null;
  /** Claude: motivo del salto (incluye `failed`), `null` si corrió. */
  claudeSkipReason: string | null;
};

const MESSAGES: Record<WizardShortfallReasonCode, string> = {
  free_layer_failed: 'La consulta a las fuentes gratuitas del país falló; se siguió con los proveedores de pago.',
  tavily_failed: 'La búsqueda web falló en esta corrida.',
  tavily_no_time: 'Se acabó el tiempo de la corrida antes de buscar en más proveedores.',
  apollo_no_time: 'Se acabó el tiempo de la corrida antes de buscar en Apollo.',
  apollo_quota_exhausted: 'Apollo no tiene cupo disponible en este momento.',
  apollo_pending_continuation: 'Apollo dejó empresas pendientes de revisar; se completan en una continuación.',
  industry_unmapped: 'La industria elegida no está conectada a todas las fuentes; algunas no se consultaron.',
  lusha_failed: 'La búsqueda de respaldo en Lusha falló.',
  claude_no_time: 'No quedó tiempo para la búsqueda con IA al final de la corrida.',
  claude_failed: 'La búsqueda con IA falló en esta corrida.',
};

function reason(code: WizardShortfallReasonCode): WizardShortfallReason {
  return { code, message: MESSAGES[code] };
}

/** Motivos en el orden en que ocurrieron en la corrida; sin repetidos. */
export function buildWizardShortfallReasons(input: WizardShortfallInput): WizardShortfallReason[] {
  if (input.targetReached) return [];

  const codes: WizardShortfallReasonCode[] = [];
  if (input.freeLayerFailed) codes.push('free_layer_failed');

  if (input.tavilyFirstOutcome === 'failed') codes.push('tavily_failed');
  // Con Apollo sin tiempo, «sin tiempo» lo dice el motivo de Apollo: uno basta.
  if (input.tavilyFirstOutcome === 'short_no_time' && input.apolloNotStartedReason === null) {
    codes.push('tavily_no_time');
  }

  if (input.apolloNotStartedReason === 'no_time') codes.push('apollo_no_time');
  if (input.apolloNotStartedReason === 'quota_exhausted') codes.push('apollo_quota_exhausted');

  if (input.lushaSkipReason === 'apollo_pending_continuation') codes.push('apollo_pending_continuation');
  if (input.lushaSkipReason === 'macro_industry_unmapped') codes.push('industry_unmapped');
  if (input.lushaFailureCode !== null || input.lushaSkipReason === 'leg_failed') codes.push('lusha_failed');

  if (input.claudeSkipReason === 'not_enough_time') codes.push('claude_no_time');
  if (input.claudeSkipReason === 'failed') codes.push('claude_failed');

  return [...new Set(codes)].map(reason);
}

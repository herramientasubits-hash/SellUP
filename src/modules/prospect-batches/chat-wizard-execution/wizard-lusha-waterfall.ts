/**
 * wizard-lusha-waterfall.ts — ¿corre la pierna Lusha? Decisión PURA.
 *
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 4.
 *
 * Sin Supabase, sin proveedor, sin `process.env`, sin reloj. El servidor
 * resuelve los hechos (bandera, disponibilidad, cuenta de útiles) y esta función
 * decide. Así la política se puede probar sin arrancar nada y no existe una
 * segunda forma de encender la pierna.
 *
 * ── 🔴 El orden de las razones ES la política ────────────────────────────────
 *
 * Se evalúan en este orden, y el orden importa porque cada respuesta gobierna
 * una promesa distinta:
 *
 *   1. bandera apagada      → CERO llamadas a Lusha, pase lo que pase;
 *   2. Apollo no terminal   → sin veredicto de Apollo no hay hueco que calcular;
 *   3. objetivo cubierto    → Lusha no consume NADA si Apollo llegó al objetivo;
 *   4. Lusha no disponible  → su propia puerta (`ENABLE_LUSHA_PREVIEW`) manda;
 *   5. macro sin mapear     → Lusha exige una de las 12 macro industrias;
 *   6. lote canónico ausente → CORTE 5A: sin el lote de la corrida, la pierna
 *      crearía uno SEGUNDO, y una búsqueda de la persona acabaría partida en dos.
 *      Fail-closed: antes que dos lotes, ninguna llamada.
 *
 * Sólo si las seis pasan la pierna corre, y corre con el HUECO: lo que falta,
 * no el objetivo entero.
 */

/** Por qué NO corrió la pierna. Vocabulario cerrado: se registra, no se narra. */
export type LushaWaterfallSkipReason =
  | 'waterfall_flag_disabled'
  | 'apollo_run_not_terminal'
  | 'target_reached'
  | 'lusha_unavailable'
  | 'macro_industry_unmapped'
  | 'canonical_batch_unresolved';

export type LushaWaterfallDecision =
  | { readonly run: false; readonly reason: LushaWaterfallSkipReason }
  | {
      readonly run: true;
      readonly gap: number;
      readonly macroIndustryKey: string;
      /** CORTE 5A — EL lote de la corrida. La pierna escribe dentro de él. */
      readonly canonicalBatchId: string;
    };

export type LushaWaterfallDecisionInput = {
  /** `ENABLE_AGENT1_APOLLO_LUSHA_WATERFALL`, ya resuelta por el servidor. */
  readonly waterfallEnabled: boolean;
  /** `ENABLE_LUSHA_PREVIEW`: la puerta propia de Lusha, que este hito no toca. */
  readonly lushaAvailable: boolean;
  /** ¿Apollo llegó a un veredicto? Una corrida caída no autoriza continuar. */
  readonly apolloTerminal: boolean;
  /** El objetivo único del wizard. */
  readonly target: number;
  /**
   * Empresas ÚTILES acumuladas por todas las piernas anteriores (capa gratuita
   * + Apollo R1 + R2), medidas con la MISMA autoridad de aceptación que decide
   * si la corrida terminó. No es un conteo de filas ni de resultados crudos.
   */
  readonly usefulAccumulated: number;
  /** Una de las 12 macro industrias, o `null` si la publicada no mapea. */
  readonly macroIndustryKey: string | null;
  /**
   * CORTE 5A — `prospect_batches.id` que la corrida del wizard YA reservó.
   *
   * `null` sólo puede significar que la ejecución llegó aquí sin lote, y en ese
   * estado la pierna no debe correr: sin lote canónico la acción de Lusha
   * crearía el suyo y el requisito M —un `wizard_run_id` reconstruye las tres
   * piernas— quedaría roto en silencio.
   */
  readonly canonicalBatchId: string | null;
};

export function decideLushaWaterfallLeg(
  input: LushaWaterfallDecisionInput,
): LushaWaterfallDecision {
  if (!input.waterfallEnabled) {
    return { run: false, reason: 'waterfall_flag_disabled' };
  }
  if (!input.apolloTerminal) {
    return { run: false, reason: 'apollo_run_not_terminal' };
  }

  // El hueco se calcula sobre la cuenta de útiles, nunca negativo. Un excedente
  // (8 útiles contra un objetivo de 5) cierra igual que un empate.
  const gap = Math.max(0, input.target - Math.max(0, input.usefulAccumulated));
  if (gap === 0) {
    return { run: false, reason: 'target_reached' };
  }

  if (!input.lushaAvailable) {
    return { run: false, reason: 'lusha_unavailable' };
  }
  if (input.macroIndustryKey === null || input.macroIndustryKey.trim() === '') {
    return { run: false, reason: 'macro_industry_unmapped' };
  }
  if (input.canonicalBatchId === null || input.canonicalBatchId.trim() === '') {
    return { run: false, reason: 'canonical_batch_unresolved' };
  }

  return {
    run: true,
    gap,
    macroIndustryKey: input.macroIndustryKey,
    canonicalBatchId: input.canonicalBatchId,
  };
}

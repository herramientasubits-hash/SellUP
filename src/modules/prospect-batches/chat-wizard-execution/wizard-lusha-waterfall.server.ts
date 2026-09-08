/**
 * wizard-lusha-waterfall.server.ts — la pierna Lusha del waterfall, del lado
 * del servidor y SIN simular un clic.
 *
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 4.
 *
 * ── 🔴 Qué ejecuta y por qué así ─────────────────────────────────────────────
 *
 * Llama a `generateLushaPendingReviewBatchAction`, que es el orquestador que ya
 * posee, en el orden correcto y con sus liquidaciones, TODAS las piezas que este
 * hito tiene que reutilizar:
 *
 *   · `resolveLushaProspectingOperation` — valla durable anti-replay;
 *   · `reserveOrReturnLushaCanonicalBatch` — lote canónico reserve-or-return;
 *   · `guardLushaRunBudget` → `try_reserve_wizard_credits` — la reserva de Lusha
 *     sobre `wizard_monthly_budget_periods`, separada de la de Apollo;
 *   · `createFencedLushaRunSearch` — valla de petición por (operación, rama, página);
 *   · `persistLushaPendingReviewBatch` — el núcleo puro, que a su vez usa
 *     `resolveLushaTargetGap` y `decideLushaProviderRequest`;
 *   · liquidación (`confirm`/`release`) y `provider_usage_logs`.
 *
 * Reimplementar aquí esa secuencia habría significado duplicar la reserva y la
 * liquidación de créditos — la clase de duplicación que termina cobrando dos
 * veces o no liberando nunca. La pierna, entonces, DECIDE y DELEGA.
 *
 * ── 🔴 Qué NO hace ───────────────────────────────────────────────────────────
 *
 * · No crea presupuesto, no crea reglas por agente, no toca la reserva de Apollo
 *   ni el esquema de `wizard_monthly_budget_periods`.
 * · No relaja ninguna puerta de Lusha: con `ENABLE_LUSHA_PREVIEW` apagada la
 *   acción misma se niega, y esta pierna ni siquiera la llama.
 * · No escribe nada por su cuenta: cada fila que aparece la escribe la acción.
 *
 * ── 🔴 CORTE 5A — la correlación, ahora EXPLÍCITA ───────────────────────────
 *
 * Hasta el corte 4 la acción resolvía su lote por `(created_by,
 * client_request_id)` con el identificador DERIVADO de esta pierna, así que la
 * pierna aterrizaba en un lote PROPIO y con su propia identidad de corrida: un
 * `wizard_run_id` NO reconstruía las tres piernas.
 *
 * Ahora la pierna le PASA a la acción el contexto de la corrida:
 *
 *   · `wizardClientRequestId` — de él deriva la acción, servidor adentro y con
 *     el actor ya autenticado, el MISMO `wizard_run_id` que Apollo escribió;
 *   · `canonicalBatchId`      — EL lote de la búsqueda. La acción lo adopta por
 *     id, comprobando el dueño, y NO crea ninguno;
 *   · `targetGap`             — lo que falta, no el objetivo entero.
 *
 * Lo que NO cambia: el `clientRequestId` de la pierna sigue siendo el suyo, y
 * por tanto su reserva de créditos, su valla durable y su liquidación siguen
 * siendo independientes de las de Apollo. Ésa es la línea que este corte NO
 * cruza — presupuesto compartido sería otro hito, y uno económico.
 */

// Server-only por convención del repo: el sufijo `.server.ts` y este encabezado.
// (No se importa el paquete `server-only`: no es dependencia de este proyecto y
// ningún otro módulo del repo lo usa.)

import {
  decideLushaWaterfallLeg,
  type LushaWaterfallDecision,
  type LushaWaterfallSkipReason,
} from './wizard-lusha-waterfall';
import { deriveLushaWaterfallClientRequestId } from './waterfall-leg-identity';
import {
  isAgent1ApolloLushaWaterfallEnabled,
  isLushaPreviewEnabled,
} from '@/lib/feature-flags.server';
import { generateLushaPendingReviewBatchAction } from '@/modules/prospect-batches/lusha-pending-review-actions';
import type { GenerateLushaPendingReviewBatchInput } from '@/modules/prospect-batches/lusha-pending-review-actions';
import type { PersistLushaPendingReviewResult } from '@/server/prospect-batches/lusha-pending-review';

export type LushaWaterfallLegInput = {
  /** El `clientRequestId` de la corrida del wizard (el de la pierna Apollo). */
  readonly wizardClientRequestId: string;
  /**
   * CORTE 5A — `prospect_batches.id` de la corrida, ya reservado por el wizard.
   *
   * `null` ⇒ la pierna NO corre (`canonical_batch_unresolved`). Ver la decisión
   * pura: antes dos lotes, ninguna llamada.
   */
  readonly canonicalBatchId: string | null;
  readonly countryCode: string;
  readonly macroIndustryKey: string | null;
  readonly subIndustryId?: number | null;
  readonly target: number;
  readonly usefulAccumulated: number;
  readonly apolloTerminal: boolean;
};

export type LushaWaterfallLegOutcome =
  | { readonly executed: false; readonly reason: LushaWaterfallSkipReason | 'leg_failed' }
  | {
      readonly executed: true;
      readonly gap: number;
      readonly clientRequestId: string;
      readonly result: PersistLushaPendingReviewResult;
    };

/**
 * Dependencias inyectables. Existen para que la POLÍTICA se pueda probar con
 * cero proveedores: en producción todas caen a su implementación real.
 */
export type LushaWaterfallLegDeps = {
  readonly waterfallEnabled?: () => boolean;
  readonly lushaAvailable?: () => boolean;
  readonly runLushaBatch?: (
    input: GenerateLushaPendingReviewBatchInput,
  ) => Promise<PersistLushaPendingReviewResult>;
  readonly deriveClientRequestId?: (wizardClientRequestId: string) => string;
  readonly onObservation?: (observation: {
    readonly decision: LushaWaterfallDecision;
    readonly clientRequestId: string | null;
  }) => void;
};

export async function runLushaWaterfallLeg(
  input: LushaWaterfallLegInput,
  deps: LushaWaterfallLegDeps = {},
): Promise<LushaWaterfallLegOutcome> {
  const decision = decideLushaWaterfallLeg({
    waterfallEnabled: (deps.waterfallEnabled ?? isAgent1ApolloLushaWaterfallEnabled)(),
    lushaAvailable: (deps.lushaAvailable ?? isLushaPreviewEnabled)(),
    apolloTerminal: input.apolloTerminal,
    target: input.target,
    usefulAccumulated: input.usefulAccumulated,
    macroIndustryKey: input.macroIndustryKey,
    canonicalBatchId: input.canonicalBatchId,
  });

  if (!decision.run) {
    deps.onObservation?.({ decision, clientRequestId: null });
    return { executed: false, reason: decision.reason };
  }

  const clientRequestId = (deps.deriveClientRequestId ?? deriveLushaWaterfallClientRequestId)(
    input.wizardClientRequestId,
  );
  deps.onObservation?.({ decision, clientRequestId });

  const runLushaBatch = deps.runLushaBatch ?? generateLushaPendingReviewBatchAction;

  try {
    const result = await runLushaBatch({
      clientRequestId,
      countryCode: input.countryCode,
      // El enum lo valida la acción; aquí ya se sabe que no es null.
      macroIndustryKey: decision.macroIndustryKey as GenerateLushaPendingReviewBatchInput['macroIndustryKey'],
      subIndustryId: input.subIndustryId ?? null,
      // 🔴 CORTE 5A — la correlación de la corrida, explícita. Sin este bloque la
      // acción vuelve a comportarse como Lusha standalone (lote propio,
      // `wizard_run_id` propio), que es justo lo que el requisito M prohíbe.
      waterfall: {
        wizardClientRequestId: input.wizardClientRequestId,
        canonicalBatchId: decision.canonicalBatchId,
        targetGap: decision.gap,
      },
    });
    return { executed: true, gap: decision.gap, clientRequestId, result };
  } catch {
    // 🔴 Fail-open hacia el wizard, NUNCA hacia el gasto. La corrida de Apollo
    // ya terminó y ya se liquidó: una pierna Lusha caída no puede convertir un
    // resultado parcial legítimo en un error de la ejecución entera. La acción
    // liquida su propia reserva en su propio `catch` antes de propagar.
    return { executed: false, reason: 'leg_failed' };
  }
}

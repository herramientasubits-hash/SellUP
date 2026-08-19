'use server';

/**
 * Lusha → pending-review persistence — Server Action (Q3F-5BB.4)
 *
 * AGENT1-LUSHA-PROVIDER-USAGE-OBSERVABILITY-1 — la frontera de escritura de esta
 * acción se ENSANCHA por exactamente UNA tabla existente: `provider_usage_logs`.
 * Sigue prohibido `agent_runs` / `agent_run_steps`, y la reserva + su liquidación
 * (M121) siguen siendo la ÚNICA autoridad de gasto: la fila de uso es
 * observabilidad y analítica, jamás una segunda contabilidad. Se escribe DESPUÉS
 * de que la liquidación es terminal, y no puede provocar otra petición al
 * proveedor ni otra liquidación.
 *
 * Runs a single Lusha company search from the "Generar con IA" wizard and
 * persists the results as a pending-review prospect batch + candidates. Thin
 * wrapper over the pure `persistLushaPendingReviewBatch` core:
 *   - Validates the authenticated, active user.
 *   - Validates + sanitizes the input with zod.
 *   - Injects the real Lusha search (same read-only `executeLushaPreview` core,
 *     so page=0 / size=10 / expectedMaxCredits=1 are inherited verbatim).
 *   - Injects DB writes SCOPED to prospect_batches + prospect_candidates using
 *     the RLS session client (bounded by `has_active_access`).
 *
 * Q3F-5BB.7 adds duplicate parity: before candidates are persisted, the pure core
 * runs the canonical SellUp + HubSpot duplicate checker and the active-candidate
 * guard through two READ-ONLY injected deps. Those checkers query accounts /
 * HubSpot / prospect_candidates for READS only — they never create or mutate a
 * record. Account/company creation, HubSpot writes and enrichment remain
 * impossible (no such dep exists).
 *
 * Hard limits (authorized scope Q3F-5BB.4 + Q3F-5BB.7):
 *   - DB writes limited to prospect_batches + prospect_candidates + the ONE
 *     aggregate provider_usage_logs row per run authorized above. Nothing else.
 *   - Does NOT create accounts/companies. Does NOT WRITE to HubSpot. Does NOT call
 *     enrichment / people search / Apollo / Tavily. Does NOT write agent_runs.
 *   - Duplicate checks are read-only (SellUp accounts + HubSpot + active
 *     candidates) and run before insert to populate duplicate_status / matched ids.
 *   - No auto-run: invoked only from the explicit "Buscar con IA" click.
 *   - Never returns raw provider payloads or secrets.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { MACRO_INDUSTRY_KEYS } from '@/modules/macro-industry-catalog/macro-industries';
import { createClient } from '@/lib/supabase/server';
import { isLushaPreviewEnabled } from '@/lib/feature-flags.server';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import { searchLushaCompaniesV3 } from '@/server/integrations/lusha-client';
import {
  executeLushaPreview,
  LUSHA_PREVIEW_TIMEOUT_MS,
} from '@/server/prospect-batches/lusha-preview';
import {
  persistLushaPendingReviewBatch,
  buildLushaPendingReviewFailure,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type PersistLushaPendingReviewResult,
} from '@/server/prospect-batches/lusha-pending-review';
// Q3F-5BB.10C2 / AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — read-only
// official-source resolvers (injected into the pure core), now the SAME
// provider-neutral wiring Apollo also uses + server-side flag gate. Neither
// path carries a forbidden import substring.
import { buildColombiaOfficialSourceResolvers } from '@/server/prospect-batches/official-source-resolvers';
import {
  guardLushaPreviewEnabled,
  buildLushaPendingReviewDisabledResult,
} from '@/modules/prospect-batches/lusha-preview-flag-guard';
// AGENT1-LUSHA-BUDGET-GATE-1 — puerta económica global. El seam es puro (sin env,
// sin proveedor, sin DB): sólo decide que nada llegue a Lusha sin reserva.
import {
  guardLushaRunBudget,
  decideLushaCreditsToConfirm,
  shouldReleaseLushaReservation,
  buildLushaBudgetSettlementTelemetry,
  LUSHA_BUDGET_SETTLEMENT_THREW_CODE,
  type LushaBudgetReserveOutcome,
  type LushaBudgetReservation,
  type LushaBudgetSettlementOutcome,
} from '@/modules/prospect-batches/lusha-budget-gate';
import { estimateLushaRunCredits } from '@/server/prospect-batches/lusha-run-liability';
// AGENT1-LUSHA-PROVIDER-USAGE-OBSERVABILITY-1 §§ 5/6/12 — la fila canónica de uso.
// El recolector no conoce el cliente de Lusha ni las RPC de presupuesto, así que
// por construcción no puede pedir otra vez ni liquidar otra vez.
import {
  recordLushaRunProviderUsage,
  LUSHA_PROVIDER_USAGE_LOG_FAILED_CODE,
} from '@/server/prospect-batches/lusha-provider-usage-recorder';
import { buildLushaRunRequestSignature } from '@/server/prospect-batches/lusha-provider-usage-observability';
// La correlación de corrida CANÓNICA, la misma que Apollo dejó en Producción. Se
// construye ANTES de salir al proveedor: una identidad acuñada después de gastar
// no puede identificar lo que se gastó.
import {
  buildWizardRunCorrelation,
  withResolvedIds,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';
// AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 §§ 2/12 — el plan sale de la MISMA
// puerta que decidió la elegibilidad, así que no puede haber ruta anunciada sin
// plan ni plan ejecutable sin reserva calculable.
import { resolveLushaRoutedSearchPlan } from '@/server/prospect-batches/lusha-macro-capability';
// Las MISMAS primitivas de reserva que usan Apollo y Tavily. Un segundo
// mecanismo de reserva sería un segundo presupuesto, que es justo lo que este
// trabajo prohíbe.
import {
  reserveWizardPilotCredits,
  confirmWizardPilotCredits,
  releaseWizardPilotCredits,
  fetchWizardReservationRecord,
  readWizardBudgetPeriodSnapshot,
  type BudgetReservationsRpcClient,
  type ReservationLookupClient,
  type BudgetPeriodLookupClient,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-reservations';
import {
  createWizardBudgetServiceClient,
  WIZARD_BUDGET_TIMEZONE,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight.server';
import { getPilotBudgetPeriodStart } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-reconciliation';
// Q3F-5BB.11D — OBSERVATIONAL provider-routing wiring. The adapter is pure (no
// env, no provider client, no Supabase). The barrel exposes the pure 11B resolver
// + 11C metadata builder. This produces routing metadata + a safety assert ONLY;
// it never decides eligibility (resolveWizardLushaCriteria) nor replaces the
// server-side flag guard above.
import {
  buildLushaRoutingCriteria,
  buildLushaRoutingConfig,
  buildLushaObservationalRegistry,
  assertLushaRoutingPlanSafe,
} from '@/modules/prospect-batches/lusha-provider-routing-adapter';
import {
  resolveProviderRoutingPlan,
  buildProviderRoutingMetadata,
  type ProviderRoutingEnvironment,
} from '@/modules/prospect-batches/provider-routing';
// Read-only duplicate parity (Q3F-5BB.7). Both helpers query for READS only:
//   - checkCompanyDuplicate       → SellUp accounts + HubSpot (read-only checkers).
//   - fetchActiveCandidatesForGuard → active prospect_candidates prefetch (read-only).
// Neither can create/mutate anything; the pure core has no write dep for them.
import { checkCompanyDuplicate } from '@/server/agents/prospecting-toolkit/duplicate-checker';
import { fetchActiveCandidatesForGuard } from '@/server/agents/prospecting-toolkit/candidate-writer';

const GenerateInputSchema = z.object({
  /**
   * AGENT1-LUSHA-BUDGET-GATE-1 § 8 — ancla de idempotencia de la reserva.
   *
   * `try_reserve_wizard_credits` identifica una corrida por
   * `(user_id, client_request_id)`: es lo que hace que un doble clic reutilice la
   * reserva en lugar de abrir una segunda. Es OBLIGATORIO, no opcional: una
   * ausencia se rechaza como entrada inválida antes de tocar al proveedor.
   * Derivarlo en el servidor a partir de los criterios sería peor — dos búsquedas
   * legítimas idénticas colisionarían y la segunda gastaría contra la reserva ya
   * liquidada de la primera.
   */
  clientRequestId: z.string().trim().uuid(),
  countryCode: z.string().trim().min(2).max(4),
  /**
   * AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 § 8 — enum CANÓNICO, no una cadena
   * con techo de longitud.
   *
   * 🔴 Lo que sustituye era `z.string().trim().min(1).max(40)`, y ese 40 era un
   * defecto latente: la clave canónica más larga del catálogo,
   * `industry_manufacturing_chemicals_automotive`, mide 44 caracteres. Con el
   * campo transportando claves de macro, esa macro —y sólo esa— habría sido
   * rechazada como entrada inválida DESPUÉS de que la UI ya la ofreciera: un
   * 11/12 silencioso, con el fallo concentrado en la macro más ancha del catálogo.
   *
   * El enum lo cierra por construcción y de paso hace innecesario cualquier
   * número: la validación ya no puede quedarse corta porque no cuenta caracteres,
   * y añadir una macro al catálogo la admite aquí sin tocar este fichero.
   */
  macroIndustryKey: z.enum(MACRO_INDUSTRY_KEYS),
  subIndustryId: z.number().int().positive().nullable().optional(),
  sizeBandKey: z.string().trim().max(20).nullable().optional(),
  searchText: z.string().trim().max(120).nullable().optional(),
});

export type GenerateLushaPendingReviewBatchInput = z.infer<typeof GenerateInputSchema>;

/** Client-facing result — never exposes raw provider payloads or secrets. */
export type GenerateLushaPendingReviewBatchActionResult = PersistLushaPendingReviewResult;

function invalidInputResult(): GenerateLushaPendingReviewBatchActionResult {
  return buildLushaPendingReviewFailure('Parámetros de búsqueda inválidos.', 'invalid_input');
}

/**
 * Resolve the runtime environment server-side (the pure routing adapter never
 * reads env). Mirrors the repo's Vercel/NODE_ENV convention; only used to gate
 * provider capability in the OBSERVATIONAL plan.
 */
function resolveRoutingEnvironment(): ProviderRoutingEnvironment {
  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv === 'production') return 'production';
  if (vercelEnv === 'preview') return 'preview';
  if (process.env.NODE_ENV === 'production') return 'production';
  return 'development';
}

/**
 * Executes the Lusha search once and persists the results as pending-review
 * prospects. Returns counts + safe billing metadata for the confirmation UI.
 */
export async function generateLushaPendingReviewBatchAction(
  rawInput: GenerateLushaPendingReviewBatchInput,
): Promise<GenerateLushaPendingReviewBatchActionResult> {
  // Q3F-5BB.10C2 — server-side ENABLE_LUSHA_PREVIEW gate (P0). When the flag is
  // off, `guardLushaPreviewEnabled` returns the disabled result WITHOUT running
  // the callback — so no Lusha client is built, no search runs, and nothing is
  // written, even on a direct call that bypasses the UI gate.
  return guardLushaPreviewEnabled(
    isLushaPreviewEnabled(),
    buildLushaPendingReviewDisabledResult,
    async () => runGenerateLushaPendingReviewBatch(rawInput),
  );
}

async function runGenerateLushaPendingReviewBatch(
  rawInput: GenerateLushaPendingReviewBatchInput,
): Promise<GenerateLushaPendingReviewBatchActionResult> {
  // Auth: active internal user (RLS-scoped session). Redirects to /login if not.
  const { internalUserId } = await requireActiveUser();

  const parsed = GenerateInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return invalidInputResult();
  }

  // Q3F-5BB.11D — OBSERVATIONAL provider-routing plan. We are already inside the
  // guard's run() (flag ON), so Lusha is enabled here. Build the pure plan,
  // assert it is safe (never Apollo/Tavily; selected must be Lusha), and derive
  // the additive routing metadata. This does NOT gate execution or eligibility —
  // it only annotates the batch/candidates. If the plan is unsafe the assert
  // throws and the outer try/catch fails the request closed (never a fallback).
  const environment = resolveRoutingEnvironment();
  const routingPlan = resolveProviderRoutingPlan(
    buildLushaRoutingCriteria({
      countryCode: parsed.data.countryCode,
      macroIndustryKey: parsed.data.macroIndustryKey,
    }),
    buildLushaRoutingConfig({ environment, lushaEnabled: true }),
    buildLushaObservationalRegistry(),
  );
  assertLushaRoutingPlanSafe(routingPlan);
  const routingMetadata = buildProviderRoutingMetadata(routingPlan, {
    environment,
    fallbackAllowed: false,
    fallbackReason: 'lusha_intent_never_chains',
  });

  // ── AGENT1-LUSHA-BUDGET-GATE-1 § 7 — puerta económica, ANTES del proveedor ──
  //
  // Orden (§ 10): flag → autenticación → validación → PRESUPUESTO → credencial →
  // cliente → búsqueda. Nada por debajo de esta línea corre sin reserva
  // concedida, y la credencial (`getLushaApiKey`) sigue resolviéndose de forma
  // perezosa dentro de `runSearch`, así que un bloqueo no llega ni a pedirla.
  //
  // § 7/§ 8 — UNA reserva por corrida, consciente del plan. `estimateLushaRunCredits`
  // devuelve 2 sin plan y ramas × 2 con plan (2/4/6), y es la MISMA función de la
  // que sale el aviso previo de la UI. El ejecutor acota sus peticiones con el
  // mismo producto, así que no puede intentar gastar por encima de lo reservado.
  // § 12 — plan y responsabilidad económica salen de la MISMA fuente canónica.
  // Una macro admitida SIEMPRE tiene plan (la capacidad es la que lo garantiza),
  // así que aquí no puede aparecer un `null` que degradase la reserva a 2.
  const searchPlan = resolveLushaRoutedSearchPlan(parsed.data.macroIndustryKey);
  const requiredCredits = estimateLushaRunCredits(searchPlan);
  const { clientRequestId, ...searchInput } = parsed.data;

  // §§ 5/6 — identidad de la corrida, ANTES del proveedor. `request_fingerprint`
  // describe lo pedido sin PII y sin nombres de empresa; el `idempotencyKey` que
  // gobierna la única fila de uso sale de (user, clientRequestId, reservationId),
  // que es la MISMA identidad sobre la que la RPC reserva.
  const baseCorrelation = buildWizardRunCorrelation({
    userId: internalUserId,
    clientRequestId,
    providerKey: 'lusha',
    requestSignature: buildLushaRunRequestSignature({
      countryCode: parsed.data.countryCode,
      macroIndustryKey: parsed.data.macroIndustryKey,
      subIndustryId: parsed.data.subIndustryId ?? null,
      sizeBandKey: parsed.data.sizeBandKey ?? null,
      branchCountPlanned: searchPlan?.branches.length ?? 1,
      requiredCredits,
    }),
  });

  return guardLushaRunBudget(
    () => reserveLushaRunCredits({ userId: internalUserId, clientRequestId, requiredCredits }),
    (block) => ({
      ...buildLushaPendingReviewFailure(block.message, block.code),
      ...(block.budgetExceeded !== null ? { budgetExceeded: block.budgetExceeded } : {}),
    }),
    (reservation) =>
      runLushaSearchWithReservation({
        searchInput,
        internalUserId,
        reservation,
        routingMetadata,
        routingPlan,
        searchPlan,
        baseCorrelation,
      }),
    requiredCredits,
  );
}

/**
 * Reserva atómica en el período GLOBAL de Agente 1, con las MISMAS RPC que
 * Apollo/Tavily y contra la MISMA fila (`wizard_monthly_budget_periods`).
 *
 * Requiere `service_role`: las RPC y `wizard_budget_reservations` están REVOKE'd
 * para `authenticated`, y el período sólo tiene policy de `service_role` — un
 * cliente de sesión leería CERO filas SIEMPRE y eso se confundiría con «no hay
 * período». Un fallo aquí (credenciales ausentes, RPC caída) se propaga como
 * excepción y el seam lo convierte en bloqueo: fail-closed.
 */
async function reserveLushaRunCredits(input: {
  userId: string;
  clientRequestId: string;
  requiredCredits: number;
}): Promise<LushaBudgetReserveOutcome> {
  const budgetClient = createWizardBudgetServiceClient();
  const periodStart = getPilotBudgetPeriodStart(WIZARD_BUDGET_TIMEZONE);

  const rpcResult = await reserveWizardPilotCredits(
    {
      userId: input.userId,
      clientRequestId: input.clientRequestId,
      requestedCredits: input.requiredCredits,
      periodStart,
    },
    budgetClient as unknown as BudgetReservationsRpcClient,
  );

  if (rpcResult.status === 'blocked') {
    // La RPC ya decidió. Esto sólo LEE el mismo período para poder explicarlo
    // (agotado vs. no alcanza). Best-effort: un fallo de lectura no cambia el
    // bloqueo, sólo deja el detalle en `null`.
    const budgetSnapshot =
      rpcResult.code === 'BUDGET_EXCEEDED'
        ? await readWizardBudgetPeriodSnapshot(
            periodStart,
            budgetClient as unknown as BudgetPeriodLookupClient,
          ).catch(() => null)
        : null;
    return {
      status: 'blocked',
      code: rpcResult.code,
      message: rpcResult.message,
      budgetSnapshot,
    };
  }

  // Tanto 'reserved' como 'already_reserved' necesitan el id para reconciliar.
  const record = await fetchWizardReservationRecord(
    input.userId,
    input.clientRequestId,
    budgetClient as unknown as ReservationLookupClient,
  );
  if (!record) {
    return {
      status: 'blocked',
      code: 'BUDGET_RESERVATION_FAILED',
      message: 'reservation_record_not_found',
      budgetSnapshot: null,
    };
  }

  return {
    status: rpcResult.status,
    reservationId: record.id,
    creditsReserved: record.credits_reserved,
  };
}

/**
 * Ejecuta la búsqueda con la reserva ya concedida y la reconcilia.
 *
 * Sólo se llega aquí desde `run()` del seam de presupuesto, así que la existencia
 * de esta función ya implica que hay reserva.
 */
async function runLushaSearchWithReservation(args: {
  searchInput: Omit<GenerateLushaPendingReviewBatchInput, 'clientRequestId'>;
  internalUserId: string;
  reservation: LushaBudgetReservation;
  routingMetadata: ReturnType<typeof buildProviderRoutingMetadata>;
  routingPlan: ReturnType<typeof resolveProviderRoutingPlan>;
  /**
   * Plan Macro-v2 de la corrida. Una macro ADMITIDA siempre lo tiene —la
   * capacidad es lo que lo garantiza— así que en la práctica nunca es `null`; el
   * tipo lo admite porque el resolvedor es fail-closed y no se le quita la
   * posibilidad de negarse.
   */
  searchPlan: ReturnType<typeof resolveLushaRoutedSearchPlan>;
  /** Correlación de la corrida, ya construida antes de la reserva (§ 5). */
  baseCorrelation: ReturnType<typeof buildWizardRunCorrelation>;
}): Promise<GenerateLushaPendingReviewBatchActionResult> {
  const {
    searchInput,
    internalUserId,
    reservation,
    routingMetadata,
    routingPlan,
    searchPlan,
    baseCorrelation,
  } = args;
  const supabase = await createClient();

  // La reserva YA existe aquí, así que la identidad de la corrida queda cerrada:
  // `withResolvedIds` recalcula el `idempotencyKey` con ella, y el `batchId` que
  // se resuelve más tarde NO lo altera. Esa es la razón de que un reintento sobre
  // la misma reserva produzca la misma clave y, por tanto, una sola fila.
  const reservedCorrelation = withResolvedIds(baseCorrelation, {
    reservationId: reservation.reservationId,
  });

  // § 12 — duración de la corrida, para la fila de uso. Se toma aquí y no en el
  // núcleo puro: el writer no mide tiempo y no debe empezar a hacerlo.
  const runStartedAtMs = Date.now();

  /**
   * Liquidación de la reserva. Se llama en TODOS los caminos de salida por
   * debajo de este punto — incluido el fallo — porque a partir de la primera
   * petición el proveedor pudo cobrar. Best-effort: un fallo de liquidación no
   * convierte una corrida exitosa en un error, igual que en la ruta Apollo.
   *
   * AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 § 10 — devuelve un resultado
   * DISCRIMINADO en lugar de `void`. Antes esta función era `Promise<void>` y sus
   * llamadas hacían `.catch(() => undefined)`, así que «liquidada», «liquidada con
   * sobrepaso» y «no liquidada» eran indistinguibles: no dejaban rastro ninguna de
   * las tres. Sigue sin lanzar —la contabilidad no puede tumbar una corrida que el
   * proveedor ya cobró— pero ahora el resultado EXISTE y se registra.
   */
  const settleReservation = async (
    result: PersistLushaPendingReviewResult | null,
  ): Promise<LushaBudgetSettlementOutcome> => {
    const budgetClient = createWizardBudgetServiceClient();
    const rpc = budgetClient as unknown as BudgetReservationsRpcClient;

    if (
      result !== null &&
      shouldReleaseLushaReservation({
        pagesRequested: result.pagesRequested,
        creditsChargedTotal: result.creditsChargedTotal,
      })
    ) {
      const released = await releaseWizardPilotCredits(
        {
          reservationId: reservation.reservationId,
          batchId: result.batchId,
          reason: 'lusha_no_provider_page_requested',
        },
        rpc,
      );
      if (released.status === 'released') return { status: 'released' };
      // `already_released` / `already_confirmed`: la reserva ya está cerrada, no
      // hay nada que liquidar y no es un fallo.
      if (released.status === 'error') {
        return {
          status: 'failed',
          code: released.code,
          creditsReportedActual: null,
        };
      }
      return { status: 'already_terminal' };
    }

    const actualCreditsConsumed = decideLushaCreditsToConfirm({
      creditsReserved: reservation.creditsReserved,
      creditsChargedTotal: result?.creditsChargedTotal ?? null,
    });

    const confirmed = await confirmWizardPilotCredits(
      {
        reservationId: reservation.reservationId,
        actualCreditsConsumed,
        batchId: result?.batchId ?? null,
        // Sólo para que el wrapper pueda declarar la MAGNITUD del sobrepaso. No
        // interviene en la decisión: quien decide si lo hubo es la RPC, que tiene
        // la fila bloqueada.
        creditsReserved: reservation.creditsReserved,
      },
      rpc,
    );

    switch (confirmed.status) {
      case 'confirmed':
        return { status: 'confirmed' };
      case 'confirmed_with_overage':
        return {
          status: 'confirmed_with_overage',
          creditsReserved: confirmed.creditsReserved ?? reservation.creditsReserved,
          creditsActual: confirmed.creditsActual,
          overageCredits:
            confirmed.overageCredits ??
            confirmed.creditsActual - reservation.creditsReserved,
        };
      case 'already_confirmed':
        return { status: 'already_terminal' };
      default:
        return {
          status: 'failed',
          code: confirmed.code,
          creditsReportedActual: actualCreditsConsumed,
        };
    }
  };

  /**
   * Liquida y DEJA CONSTANCIA. Nunca lanza y nunca cambia el resultado de la
   * corrida: § 12 es explícito en que un fallo de contabilidad no debe convertir un
   * descubrimiento exitoso en un fallo de proveedor. Lo que sí hace es que el fallo
   * —y el sobrepaso— dejen de ser silenciosos.
   */
  const settleReservationObservably = async (
    result: PersistLushaPendingReviewResult | null,
  ): Promise<LushaBudgetSettlementOutcome> => {
    let outcome: LushaBudgetSettlementOutcome;
    try {
      outcome = await settleReservation(result);
    } catch (settlementError: unknown) {
      // La liquidación lanzó (credenciales de servicio ausentes, RPC inalcanzable).
      // Se clasifica; el mensaje crudo no entra en el log.
      outcome = {
        status: 'failed',
        code: LUSHA_BUDGET_SETTLEMENT_THREW_CODE,
        creditsReportedActual: null,
      };
      void settlementError;
    }

    const telemetry = buildLushaBudgetSettlementTelemetry(outcome, {
      reservationId: reservation.reservationId,
      creditsReserved: reservation.creditsReserved,
      batchId: result?.batchId ?? null,
    });
    if (telemetry) {
      // Log de servidor seguro: cifras e IDs internos. Sin payload del proveedor,
      // sin clave de API, sin datos de empresa ni de persona.
      console.warn(`[${telemetry.code}]`, telemetry.payload);
    }
    // §§ 7/8 — el DESENLACE de la liquidación se devuelve porque la fila de uso lo
    // necesita para declarar la verdad: cuánto se liquidó de verdad, si hubo
    // sobrepaso y si la liquidación llegó a ocurrir. Sigue sin lanzar y sigue sin
    // alterar el resultado de la corrida.
    return outcome;
  };

  /**
   * Observabilidad de uso: UNA fila por corrida, DESPUÉS de la liquidación (§ 12).
   *
   * Mismo patrón probado que la liquidación: nunca lanza y nunca cambia el
   * resultado. Es deliberado y no es defensa redundante — si un fallo de
   * observabilidad se propagara, el `catch` de abajo liquidaría por SEGUNDA vez y
   * devolvería un error al usuario por una corrida que el proveedor YA cobró,
   * ofreciéndole un reintento que volvería a gastar.
   *
   * No puede reservar, confirmar ni liberar créditos: el recolector no importa
   * ninguna RPC de presupuesto. Tampoco puede pedir otra vez al proveedor: no
   * conoce el cliente de Lusha.
   */
  const recordRunUsageObservably = async (
    result: PersistLushaPendingReviewResult | null,
    settlement: LushaBudgetSettlementOutcome,
  ): Promise<void> => {
    try {
      const outcome = await recordLushaRunProviderUsage({
        // El `batchId` entra ahora que existe; no altera la clave de idempotencia.
        correlation: withResolvedIds(reservedCorrelation, {
          batchId: result?.batchId ?? null,
        }),
        triggeredByUserId: internalUserId,
        countryCode: searchInput.countryCode,
        macroIndustryKey: searchInput.macroIndustryKey,
        creditsReserved: reservation.creditsReserved,
        settlement,
        durationMs: Date.now() - runStartedAtMs,
        run: {
          status: result?.status ?? 'error',
          creditsChargedTotal: result?.creditsChargedTotal ?? null,
          resultsReturned: result?.resultsReturned ?? null,
          rawResultsTotal: result?.rawResultsTotal ?? null,
          pagesRequested: result?.pagesRequested ?? null,
          providerRequestsUsed: result?.providerRequestsUsed ?? null,
          stopReason: result?.stopReason ?? null,
          reviewableFoundTotal: result?.reviewableFoundTotal ?? null,
          acceptedForTargetTotal: result?.usefulCandidatesCount ?? 0,
          targetOverflowDiscarded: result?.targetOverflowDiscarded ?? null,
          precisionRejectedTotal: result?.precisionRejectedTotal ?? null,
          historicalActiveSkips: result?.skippedActiveDuplicatesCount ?? 0,
          exactDuplicates: result?.excludedExactDuplicatesCount ?? 0,
          possibleDuplicates: result?.possibleDuplicatesCount ?? 0,
          telemetry: result?.multiBranch ?? null,
        },
      });

      if (outcome.kind === 'failed') {
        // Observable, nunca silencioso — y nunca un reintento del proveedor.
        console.warn(`[${LUSHA_PROVIDER_USAGE_LOG_FAILED_CODE}]`, {
          reservation_id: reservation.reservationId,
          batch_id: result?.batchId ?? null,
          wizard_run_id: reservedCorrelation.wizardRunId,
        });
      }
    } catch {
      // Ya no debería poder ocurrir (el recolector es total), pero si ocurriera,
      // aquí se detiene: la corrida y su liquidación son terminales.
      console.warn(`[${LUSHA_PROVIDER_USAGE_LOG_FAILED_CODE}]`, {
        reservation_id: reservation.reservationId,
        wizard_run_id: reservedCorrelation.wizardRunId,
        threw: true,
      });
    }
  };

  try {
    const result = await persistLushaPendingReviewBatch(
      {
        // Lusha runs through the read-only preview core → guardrails inherited.
        runSearch: (input) =>
          executeLushaPreview(
            {
              resolveApiKey: () => getLushaApiKey(),
              searchCompanies: (apiKey, request) =>
                searchLushaCompaniesV3({
                  apiKey,
                  timeoutMs: LUSHA_PREVIEW_TIMEOUT_MS,
                  request,
                }),
            },
            input,
          ),
        // Write dep #1 — prospect_batches ONLY.
        insertBatch: async (row: LushaPendingReviewBatchRow) => {
          const { data, error } = await supabase
            .from('prospect_batches')
            .insert(row)
            .select('id')
            .single();
          if (error || !data) {
            throw new Error(`No se pudo crear el lote: ${error?.message ?? 'sin datos'}`);
          }
          return { id: data.id as string };
        },
        // Write dep #2 — prospect_candidates ONLY.
        insertCandidates: async (rows: LushaPendingReviewCandidateRow[]) => {
          const { data, error } = await supabase
            .from('prospect_candidates')
            .insert(rows)
            .select('id');
          if (error) {
            throw new Error(`No se pudieron crear los candidatos: ${error.message}`);
          }
          return { insertedCount: data?.length ?? 0 };
        },
        // Read-only dep #1 — canonical SellUp + HubSpot duplicate checker.
        checkCompanyDuplicate: (dupInput) => checkCompanyDuplicate(dupInput),
        // Read-only dep #2 — active prospect_candidates prefetch for the guard.
        // Uses the RLS-bounded session client; degrades gracefully (returns []).
        fetchActiveCandidates: async (domains, countryCode) => {
          const prefetch = await fetchActiveCandidatesForGuard(
            supabase,
            domains,
            countryCode,
          );
          return prefetch.records;
        },
        // Read-only official-source resolvers (Q3F-5BB.10C2). Today: Colombia
        // (co_siis) name→NIT via an approved service-role read. Best-effort:
        // yields [] when a safe client is unavailable → enrichment fails soft.
        officialSourceResolvers: buildColombiaOfficialSourceResolvers(),
      },
      searchInput,
      { internalUserId },
      // Q3F-5BB.11D — additive OBSERVATIONAL routing metadata (never gates).
      { routingMetadata, routingPlan },
      // §§ 3/4/8 — ejecución de la corrida. `targetGap` NO se pasa: no existe
      // todavía ninguna fuente de hueco aguas arriba (el descubrimiento por país
      // es trabajo posterior), así que el ejecutor resuelve su objetivo por
      // defecto y el comportamiento de producto no cambia. `creditsReserved` es
      // sólo telemetría, para que el lote registre contra qué reserva corrió.
      {
        plan: searchPlan,
        creditsReserved: reservation.creditsReserved,
      },
    );

    // § 9 — reconciliación: se confirma lo que Lusha reportó, y la reserva
    // entera cuando no reportó nada (gasto no verificable). Un sobrepaso o un
    // fallo de liquidación quedan registrados (§ 11/§ 12) sin alterar el resultado.
    const settlement = await settleReservationObservably(result);

    // § 12 — la observabilidad va DESPUÉS de una liquidación ya terminal, para
    // poder registrar el importe REALMENTE liquidado y no una estimación.
    await recordRunUsageObservably(result, settlement);

    // Safe server-side log — no secrets, no raw payload, no PII.
    console.warn('[lusha-pending-review]', {
      status: result.status,
      createdCandidatesCount: result.createdCandidatesCount,
      skippedCount: result.skippedCount,
      creditsCharged: result.creditsCharged,
      resultsReturned: result.resultsReturned,
      country: searchInput.countryCode,
      reservedCredits: reservation.creditsReserved,
      creditsChargedTotal: result.creditsChargedTotal,
      // §§ 18/19 — por qué paró y cuánto pidió. Sin PII, sin payload, sin clave.
      macroKey: searchPlan?.macroKey ?? null,
      branchCountPlanned: result.branchCountPlanned,
      branchCountAttempted: result.branchCountAttempted,
      providerRequestsAllowed: result.providerRequestsAllowed,
      providerRequestsUsed: result.providerRequestsUsed,
      crossBranchDuplicatesRemoved: result.crossBranchDuplicatesRemoved,
      stopReason: result.stopReason,
    });

    if (result.status === 'success') {
      // Refresh the Prospectos list so the new candidates appear.
      revalidatePath('/accounts');
    }

    return result;
  } catch (err: unknown) {
    // § 9 — un fallo DESPUÉS de la reserva se liquida conservador: sin resultado
    // no se sabe si el proveedor cobró, y devolver headroom que sí se gastó
    // dejaría el período mintiendo por encima de lo real.
    const settlement = await settleReservationObservably(null);
    // § 13 — si la corrida no llegó a pedir al proveedor, el recolector no emite
    // ninguna fila pagada. Un fallo DESPUÉS de la primera petición sí se registra,
    // porque el proveedor pudo cobrarla.
    await recordRunUsageObservably(null, settlement);
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    return buildLushaPendingReviewFailure(
      'No fue posible guardar los prospectos. Intenta de nuevo.',
      msg.slice(0, 200),
    );
  }
}

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
// AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 12/15/25 — la capa GRATUITA,
// idéntica para Apollo y para Lusha, que corre ANTES de que exista una reserva.
import { runPrePaidNoveltyDiscovery } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import {
  createCanonicalLushaBatchResolver,
  reserveOrReturnLushaCanonicalBatch,
  type CanonicalLushaBatchResolver,
  type LushaCanonicalBatchDbClient,
} from '@/server/prospect-batches/lusha-canonical-batch';
import { resolveProviderSeenStore } from '@/server/prospect-batches/provider-seen/provider-seen-store';
import {
  LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
  // AGENT1-LOCAL-CUT9 § 1 — el ÚNICO dueño del valor vivo de activación de hueco
  // parcial en esta superficie. `true` desde CUT-9.
  LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
} from '@/server/prospect-batches/lusha-pending-review-limits';
// ── AGENT1-LOCAL-CUT9 §§ 2, 3, 4 — la aceptación hacia el objetivo ────────────
//
// 🔴 Los MISMOS helpers que la ruta Apollo del wizard usa desde CUT-7/CUT-8. No se
// acuña una autoridad Lusha: `resolveAcceptedForTarget` es la única aritmética de
// aceptación de la corrida, y `resolveProviderResultDemand` la única lectura del
// hueco. Esta superficie deja de tener que reconstruir ninguno de los dos.
import {
  ACCEPTED_FOR_TARGET_METADATA_KEY,
  PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
  paidAcceptedContributionFromWriterTruth,
  resolveAcceptedForTarget,
  toAcceptedForTargetMetadata,
  type AcceptedForTargetResult,
} from '@/modules/prospect-batches/accepted-for-target';
// AGENT1-LOCAL-CUT9B — la costura durable. El TIPO del proyector es el MISMO que
// CUT-8 fijó para la ruta Apollo (`ResolveExtraBatchMetadata`): una clave, una
// forma y un vocabulario para las dos superficies.
import type { ResolveExtraBatchMetadata } from '@/server/agents/prospecting-toolkit/writer-metadata-resolution';
import {
  decideBatchMetadataFencePlan,
  publishFencedBatchMetadata,
  type BatchMetadataPublicationDbClient,
} from '@/server/prospect-batches/batch-metadata-fenced-publication';
import {
  fullTargetResultDemand,
  resolveProviderResultDemand,
} from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import {
  persistLushaPendingReviewBatch,
  buildLushaPendingReviewFailure,
  buildLushaProviderNotRequiredResult,
  LUSHA_PENDING_REVIEW_BATCH_SOURCE,
  LUSHA_PENDING_REVIEW_BATCH_STATUS,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type PersistLushaPendingReviewResult,
} from '@/server/prospect-batches/lusha-pending-review';
// AGENT1-CUT3B4 § 22 — el transporte de la RPC vallada. Aquí vive el ÚNICO
// cliente de base de datos de esta ruta; el núcleo sigue sin tener I/O propio.
import { insertFencedProspectCandidates } from '@/server/prospect-batches/batch-identity-fence';
import { loadBatchIdentityRegistry } from '@/server/prospect-batches/batch-identity-registry-store';
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
  const { clientRequestId, ...searchInput } = parsed.data;

  // ── AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 12/15 — TODO lo gratuito ──
  //
  // Va ANTES de `estimateLushaRunCredits` y ANTES de la reserva, y ese orden es el
  // hito entero. La corrida real del 2026-08-19 hizo lo contrario: reservó 6
  // créditos, los gastó, y sólo entonces descubrió que 24 empresas eran candidatos
  // históricos activos, 10 duplicados exactos y 6 fuera de la macro — todo ello ya
  // sabido en SellUp antes de preguntar. Cero empresas nuevas por $0.529.
  //
  // Fail-open (§ 12): país sin fuente, fuente sin cablear, macro sin cobertura o
  // lectura caída terminan en `residualGap = requestedTarget`, y desde ahí la ruta
  // de pago se comporta EXACTAMENTE como antes de este hito.
  const requestedTarget = LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES;
  const countryName =
    LATAM_COUNTRIES.find((c) => c.code === parsed.data.countryCode)?.name ??
    parsed.data.countryCode;

  // Las empresas gratuitas aceptadas se persisten por la ingesta CANÓNICA de
  // fuentes (§ 13) dentro de este mismo runner —el MISMO que usa la ruta
  // Apollo—, así que la capa previa al pago no puede divergir entre proveedores.
  //
  // ── AGENT1-LUSHA-MIXED-TWO-BATCH-CONTAINMENT-1 §§ 2, 4 — CONTENCIÓN ────────
  //
  // Lusha SÍ sabe aceptar un objetivo reducido —`resolveLushaTargetGap` lo recibe
  // y `canAcceptLushaUsefulCandidate` lo hace cumplir dentro de cada página
  // pagada—, y esa capacidad sigue entera y probada. Lo que esta superficie NO
  // tiene es el ancla durable de idempotencia/lote que permitiría al ejecutor de
  // pago ADOPTAR el lote de la capa gratuita, así que con `true` una sola
  // búsqueda del usuario termina en DOS lotes: el gratuito con su aporte parcial
  // y el pagado con el resto, y el resultado devuelto apunta al segundo.
  //
  // Ese comportamiento está VIVO hoy. Hasta que
  // `AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1` diseñe el lote único, esta ruta toma
  // la MISMA postura de contención que ya tiene la ruta Apollo
  // (`WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED`): todo-o-nada.
  //
  // 🔴 El valor vivo se decide en UN sitio y aquí sólo se consume. Escribir el
  // literal de vuelta pone en rojo el ratchet de cableado.
  // ── AGENT1-LOCAL-CUT9A §§ 2, 5 — UN dueño canónico por EJECUCIÓN ──────────
  //
  // Se construye ANTES de que corra nada —gratuito o de pago— y las dos mitades
  // preguntan a ESTA instancia. Ese es el corte entero: hasta aquí la mitad
  // gratuita creaba su lote y la de pago el suyo, sin ninguna autoridad común, y
  // una sola búsqueda podía terminar en dos.
  //
  // 🔴 PEREZOSO: construirlo no escribe nada. La fila nace en la primera llamada a
  // `resolve()`, así que una corrida que la puerta gratuita descarta sin escribir
  // —o que el presupuesto bloquea más abajo— sigue sin dejar lote, exactamente
  // como antes del corte.
  //
  // 🔴 La identidad es la que YA existe, `(created_by, client_request_id)`. No se
  // inventa ninguna: ni `batchExecutionId`, ni `retryGroupId`, ni equivalente.
  const canonicalBatchClient = (await createClient()) as unknown as LushaCanonicalBatchDbClient;
  const canonicalBatch = createCanonicalLushaBatchResolver(
    (row) => reserveOrReturnLushaCanonicalBatch(row, canonicalBatchClient),
    {
      createdByUserId: internalUserId,
      clientRequestId,
      // § 8 — AUTORIDAD DE PETICIÓN. Es el objetivo que el producto le promete a la
      // persona, y lo establece el PROPIETARIO del lote, no el primer contribuyente
      // que llegue con un residual.
      requestedTarget,
      defaults: {
        name: `Búsqueda con IA · ${parsed.data.macroIndustryKey ?? '—'} · ${countryName}`,
        country: countryName,
        country_code: parsed.data.countryCode,
        industry: parsed.data.macroIndustryKey,
        search_depth: 'standard',
        status: LUSHA_PENDING_REVIEW_BATCH_STATUS,
        source: LUSHA_PENDING_REVIEW_BATCH_SOURCE,
        metadata: {},
      },
    },
  );

  const prePaid = await runPrePaidNoveltyDiscovery(await createClient(), {
    countryCode: parsed.data.countryCode,
    countryName,
    macroIndustryKey: parsed.data.macroIndustryKey,
    requestedTarget,
    requestedByUserId: internalUserId,
    partialGapSupported: LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
    // ADDENDUM PROVIDER-SEEN §§ 5, 6 — el proveedor decide la CAPACIDAD de
    // exclusión y de qué memoria se lee.
    //
    // 🔴 AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION § 1 — y la capacidad de Lusha
    // está APAGADA en las dos dimensiones: el soporte HUMANO confirmó que
    // `POST /v3/companies/prospecting` no tiene exclusión del lado del servidor.
    // Los dominios conocidos se siguen recogiendo, y sirven para la supresión
    // CLIENTE posterior a la respuesta.
    provider: 'lusha',
    // 🔴 CUT9A § 5 — la MISMA autoridad que usará la mitad de pago. El runner lo
    // invoca SÓLO cuando de verdad tiene empresas que escribir, y envuelto en su
    // `.catch(() => null)`: la capa gratuita falla ABIERTO y este cableado no le
    // quita esa propiedad. Si el lote canónico no se pudiera resolver, el writer
    // genérico crearía el suyo, que es el comportamiento previo al corte.
    resolveBatchId: async () => (await canonicalBatch.resolve()).id,
  });

  // ── AGENT1-LOCAL-CUT9 §§ 2, 3, 4 — LA ÚNICA ARITMÉTICA DE ACEPTACIÓN ───────
  //
  // 🔴 CUT-9 § 2 — el hueco NO se recalcula aquí. `resolveProviderResultDemand`
  // LEE el `residualGap` que `buildPrePaidNoveltyContext` ya resolvió y que
  // `withFreeSourcePersistenceOutcome` ya reajustó a lo REALMENTE persistido.
  // Escribir `requestedTarget - prePaid.persistedCount` habría creado una segunda
  // definición del mismo hueco, que es lo que este corte existe para no hacer.
  //
  // 🔴 `prePaidContributed` es la MISMA condición que gobierna la demanda en la
  // ruta Apollo: sin lote y sin filas no hay aporte que acreditar, aunque la puerta
  // hubiera aceptado empresas. Dos condiciones separadas podrían discrepar.
  const prePaidContributed = prePaid.batchId !== null && prePaid.persistedCount > 0;
  const resultDemand = prePaidContributed
    ? resolveProviderResultDemand(prePaid, requestedTarget)
    : fullTargetResultDemand(requestedTarget);

  /**
   * AGENT1-LOCAL-CUT9 §§ 3, 4 — el helper ÚNICO de la corrida.
   *
   * La aceptación hace falta en dos momentos que no coinciden —antes de que la ruta
   * de pago exista, y después de que haya devuelto— y lo único que cambia entre
   * ellos es el aporte de PAGO. El objetivo, la demanda y el aporte gratuito son
   * los mismos objetos capturados aquí: no se releen ni se recalculan.
   *
   * 🔴 Es `resolveAcceptedForTarget` y nada más. No hay `acceptedFree + acceptedPaid
   * >= requested` escrito en esta capa, ni un `min(...)` propio, ni una clave
   * `lusha_accepted_for_target`.
   */
  const resolveRunAcceptance = (paidWriterTruth: {
    completeValidCandidates: number | null | undefined;
    persistedCandidates: number;
  }): AcceptedForTargetResult =>
    resolveAcceptedForTarget({
      demand: resultDemand,
      freePersistedCandidates: prePaidContributed ? prePaid.persistedCount : 0,
      paid: paidAcceptedContributionFromWriterTruth(paidWriterTruth),
    });

  /**
   * AGENT1-LOCAL-CUT9B — el PROYECTOR canónico hacia la metadata durable.
   *
   * 🔴 Es el MISMO que la ruta Apollo cablea en `wizard-execution-actions`:
   * misma clave (`ACCEPTED_FOR_TARGET_METADATA_KEY`), mismo serializador
   * (`toAcceptedForTargetMetadata`) y misma aritmética (`resolveRunAcceptance`,
   * que es `resolveAcceptedForTarget` cerrada sobre la demanda y el aporte
   * gratuito de ESTA corrida). No hay una clave `lusha_accepted_for_target`, ni
   * un shape reducido, ni un `min(...)` escrito en el sitio de la escritura.
   *
   * 🔴 `completeValidCandidates` se pasa TAL CUAL, `null` incluido. Sustituirlo
   * por `persistedCandidates` publicaría en la base la mentira exacta que CUT-7
   * cerró en la UI: afirmaría que toda fila escrita cuenta hacia el objetivo.
   *
   * PURO: sin I/O, sin relectura y sin reloj. Lo llama el núcleo con lo que acaba
   * de contar, y lo devuelto se escribe tal cual.
   */
  const resolveAcceptedForTargetBatchMetadata: ResolveExtraBatchMetadata = (writerOutcome) => ({
    [ACCEPTED_FOR_TARGET_METADATA_KEY]: toAcceptedForTargetMetadata(
      resolveRunAcceptance({
        completeValidCandidates: writerOutcome.completeValidCandidates,
        persistedCandidates: writerOutcome.persistedCandidates,
      }),
    ),
  });

  // § 15 — hueco cerrado gratis ⇒ ni estimación, ni reserva, ni credencial, ni
  // cliente, ni petición. La salida ocurre AQUÍ, por encima de todo eso.
  //
  // 🔴 CUT-9 § 12 — la CONDICIÓN no cambia. Sigue siendo `providerRequired`, que es
  // la misma puerta que existía antes de este corte: CUT-9 activa una capacidad
  // interna de una ruta ya seleccionada y no puede mover la decisión de si el
  // proveedor corre (`PROVIDER_ACTIVATION_CHANGED = NO`).
  if (!prePaid.providerRequired) {
    return {
      ...buildLushaProviderNotRequiredResult({
        batchId: prePaid.batchId,
        createdCandidatesCount: prePaid.persistedCount,
        targetGap: requestedTarget,
        message:
          prePaid.persistedCount > 0
            ? `Se encontraron ${prePaid.persistedCount} empresas nuevas en fuentes oficiales, sin consultar proveedores de pago.`
            : 'La búsqueda se resolvió con fuentes oficiales, sin consultar proveedores de pago.',
      }),
      // 🔴 La mitad de pago entra declarada como «no corrió» —cero CONOCIDO— y no
      // como una ausencia de medición: aquí el proveedor todavía no ha corrido, y
      // «no corrió» es una respuesta, no un dato que falte. Es la MISMA constante
      // que la rama sólo-gratuita de Apollo usa (CUT-8B).
      acceptedForTarget: resolveRunAcceptance(PAID_ROUTE_NOT_RUN_WRITER_TRUTH),
    };
  }

  const searchPlan = resolveLushaRoutedSearchPlan(parsed.data.macroIndustryKey);
  // 🔴 § 16 — la responsabilidad económica NO es el hueco. El planificador del
  // proveedor sigue decidiéndola desde su plan de ramas (2/4/6), porque con hueco
  // 1 una rama puede necesitar dos páginas igual. Lo que el hueco cambia es
  // cuántas empresas se ACEPTAN, no cuánto se reserva.
  const requiredCredits = estimateLushaRunCredits(searchPlan);

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
        clientRequestId,
        requestedTarget,
        canonicalBatch,
        reservation,
        routingMetadata,
        routingPlan,
        searchPlan,
        baseCorrelation,
        prePaid,
        // 🔴 CUT-9 §§ 3, 4 — el MISMO helper, no una segunda llamada. La ejecución
        // reservada sólo cambia el aporte de PAGO; el objetivo, la demanda y el
        // aporte gratuito ya están capturados dentro.
        resolveRunAcceptance,
        // 🔴 CUT-9B — el proyector durable, derivado del MISMO helper. Viaja junto
        // a él y no se reconstruye abajo: dos construcciones del mismo proyector
        // serían dos entradas a la misma aritmética.
        resolveAcceptedForTargetBatchMetadata,
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
  /** AGENT1-LOCAL-CUT9A § 3 — identidad de EJECUCIÓN, la que va a la fila del lote. */
  clientRequestId: string;
  /** § 8 — el objetivo PEDIDO, la autoridad que `target_count` publica. */
  requestedTarget: number;
  /**
   * § 5 — el MISMO resolutor que la mitad gratuita ya consultó.
   *
   * 🔴 Es la instancia, no una copia ni una fábrica: si esta mitad construyera la
   * suya, las dos mitades volverían a poder materializar lotes distintos y el
   * corte no habría cerrado nada.
   */
  canonicalBatch: CanonicalLushaBatchResolver;
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
  /**
   * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 11/14 — el plan gratuito ya
   * resuelto. Aporta dos cosas y sólo dos: el hueco REAL que el ejecutor debe
   * cerrar y los dominios que no hace falta volver a pagar.
   */
  prePaid: Awaited<ReturnType<typeof runPrePaidNoveltyDiscovery>>;
  /**
   * AGENT1-LOCAL-CUT9 §§ 3, 4 — el helper ÚNICO de aceptación de la corrida, ya
   * cerrado sobre la demanda y el aporte gratuito.
   *
   * 🔴 Se INYECTA en vez de reconstruirse aquí. Si esta mitad volviera a llamar a
   * `resolveAcceptedForTarget` con sus propios argumentos habría dos entradas a la
   * misma aritmética, que es exactamente cómo dos vistas del mismo hecho empiezan a
   * discrepar (CUT-8 § 1).
   */
  resolveRunAcceptance: (paidWriterTruth: {
    completeValidCandidates: number | null | undefined;
    persistedCandidates: number;
  }) => AcceptedForTargetResult;
  /**
   * AGENT1-LOCAL-CUT9B — el proyector de la metadata durable, ya cerrado sobre el
   * helper único de aceptación de la corrida.
   *
   * 🔴 Se INYECTA por la misma razón que `resolveRunAcceptance`: construirlo aquí
   * dejaría dos sitios que arman el bloque canónico, y dos sitios es como dos
   * vistas del mismo hecho empiezan a discrepar.
   */
  resolveAcceptedForTargetBatchMetadata: ResolveExtraBatchMetadata;
}): Promise<GenerateLushaPendingReviewBatchActionResult> {
  const {
    searchInput,
    internalUserId,
    clientRequestId,
    requestedTarget,
    canonicalBatch,
    reservation,
    routingMetadata,
    routingPlan,
    searchPlan,
    baseCorrelation,
    prePaid,
    resolveRunAcceptance,
    resolveAcceptedForTargetBatchMetadata,
  } = args;
  const supabase = await createClient();

  // ADDENDUM PROVIDER-SEEN § 4 — la memoria de lo ya pagado, resuelta UNA vez por
  // corrida. 🔴 No es `supabase`: éste es el cliente de SESIÓN del usuario y la
  // tabla sólo concede lectura y escritura a `service_role`, así que la memoria
  // tiene su propio resolutor y su propia credencial.
  const providerSeenStore = resolveProviderSeenStore();

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
          // 🔴 AGENT1-LOCAL-CUT9 § 3 — la MISMA autoridad que el bloque canónico:
          // lo RECONCILIADO contra las filas, no `usefulCandidatesCount`, que es lo
          // que la corrida intentó escribir. Dos vistas del mismo hecho bajo el
          // mismo nombre contando distinto es el defecto, no el arreglo.
          acceptedForTargetTotal: result?.multiBranch?.acceptedForTargetTotal ?? 0,
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

  // ── 🔴 AGENT1-LOCAL-CUT9 §§ 6, 7 — la SIEMBRA cruzada, leída ANTES de admitir ──
  //
  // Sin ella una empresa que la capa gratuita ya cerró podía volver por la ruta de
  // pago y cerrar hueco por SEGUNDA vez: objetivo 10, 4 gratis, 6 de pago de las
  // cuales 2 son las mismas ⇒ el informe diría 10 sobre 8 empresas distintas.
  //
  // 🔴 La autoridad es la que YA existe —`loadBatchIdentityRegistry` →
  // `read_batch_identity_snapshot` (CUT-3B4)—, la MISMA que ya se usa unas líneas
  // más abajo para releer la época y la MISMA que usan los otros dos escritores de
  // Agente 1. CUT-9 no acuña emparejamiento por nombre, por `displayName`, por
  // substring ni por «última fila».
  //
  // 🔴 Sólo se pide cuando la capa gratuita DE VERDAD escribió: sin lote no hay
  // filas que sembrar, y una consulta sobre `null` sería trabajo por nada. Ausente
  // ⇒ registro vacío, byte por byte la admisión anterior a CUT-9.
  //
  // 🔴 Degrada ABIERTO, igual que la lectura de la que sale: un fallo deja la
  // siembra vacía y la admisión ADMITE. Convertir una consulta caída en «esta
  // empresa ya existía» suprimiría candidatos legítimos, que es la dirección
  // equivocada de la degradación.
  const batchIdentitySeed =
    prePaid.batchId !== null
      ? await loadBatchIdentityRegistry(supabase, prePaid.batchId).catch(() => null)
      : null;

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
            // 🔴 AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION §§ 1, 2 — la entrada
            // viaja TAL CUAL, sin exclusión ninguna.
            //
            // Aquí se inyectaba `excludeDomains: prePaid.exclusionDomains`, que
            // acababa en `filters.companies.exclude.domains`. El soporte HUMANO de
            // Lusha confirmó que `POST /v3/companies/prospecting` no soporta
            // exclusión del lado del servidor, así que ese envío se retira entero y
            // no se sustituye por otro campo adivinado.
            //
            // 🔴 Los dominios conocidos NO se pierden: viajan por la ejecución en
            // `providerExclusionPlan.domains.availableValues` y siembran la
            // supresión CLIENTE del registro de identidad de la corrida. Lo que
            // este corte no puede es ahorrar el crédito de Prospecting de una
            // empresa histórica: la respuesta ya llegó cuando se la reconoce.
            input,
          ),
        // Write dep #1 — prospect_batches ONLY.
        //
        // ── AGENT1-LOCAL-CUT9A § 4 — RESERVE-OR-RETURN, no INSERT incondicional ──
        //
        // 🔴 Ya NO escribe directamente. Delega en el resolutor canónico de la
        // ejecución, que es el MISMO que la mitad gratuita consultó unas líneas más
        // arriba. Con eso:
        //
        //   · si la mitad gratuita ya materializó el lote, esta llamada lo ADOPTA
        //     (memoizado, sin tocar la base) y devuelve su época REAL;
        //   · si nadie lo materializó, esta llamada lo crea con la fila RICA que el
        //     núcleo acaba de construir —metadata de facturación, telemetría de
        //     ramas, enrutado observacional— y la identidad canónica estampada
        //     encima;
        //   · si otra materialización de la MISMA ejecución ganó la carrera, la
        //     base devuelve 23505 sobre `(created_by, client_request_id)` y se
        //     relee ESA fila. Nunca «el último lote».
        //
        // 🔴 La contribución NO puede redefinir `target_count`, `created_by`,
        // `owner_id` ni `client_request_id`: el resolutor los estampa. Por eso el
        // núcleo puede seguir construyendo la fila entera sin poder falsear la
        // petición.
        reserveBatch: (row: LushaPendingReviewBatchRow) =>
          canonicalBatch.resolve({
            name: row.name,
            country: row.country,
            country_code: row.country_code,
            industry: row.industry,
            search_depth: row.search_depth,
            status: row.status,
            source: row.source,
            metadata: row.metadata,
          }),
        // Write dep #2 — prospect_candidates ONLY.
        //
        // 🔴 AGENT1-CUT3B4 § 22 — ruta ANTERIOR a B4. Se conserva porque la
        // migración 126 se entrega SIN aplicar: mientras la RPC vallada no exista,
        // ésta es la única forma de que esta ruta escriba, y su forma TODO-O-NADA
        // (un solo `.insert(rows)`, sin trocear, sin `upsert`, sin tragarse el
        // error) sigue siendo el invariante que la guarda de CUT-3B23 defiende.
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
        // Write dep #3 — prospect_candidates, VALLADO por época de lote.
        //
        // AGENT1-CUT3B4 § 22 — comprobación de época + INSERT del bloque ENTERO +
        // avance de época, en UNA transacción de la base. La atomicidad de
        // todo-o-nada no se pierde: se traslada a la transacción, donde además
        // queda protegida contra una decisión de admisión caduca.
        //
        // Corre con el cliente de SESIÓN y la función es SECURITY INVOKER, así que
        // sigue bajo las MISMAS políticas RLS que el insert directo de arriba. No
        // concede ninguna capacidad nueva.
        insertCandidatesFenced: (args) =>
          insertFencedProspectCandidates(supabase, {
            batchId: args.batchId,
            expectedEpoch: args.expectedEpoch,
            candidates: args.rows as unknown as Record<string, unknown>[],
          }),
        // Read-only dep — 🔴 CUT9A-FIX-ADOPTED-EPOCH-REFRESH.
        //
        // La época contra la que la mitad de pago valla se LEE aquí, y se lee
        // AHORA: el resolutor canónico memoiza la reserva entera, así que la época
        // que traía era la del instante en que el lote NACIÓ, no la que la capa
        // gratuita dejó al escribir sus filas.
        //
        // 🔴 La autoridad es la que YA existe: `loadBatchIdentityRegistry` →
        // `read_batch_identity_snapshot` (CUT-3B4), que devuelve filas y época de
        // UNA sola sentencia y por tanto de UNA sola foto. NO se añade una consulta
        // ad-hoc a `prospect_batches.identity_epoch`: habría sido una segunda
        // autoridad de identidad de lote, con su propia forma de degradar.
        //
        // Sólo se consume `epoch` / `fenceCapabilityAbsent` / `degraded`; la siembra
        // del registro que la misma foto trae NO se usa aquí, y decirlo importa:
        // sembrar `admitByBatchIdentity` con ella exige resolver el lote ANTES de la
        // admisión y sigue siendo CUT-9, no este arreglo.
        readBatchIdentityEpoch: (batchId: string) =>
          loadBatchIdentityRegistry(supabase, batchId),
        // ── Write dep #4 — AGENT1-LOCAL-CUT9B, prospect_batches.metadata ──────
        //
        // 🔴 La ÚNICA escritura que este corte añade, y no es independiente: el
        // núcleo la invoca UNA vez, sobre el lote CANÓNICO que él mismo acaba de
        // resolver, con la época POSTERIOR a su propia escritura de candidatos.
        // No busca lote, no ordena por fecha y no adopta nada.
        //
        // 🔴 Va por el cliente de SESIÓN, no por `service_role`, igual que el
        // sellado terminal de la rama sólo-gratuita: la RLS de `prospect_batches`
        // acota la fila a su dueño, así que esta costura no concede ninguna
        // capacidad nueva sobre ninguna fila que la sesión no pudiera tocar ya.
        //
        // 🔴 El régimen lo decide el ESQUEMA, no una preferencia:
        // `decideBatchMetadataFencePlan` exige una época REAL para vallar, y sólo
        // acepta escribir sin valla cuando la base PROBÓ que la 126 no está
        // aplicada. Cualquier otro `null` —lectura caída, lote invisible— no
        // escribe: fallo CERRADO.
        acceptedForTargetPublication: {
          resolve: resolveAcceptedForTargetBatchMetadata,
          publish: ({ batchId, epochAfterWrite, evidence, published }) =>
            publishFencedBatchMetadata(
              supabase as unknown as BatchMetadataPublicationDbClient,
              {
                batchId,
                plan: decideBatchMetadataFencePlan({ epochAfterWrite, evidence }),
                published,
              },
            ),
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
      // AGENT1-LOCAL-CUT9A §§ 3, 8 — el actor lleva ahora la identidad de EJECUCIÓN
      // y la AUTORIDAD DE PETICIÓN. Las dos son obligatorias: sin la primera la
      // fila nacería fuera del índice único y no habría nada que adoptar; sin la
      // segunda el único número a mano para `target_count` volvería a ser un
      // residual.
      { internalUserId, clientRequestId, requestedTarget },
      // Q3F-5BB.11D — additive OBSERVATIONAL routing metadata (never gates).
      { routingMetadata, routingPlan },
      // §§ 3/4/8 — ejecución de la corrida.
      //
      // AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 § 14 — `targetGap` YA existe:
      // es el hueco que la capa gratuita dejó abierto. `resolveLushaTargetGap` lo
      // recorta al objetivo de producto, así que un hueco sólo puede ser MENOR,
      // nunca una vía para subir el gasto por parámetro. Con la fuente ausente o
      // caída vale el objetivo entero y el comportamiento es el de siempre.
      //
      // 🔴 Esto NO toca la reserva: `requiredCredits` se calculó con el plan del
      // proveedor (§ 16). El hueco gobierna cuántas empresas se aceptan.
      //
      // ADDENDUM PROVIDER-SEEN §§ 4, 10 — la memoria de lo ya pagado viaja al
      // ejecutor para dos cosas y sólo dos: CONTAR aciertos sobre la respuesta y
      // RECORDAR lo que el proveedor devolvió. No decide, no filtra y no reduce el
      // objetivo; el dedupe local sigue siendo la autoridad (§ 6).
      //
      // 🔴 AGENT1-PROVIDER-SEEN-MEMORY-3 — `resolveProviderSeenStore()` ya devuelve
      // el store PERSISTENTE: la migración 123 está aplicada en Producción. Se
      // resuelve UNA vez por corrida, arriba, y no una por página: un cliente por
      // página sería trabajo repetido sobre la misma credencial.
      //
      // Un fallo de esta escritura NO reintenta al proveedor y NO altera la
      // liquidación; se cuenta y viaja en la telemetría de la corrida.
      {
        plan: searchPlan,
        creditsReserved: reservation.creditsReserved,
        targetGap: prePaid.residualGap,
        providerSeen: {
          memory: prePaid.providerSeenMemory,
          record: (writeInput) => providerSeenStore.record(writeInput),
          correlationId: baseCorrelation.wizardRunId,
        },
        providerSeenLoad: prePaid.providerSeenLoad,
        providerExclusionPlan: prePaid.providerExclusionPlan,
        freeSource: prePaid.freeSource,
        // 🔴 CUT-9 §§ 6, 7 — las filas que lo gratuito dejó en ESTE lote. Es lo que
        // impide que una empresa cuente dos veces hacia el objetivo.
        batchIdentitySeed,
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

    // ── 🔴 AGENT1-LOCAL-CUT9 §§ 3, 4 — la aceptación de PAGO, con su autoridad ──
    //
    // `usefulCandidatesCount` NO sirve: es lo que la corrida INTENTÓ escribir, y el
    // núcleo ya reconcilia contra lo que la base confirmó
    // (`persistedForTarget = min(insertedCount, useful.length)`), que es lo que
    // publica en `multiBranch.acceptedForTargetTotal`. Ésa es la autoridad exacta —
    // ya post-admisión de identidad de lote, ya acotada por `targetGap`, ya
    // reconciliada con las filas— y es la que se consume.
    //
    // 🔴 Ausente ⇒ `null` ⇒ SIN MEDIR, y `paidAcceptedContributionFromWriterTruth`
    // aporta CERO en vez de las filas. Sustituirlo por `insertedCandidatesCount`
    // sería exactamente el defecto que CUT-7 cerró, escrito en el camino de
    // degradación.
    const acceptance = resolveRunAcceptance({
      completeValidCandidates: result.multiBranch?.acceptedForTargetTotal ?? null,
      persistedCandidates: result.insertedCandidatesCount,
    });

    // 🔴 AGENT1-LOCAL-CUT9B — que la publicación durable NO entrara deja de ser
    // silencioso. `stale` es control de concurrencia funcionando y no es una
    // avería, pero sí es un lote cuya metadata NO lleva el bloque canónico, y eso
    // hay que poder saberlo sin ir a mirar la fila a mano.
    //
    // No altera el resultado: los candidatos ya son durables y el proveedor ya
    // cobró. Sólo cifras e IDs internos; sin payload, sin clave, sin PII.
    const publication = result.acceptedForTargetPublication ?? null;
    if (publication !== null && publication.status !== 'published') {
      console.warn('[lusha-accepted-for-target-publication]', {
        status: publication.status,
        code: publication.status === 'failed' ? publication.code : null,
        batch_id: result.batchId,
        wizard_run_id: reservedCorrelation.wizardRunId,
      });
    }

    return { ...result, acceptedForTarget: acceptance };
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
    return {
      ...buildLushaPendingReviewFailure(
        'No fue posible guardar los prospectos. Intenta de nuevo.',
        msg.slice(0, 200),
      ),
      // 🔴 CUT-9 § 13 — un fallo de la mitad de pago no borra lo que lo gratuito
      // dejó durable. La mitad de pago entra como «no corrió» y eso es CIERTO en
      // filas: los tres caminos que lanzan por debajo de la reserva lo hacen ANTES
      // de que exista una sola fila de pago —`fence_stale`/`batch_not_found` y el
      // fallo de la escritura vallada revierten su transacción, y el INSERT
      // anterior a B4 es todo-o-nada y lanza sin escribir—.
      //
      // 🔴 Y no se inventa una medición: si un día esta ruta pudiera lanzar DESPUÉS
      // de escribir, el aporte tendría que declararse SIN MEDIR, nunca cero medido.
      acceptedForTarget: resolveRunAcceptance(PAID_ROUTE_NOT_RUN_WRITER_TRUTH),
    };
  }
}

/**
 * AGENT1-LUSHA-CUT-L3 — la composición: valla durable + núcleo de preview +
 * cliente de Lusha, en UN solo sitio.
 *
 * ── Por qué este módulo existe aparte ────────────────────────────────────────
 *
 * La server action de pending-review es `'use server'`, arrastra Supabase, Vault,
 * presupuesto y persistencia. Si la composición viviera allí, la única forma de
 * probar «cuántas veces se llamó al proveedor» sería levantar media aplicación.
 * Aquí las tres piezas se pueden doblar por separado y CONTAR las llamadas HTTP,
 * que es exactamente lo que las pruebas del corte tienen que afirmar.
 *
 * ── El orden que garantiza ───────────────────────────────────────────────────
 *
 *   0. (fuera de este módulo) la OPERACIÓN lógica ya está resuelta y autorizada:
 *      sólo una operación recién acuñada llega hasta aquí. Una reanudada sin
 *      resolver bloquea ANTES, en la entrada del servidor, y por tanto no hay
 *      páginas que vallar.
 *   1. `claim` durable (INSERT atómico). Ya existía fila ⇒ NO se llama a nada.
 *   2. `executeLushaPreview` resuelve industria, país, rama y credencial. Todo lo
 *      que falla aquí falla ANTES del proveedor y no marca la frontera.
 *   3. `searchCompanies(..., beforeDispatch)` — la marca durable es la última
 *      instrucción antes de `fetch()`, dentro del propio cliente.
 *   4. `settle` con el desenlace canónico de CUT-L2.
 *
 * 🔴 Este módulo NO reintenta. Ni siquiera un `429`, que CUT-L2 declara
 * `retryable_by_contract`: eso describe lo que Lusha permite, y ejecutarlo es
 * CUT-L4.
 */

import type {
  LushaCompanyProspectingV3Request,
  LushaCompanyProspectingV3Result,
} from '@/server/integrations/lusha-client';
import { emptyLushaRateLimitSnapshot } from '@/server/integrations/lusha-rate-limit-headers';
import {
  executeLushaPreview,
  LUSHA_PREVIEW_EXPECTED_MAX_CREDITS,
  type LushaPreviewInput,
  type LushaPreviewResult,
} from './lusha-preview';
import type {
  LushaProviderRequestCoordinates,
  RunLushaSearch,
} from './lusha-pending-review';
import {
  LUSHA_REQUEST_FENCE_UNAVAILABLE_CODE,
  resolveLushaRequestFenceTerminalState,
  runFencedLushaProspectingRequest,
  type LushaRequestFenceBlock,
  type LushaRequestFenceContext,
  type LushaRequestFenceSettlement,
  type LushaRequestFenceStore,
} from './lusha-request-fence';

/** Warning estable que marca una petición detenida por la valla. */
export const LUSHA_FENCE_BLOCKED_WARNING = 'lusha_request_fence_blocked' as const;

/** Código cuando el ejecutor no recibió coordenadas de petición. */
export const LUSHA_FENCE_MISSING_COORDINATES_CODE =
  'lusha_request_fence_missing_coordinates' as const;

/**
 * Evidencia terminal a partir del resultado del preview.
 *
 * 🔴 No reinterpreta nada: `providerOutcome` ya trae el veredicto de CUT-L2 y
 * aquí sólo se traduce a estado durable. `null` cuando el resultado no publicó
 * desenlace — un doble de prueba anterior al corte —, y entonces el ejecutor
 * liquida CERRADO por su cuenta.
 */
export function buildLushaRequestFenceSettlementFromPreview(
  result: LushaPreviewResult,
): LushaRequestFenceSettlement | null {
  const outcome = result.providerOutcome;
  if (!outcome) return null;
  return {
    state: resolveLushaRequestFenceTerminalState(outcome.outcomeClass),
    outcomeClass: outcome.outcomeClass,
    billingCertainty: outcome.billingCertainty,
    retryContract: outcome.retryContract,
    httpStatus: outcome.httpStatus,
    // TRAZA del servidor de Lusha. Nunca clave de valla, nunca idempotencia.
    providerRequestId: outcome.providerRequestId,
    creditsCharged: result.billing.creditsCharged,
    resultsReturned: result.billing.resultsReturned,
    rateLimit: {
      minuteLimit: outcome.rateLimit?.minuteLimit ?? null,
      minuteRemaining: outcome.rateLimit?.minuteRemaining ?? null,
      dailyLimit: outcome.rateLimit?.dailyLimit ?? null,
      dailyRemaining: outcome.rateLimit?.dailyRemaining ?? null,
    },
  };
}

/**
 * Resultado que ve el ejecutor cuando la valla detiene la petición.
 *
 * `ok:false` ⇒ el bucle de ramas para la corrida, exactamente igual que ante un
 * fallo de proveedor, y no escribe candidatos.
 *
 * 🔴 `providerRequestDispatched: false` es VERDAD y es importante: ESTE proceso
 * no envió nada. Lo que pudo haberse cobrado —si algo se cobró— pertenece al
 * intento que dejó la fila, y su certeza vive en esa fila, no aquí.
 */
export function buildLushaFenceBlockedPreviewResult(
  input: LushaPreviewInput,
  block: LushaRequestFenceBlock,
): LushaPreviewResult {
  const industryKey =
    (typeof input.macroIndustryKey === 'string' && input.macroIndustryKey.trim()) ||
    (typeof input.sectorKey === 'string' && input.sectorKey.trim()) ||
    '';
  return {
    ok: false,
    status: 'provider_error',
    results: [],
    billing: {
      creditsCharged: null,
      resultsReturned: 0,
      expectedMaxCredits: LUSHA_PREVIEW_EXPECTED_MAX_CREDITS,
    },
    providerOutcome: {
      outcomeClass: 'local_pre_dispatch_failure',
      billingCertainty: 'definitely_not_charged',
      retryContract: 'safe_to_retry_not_dispatched',
      providerRequestDispatched: false,
      httpStatus: null,
      providerRequestId: null,
      rateLimit: emptyLushaRateLimitSnapshot(),
    },
    warnings: [LUSHA_FENCE_BLOCKED_WARNING, block.code],
    requestSummary: {
      country: null,
      countryCode: input.countryCode,
      sector: null,
      industryKey,
      macroIndustryKey: null,
      mainIndustriesIds: [],
      subIndustryId: null,
      sizeBand: null,
      hasSearchText:
        typeof input.searchText === 'string' && input.searchText.trim().length > 0,
    },
    error: block.code,
  };
}

export type FencedLushaSearchDeps = {
  store: LushaRequestFenceStore;
  /**
   * Identidad DURABLE de la operación lógica, acuñada por el SERVIDOR.
   *
   * 🔴 Antes era `clientRequestId`, el uuid del navegador. Cambiarlo es el arreglo
   * entero: un clic nuevo tras una caída se reencuentra con la MISMA operación y
   * por tanto reconstruye las MISMAS claves de valla, en vez de acuñar claves
   * vírgenes con las que la misma página podía volver a comprarse.
   */
  operationId: string;
  context: LushaRequestFenceContext;
  resolveApiKey: () => Promise<string | null>;
  /**
   * El cliente de Lusha. `beforeDispatch` viaja hasta él y se ejecuta
   * inmediatamente antes de `fetch()`.
   */
  searchCompanies: (
    apiKey: string,
    request: LushaCompanyProspectingV3Request,
    beforeDispatch: () => Promise<void>,
  ) => Promise<LushaCompanyProspectingV3Result>;
  /** Telemetría segura de liquidación. Sólo códigos e ids internos. */
  onSettlementIssue?: (issue: { fenceKey: string; code: string }) => void;
  /** Telemetría segura de bloqueo. */
  onBlocked?: (block: LushaRequestFenceBlock & { fenceKey: string | null }) => void;
};

/**
 * Construye el `runSearch` que consume `persistLushaPendingReviewBatch`.
 *
 * 🔴 Sin coordenadas se falla CERRADO. Defaultear `branchIndex` a 0 habría hecho
 * que todas las ramas compartieran identidad y que la valla suprimiera peticiones
 * legítimas; defaultearlo «con cuidado» habría sido peor: una identidad más
 * ancha de lo que el ejecutor cree, descubierta el día que dos ramas coincidan.
 */
export function createFencedLushaRunSearch(deps: FencedLushaSearchDeps): RunLushaSearch {
  return async (
    input: LushaPreviewInput,
    coordinates?: LushaProviderRequestCoordinates,
  ): Promise<LushaPreviewResult> => {
    if (
      !coordinates ||
      !Number.isInteger(coordinates.branchIndex) ||
      !Number.isInteger(coordinates.page)
    ) {
      const block: LushaRequestFenceBlock = {
        reason: 'fence_unavailable',
        state: null,
        code: LUSHA_FENCE_MISSING_COORDINATES_CODE,
      };
      deps.onBlocked?.({ ...block, fenceKey: null });
      return buildLushaFenceBlockedPreviewResult(input, block);
    }

    const outcome = await runFencedLushaProspectingRequest<LushaPreviewResult>({
      store: deps.store,
      identity: {
        operationId: deps.operationId,
        branchIndex: coordinates.branchIndex,
        page: coordinates.page,
      },
      context: deps.context,
      run: (beforeDispatch) =>
        executeLushaPreview(
          {
            resolveApiKey: deps.resolveApiKey,
            searchCompanies: (apiKey, request) =>
              deps.searchCompanies(apiKey, request, beforeDispatch),
          },
          input,
        ),
      settlementFrom: buildLushaRequestFenceSettlementFromPreview,
      onSettlementIssue: deps.onSettlementIssue,
    });

    if (outcome.status === 'blocked') {
      deps.onBlocked?.({ ...outcome.block, fenceKey: outcome.fenceKey });
      return buildLushaFenceBlockedPreviewResult(input, outcome.block);
    }
    return outcome.result;
  };
}

/** Bloqueo por valla irresoluble (credencial de servicio ausente, por ejemplo). */
export function buildLushaFenceUnavailableBlock(code?: string): LushaRequestFenceBlock {
  return {
    reason: 'fence_unavailable',
    state: null,
    code: code ?? LUSHA_REQUEST_FENCE_UNAVAILABLE_CODE,
  };
}

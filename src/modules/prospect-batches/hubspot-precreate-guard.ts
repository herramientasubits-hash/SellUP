/**
 * hubspot-precreate-guard.ts — la ÚNICA guarda antes de crear una empresa en
 * HubSpot desde una aprobación (AGENT1-AUDIT-WS4).
 *
 * Antes había dos caminos con reglas distintas: la conversión antigua
 * (`attemptHubSpotSync`) bloqueaba empresas en liquidación/inactivas y hacía una
 * búsqueda EN VIVO justo antes del POST; la aprobación actual
 * (`approveAndConvertCandidateAction`) no hacía ninguna de las dos y se fiaba del
 * chequeo guardado al validar. Ahora ambos pasan por aquí:
 *
 *   1. Señal de liquidación / inactividad (nombre, razón social o banderas) ⇒
 *      no se crea (`blocked_inactive_or_liquidation`).
 *   2. Búsqueda en vivo de la misma empresa en HubSpot, SIEMPRE (no depende de
 *      ninguna bandera): coincidencia ⇒ no se crea (`blocked_duplicate`, revisión
 *      humana); error o respuesta dudosa ⇒ no se crea (`failed_lookup`).
 *
 * Fail-closed: lo único que deja crear es un `no_match` explícito.
 *
 * Núcleo puro + puerta inyectada: sin red, sin env.
 */

import type { HubSpotPreCreateLiveCheck } from '@/server/integrations/hubspot-company-create';

const LIQUIDATION_NAME_SIGNALS = [
  'EN LIQUIDACION',
  'EN LIQUIDACIÓN',
  ' LIQUIDACION',
  ' LIQUIDACIÓN',
  'LIQUIDADA',
  'DISUELTA',
  'EN DISOLUCION',
  'EN DISOLUCIÓN',
];

const INACTIVE_REVIEW_FLAGS = ['inactive_company', 'possible_inactive'];

/** ¿El nombre o las banderas dicen que la empresa está en liquidación o inactiva? */
export function hasLiquidationOrInactiveSignal(
  name: string,
  reviewFlagsAtConversion?: string[] | null,
  candidateReviewFlags?: string[] | null,
): boolean {
  const upper = (name ?? '').toUpperCase();
  if (LIQUIDATION_NAME_SIGNALS.some((s) => upper.includes(s))) return true;
  const allFlags = [
    ...(Array.isArray(reviewFlagsAtConversion) ? reviewFlagsAtConversion : []),
    ...(Array.isArray(candidateReviewFlags) ? candidateReviewFlags : []),
  ];
  return INACTIVE_REVIEW_FLAGS.some((f) => allFlags.includes(f));
}

export type HubSpotPreCreateGuardInput = {
  name: string;
  legalName?: string | null;
  domain: string | null;
  taxIdentifier: string | null;
  countryCode: string | null;
  reviewFlagsAtConversion?: string[] | null;
  candidateReviewFlags?: string[] | null;
};

export type HubSpotPreCreateGuardPorts = {
  liveDuplicateCheck: (input: {
    name: string;
    domain: string | null;
    taxIdentifier: string | null;
    countryCode: string | null;
  }) => Promise<HubSpotPreCreateLiveCheck>;
};

export type HubSpotPreCreateGuardResult =
  | { allowed: true }
  | { allowed: false; syncStatus: 'blocked_inactive_or_liquidation'; reason: 'inactive_or_liquidation_signal' }
  | {
      allowed: false;
      syncStatus: 'blocked_duplicate';
      reason: 'hubspot_live_match';
      companyIds: string[];
      matchedBy: string[];
    }
  | { allowed: false; syncStatus: 'failed_lookup'; reason: 'hubspot_live_check_failed'; error: string };

/** Corre la guarda. Nunca lanza: un tropiezo de la puerta cuenta como `failed_lookup`. */
export async function runHubSpotPreCreateGuard(
  input: HubSpotPreCreateGuardInput,
  ports: HubSpotPreCreateGuardPorts,
): Promise<HubSpotPreCreateGuardResult> {
  const liquidation =
    hasLiquidationOrInactiveSignal(input.name, input.reviewFlagsAtConversion, input.candidateReviewFlags) ||
    (typeof input.legalName === 'string' && hasLiquidationOrInactiveSignal(input.legalName));
  if (liquidation) {
    return { allowed: false, syncStatus: 'blocked_inactive_or_liquidation', reason: 'inactive_or_liquidation_signal' };
  }

  let live: HubSpotPreCreateLiveCheck;
  try {
    live = await ports.liveDuplicateCheck({
      name: input.name,
      domain: input.domain,
      taxIdentifier: input.taxIdentifier,
      countryCode: input.countryCode,
    });
  } catch (err) {
    return {
      allowed: false,
      syncStatus: 'failed_lookup',
      reason: 'hubspot_live_check_failed',
      error: err instanceof Error ? err.message.slice(0, 200) : 'live_check_threw',
    };
  }

  if (live?.status === 'no_match') return { allowed: true };
  if (live?.status === 'match') {
    return {
      allowed: false,
      syncStatus: 'blocked_duplicate',
      reason: 'hubspot_live_match',
      companyIds: live.companyIds,
      matchedBy: live.matchedBy,
    };
  }
  return {
    allowed: false,
    syncStatus: 'failed_lookup',
    reason: 'hubspot_live_check_failed',
    error: live?.status === 'lookup_failed' ? live.error : 'inconclusive_live_check',
  };
}

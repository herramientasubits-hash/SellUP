/**
 * phone-reveal-usage-log-core.ts — Construcción PURA de las filas de
 * `provider_usage_logs` de una autorización de reveal de teléfono
 * (Agente 2A · AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1).
 *
 * ── POR QUÉ EXISTE ───────────────────────────────────────────────────────────
 *
 * Desde que una misma autorización puede pagarle a Lusha DOS cosas —averiguar la
 * identidad y pedir el teléfono— el ledger tiene que poder responder por separado
 * "¿cuánto costó saber quién es?" y "¿cuánto costó su número?". `provider_key` ya no
 * distingue nada: las dos filas dicen `lusha`.
 *
 * Lo que las distingue es `operation_key`, que en `provider_usage_logs` es una columna
 * `text` SIN CHECK (migración 036), así que este grano NO necesitó migración. El valor
 * `lusha_contact_search` además ya existía en el repositorio antes de este hito.
 *
 * ── CORRELACIÓN ──────────────────────────────────────────────────────────────
 *
 * Las dos filas llevan el MISMO `reservation_group_id` en metadata, porque pertenecen
 * a la misma autorización del mismo operador. Es lo que permite sumarlas y obtener el
 * costo total de Lusha de esa corrida sin adivinar por marcas de tiempo.
 *
 * ── PII ──────────────────────────────────────────────────────────────────────
 *
 * Ninguna fila lleva email, teléfono, URL de LinkedIn, nombre, nombre de empresa, ni
 * el contactId de Lusha, ni el personId de Apollo. Solo códigos mecánicos, ids opacos
 * de correlación propios y cifras. `matchKey` dice CON QUÉ TIPO de dato se buscó
 * ('email'), nunca el dato ('ana@…'), y esa distinción es justamente lo que hace que
 * la telemetría sea auditable sin ser identificable.
 *
 * PURO: sin I/O, sin Supabase, sin fetch, sin process.env, sin Date.now().
 */

import type { LogProviderUsageInput } from '../usage-tracking/types';
import type { LushaIdentitySearchMatchKey } from './lusha-identity-search-core';
import type { LushaIdentitySearchRunOutcome } from './lusha-identity-resolution-runtime-core';

/**
 * `operation_key` de la búsqueda de identidad. Valor YA existente en el repositorio
 * (lo emite `lushaSearchUnknownCostComponent` del runner de Lusha), reutilizado a
 * propósito: dos nombres para la misma llamada al mismo endpoint harían imposible
 * agregarla.
 */
export const LUSHA_IDENTITY_SEARCH_OPERATION_KEY = 'lusha_contact_search';

/** `operation_key` del reveal de teléfono de Lusha. */
export const LUSHA_PHONE_REVEAL_OPERATION_KEY = 'lusha_phone_reveal';

/** `operation_key` del reveal de teléfono de Apollo. */
export const APOLLO_PHONE_REVEAL_OPERATION_KEY = 'apollo_phone_reveal';

/**
 * Fila de usage de la BÚSQUEDA de identidad.
 *
 * `credits_used` viaja tal cual lo reportó el proveedor. Cuando NO lo reportó se omite
 * en vez de escribir 0: un 0 en el ledger afirma que la llamada fue gratis, y Lusha
 * cobra 1 crédito por petición a `api_search` incluso sin resultados. Quien liquida
 * ese hueco es la reserva, que lo confirma al tope con `assumed_cap`.
 *
 * `estimated_cost_usd` es `null` EXPLÍCITO —no 0— porque Contact Search no tiene
 * mapeo de precio autorizado en este repositorio (`search_credit_cost_not_mapped`).
 * Un costo desconocido no es un costo de cero.
 */
export function buildLushaIdentitySearchUsageLog(args: {
  reservationGroupId: string;
  runId: string;
  triggeredBy?: string;
  matchKey: LushaIdentitySearchMatchKey;
  outcome: LushaIdentitySearchRunOutcome;
  creditsCharged: number | null;
  resultsReturned: number;
  durationMs: number;
  providerRequestId?: string | null;
}): LogProviderUsageInput {
  return {
    provider_key: 'lusha',
    operation_key: LUSHA_IDENTITY_SEARCH_OPERATION_KEY,
    ...(typeof args.creditsCharged === 'number' && Number.isFinite(args.creditsCharged)
      ? { credits_used: args.creditsCharged }
      : {}),
    results_returned: args.resultsReturned,
    estimated_cost_usd: null,
    real_cost_usd: null,
    status: args.outcome === 'error' ? 'error' : 'success',
    ...(args.triggeredBy ? { triggered_by: args.triggeredBy } : {}),
    duration_ms: args.durationMs,
    metadata: {
      endpoint_family: 'v3_contacts_search',
      capability: 'identity_resolution',
      // Correlación con la MISMA autorización que paga el reveal. Ids opacos nuestros.
      reservation_group_id: args.reservationGroupId,
      phone_reveal_run_id: args.runId,
      // TIPO de identificador usado, nunca su valor.
      match_key: args.matchKey,
      identity_outcome: args.outcome,
      cost: {
        truth_source: 'unknown',
        unknown_reason: 'search_credit_cost_not_mapped',
      },
      hito: 'AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1',
    },
  };
}

/**
 * Claves de metadata que NUNCA pueden aparecer en una fila de usage de este flujo.
 *
 * Se declara como DATO y no como prosa para que un test pueda recorrerla: una
 * prohibición que solo vive en un comentario no impide nada. Cubre tanto los datos
 * personales como los ids nativos de proveedor, que son identidades de terceros y no
 * tienen ninguna función en la contabilidad.
 */
export const PHONE_REVEAL_USAGE_LOG_FORBIDDEN_METADATA_KEYS: readonly string[] = [
  'email',
  'phone',
  'phones',
  'linkedin_url',
  'linkedinUrl',
  'full_name',
  'fullName',
  'first_name',
  'firstName',
  'last_name',
  'lastName',
  'company_name',
  'companyName',
  'company_domain',
  'companyDomain',
  'contact_id',
  'contactId',
  'lusha_contact_id',
  'lushaContactId',
  'apollo_person_id',
  'apolloPersonId',
  'person_id',
  'personId',
];

/**
 * ¿Esta fila de usage contiene alguna clave prohibida, a cualquier profundidad?
 *
 * Recorre el objeto entero en vez de mirar solo el primer nivel: una PII escondida
 * dentro de `metadata.cost.email` sería igual de PII, y una comprobación superficial
 * daría un verde que no significa nada.
 */
export function findForbiddenUsageLogMetadataKeys(
  value: unknown,
  forbidden: readonly string[] = PHONE_REVEAL_USAGE_LOG_FORBIDDEN_METADATA_KEYS,
): readonly string[] {
  const found = new Set<string>();
  const forbiddenSet = new Set(forbidden);

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (forbiddenSet.has(key)) found.add(key);
      walk(child);
    }
  };

  walk(value);
  return [...found];
}

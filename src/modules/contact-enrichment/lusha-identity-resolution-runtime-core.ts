/**
 * lusha-identity-resolution-runtime-core.ts — Orquestación de la resolución de la
 * identidad nativa de Lusha dentro de una corrida del waterfall
 * (Agente 2A · AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1).
 *
 * Se sitúa ENTRE la re-comprobación de privacidad y el claim del reveal. Es el único
 * punto del sistema que puede emitir una búsqueda PAGADA de identidad, y lo hace como
 * máximo una vez por corrida.
 *
 * ── EL ORDEN ES EL CONTRATO ──────────────────────────────────────────────────
 *
 *   1. ¿Lusha YA sabe quién es?   → 0 llamadas, 0 créditos. Fin.
 *   2. ¿Hay con qué preguntárselo? → si no, 0 llamadas, 0 créditos, terminal.
 *   3. CLAIM atómico de la búsqueda → si se pierde, 0 llamadas y 0 escrituras.
 *   4. UNA petición, sin retry, sin cascada.
 *   5. Identidad única → se PERSISTE ANTES de que el reveal arranque.
 *
 * El paso 2 va ANTES del paso 3 a propósito. Reclamar y luego descubrir que no había
 * con qué buscar dejaría la corrida marcada como «búsqueda intentada» sin que nadie
 * llamara a nadie — y la liquidación, que confía en ese sello, cobraría 1 crédito por
 * una petición que nunca salió.
 *
 * ── POR QUÉ EL CLAIM ES SUYO Y NO EL DEL REVEAL ──────────────────────────────
 *
 * `lusha_attempted_at` significa «ya se pidió el teléfono». Si la búsqueda lo usara,
 * una caída entre la búsqueda y el reveal sería indistinguible de un reveal ya hecho:
 * la recuperación no podría continuar, y el id que acabábamos de pagar quedaría
 * inservible para siempre. Por eso la migración 124 le da su propia columna.
 *
 * ── RECUPERACIÓN TRAS CAÍDA ──────────────────────────────────────────────────
 *
 *   * cayó DESPUÉS de persistir la identidad → el paso 1 la encuentra: 0 búsquedas,
 *     y el reveal continúa con el id que ya se pagó.
 *   * cayó ANTES de persistirla → el claim ya está tomado y la identidad no está.
 *     NO se vuelve a buscar (sería el segundo cobro) y NO se escribe nada: se
 *     devuelve `claim_lost`, que es exactamente lo que este core hace ante cualquier
 *     otro titular del claim.
 *
 * PURO salvo por las dependencias inyectadas: sin Supabase, sin fetch, sin
 * process.env, sin Date.now(). Misma convención que el resto de los cores.
 */

import {
  buildLushaIdentitySearchQuery,
  evaluateLushaIdentitySearchResponse,
  LUSHA_IDENTITY_MATCH_KEY_TO_RESOLUTION_SOURCE,
  type LushaIdentitySearchCandidateFacts,
  type LushaIdentitySearchMatchKey,
  type LushaIdentitySearchResultItem,
} from './lusha-identity-search-core';
import {
  resolveProviderNativeContactId,
  type ProviderContactIdentityRecord,
} from './provider-contact-identity-core';

/**
 * Desenlace registrado en `phone_reveal_waterfall_runs.lusha_identity_search_outcome`.
 * Espejo del CHECK de la migración 124.
 */
export const LUSHA_IDENTITY_SEARCH_RUN_OUTCOMES = [
  'resolved',
  'not_found',
  'ambiguous',
  'error',
  'no_identifier',
  'reused_persisted',
] as const;

export type LushaIdentitySearchRunOutcome =
  (typeof LUSHA_IDENTITY_SEARCH_RUN_OUTCOMES)[number];

/** Respuesta cruda del proveedor, ya saneada por el cliente. */
export interface LushaIdentitySearchProviderResponse {
  outcome:
    | { status: 'success'; results: readonly LushaIdentitySearchResultItem[] }
    | { status: 'no_results' }
    | { status: 'provider_timeout' }
    | { status: 'provider_error' }
    | { status: 'unreadable' };
  /**
   * Créditos que el proveedor dice haber cobrado por ESTA petición. `null` = no lo
   * reportó, y como en todo este módulo, no reportar NO es no cobrar: se liquidará al
   * tope (1) con `assumed_cap`.
   */
  creditsCharged: number | null;
}

/** Resultado del claim de la búsqueda. Espejo de `claim_lusha_identity_search`. */
export type LushaIdentitySearchClaimResult =
  | 'claimed'
  | 'already_claimed'
  | 'run_not_found'
  | 'run_terminal'
  | 'authorization_expired';

export interface ResolveLushaIdentityDeps {
  /**
   * CLAIM ATÓMICO de la búsqueda. UPDATE condicional sobre
   * `lusha_identity_search_attempted_at IS NULL`. Devuelve `claimed` SOLO si actualizó
   * una fila.
   */
  claimIdentitySearch: (runId: string) => Promise<LushaIdentitySearchClaimResult>;
  /** UNA petición a `/v3/contacts/search`. Sin retry: el retry es un segundo cobro. */
  searchIdentity: (args: {
    runId: string;
    contact: Record<string, string>;
  }) => Promise<LushaIdentitySearchProviderResponse>;
  /**
   * Persiste la identidad resuelta. Write-once: si otro proceso ganó, devuelve el id
   * del ganador en vez de sobrescribir. Se invoca ANTES de que el reveal arranque.
   */
  persistIdentity: (args: {
    candidateId: string;
    runId: string;
    providerContactId: string;
    matchKey: LushaIdentitySearchMatchKey;
  }) => Promise<void>;
}

/**
 * Desenlace de la resolución, desde el punto de vista del waterfall.
 *
 *   * `ready`       — hay id utilizable; el reveal PUEDE continuar.
 *   * `blocked`     — terminal y sin reveal. `skippedReason` dice por qué.
 *   * `claim_lost`  — otro disparador tiene la búsqueda (o la tuvo y cayó). Esta
 *     invocación no llama a nadie y NO escribe nada.
 */
export type ResolveLushaIdentityResult =
  | {
      status: 'ready';
      contactId: string;
      /** true solo si ESTA invocación pagó una búsqueda. */
      searched: boolean;
      runOutcome: Extract<LushaIdentitySearchRunOutcome, 'resolved' | 'reused_persisted'>;
      /** Créditos reportados por la búsqueda. null cuando no hubo búsqueda o no se reportó. */
      searchCreditsCharged: number | null;
    }
  | {
      status: 'blocked';
      skippedReason:
        | 'lusha_identity_unresolvable'
        | 'lusha_identity_not_found'
        | 'lusha_identity_ambiguous'
        | 'lusha_identity_error';
      runOutcome: Exclude<LushaIdentitySearchRunOutcome, 'resolved' | 'reused_persisted'>;
      /** true si esta invocación llegó a emitir la petición (y por tanto pudo costar 1). */
      searched: boolean;
      searchCreditsCharged: number | null;
    }
  | { status: 'claim_lost'; reason: LushaIdentitySearchClaimResult };

/**
 * Resuelve la identidad nativa de Lusha para un candidato de una corrida viva.
 *
 * NUNCA: cascada de búsquedas pagadas, coincidencia difusa, elección del primer
 * resultado, reintento, sustitución de persona, ni reenvío de un id de otro proveedor.
 */
export async function resolveLushaIdentityForWaterfall(
  input: {
    candidateId: string;
    runId: string;
    candidateSource: string | null;
    candidateSourceContactId: string | null;
    identities: readonly ProviderContactIdentityRecord[];
    facts: LushaIdentitySearchCandidateFacts;
  },
  deps: ResolveLushaIdentityDeps,
): Promise<ResolveLushaIdentityResult> {
  // ── 1. ¿Ya lo sabemos? Entonces no se paga nada, hoy ni nunca más. ──
  const persisted = resolveProviderNativeContactId({
    providerKey: 'lusha',
    candidateSource: input.candidateSource,
    candidateSourceContactId: input.candidateSourceContactId,
    identities: input.identities,
  });
  if (persisted) {
    return {
      status: 'ready',
      contactId: persisted.contactId,
      searched: false,
      runOutcome: 'reused_persisted',
      searchCreditsCharged: null,
    };
  }

  // ── 2. ¿Hay con qué preguntar? Se decide ANTES de reclamar. ──
  const query = buildLushaIdentitySearchQuery(input.facts);
  if (!query) {
    return {
      status: 'blocked',
      skippedReason: 'lusha_identity_unresolvable',
      runOutcome: 'no_identifier',
      searched: false,
      searchCreditsCharged: null,
    };
  }

  // ── 3. Claim atómico y propio. ──
  const claim = await deps.claimIdentitySearch(input.runId);
  if (claim !== 'claimed') {
    // Incluye el caso de recuperación tras caída: el claim está tomado y la identidad
    // no está persistida. No se vuelve a buscar —sería el segundo cobro— y no se
    // escribe nada, que es lo mismo que se hace ante cualquier otro titular.
    return { status: 'claim_lost', reason: claim };
  }

  // ── 4. UNA petición. Un throw se trata como error del proveedor: la petición pudo
  //       salir y cobrarse, así que jamás se asume costo 0 por haber fallado. ──
  let response: LushaIdentitySearchProviderResponse;
  try {
    response = await deps.searchIdentity({
      runId: input.runId,
      contact: query.contact as Record<string, string>,
    });
  } catch {
    return {
      status: 'blocked',
      skippedReason: 'lusha_identity_error',
      runOutcome: 'error',
      searched: true,
      searchCreditsCharged: null,
    };
  }

  const evaluation = evaluateLushaIdentitySearchResponse({
    candidate: {
      companyName: input.facts.companyName,
      companyDomain: input.facts.companyDomain,
    },
    matchKey: query.matchKey,
    response: response.outcome,
  });

  if (evaluation.status === 'not_found') {
    return {
      status: 'blocked',
      skippedReason: 'lusha_identity_not_found',
      runOutcome: 'not_found',
      searched: true,
      searchCreditsCharged: response.creditsCharged,
    };
  }
  if (evaluation.status === 'ambiguous') {
    return {
      status: 'blocked',
      skippedReason: 'lusha_identity_ambiguous',
      runOutcome: 'ambiguous',
      searched: true,
      searchCreditsCharged: response.creditsCharged,
    };
  }
  if (evaluation.status === 'error' || evaluation.status === 'no_identifier') {
    return {
      status: 'blocked',
      skippedReason: 'lusha_identity_error',
      runOutcome: 'error',
      searched: true,
      searchCreditsCharged: response.creditsCharged,
    };
  }

  // ── 5. Identidad única. Se PERSISTE antes de que el reveal exista. ──
  //
  // El orden importa y es el que MÁS protege: si el proceso muriera justo aquí, el
  // estado que sobrevive es «identidad pagada y guardada, reveal pendiente», que la
  // recuperación resuelve gratis. El orden inverso —revelar y luego guardar— dejaría
  // un id pagado y perdido, y la siguiente corrida volvería a pagarlo.
  //
  // Un fallo al persistir NO cancela el reveal: la búsqueda ya se cobró y el id que
  // tenemos en la mano es válido para esta corrida. Lo que se pierde es el ahorro
  // futuro, no la operación que el operador autorizó.
  try {
    await deps.persistIdentity({
      candidateId: input.candidateId,
      runId: input.runId,
      providerContactId: evaluation.contactId,
      matchKey: evaluation.matchKey,
    });
  } catch {
    // Silencio acotado y deliberado: el escritor registra su propio fallo.
  }

  return {
    status: 'ready',
    contactId: evaluation.contactId,
    searched: true,
    runOutcome: 'resolved',
    searchCreditsCharged: response.creditsCharged,
  };
}

/**
 * Procedencia que se persiste para una clave de coincidencia. Reexportado para que el
 * escritor no vuelva a declarar el mapeo: una sola autoridad.
 */
export function resolutionSourceForMatchKey(matchKey: LushaIdentitySearchMatchKey) {
  return LUSHA_IDENTITY_MATCH_KEY_TO_RESOLUTION_SOURCE[matchKey];
}

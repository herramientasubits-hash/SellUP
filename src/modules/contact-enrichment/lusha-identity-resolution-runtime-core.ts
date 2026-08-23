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
 *   5. Identidad única → se PERSISTE, y si no se persiste NO HAY REVEAL.
 *
 * El paso 5 es una PRECONDICIÓN, no un efecto secundario: una identidad recién
 * resuelta tiene que quedar almacenada de forma duradera ANTES de que se le pida un
 * teléfono a Lusha. Revelar sobre una identidad que no se guardó deja al candidato con
 * teléfono y sin identidad — el estado exacto que obliga a la siguiente autorización a
 * comprar otra vez el mismo dato.
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
 * ── EL ESTADO «BÚSQUEDA COBRADA, IDENTIDAD PERDIDA» ──────────────────────────
 *
 * Es un estado REAL y declarado, no un hueco: la petición salió, el proveedor señaló a
 * una persona y cobró, y la escritura de la identidad falló. Lo que ocurre entonces:
 *
 *   * NO hay reveal — ni en esta corrida ni disparado desde aquí;
 *   * NO hay segunda búsqueda automática. El claim tomado la impide, y nada en este
 *     módulo la reintenta;
 *   * la corrida queda `aborted` con `lusha_skipped_reason='lusha_identity_not_persisted'`
 *     y `lusha_identity_search_outcome='resolved_not_persisted'`;
 *   * la reserva de la BÚSQUEDA se liquida (reportado, o al tope si no se reportó) y la
 *     del REVEAL se libera intacta, porque su pata nunca se reclamó.
 *
 * Recuperarse de él es una decisión humana: una corrida nueva volverá a buscar y a
 * pagar, y eso tiene que ser una autorización, no un reintento silencioso.
 *
 * ── LO QUE NO SE AFIRMA ──────────────────────────────────────────────────────
 *
 * Nada aquí garantiza semántica exactly-once frente al proveedor. Lusha no ofrece
 * clave de idempotencia en `/v3/contacts/search`, así que lo que este módulo garantiza
 * es lo que SÍ está en sus manos: como máximo UNA petición por corrida (claim atómico)
 * y ningún reintento automático. Si una petición se cobró y su respuesta nunca llegó,
 * el cobro existe y el sistema lo trata como desconocido-y-cobrado, nunca como gratis.
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
  /**
   * El proveedor SÍ señaló a una identidad única —y cobró por decirlo— pero esa
   * identidad no se pudo almacenar de forma duradera.
   *
   * Es un desenlace propio y no un `resolved` ni un `error` porque afirma dos cosas a
   * la vez que ningún otro valor puede afirmar juntas: que la búsqueda se pagó (así
   * que su reserva se liquida) y que el ahorro futuro NO existe (así que la próxima
   * autorización volverá a buscar). Colapsarlo en `resolved` diría que hay un id
   * guardado que no hay; colapsarlo en `error` diría que el proveedor falló, y no
   * falló.
   */
  'resolved_not_persisted',
] as const;

export type LushaIdentitySearchRunOutcome =
  (typeof LUSHA_IDENTITY_SEARCH_RUN_OUTCOMES)[number];

/** Desenlaces con los que el reveal PUEDE continuar. */
export type LushaIdentitySearchReadyRunOutcome = 'resolved' | 'reused_persisted';

/** Desenlaces terminales: ninguno permite un reveal. */
export type LushaIdentitySearchBlockedRunOutcome = Exclude<
  LushaIdentitySearchRunOutcome,
  LushaIdentitySearchReadyRunOutcome
>;

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
  /**
   * UNA petición a `/v3/contacts/search`. Sin retry: el retry es un segundo cobro.
   *
   * `matchKey` viaja para que el adaptador pueda declarar en el ledger CON QUÉ TIPO de
   * identificador se buscó sin volver a decidirlo. Es el tipo ('email'), nunca el dato.
   */
  searchIdentity: (args: {
    runId: string;
    matchKey: LushaIdentitySearchMatchKey;
    contact: Record<string, string>;
  }) => Promise<LushaIdentitySearchProviderResponse>;
  /**
   * Persiste la identidad resuelta y DECLARA si quedó guardada. Write-once: si otro
   * proceso ganó, devuelve el id del GANADOR en vez de sobrescribir.
   *
   * El resultado no es decorativo: la persistencia es una PRECONDICIÓN del reveal
   * (ver `resolveLushaIdentityForWaterfall`, paso 5), así que un `failed` cierra la
   * corrida sin llamar a Lusha. Por eso devuelve un veredicto explícito en vez de
   * `void` — un `void` obliga a inferir el éxito de la ausencia de excepción, y una
   * escritura que el driver reporta como fallida sin lanzar quedaría leída como buena.
   *
   * Devolver el id EFECTIVO (el del ganador, no el nuestro) es lo que impide revelar
   * contra un id distinto del que quedó almacenado.
   */
  persistIdentity: (args: {
    candidateId: string;
    runId: string;
    providerContactId: string;
    matchKey: LushaIdentitySearchMatchKey;
  }) => Promise<LushaIdentityPersistResult>;
}

/**
 * Veredicto de durabilidad de la identidad.
 *
 *   * `persisted` — hay una fila. `providerContactId` es la que quedó (la nuestra si
 *     insertamos, la del ganador si otro proceso llegó antes).
 *   * `failed` — NO hay fila que podamos afirmar. Fail-closed: sin reveal.
 */
export type LushaIdentityPersistResult =
  | { status: 'persisted'; providerContactId: string }
  | { status: 'failed' };

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
      runOutcome: LushaIdentitySearchReadyRunOutcome;
      /** Créditos reportados por la búsqueda. null cuando no hubo búsqueda o no se reportó. */
      searchCreditsCharged: number | null;
    }
  | {
      status: 'blocked';
      skippedReason:
        | 'lusha_identity_unresolvable'
        | 'lusha_identity_not_found'
        | 'lusha_identity_ambiguous'
        | 'lusha_identity_error'
        /**
         * Se resolvió UNA identidad y se pagó por ella, pero no quedó almacenada. El
         * reveal NO corre: revelar sin identidad persistida convierte cada corrida
         * futura en una compra nueva del mismo dato.
         */
        | 'lusha_identity_not_persisted';
      runOutcome: LushaIdentitySearchBlockedRunOutcome;
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
      matchKey: query.matchKey,
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

  // ── 5. Identidad única. Se PERSISTE, y la persistencia es una PRECONDICIÓN. ──
  //
  // El orden importa y es el que MÁS protege: si el proceso muriera justo aquí, el
  // estado que sobrevive es «identidad pagada y guardada, reveal pendiente», que la
  // recuperación resuelve gratis. El orden inverso —revelar y luego guardar— dejaría
  // un id pagado y perdido, y la siguiente corrida volvería a pagarlo.
  //
  // ── POR QUÉ UN FALLO AL PERSISTIR CANCELA EL REVEAL ──────────────────────────
  //
  // La tentación es la contraria: la búsqueda ya se cobró y el id está en la mano, así
  // que revelar «aprovecha» el crédito. Pero ese razonamiento sólo mira ESTA corrida.
  // Un reveal sobre una identidad que no quedó almacenada produce un candidato con
  // teléfono y SIN identidad Lusha — es decir, exactamente el estado que obliga a la
  // siguiente autorización a pagar otra búsqueda por el mismo dato. El crédito no se
  // «aprovecha»: se convierte en el primero de una serie.
  //
  // Fail-closed, entonces, con tres propiedades explícitas:
  //
  //   * la EVIDENCIA ECONÓMICA de la búsqueda se conserva (`searched: true` +
  //     `resolved_not_persisted`), así que su reserva se liquida y el ledger la
  //     registra: nadie regala el crédito que ya se gastó;
  //   * NO se repite la búsqueda automáticamente. El claim sigue tomado, y ese es
  //     precisamente su trabajo: la corrida siguiente lee `already_claimed` y sale;
  //   * el error NO se oculta — viaja como desenlace propio hasta la corrida y hasta
  //     el ledger, en vez de morir en un `catch` vacío.
  //
  // Un throw se trata igual que un `failed` declarado: en ninguno de los dos casos
  // podemos afirmar que exista una fila.
  let persistence: LushaIdentityPersistResult;
  try {
    persistence = await deps.persistIdentity({
      candidateId: input.candidateId,
      runId: input.runId,
      providerContactId: evaluation.contactId,
      matchKey: evaluation.matchKey,
    });
  } catch {
    // Silencio acotado a la EXCEPCIÓN, no al hecho: el escritor registra su propio
    // fallo sin PII, y el hecho sale de aquí como `resolved_not_persisted`.
    persistence = { status: 'failed' };
  }

  if (persistence.status !== 'persisted') {
    return {
      status: 'blocked',
      skippedReason: 'lusha_identity_not_persisted',
      runOutcome: 'resolved_not_persisted',
      // La petición SALIÓ y el proveedor contestó: la reserva de la búsqueda se
      // liquida por lo que costó (o al tope si no lo reportó), nunca a 0.
      searched: true,
      searchCreditsCharged: response.creditsCharged,
    };
  }

  return {
    status: 'ready',
    // El id que se revela es el ALMACENADO, no el que acabamos de recibir. Coinciden
    // salvo cuando otro proceso ganó la carrera, y en ese caso el suyo es el que la
    // base de datos afirma — revelar contra el nuestro sería revelar contra un id que
    // nadie guardó.
    contactId: persistence.providerContactId,
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

/**
 * phone-reveal-waterfall-core.ts — Pure orchestration of the Apollo → Lusha
 * phone reveal waterfall (Agente 2A · AGENT2A-PHONE-WATERFALL-1).
 *
 * ONE operator click on "Revelar teléfono" authorizes up to TWO provider legs:
 * Apollo first and, only if Apollo terminated as `no_phone_found`, Lusha
 * automatically underneath — no second click, no second modal. The whole
 * authorization lives in one `phone_reveal_waterfall_runs` row (migration 102)
 * so both legs stay attributable and separately costed.
 *
 * PURE: no I/O, no Supabase, no fetch, no process.env, no Date.now(). The run
 * store, the candidate load, the suppression/DNC re-check and the Lusha call are
 * all injected, exactly like phone-reveal-core.ts / phone-reveal-webhook-core.ts
 * / phone-reveal-recovery-core.ts. The resolved flag values arrive as booleans.
 *
 * Deliberately dependency-free: this module imports NOTHING from the Apollo or
 * Lusha cores. The credit constants below are mirrored here and a static test
 * asserts they still equal their authorities (APOLLO_PHONE_REVEAL_CREDITS and
 * LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS) — the same convention
 * lusha-phone-fallback-copy.ts uses for LUSHA_PHONE_FALLBACK_MAX_CREDITS. That
 * keeps this core importable from anywhere without dragging server modules in,
 * and removes any import-cycle risk with the two cores that call back into it.
 *
 * Contract enforced here (never by a migration):
 *   * the role authority is the reveal's own — `PHONE_REVEAL_AUTHORIZED_ROLE_KEYS`
 *     in phone-reveal-authorized-roles.ts (admin + commercial_manager), reused via
 *     `isPhoneRevealWaterfallRoleAuthorized`. There is NO separate waterfall role
 *     gate (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1): whoever may press
 *     "Revelar teléfono" gets Apollo → Lusha, and the only switch is the flag.
 *     A role that cannot reveal never gets a run row, so the Lusha leg stays
 *     structurally unreachable for it.
 *   * ONE candidate per run — no bulk, no array input anywhere.
 *   * the Lusha leg runs AT MOST ONCE per run. The webhook, the recovery cron
 *     and the manual L3 review can all observe the same Apollo `no_phone_found`;
 *     the atomic claim on `lusha_attempted_at` is what makes them converge on a
 *     single call.
 *   * the authorization expires after 24h. A webhook that lands two days later
 *     can still close the Apollo leg, but it can NEVER spend the second leg on a
 *     stale authorization.
 *   * suppression / do-not-contact are re-checked immediately BEFORE the Lusha
 *     leg, fail-closed: an unverifiable check blocks the call. It is recorded as
 *     `suppression_check_unavailable`, NEVER as `suppressed` — "we could not
 *     verify" is not the same claim as "this contact is suppressed", and the
 *     audit must not turn the first into the second.
 *   * no automatic retry, no bulk, no HubSpot write, no candidate approval.
 *   * Apollo and Lusha costs are recorded in SEPARATE columns and are NEVER
 *     summed into one. An unreported cost is `null` + `unknown`, never 0.
 *
 * MODALIDAD LEGACY (AGENT2A-PHONE-WATERFALL-2). Un candidato cuyo intento Apollo YA
 * ocurrió y YA terminó `no_phone_found` ANTES de que existiera
 * `phone_reveal_waterfall_runs` no tiene pata Apollo que gastar, pero sí puede tener
 * pata Lusha. Para él existe una corrida `run_mode = 'legacy_lusha_only'`:
 *
 *   * MISMO botón, MISMO modal, MISMA autorización explícita — no hay un segundo
 *     botón manual de Lusha ni un segundo clic;
 *   * tope 5 (solo Lusha), nunca 13: los 8 de Apollo ya se cobraron bajo OTRA
 *     autorización y no se re-atribuyen;
 *   * CERO llamadas a Apollo, cero usage logs nuevos de Apollo, cero timestamps o
 *     request ids inventados. `apollo_attempted_at` queda null y la modalidad es lo
 *     que explica por qué;
 *   * el resto del contrato es IDÉNTICO: claim atómico, TTL de 24 h,
 *     re-comprobación de supresión/DNC fail-closed, la MISMA autoridad de rol que el
 *     reveal, una sola llamada a Lusha, sin retry automático, sin HubSpot, sin bulk.
 *
 * La ruta legacy NO es un atajo para saltarse Apollo: exige evidencia PERSISTIDA del
 * desenlace histórico y se cierra en cuanto el candidato pertenece al flujo completo.
 *
 * REAUTORIZACIÓN (AGENT2A-PHONE-WATERFALL-2C). Una corrida histórica NO bloquea de
 * forma indiscriminada una autorización nueva: lo que bloquea es su CLASE, no su
 * existencia. La distinción vive en `classifyPhoneRevealWaterfallLegacyHistory` y es
 * la única autoridad, compartida por el servidor y por la UI.
 *
 * PREFLIGHT DE SALDO (AGENT2A-PHONE-WATERFALL-4D). Con el modal eliminado, el clic
 * único crea la corrida y arranca Apollo sin paso intermedio, así que el presupuesto se
 * comprueba en los DOS arranques justo antes del INSERT. Sin saldo suficiente —o sin
 * poder verificarlo— fail-closed: 0 corridas, 0 llamadas a proveedor, 0 usage logs, 0
 * créditos. La comparación vive en phone-reveal-credit-budget-core.ts, que es igual de
 * puro; la resolución del presupuesto llega inyectada como dep.
 *
 * RESERVA ATÓMICA (AGENT2A-PHONE-WATERFALL-4E). Comprobar el saldo no basta: el modelo
 * presupuestario es POR PROVEEDOR y no tiene contador de reservado, así que dos
 * autorizaciones consecutivas leen la MISMA disponibilidad y las dos pasan. Por eso el
 * arranque ahora RESERVA la exposición máxima —Apollo 8 y/o Lusha 5, cada una contra su
 * propio pozo, all-or-nothing— ANTES de crear la corrida y ANTES de llamar a cualquier
 * proveedor. Consecuencias que este core garantiza:
 *
 *   * sin regla de crédito para un proveedor exigido ⇒ `budget_not_configured` y NO se
 *     arranca (no hay disponibilidad contra la que reservar);
 *   * si la corrida no se puede crear —excepción o 23505 del índice único parcial— la
 *     reserva se LIBERA, así que un conflicto benigno no deja créditos bloqueados;
 *   * la corrida nace con `credit_reservation_group_id`, así que run y exposición
 *     quedan asociadas ATÓMICAMENTE: no existe una corrida cuya reserva no se pueda
 *     encontrar para liquidarla;
 *   * mientras la corrida siga viva la exposición se mantiene ENTERA, y al terminalizar
 *     se reconcilia contra el costo real de cada pata por separado (la decisión vive en
 *     phone-reveal-credit-reservation-core.ts).
 */

// Únicos imports de este módulo, y los dos son a cores PUROS (sin I/O, sin imports de
// servidor): la alternativa era duplicar aquí los topes exigidos, la política
// fail-closed del presupuesto y el ciclo de vida de la reserva, y duplicarlos es lo que
// permitiría que discrepasen.
import {
  evaluatePhoneRevealCreditBudget,
  resolvePhoneRevealCreditBudgetMode,
  resolvePhoneRevealCreditBudgetProviders,
  type PhoneRevealCreditBudgetMode,
  type PhoneRevealCreditPool,
  type PhoneRevealCreditProviderKey,
} from './phone-reveal-credit-budget-core';
import {
  resolveProviderNativeContactId,
  type ProviderContactIdentityRecord,
} from './provider-contact-identity-core';
import {
  buildLushaIdentitySearchQuery,
  type LushaIdentitySearchCandidateFacts,
} from './lusha-identity-search-core';
import type {
  LushaIdentitySearchRunOutcome,
  ResolveLushaIdentityResult,
} from './lusha-identity-resolution-runtime-core';
import {
  buildPhoneRevealCreditReservationLegs,
  type PhoneRevealCreditReservationAndRunOutcome,
  type PhoneRevealCreditReservationAndRunRequest,
  type PhoneRevealCreditReservedLeg,
} from './phone-reveal-credit-reservation-core';
import { isPhoneRevealRoleAuthorized } from './phone-reveal-authorized-roles';

// ── Vocabularios (espejo exacto de los CHECK de la migración 102) ──

/** Lifecycle de la corrida completa. */
export type PhoneRevealWaterfallStatus =
  | 'authorized'
  | 'apollo_in_flight'
  | 'completed_apollo'
  | 'lusha_pending'
  | 'lusha_running'
  | 'completed_lusha'
  | 'exhausted'
  | 'error'
  | 'aborted';

/** Desenlace de la pata Apollo. */
export type PhoneRevealWaterfallApolloOutcome =
  | 'revealed'
  | 'revealed_from_cache'
  | 'no_phone_found'
  | 'error'
  | 'blocked_suppressed'
  | 'do_not_contact'
  | 'suppression_check_unavailable'
  | 'cache_unavailable';

/** Desenlace de la pata Lusha. */
/**
 * Desenlace de la pata de Lusha. Espejo del CHECK
 * `phone_reveal_waterfall_runs_lusha_outcome_check` (creado por la 102, ensanchado por la
 * 122).
 *
 * `no_new_distinct_phone` (AGENT2A-SEARCH-MORE-PHONES-1) es el desenlace que sólo una
 * corrida `search_more` puede producir: Lusha CONTESTÓ y se cobró, pero todos los números
 * que devolvió ya estaban guardados.
 *
 * No se colapsa en ninguno de los otros dos, y en las dos direcciones importa:
 *   * `no_phone_found` afirmaría que el proveedor NO tiene teléfono para esa persona, lo
 *     cual es falso —tiene el mismo— y además haría que el copy dijera «este contacto no
 *     tiene teléfono» cuando la verdad es «no hay números ADICIONALES»;
 *   * `revealed` afirmaría que SellUp ganó un número que no ganó.
 */
export type PhoneRevealWaterfallLushaOutcome =
  | 'revealed'
  | 'no_phone_found'
  | 'error'
  | 'no_new_distinct_phone';

/** Proveedor que REALMENTE reveló (nunca uno que solo intentó). */
export type PhoneRevealWaterfallFinalProvider = 'apollo' | 'lusha' | 'none';

/**
 * Modalidad de la corrida (AGENT2A-PHONE-WATERFALL-2). Vocabulario CERRADO y única
 * fuente de los nombres: el CHECK `phone_reveal_waterfall_runs_run_mode_check` de la
 * migración 103 se compara contra esta lista en un test estático, en los dos
 * sentidos.
 *
 *   * `full_waterfall`     — Apollo dentro de la corrida y Lusha después solo si
 *     Apollo terminó `no_phone_found`. Tope 13 (8 + 5).
 *   * `legacy_lusha_only`  — el intento Apollo YA ocurrió y YA terminó
 *     `no_phone_found` ANTES de que existiera la tabla. Apollo NO se vuelve a
 *     ejecutar (0 llamadas, 0 créditos, 0 usage logs nuevos) y el operador autoriza
 *     ÚNICAMENTE la pata Lusha. Tope 5.
 *   * `search_more`         — «Buscar más números» (AGENT2A-SEARCH-MORE-PHONES-1). El
 *     candidato YA TIENE teléfono guardado y el operador autoriza consultar al
 *     proveedor que FALTA para conseguir números ADICIONALES. Tope 5 por pata.
 *
 * `search_more` NO es un reetiquetado de `legacy_lusha_only`, y confundirlos sería el
 * error caro: la condición de entrada es la OPUESTA. `legacy_lusha_only` exige que el
 * candidato NO tenga teléfono (su elegibilidad rechaza con `existing_phone_present`);
 * `search_more` exige que SÍ lo tenga. Reusar el valor haría que toda consulta de
 * auditoría del tipo «¿se agotó Apollo para este candidato?» respondiera al revés, y
 * volvería indistinguibles dos topes distintos en el ledger.
 *
 * Es una columna y no una inferencia a propósito: `apollo_attempted_at IS NULL` es
 * un efecto colateral, no una afirmación, y no distingue "Apollo no se ejecutó
 * porque ya corrió antes" de "la pata Apollo nunca se registró".
 */
export const PHONE_REVEAL_WATERFALL_RUN_MODES = [
  'full_waterfall',
  'legacy_lusha_only',
  'search_more',
] as const;

export type PhoneRevealWaterfallRunMode =
  (typeof PHONE_REVEAL_WATERFALL_RUN_MODES)[number];

/**
 * Parser del vocabulario cerrado de modalidad. Un valor desconocido cae a
 * `full_waterfall`, que es el DEFAULT de la columna y la modalidad más restrictiva
 * para la ruta legacy: una fila ilegible nunca se lee como "Apollo ya está
 * excusado", así que no puede convertirse en un atajo para saltarse Apollo.
 */
export function parsePhoneRevealWaterfallRunMode(
  value: unknown,
): PhoneRevealWaterfallRunMode {
  if (typeof value !== 'string') return 'full_waterfall';
  const trimmed = value.trim();
  return (PHONE_REVEAL_WATERFALL_RUN_MODES as readonly string[]).includes(trimmed)
    ? (trimmed as PhoneRevealWaterfallRunMode)
    : 'full_waterfall';
}

/** Confianza sobre el costo. `unknown` ≠ 0: un costo no reportado no es gratis. */
export type PhoneRevealWaterfallCostSource = 'reported' | 'assumed_cap' | 'unknown';

/**
 * Por qué NO se intentó Lusha. Vocabulario CERRADO y única fuente de los nombres:
 * el CHECK `phone_reveal_waterfall_runs_lusha_skipped_reason_check` de la
 * migración 102 se compara contra esta lista en un test estático, en los dos
 * sentidos, para que no se pueda añadir un motivo en un solo lado.
 *
 * `suppressed` y `suppression_check_unavailable` son DELIBERADAMENTE distintos:
 *   * `suppressed` — la comprobación SÍ se ejecutó y confirmó tombstone/bloqueo.
 *   * `suppression_check_unavailable` — la comprobación no se pudo completar, así
 *     que NO se sabe si el candidato está suprimido. Solo se sabe que SellUp no
 *     pudo verificarlo y, fail-closed, no ejecutó Lusha.
 * Colapsar el segundo en el primero afirmaría al operador (y a una auditoría de
 * privacidad) algo que nunca se comprobó, así que son dos motivos separados.
 */
export const PHONE_REVEAL_WATERFALL_LUSHA_SKIPPED_REASONS = [
  'missing_lusha_contact_id',
  'apollo_revealed',
  'suppressed',
  'suppression_check_unavailable',
  'dnc',
  'authorization_expired',
  'role_not_allowed',
  'feature_disabled',
  'already_attempted',
  'not_needed',
  'provider_error',
  // ── Resolución de identidad cross-provider (AGENT2A-CROSS-PROVIDER-
  //    PHONE-IDENTITY-RESOLUTION-1). Los cuatro son motivos por los que la pata
  //    Lusha NO llegó a intentarse, y son distintos entre sí porque cuestan cosas
  //    distintas y le dicen cosas distintas al operador:
  /** No había ningún identificador exacto con el que buscar. 0 llamadas, 0 créditos. */
  'lusha_identity_unresolvable',
  /** Se buscó y Lusha no conoce a esta persona. Costó 1 crédito averiguarlo. */
  'lusha_identity_not_found',
  /** Se buscó y la respuesta no señala a UNA persona. Costó 1. Nunca se elige la 1ª. */
  'lusha_identity_ambiguous',
  /** La búsqueda falló o expiró. No sabemos qué sabe Lusha, y pudo cobrarnos igual. */
  'lusha_identity_error',
  /**
   * Se resolvió UNA identidad —y se pagó 1 crédito por ella— pero no quedó almacenada
   * de forma duradera. Es distinto de `lusha_identity_error`: el proveedor no falló,
   * falló nuestra escritura. Y es distinto de un reveal omitido cualquiera porque el
   * crédito de la búsqueda SÍ se gastó y hay que liquidarlo.
   */
  'lusha_identity_not_persisted',
] as const;

export type PhoneRevealWaterfallLushaSkippedReason =
  (typeof PHONE_REVEAL_WATERFALL_LUSHA_SKIPPED_REASONS)[number];

/**
 * Parser del vocabulario cerrado. Un valor arbitrario (columna ampliada por otra
 * rama, fila escrita a mano, driver devolviendo algo inesperado) se descarta a
 * `null` en vez de viajar a la UI o a la auditoría como si fuera un motivo válido.
 */
export function parsePhoneRevealWaterfallLushaSkippedReason(
  value: unknown,
): PhoneRevealWaterfallLushaSkippedReason | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return (PHONE_REVEAL_WATERFALL_LUSHA_SKIPPED_REASONS as readonly string[]).includes(
    trimmed,
  )
    ? (trimmed as PhoneRevealWaterfallLushaSkippedReason)
    : null;
}

/** Estados NO terminales: la corrida sigue viva y puede gastar la 2ª pata. */
export const PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES: readonly PhoneRevealWaterfallStatus[] =
  ['authorized', 'apollo_in_flight', 'lusha_pending', 'lusha_running'];

/** Estados terminales: nada más se ejecuta para esa corrida. */
export const PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES: readonly PhoneRevealWaterfallStatus[] =
  ['completed_apollo', 'completed_lusha', 'exhausted', 'error', 'aborted'];

/**
 * Estados desde los que el CLAIM de la pata Lusha es válido. Espejo del `WHERE`
 * del UPDATE atómico en el store (ver `claimLushaAttempt` en los deps): un claim
 * solo puede salir de una corrida que sigue esperando (Apollo en vuelo o Lusha
 * pendiente), nunca de una ya terminal ni de una ya en `lusha_running`.
 */
export const PHONE_REVEAL_WATERFALL_CLAIMABLE_STATUSES: readonly PhoneRevealWaterfallStatus[] =
  ['apollo_in_flight', 'lusha_pending'];

// ── Constantes de autorización y costo ─────────────────────────

// El waterfall NO declara lista de roles propia
// (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1). Aquí vivía
// `PHONE_REVEAL_WATERFALL_AUTHORIZED_ROLE_KEYS = ['admin']`, y esa segunda lista
// partía el producto en dos flujos según el rol: un `commercial_manager` con
// permiso de revelar teléfono se quedaba en Apollo-only y un `admin` obtenía
// Apollo → Lusha. La autoridad es UNA — `PHONE_REVEAL_AUTHORIZED_ROLE_KEYS` en
// phone-reveal-authorized-roles.ts — y quien decide si el waterfall corre es el
// flag `ENABLE_PHONE_REVEAL_WATERFALL`, nunca el rol. Ver
// `isPhoneRevealWaterfallRoleAuthorized` más abajo.

/**
 * Tope de la pata Apollo. Espejo de APOLLO_PHONE_REVEAL_CREDITS (8) en
 * phone-reveal-core.ts; un test estático verifica que sigan coincidiendo.
 */
export const PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS = 8;

/**
 * Tope de la pata Lusha. Espejo de LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS (5)
 * en lusha-phone-fallback-core.ts; un test estático verifica la coincidencia.
 */
export const PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS = 5;

/** Tope que el operador acepta cuando Lusha es una 2ª pata posible: 8 + 5. */
export const PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA =
  PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS + PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS;

/**
 * Tope de la BÚSQUEDA DE IDENTIDAD de Lusha: **1 crédito**
 * (AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1).
 *
 * Cifra del proveedor, no una estimación nuestra: Lusha factura Contact Search vía
 * `api_search` a 1 crédito por petición a la API, con un mínimo de 1 aunque la
 * respuesta no traiga resultados. De ahí que el tope sea 1 y que una búsqueda sin
 * resultados se liquide igual a 1: el mínimo ya se cobró.
 *
 * Es un tope PROPIO y no un sumando escondido dentro de los 5 del reveal. Fundirlos
 * dejaría al operador autorizando una operación que no ve, y dejaría al ledger sin
 * poder responder cuánto costó averiguar la identidad frente a cuánto costó el
 * teléfono.
 */
export const PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS = 1;

/**
 * Tope cuando además hay que AVERIGUAR la identidad Lusha: 8 + 1 + 5 = 14.
 *
 * Es la modalidad del candidato nacido en Apollo, que es precisamente el que este
 * hito desbloquea: alcanzable por Lusha, pero solo tras pagar por saber con qué id lo
 * conoce Lusha.
 */
export const PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH =
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA +
  PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS;

/**
 * Tope de una corrida `legacy_lusha_only` (AGENT2A-PHONE-WATERFALL-2): SOLO la pata
 * Lusha, así que es exactamente el tope de Lusha y NUNCA incluye los 8 de Apollo.
 * Apollo ya corrió y ya se cobró bajo OTRA autorización; sumarlo aquí cobraría dos
 * veces el mismo intento en la confirmación que ve el operador.
 */
export const PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS =
  PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS;

/**
 * Tope de una corrida legacy que además tiene que AVERIGUAR la identidad Lusha:
 * 1 + 5 = **6** (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1).
 *
 * Es la modalidad del candidato NACIDO EN APOLLO cuyo intento Apollo ya terminó
 * `no_phone_found`: Lusha puede alcanzarlo, pero antes hay que pagar por saber con qué
 * id lo conoce.
 *
 * Los 8 de Apollo siguen SIN entrar, igual que en `legacy_lusha_only`. El costo
 * histórico de Apollo pertenece a la autorización que lo pagó; esta autorización no lo
 * vuelve a gastar y por tanto no lo vuelve a pedir. Nunca se enseña 14, ni 13, ni
 * «8 + …»: la cifra que el operador acepta aquí es exactamente la que esta corrida
 * puede llegar a cobrar.
 */
export const PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH =
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS +
  PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS;

/**
 * Vida útil de la autorización humana. Pasadas 24 h, un webhook tardío puede
 * cerrar la pata Apollo pero NUNCA gastar la pata Lusha: el operador confirmó un
 * costo en un momento concreto, no de forma indefinida.
 */
export const PHONE_REVEAL_WATERFALL_AUTHORIZATION_TTL_HOURS = 24;

// ── Registros (proyecciones de solo lectura) ───────────────────

/** Fila de `phone_reveal_waterfall_runs` proyectada. PII-free por contrato. */
export interface PhoneRevealWaterfallRunRecord {
  id: string;
  candidateId: string;
  status: PhoneRevealWaterfallStatus;
  /**
   * Modalidad de la corrida (AGENT2A-PHONE-WATERFALL-2). `full_waterfall` es el
   * default de la columna, así que las corridas creadas por el START de Apollo la
   * traen sin cambiar nada.
   */
  runMode: PhoneRevealWaterfallRunMode;
  authorizedAt: string;
  /** internal_users.id opaco del operador que autorizó. Actor de los dos legs. */
  authorizedBy: string;
  authorizedByRole: string | null;
  maxCreditsAuthorized: number;
  apolloAttemptedAt: string | null;
  apolloOutcome: PhoneRevealWaterfallApolloOutcome | null;
  apolloCostCredits: number | null;
  apolloCostSource: PhoneRevealWaterfallCostSource | null;
  lushaEligible: boolean | null;
  lushaSkippedReason: PhoneRevealWaterfallLushaSkippedReason | null;
  lushaAttemptedAt: string | null;
  /**
   * `lusha_identity_search_attempted_at` (migración 124): el claim PROPIO de la búsqueda
   * de identidad, deliberadamente distinto de `lushaAttemptedAt`, que reclama el reveal.
   *
   * OPCIONAL: una corrida anterior a la 124 no tiene la columna, y su ausencia se lee
   * como «no se buscó» — que es la verdad para toda corrida histórica, ninguna de las
   * cuales pudo pagar una búsqueda de identidad. Es lo que decide si la pata
   * `lusha/contact_search` se CONFIRMA o se LIBERA en la liquidación.
   */
  lushaIdentitySearchAttemptedAt?: string | null;
  lushaOutcome: PhoneRevealWaterfallLushaOutcome | null;
  lushaCostCredits: number | null;
  lushaCostSource: PhoneRevealWaterfallCostSource | null;
  finalProvider: PhoneRevealWaterfallFinalProvider | null;
  completedAt: string | null;
  errorCode: string | null;
  /**
   * Grupo de reserva que paga esta corrida (AGENT2A-PHONE-WATERFALL-4E). Se escribe
   * DENTRO del INSERT, así que una corrida creada por este código siempre lo trae.
   * `null` solo en corridas anteriores a la migración 104, que no tienen exposición
   * reservada que liquidar.
   */
  creditReservationGroupId: string | null;
}

/**
 * Proyección mínima del candidato para decidir el waterfall. NO incluye
 * teléfono, email, LinkedIn ni nombre: la decisión solo necesita saber SI ya hay
 * teléfono, no cuál es.
 */
export interface PhoneRevealWaterfallCandidateRecord {
  id: string;
  /** `contact_enrichment_candidates.source` crudo ('apollo' | 'lusha' | …). */
  source: string | null;
  /** id de contacto del proveedor de origen. Opaco, nunca se imprime. */
  sourceContactId: string | null;
  /** true si el candidato YA tiene un teléfono persistido. Nunca el número. */
  hasPhone: boolean;
  phoneRevealStatus: string | null;
  /**
   * Identidades provider-native persistidas (`contact_provider_identities`).
   * OPCIONAL: ausente ⇒ ninguna, que es el estado de todo candidato anterior a la
   * migración 124 y deja el comportamiento idéntico al de antes del hito.
   */
  providerIdentities?: readonly ProviderContactIdentityRecord[];
  /**
   * Datos con los que se podría construir UNA búsqueda de identidad. Se leen del
   * propio candidato y de su cuenta; ninguno viaja jamás a un log.
   */
  identitySearchFacts?: LushaIdentitySearchCandidateFacts;
}

// ── Elegibilidad de la pata Lusha ──────────────────────────────

export interface PhoneRevealWaterfallLushaLegEligibility {
  eligible: boolean;
  /** Motivo cuando NO es elegible. null cuando sí lo es. */
  skippedReason: PhoneRevealWaterfallLushaSkippedReason | null;
  /**
   * true cuando la pata Lusha es alcanzable pero exige PAGAR una búsqueda de identidad
   * primero. Es la señal que separa un tope de 14 de uno de 13, y por eso se resuelve
   * en la misma evaluación que la elegibilidad: preguntarlo más tarde significaría
   * decidir el tope después de habérselo enseñado al operador.
   *
   * OPCIONAL para que un caller anterior al hito compile sin cambios; su ausencia se
   * lee como `false`.
   */
  requiresIdentitySearch?: boolean;
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * ¿Puede este candidato llegar a la pata Lusha? SOLO si tiene un id de contacto
 * Lusha PROPIO y reutilizable, es decir si su `source` es 'lusha'.
 *
 * Un candidato de origen Apollo (o de cualquier otro) NUNCA reenvía su
 * `source_contact_id` a Lusha: son espacios de id distintos y usar el ajeno es
 * exactamente la causa raíz del HTTP 422 documentada en el RCA del reveal
 * asíncrono. Misma regla, sin relajar, que `resolveLushaContactId` en
 * lusha-phone-fallback-core.ts — aquí solo se anticipa para poder decir al
 * operador, ANTES de cobrar nada, si el tope es 13 o 8.
 *
 * No hay `search`, no hay `waterfallReveal` de Lusha y no hay search-and-enrich:
 * sin id propio la pata Lusha simplemente no existe.
 */
export function evaluatePhoneRevealWaterfallLushaLeg(
  candidate: Pick<PhoneRevealWaterfallCandidateRecord, 'source' | 'sourceContactId'> & {
    /**
     * Identidades provider-native ya persistidas para este candidato
     * (`contact_provider_identities`, migración 124). Ausente ⇒ ninguna, que es el
     * estado de todo candidato anterior a este hito.
     */
    providerIdentities?: readonly ProviderContactIdentityRecord[];
    /**
     * Datos con los que se PODRÍA construir una búsqueda de identidad. Ausente ⇒ no
     * se evalúa esa vía y el comportamiento es EXACTAMENTE el anterior al hito: sin
     * id propio, no hay pata Lusha.
     */
    identitySearchFacts?: LushaIdentitySearchCandidateFacts;
  },
  /**
   * ¿Esta autorización cubre una búsqueda de identidad PAGADA?
   *
   * AUSENTE ⇒ `true`, que es lo correcto en el ARRANQUE: allí el tope todavía se está
   * decidiendo, así que preguntar por él sería circular.
   *
   * En la CONTINUACIÓN se pasa el hecho real de la corrida, y ahí `false` importa: una
   * corrida `legacy_lusha_only` (o cualquiera creada antes de que el flag se encendiera)
   * reservó UNA pata de teléfono y ningún crédito de búsqueda. Si la búsqueda se
   * ejecutara igual, gastaría un crédito que nadie reservó y que el operador nunca vio
   * en su confirmación — el defecto exacto que la reserva por pata existe para impedir.
   */
  options?: { identitySearchAuthorized?: boolean },
): PhoneRevealWaterfallLushaLegEligibility {
  // 1. ¿Lusha ya sabe quién es? Vale tanto un candidato nacido en Lusha como una
  //    identidad resuelta y persistida por una autorización anterior. Este helper
  //    NUNCA devuelve el id de Apollo: `provider_key` forma parte de su clave.
  const nativeIdentity = resolveProviderNativeContactId({
    providerKey: 'lusha',
    candidateSource: candidate.source,
    candidateSourceContactId: candidate.sourceContactId,
    identities: candidate.providerIdentities ?? [],
  });
  if (nativeIdentity) {
    return { eligible: true, skippedReason: null, requiresIdentitySearch: false };
  }

  // 2. Si no lo sabe, ¿hay con qué averiguarlo? Se responde AQUÍ, antes del clic,
  //    porque es lo que decide si el operador autoriza 14 o solamente 8.
  const query = candidate.identitySearchFacts
    ? buildLushaIdentitySearchQuery(candidate.identitySearchFacts)
    : null;
  // La vía de pago sólo existe si ESTA autorización la cubre. Cuando no la cubre, el
  // veredicto vuelve a ser el de antes del hito —y es el veredicto VERDADERO para esa
  // corrida: bajo esta autorización, este candidato no tiene identificador de Lusha
  // reutilizable. Que una autorización distinta pudiera comprarlo no es algo que esta
  // corrida pueda gastar.
  if (query && options?.identitySearchAuthorized !== false) {
    return { eligible: true, skippedReason: null, requiresIdentitySearch: true };
  }

  // 3. Ni id propio ni identificador con el que buscarlo: la pata Lusha no existe, y
  //    el operador autoriza 8. Idéntico al comportamiento anterior al hito.
  return {
    eligible: false,
    skippedReason: 'missing_lusha_contact_id',
    requiresIdentitySearch: false,
  };
}

/**
 * Vista previa de la AUTORIZACIÓN, ANTES del clic
 * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1).
 *
 * PII-free por construcción: dos booleanos y un entero. Ni teléfono, ni email, ni
 * LinkedIn, ni nombre, ni ningún id de proveedor.
 */
export interface PhoneRevealWaterfallAuthorizationPreview {
  /** ¿La 2ª pata (Lusha) es alcanzable bajo esta autorización? */
  lushaEligible: boolean;
  /** ¿Alcanzarla exige pagar antes una búsqueda de identidad? */
  requiresIdentitySearch: boolean;
  /** Tope que el operador debe aceptar: 8, 13 o 14. */
  maxCredits: number;
}

/**
 * Resuelve la modalidad y el tope de UNA autorización a partir de los hechos del
 * candidato. ES la función que usa el ARRANQUE, y por eso mismo es la que debe usar la
 * UI para su copy: mientras las dos llamen aquí, el botón no puede prometer 8 donde el
 * servidor va a reservar 14, ni ofrecer 14 donde la búsqueda no se puede ejecutar.
 *
 * No decide permisos y no lee nada: los hechos llegan ya cargados.
 */
export function buildPhoneRevealWaterfallAuthorizationPreview(
  candidate: Parameters<typeof evaluatePhoneRevealWaterfallLushaLeg>[0],
): PhoneRevealWaterfallAuthorizationPreview {
  const leg = evaluatePhoneRevealWaterfallLushaLeg(candidate);
  const requiresIdentitySearch = leg.requiresIdentitySearch === true;
  return {
    lushaEligible: leg.eligible,
    requiresIdentitySearch,
    maxCredits: resolvePhoneRevealWaterfallMaxCredits(
      leg.eligible,
      requiresIdentitySearch,
    ),
  };
}

/**
 * Normaliza el tope que el CLIENTE dice haber aceptado
 * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2).
 *
 * Ausente, no numérico o no finito ⇒ el suelo conservador de 8, jamás la modalidad
 * requerida. Un cliente que no manda el tope no puede acabar autorizando el más caro por
 * omisión; en el peor caso se le vuelve a preguntar.
 */
export function normalizePhoneRevealWaterfallAcceptedMaxCredits(
  acceptedMaxCredits: number | null | undefined,
): number {
  return typeof acceptedMaxCredits === 'number' && Number.isFinite(acceptedMaxCredits)
    ? acceptedMaxCredits
    : PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS;
}

/**
 * ¿La autorización HUMANA cubre lo que esta modalidad exige?
 * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2)
 *
 * El tope que se le enseñó a una persona es un LÍMITE SUPERIOR DURO. `>=` y no `===`
 * porque aceptar de más es seguro —el operador consintió un gasto mayor del que hace
 * falta, y lo que se reserva sigue siendo lo requerido, no lo aceptado—; aceptar de
 * MENOS nunca lo es, porque significaría cobrarle un máximo que nunca vio.
 *
 * Es una función PURA y separada a propósito: es el único lugar donde se decide si una
 * autorización obsoleta puede seguir, y el arranque la llama ANTES de cualquier reserva.
 */
export function isPhoneRevealWaterfallAuthorizationCeilingHonored(args: {
  requiredMaxCredits: number;
  acceptedMaxCredits: number;
}): boolean {
  return args.acceptedMaxCredits >= args.requiredMaxCredits;
}

/**
 * ¿El tope que el operador aceptó incluye la búsqueda de identidad PAGADA?
 *
 * Se responde con `max_credits_authorized`, que es el único hecho durable que dice a la
 * vez qué se le enseñó al operador y qué patas se reservaron. Un `>=` y no un `===`
 * porque el tope es un UMBRAL: si algún día crece, una corrida con más margen sigue
 * cubriendo la búsqueda.
 */
export function doesRunAuthorizeIdentitySearch(
  run: Pick<PhoneRevealWaterfallRunRecord, 'maxCreditsAuthorized' | 'runMode'>,
): boolean {
  return run.maxCreditsAuthorized >= resolveIdentitySearchAuthorizingCeiling(run.runMode);
}

/**
 * Tope a partir del cual una corrida DEMUESTRA que reservó la pata de búsqueda, según
 * su MODALIDAD (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1).
 *
 * El umbral no puede ser único porque las modalidades no cuestan lo mismo:
 *
 *   * `full_waterfall` → 14 (Apollo 8 + búsqueda 1 + teléfono 5). Una corrida de 13
 *     reservó las dos patas de teléfono y NINGÚN crédito de búsqueda.
 *   * `legacy_lusha_only` → 6 (búsqueda 1 + teléfono 5). Apollo NO se ejecuta bajo esta
 *     autorización, así que exigirle 14 le pediría demostrar que reservó un proveedor
 *     que su propia modalidad prohíbe: ninguna corrida legacy llegaría nunca a 14, y la
 *     vía de pago quedaría permanentemente muerta para el candidato Apollo agotado —
 *     que es justamente a quien este hito desbloquea.
 *   * `search_more` → 14 también, y ahí el efecto es el correcto por construcción: su
 *     tope es 5, así que jamás autoriza una búsqueda. Esa modalidad no pasa por la
 *     continuación, y si algún día pasara, seguiría sin poder comprar identidad.
 *
 * En las TRES el criterio es el mismo hecho durable —`max_credits_authorized`— y no una
 * inferencia: es lo único que dice a la vez qué se le enseñó al operador y qué patas se
 * reservaron. Reutilizar una identidad YA persistida sigue permitido en todas: cuesta 0.
 */
function resolveIdentitySearchAuthorizingCeiling(
  runMode: PhoneRevealWaterfallRunMode,
): number {
  return runMode === 'legacy_lusha_only'
    ? PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH
    : PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH;
}

/**
 * Normaliza el tope que el CLIENTE dice haber aceptado en la ruta LEGACY
 * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1).
 *
 * Gemela de `normalizePhoneRevealWaterfallAcceptedMaxCredits`, pero con OTRO suelo, y
 * la diferencia es económica y no estética: el suelo del waterfall completo son los 8
 * de Apollo, y 8 ≥ 6, así que reutilizarlo aquí haría que un cliente que NO manda el
 * tope pasara el techo de la modalidad de 6 sin haber enseñado jamás un 6. El suelo
 * legacy es 5 —la modalidad más barata de esta ruta— así que un cliente silencioso
 * como máximo autoriza lo que la ruta legacy siempre autorizó, y una modalidad de 6 le
 * exige decirlo.
 */
export function normalizeLegacyPhoneRevealAcceptedMaxCredits(
  acceptedMaxCredits: number | null | undefined,
): number {
  return typeof acceptedMaxCredits === 'number' && Number.isFinite(acceptedMaxCredits)
    ? acceptedMaxCredits
    : PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS;
}

/**
 * Tope que la ruta LEGACY exige: 6 cuando además hay que pagar la búsqueda de
 * identidad, 5 cuando la identidad Lusha ya se conoce. Nunca 8, nunca 13, nunca 14.
 */
export function resolveLegacyPhoneRevealMaxCredits(
  requiresIdentitySearch: boolean,
): number {
  return requiresIdentitySearch
    ? PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH
    : PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS;
}

/**
 * Tope de créditos que el operador debe aceptar: 13 cuando Lusha es una 2ª pata
 * posible (Apollo hasta 8 + Lusha 5) y 8 cuando no lo es. Es el UMBRAL de
 * confirmación, no una predicción del cobro: el costo real de cada pata sale
 * exclusivamente de lo que reporta cada proveedor.
 */
export function resolvePhoneRevealWaterfallMaxCredits(
  lushaEligible: boolean,
  /**
   * true cuando además hay que pagar la búsqueda de identidad. Ausente ⇒ `false`, que
   * devuelve exactamente los 13 / 8 de antes del hito.
   */
  requiresIdentitySearch: boolean = false,
): number {
  if (!lushaEligible) return PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS;
  return requiresIdentitySearch
    ? PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH
    : PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA;
}

/**
 * Confianza del costo a partir de lo que el proveedor reportó. Un número finito
 * (incluido 0 explícito) es `reported`; la AUSENCIA de dato es `unknown`, nunca
 * 0 — no reportar no es lo mismo que no cobrar.
 */
export function resolvePhoneRevealWaterfallCostSource(
  credits: number | null | undefined,
): PhoneRevealWaterfallCostSource {
  return typeof credits === 'number' && Number.isFinite(credits) ? 'reported' : 'unknown';
}

/** ¿La autorización humana ya venció? (TTL 24 h desde `authorized_at`). */
export function isPhoneRevealWaterfallAuthorizationExpired(
  authorizedAtIso: string,
  nowIso: string,
  ttlHours: number = PHONE_REVEAL_WATERFALL_AUTHORIZATION_TTL_HOURS,
): boolean {
  const authorizedAt = new Date(authorizedAtIso).getTime();
  const now = new Date(nowIso).getTime();
  // Fechas ilegibles ⇒ se trata como vencida (fail-closed: nunca se gasta la
  // segunda pata sobre una autorización que no se puede fechar).
  if (!Number.isFinite(authorizedAt) || !Number.isFinite(now)) return true;
  return now - authorizedAt > ttlHours * 3_600_000;
}

/**
 * ¿El rol sigue autorizado para el waterfall?
 *
 * `WATERFALL_ALLOWED(actor) = PHONE_REVEAL_ALLOWED(actor)` del contrato de Product
 * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1): DELEGA en la autoridad canónica del
 * reveal en vez de comparar contra una lista propia. No amplía nada por su cuenta —
 * quien no podía revelar teléfono sigue sin poder — y no estrecha nada tampoco: el
 * waterfall es el comportamiento NORMAL del botón para quien ya tenía el permiso.
 *
 * Se conserva como función NOMBRADA (y no se sustituye por la canónica en los cuatro
 * puntos de uso) porque los cuatro son gates del WATERFALL: el arranque completo, el
 * arranque legacy, la continuación sin humano presente y la lectura de la auditoría.
 * Tener el nombre permite leer en el código qué se está autorizando.
 */
export function isPhoneRevealWaterfallRoleAuthorized(roleKey: string | null): boolean {
  return isPhoneRevealRoleAuthorized(cleanText(roleKey));
}

// ── Arranque: crear la corrida al autorizar el botón ───────────

/** Patch de INSERT de la corrida. Describe la fila; no la escribe. */
export interface PhoneRevealWaterfallRunDraft {
  candidateId: string;
  /**
   * `apollo_in_flight` para una corrida `full_waterfall` (Apollo acaba de arrancar)
   * y `lusha_pending` para una `legacy_lusha_only` (Apollo no va a arrancar: la
   * corrida nace directamente esperando la pata Lusha). Los dos están en
   * PHONE_REVEAL_WATERFALL_CLAIMABLE_STATUSES y en el índice único parcial, así que
   * el claim atómico y "una sola corrida activa por candidato" valen igual.
   */
  status: Extract<PhoneRevealWaterfallStatus, 'apollo_in_flight' | 'lusha_pending'>;
  /** Modalidad explícita. Nunca se deduce de los timestamps. */
  runMode: PhoneRevealWaterfallRunMode;
  authorizedAt: string;
  authorizedBy: string;
  authorizedByRole: string | null;
  maxCreditsAuthorized: number;
  /**
   * `null` en una corrida `legacy_lusha_only`: Apollo NO se ejecuta bajo esta
   * autorización, y un timestamp inventado haría parecer que sí. La evidencia del
   * intento histórico vive en el candidato, no aquí.
   */
  apolloAttemptedAt: string | null;
  /**
   * Desenlace de la pata Apollo ya conocido en el INSERT. En `legacy_lusha_only`
   * transcribe el desenlace terminal histórico del candidato (siempre
   * `no_phone_found`, que es la condición de entrada). `undefined` en
   * `full_waterfall`: ahí Apollo acaba de arrancar y todavía no hay desenlace.
   */
  apolloOutcome?: PhoneRevealWaterfallApolloOutcome;
  /**
   * Confianza del costo Apollo. En `legacy_lusha_only` es `unknown` con
   * `apolloCostCredits` en null: el costo histórico pertenece a la autorización que
   * realmente lo pagó y NUNCA se re-atribuye a esta. Jamás 0.
   */
  apolloCostSource?: PhoneRevealWaterfallCostSource;
  lushaEligible: boolean;
  /**
   * `missing_lusha_contact_id` ya en el INSERT cuando el candidato no tiene id
   * Lusha propio: la corrida nace sabiendo que su 2ª pata es imposible, así que
   * la auditoría no depende de que alguien lo deduzca después. null cuando la
   * pata sigue viva (todavía puede terminar en `apollo_revealed`, `suppressed`…).
   */
  lushaSkippedReason: PhoneRevealWaterfallLushaSkippedReason | null;
  /**
   * Grupo de reserva cuya exposición paga esta corrida
   * (AGENT2A-PHONE-WATERFALL-4E). Va en el INSERT y no en un UPDATE posterior: es lo
   * que hace que la asociación entre corrida y exposición sea ATÓMICA, sin una ventana
   * en la que exista una corrida cuya reserva nadie pueda encontrar.
   */
  creditReservationGroupId: string;
}

export interface StartPhoneRevealWaterfallInput {
  candidateId: string;
  /**
   * Tope de créditos que el operador ACEPTÓ en la UI, tal cual llegó del cliente
   * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2).
   *
   * POR QUÉ EXISTE: el copy del botón se calcula ANTES del clic y puede quedar OBSOLETO
   * —la vista previa falló y la UI cayó a su suelo conservador de 8, o la modalidad
   * cambió entre el render y el clic—. Sin este dato, el arranque resolvía la modalidad
   * REAL y reservaba 14 sobre una autorización humana de 8. El tope que se le enseñó a
   * una persona es un LÍMITE SUPERIOR DURO, no una sugerencia: si lo que hace falta lo
   * supera, no se reserva nada y se le vuelve a preguntar.
   *
   * Ausente o no finito ⇒ se asume el suelo conservador
   * (`PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS`), NUNCA la modalidad requerida: un
   * cliente que no manda el tope no puede acabar autorizando el más caro.
   */
  acceptedMaxCredits?: number;
}

/**
 * Resolución del presupuesto (AGENT2A-PHONE-WATERFALL-4D, per-provider en 4E). Recibe
 * los proveedores que la modalidad puede llegar a llamar y devuelve UN POZO POR
 * PROVEEDOR, con su límite, su consumo y la identidad de su pozo. Es una dep porque el
 * core es puro: aquí no se consulta nada.
 *
 * Es OBLIGATORIA en los dos arranques: sin ella el preflight no existiría y el clic
 * único crearía la corrida sin comprobar nada. Un fallo de lectura se expresa como
 * `{ kind: 'unavailable' }` por pozo — fail-closed — no lanzando.
 */
export type PhoneRevealWaterfallCreditPoolReader = (
  providerKeys: readonly PhoneRevealCreditProviderKey[],
) => Promise<readonly PhoneRevealCreditPool[]>;

/**
 * Reserva la exposición Y crea la corrida en UNA sola transacción
 * (AGENT2A-PHONE-WATERFALL-4F, `reserve_and_create_phone_reveal_run`).
 *
 * Sustituye al par `reserveCredits` + `createRun` de 4E, que eran dos viajes con una
 * ventana entre medias: si el proceso moría, la respuesta se perdía tras el COMMIT o el
 * driver expiraba, la reserva quedaba escrita sin corrida y la compensación nunca
 * corría. Una reserva huérfana no es sólo improbable ahora: es irrepresentable.
 *
 * Contrato: nunca lanza. Un fallo se expresa como `{ status: 'unavailable' }`.
 */
export type PhoneRevealWaterfallCreditReserverAndRunCreator = (args: {
  reservation: PhoneRevealCreditReservationAndRunRequest;
  run: PhoneRevealWaterfallRunDraft;
}) => Promise<PhoneRevealCreditReservationAndRunOutcome>;

/**
 * Deps de reserva compartidas por los TRES arranques: completo, legacy y —desde
 * AGENT2A-SEARCH-MORE-PHONES-1— «Buscar más números».
 *
 * EXPORTADA para que la tercera modalidad reutilice el MISMO motor económico en vez de
 * llevar una segunda implementación de «reservar y crear la corrida». Exportar el tipo no
 * cambia nada de lo que hace: es el contrato que los tres cableados ya cumplían.
 */
export interface PhoneRevealWaterfallCreditReservationDeps {
  /** Presupuesto por proveedor, resuelto ANTES de reservar. Fail-closed. */
  readCreditPools: PhoneRevealWaterfallCreditPoolReader;
  /**
   * Reserva atómica de todas las patas Y creación de la corrida, en UNA transacción
   * (AGENT2A-PHONE-WATERFALL-4F). Una sola dep porque son una sola escritura: separarlas
   * es exactamente lo que producía reservas huérfanas.
   */
  reserveCreditsAndCreateRun: PhoneRevealWaterfallCreditReserverAndRunCreator;
  /**
   * Id del grupo de reserva. Es una dep porque el core es puro y no puede llamar a
   * `crypto.randomUUID()`; en tests es determinista.
   */
  newReservationGroupId: () => string;
  /**
   * Clave de idempotencia de ESTA autorización (AGENT2A-PHONE-WATERFALL-4F). Se genera
   * ANTES de la operación, una vez por autorización, y la capa de I/O la reenvía
   * IDÉNTICA en su reintento. Dep por la misma razón que la anterior: el core es puro.
   */
  newAuthorizationKey: () => string;
  /**
   * RE-LECTURA POSTERIOR AL CONFLICTO
   * (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1).
   *
   * Un conflicto de unicidad dice que ALGO chocó. NO dice qué, y sobre todo no dice que
   * exista una autorización viva: la transacción se deshace entera, así que un conflicto
   * puede dejar la base exactamente como estaba —0 corridas y 0 reservas— y aun así
   * llegar aquí. Traducirlo a «ya hay una revelación en proceso» era inventarle al
   * operador una corrida que nadie podía encontrar.
   *
   * Con esta dep el conflicto deja de ser una CONCLUSIÓN y pasa a ser una PREGUNTA: se
   * vuelve a leer la corrida activa del candidato y sólo si aparece se afirma que existe.
   *
   * AUSENTE ⇒ fail-closed hacia infraestructura. No se afirma que haya corrida viva por
   * no haber podido comprobarlo: ese es justo el atajo que este hito elimina.
   */
  findActiveRunAfterConflict?: (
    candidateId: string,
  ) => Promise<PhoneRevealWaterfallRunRecord | null>;
}

export interface StartPhoneRevealWaterfallDeps
  extends PhoneRevealWaterfallCreditReservationDeps {
  /** ENABLE_PHONE_REVEAL_WATERFALL ya resuelto por el wrapper. */
  flagEnabled: boolean;
  actor: { internalUserId: string; roleKey: string | null };
  nowIso: string;
  loadCandidate: (
    candidateId: string,
  ) => Promise<PhoneRevealWaterfallCandidateRecord | null>;
  /** Corrida NO terminal existente para el candidato (índice único parcial). */
  findActiveRun: (
    candidateId: string,
  ) => Promise<PhoneRevealWaterfallRunRecord | null>;
}

export type StartPhoneRevealWaterfallResult =
  | {
      started: true;
      runId: string;
      maxCreditsAuthorized: number;
      lushaEligible: boolean;
      /**
       * true cuando el tope autorizado incluye la búsqueda de identidad de Lusha
       * (14 en vez de 13). Lo consume el copy para desglosar los 6 de Lusha en
       * «búsqueda hasta 1 + teléfono hasta 5» en vez de enseñar un 6 sin explicar.
       */
      requiresIdentitySearch?: boolean;
    }
  | {
      started: false;
      reason:
        | 'feature_disabled'
        | 'role_not_allowed'
        | 'invalid_candidate'
        | 'candidate_not_found'
        | 'active_run_exists'
        /**
         * Algún pozo NO cubre su pata (Apollo 8 y/o Lusha 5). No se creó corrida, no se
         * reservó nada y no se llamó a ningún proveedor
         * (AGENT2A-PHONE-WATERFALL-4D/4E).
         */
        | 'insufficient_credits'
        /**
         * Algún proveedor exigido NO tiene regla de crédito configurada
         * (AGENT2A-PHONE-WATERFALL-4E). No hay disponibilidad contra la que reservar, así
         * que el waterfall no arranca en vez de correr sobre un techo imaginario.
         */
        | 'budget_not_configured'
        /** El presupuesto no se pudo verificar. Fail-closed: tampoco se creó corrida. */
        | 'credit_balance_unavailable'
        /**
         * El presupuesto SÍ se verificó, pero la escritura atómica de reserva + corrida
         * no se pudo ejecutar (AGENT2A-PHONE-WATERFALL-4F): función ausente porque la
         * migración 104 no está aplicada, timeout, credenciales… Fail-closed: 0
         * corridas, 0 proveedores, 0 créditos, y el operador lee un fallo de
         * infraestructura en vez de uno de saldo.
         */
        | 'run_creation_unavailable'
        /**
         * Conflicto de unicidad SIN corrida activa que lo explique
         * (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1). Los dos son
         * infraestructura: 0 corridas, 0 reservas, 0 proveedores, 0 créditos. Ninguno
         * afirma ya que exista una revelación en curso — eso ahora exige haberla leído.
         */
        | 'create_conflict'
        | 'reservation_conflict'
        /**
         * El tope que el operador ACEPTÓ es MENOR que el que esta modalidad exige
         * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2). Se detecta DESPUÉS de conocer
         * la modalidad real y ANTES del preflight de presupuesto y de
         * `reserve_and_create_phone_reveal_run`, así que por construcción: 0 reservas, 0
         * corridas, 0 llamadas a Apollo, 0 llamadas a Lusha, 0 usage-logs y 0 créditos.
         *
         * NO se sube el tope en silencio y NO se reintenta: una autorización humana
         * obsoleta se vuelve a pedir, no se reinterpreta.
         */
        | 'authorization_ceiling_mismatch';
      /**
       * Solo en `authorization_ceiling_mismatch`: qué exigía la modalidad real y qué
       * había aceptado el operador. Dos enteros, PII-free, para que el wrapper pueda
       * registrarlo sin volver a resolver la modalidad.
       */
      requiredMaxCredits?: number;
      acceptedMaxCredits?: number;
    };

// ── Reserva + corrida atómicas, compartidas por los dos arranques ──

/** Desenlace del gate: o existe la corrida con su exposición, o hay un motivo. */
export type PhoneRevealWaterfallCreditGate =
  | {
      started: true;
      runId: string;
      reservationGroupId: string | null;
      /** true cuando la clave de idempotencia devolvió una corrida que YA existía. */
      idempotentHit: boolean;
      /**
       * Las patas que la transacción acaba de reservar, TAL COMO las devolvió.
       *
       * Se propagan porque la operación atómica ya las trae en su envoltorio `created`, y
       * volver a leerlas de la base para conocer el id de una reserva que se acaba de
       * escribir sería una consulta redundante contra una fila que el caller ya tuvo en la
       * mano. Una operación PAGADA las necesita para correlacionar directamente lo que
       * compró con la exposición que lo respaldó.
       *
       * VACÍA en el golpe idempotente (`already_created`): esa llamada no reservó nada, así
       * que no hay ninguna pata NUEVA que atribuirle. Vacío es el dato honesto — inventar la
       * reserva de la corrida ganadora afirmaría una correlación que esta invocación no creó.
       */
      reservations: readonly PhoneRevealCreditReservedLeg[];
    }
  | {
      started: false;
      reason:
        | 'insufficient_credits'
        | 'budget_not_configured'
        | 'credit_balance_unavailable'
        | 'run_creation_unavailable'
        /**
         * SÓLO tras comprobarlo (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1). Una
         * corrida activa REAL se encontró con `findActiveRunAfterConflict`. Nunca se
         * deduce de un conflicto a secas.
         */
        | 'active_run_exists'
        /** Conflicto del lado de la CORRIDA y NINGUNA corrida activa que lo explique. */
        | 'create_conflict'
        /**
         * Conflicto del lado de la RESERVA (`already_reserved`) y NINGUNA corrida activa
         * que lo explique. Es un hecho de infraestructura —exposición ocupada que nadie
         * puede señalar—, no una autorización viva, y por eso no comparte código con
         * `active_run_exists`.
         */
        | 'reservation_conflict';
      /** Qué chocó, para el diagnóstico. `null` = no hubo conflicto de unicidad. */
      conflictClass?: PhoneRevealWaterfallConflictClass | null;
      /**
       * Qué respondió la re-lectura posterior al conflicto. `null` = no se llegó a
       * consultar (no hubo conflicto, o no había dep con la que consultar).
       */
      postConflictActiveRunFound?: boolean | null;
    };

/**
 * QUÉ chocó, como enum cerrado y PII-free
 * (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1).
 *
 * `reservation` = índice único de la exposición; `run_create` = índice único de la
 * corrida. Se distinguen porque afirman cosas distintas y porque colapsarlos es
 * exactamente lo que hacía que una colisión de reservas se leyera como una revelación
 * en curso.
 */
export type PhoneRevealWaterfallConflictClass = 'reservation' | 'run_create';

/**
 * Convierte un CONFLICTO en un hecho comprobado
 * (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1).
 *
 * Es la única puerta por la que un conflicto de unicidad puede salir como
 * `active_run_exists`, y sólo lo hace cuando la re-lectura ENCUENTRA la corrida. Las
 * tres formas de no encontrarla se distinguen y ninguna afirma que exista:
 *
 *   * la dep no está cableada  ⇒ `run_creation_unavailable`. No se comprobó.
 *   * la re-lectura LANZA      ⇒ `run_creation_unavailable`. Tampoco se comprobó, y un
 *     fallo de lectura no es permiso para afirmar lo que se quería leer.
 *   * la re-lectura dice "no hay" ⇒ el conflicto es REAL pero no lo explica ninguna
 *     corrida viva: `reservation_conflict` o `create_conflict` según qué chocó.
 *
 * NO llama a ningún proveedor y NO gasta créditos: la transacción que produjo el
 * conflicto ya se deshizo, así que no hay nada que liberar y nada que cobrar.
 */
async function resolvePhoneRevealConflictAgainstActiveRun(args: {
  conflictClass: PhoneRevealWaterfallConflictClass;
  candidateId: string;
  findActiveRunAfterConflict?: (
    candidateId: string,
  ) => Promise<PhoneRevealWaterfallRunRecord | null>;
}): Promise<PhoneRevealWaterfallCreditGate> {
  const { conflictClass, candidateId, findActiveRunAfterConflict } = args;

  if (!findActiveRunAfterConflict) {
    return {
      started: false,
      reason: 'run_creation_unavailable',
      conflictClass,
      postConflictActiveRunFound: null,
    };
  }

  let activeRun: PhoneRevealWaterfallRunRecord | null;
  try {
    activeRun = await findActiveRunAfterConflict(candidateId);
  } catch {
    // Fail-closed hacia infraestructura. El mensaje del driver NO se propaga: puede
    // llevar valores de fila, y este camino termina en un log PII-free.
    return {
      started: false,
      reason: 'run_creation_unavailable',
      conflictClass,
      postConflictActiveRunFound: null,
    };
  }

  if (activeRun) {
    // Caso A/B del contrato: la carrera la ganó otra autorización y su corrida EXISTE.
    // Aquí «ya hay una revelación en proceso» es una afirmación verificada.
    return {
      started: false,
      reason: 'active_run_exists',
      conflictClass,
      postConflictActiveRunFound: true,
    };
  }

  return {
    started: false,
    reason: conflictClass === 'reservation' ? 'reservation_conflict' : 'create_conflict',
    conflictClass,
    postConflictActiveRunFound: false,
  };
}

/**
 * Resuelve el presupuesto y, en UNA sola operación atómica, RESERVA la exposición
 * máxima de la modalidad Y CREA la corrida (AGENT2A-PHONE-WATERFALL-4E/4F).
 *
 * Dos pasos y no uno, a propósito:
 *
 *   1. La evaluación PURA distingue los tres rechazos con precisión —no alcanza / no hay
 *      presupuesto / no se pudo leer— y evita una RPC cuando ya se sabe que va a fallar.
 *      Es lo que le permite al operador leer el motivo exacto.
 *   2. La operación ATÓMICA es la autoridad. Vuelve a comparar dentro de la transacción,
 *      con la exposición ya reservada por otras autorizaciones incluida, que es lo único
 *      que el paso 1 no puede saber sin condición de carrera — y escribe la corrida en
 *      esa MISMA transacción.
 *
 * QUÉ CAMBIÓ EN 4F. En 4E el paso 2 sólo reservaba, y la corrida se creaba después, en
 * otro viaje. Entre los dos había una ventana en la que la reserva estaba comprometida y
 * la corrida no existía; una caída, una respuesta perdida o un timeout dejaban ahí una
 * huérfana que ninguna compensación iba a recoger. Ahora las dos escrituras son una, y
 * cualquier fallo deshace ambas: NO hay camino en el que quede exposición sin corrida, y
 * por eso ya no hace falta `releaseCredits` ni `attachReservationsToRun` aquí.
 *
 * `already_reserved` se traduce a `active_run_exists`: ese candidato ya tiene exposición
 * viva, así que hay una autorización en curso y no se abre una segunda.
 *
 * EXPORTADA en AGENT2A-SEARCH-MORE-PHONES-1. «Buscar más números» es la tercera modalidad
 * pagada y necesita EXACTAMENTE esta secuencia —evaluación pura, reserva + corrida en una
 * transacción, clave de idempotencia generada antes de la operación—. Reimplementarla
 * habría sido una segunda ruta que puede dejar reservas huérfanas, que es el defecto que 4F
 * cerró. La función no cambia: sólo deja de ser privada.
 */
export async function reserveWaterfallCreditsAndCreateRunOrBlock(args: {
  mode: PhoneRevealCreditBudgetMode;
  candidateId: string;
  authorizedBy: string;
  deps: PhoneRevealWaterfallCreditReservationDeps;
  /** Construye el borrador una vez conocido el grupo de reserva. */
  buildRun: (reservationGroupId: string) => PhoneRevealWaterfallRunDraft;
}): Promise<PhoneRevealWaterfallCreditGate> {
  const { mode, deps } = args;

  const pools = await deps.readCreditPools(
    resolvePhoneRevealCreditBudgetProviders(mode),
  );
  const budget = { model: 'per_provider' as const, pools };
  const verdict = evaluatePhoneRevealCreditBudget({ mode, budget });

  if (verdict.decision === 'insufficient_credits') {
    return { started: false, reason: 'insufficient_credits' };
  }
  if (verdict.decision === 'budget_not_configured') {
    return { started: false, reason: 'budget_not_configured' };
  }
  if (verdict.decision === 'balance_unavailable') {
    return { started: false, reason: 'credit_balance_unavailable' };
  }

  const reservationGroupId = deps.newReservationGroupId();
  const outcome = await deps.reserveCreditsAndCreateRun({
    reservation: {
      candidateId: args.candidateId,
      authorizedBy: args.authorizedBy,
      reservationGroupId,
      // Se genera ANTES de la operación: es la condición para que el reintento de la
      // capa de I/O pueda ser idempotente en vez de una segunda autorización.
      authorizationKey: deps.newAuthorizationKey(),
      legs: buildPhoneRevealCreditReservationLegs({ mode, budget }),
    },
    run: args.buildRun(reservationGroupId),
  });

  switch (outcome.status) {
    case 'created':
      return {
        started: true,
        runId: outcome.runId,
        reservationGroupId: outcome.reservationGroupId,
        idempotentHit: false,
        // Ya vienen en el envoltorio de la transacción: se propagan en vez de re-leerlas.
        reservations: outcome.reservations,
      };
    case 'already_created':
      // El reintento encontró la corrida que la primera llamada ya había creado. No se
      // reservó nada nuevo y no se gastó nada: es la MISMA autorización.
      return {
        started: true,
        runId: outcome.runId,
        reservationGroupId: outcome.reservationGroupId,
        idempotentHit: true,
        // Esta invocación no reservó ninguna pata. Devolver las de la corrida ganadora
        // atribuiría a este golpe una exposición que no creó.
        reservations: [],
      };
    case 'insufficient_credits':
      return { started: false, reason: 'insufficient_credits' };
    case 'budget_not_configured':
      return { started: false, reason: 'budget_not_configured' };
    // Los DOS conflictos de unicidad pasan por la MISMA re-lectura
    // (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1): ninguno de los dos PRUEBA por
    // sí mismo que exista una autorización viva, porque la transacción se deshizo entera
    // y la base puede haber quedado igual que antes del clic.
    case 'already_reserved':
      return resolvePhoneRevealConflictAgainstActiveRun({
        conflictClass: 'reservation',
        candidateId: args.candidateId,
        findActiveRunAfterConflict: deps.findActiveRunAfterConflict,
      });
    case 'create_conflict':
      return resolvePhoneRevealConflictAgainstActiveRun({
        conflictClass: 'run_create',
        candidateId: args.candidateId,
        findActiveRunAfterConflict: deps.findActiveRunAfterConflict,
      });
    case 'unavailable':
      // NO es `credit_balance_unavailable`. El saldo YA se verificó arriba, con éxito;
      // lo que falló es la ESCRITURA atómica (función ausente porque la migración 104
      // no está aplicada, timeout, credenciales…). Decirle al operador que no se pudo
      // verificar su saldo sería describirle un problema que no tuvo. Los dos caminos
      // son igual de fail-closed: 0 corridas, 0 proveedores, 0 créditos.
      return { started: false, reason: 'run_creation_unavailable' };
    default: {
      // Un desenlace nuevo rompe la compilación: decidir si una respuesta inédita de la
      // reserva puede seguir gastando proveedores es una decisión de producto.
      const exhaustive: never = outcome;
      void exhaustive;
      return { started: false, reason: 'run_creation_unavailable' };
    }
  }
}

/**
 * Crea la corrida del waterfall al autorizar el botón. Corre ANTES del START de
 * Apollo, con todos los gates baratos primero: con el flag apagado o un rol no
 * admin no se lee el candidato ni se escribe nada, así que el camino Apollo-only
 * queda exactamente como antes de este hito.
 *
 * NO llama a ningún proveedor y NO gasta créditos: solo registra qué autorizó el
 * operador y hasta cuánto.
 */
export async function startPhoneRevealWaterfall(
  input: StartPhoneRevealWaterfallInput,
  deps: StartPhoneRevealWaterfallDeps,
): Promise<StartPhoneRevealWaterfallResult> {
  if (!deps.flagEnabled) return { started: false, reason: 'feature_disabled' };
  if (!isPhoneRevealWaterfallRoleAuthorized(deps.actor.roleKey)) {
    return { started: false, reason: 'role_not_allowed' };
  }

  const candidateId = cleanText(
    typeof input.candidateId === 'string' ? input.candidateId : null,
  );
  if (!candidateId) return { started: false, reason: 'invalid_candidate' };

  const candidate = await deps.loadCandidate(candidateId);
  if (!candidate) return { started: false, reason: 'candidate_not_found' };

  // Una sola autorización viva por candidato. Si ya hay una, no se abre otra: el
  // reveal Apollo devolverá `already_pending` y el operador no paga dos veces.
  const active = await deps.findActiveRun(candidateId);
  if (active) return { started: false, reason: 'active_run_exists' };

  const lushaLeg = evaluatePhoneRevealWaterfallLushaLeg(candidate);
  // El tope se resuelve con las DOS señales, no con una: si la identidad Lusha ya está
  // persistida el operador autoriza 13, y reservarle 14 le quitaría un crédito de
  // disponibilidad por una búsqueda que esta corrida no puede llegar a ejecutar.
  //
  // Se pasa por `buildPhoneRevealWaterfallAuthorizationPreview` —la MISMA función que
  // alimenta el copy del botón— para que el número que se enseña antes del clic y el
  // que se reserva después sean el mismo por CONSTRUCCIÓN, no por coincidencia
  // (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1).
  const preview = buildPhoneRevealWaterfallAuthorizationPreview(candidate);
  const requiresIdentitySearch = preview.requiresIdentitySearch;
  const maxCreditsAuthorized = preview.maxCredits;

  // TECHO DE LA AUTORIZACIÓN HUMANA (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2).
  //
  // Va AQUÍ y no más abajo por una razón económica, no estética: es el último punto en el
  // que ya se conoce la modalidad REAL y todavía no se ha tocado el presupuesto ni la
  // transacción de reserva. Comparar después de reservar —y liberar— seguiría siendo un
  // gasto autorizado por encima de lo que una persona aprobó, y dejaría una ventana en la
  // que la corrida existe.
  //
  // El caso que lo motiva: la vista previa falló, la UI cayó a su suelo conservador de 8,
  // el operador autorizó 8 y al hacer clic el servidor resuelve 14. Antes se reservaban
  // 14. Ahora no se reserva nada: se corta y se le vuelve a preguntar con el número real.
  const acceptedMaxCredits = normalizePhoneRevealWaterfallAcceptedMaxCredits(
    input.acceptedMaxCredits,
  );
  if (
    !isPhoneRevealWaterfallAuthorizationCeilingHonored({
      requiredMaxCredits: maxCreditsAuthorized,
      acceptedMaxCredits,
    })
  ) {
    return {
      started: false,
      reason: 'authorization_ceiling_mismatch',
      requiredMaxCredits: maxCreditsAuthorized,
      acceptedMaxCredits,
    };
  }

  // PREFLIGHT + RESERVA (AGENT2A-PHONE-WATERFALL-4D/4E). Van justo ANTES del INSERT y
  // DESPUÉS de conocer la modalidad, porque lo exigido depende de ella (Apollo 8 + Lusha
  // 5 con pata Lusha, solo Apollo 8 sin ella). Al eliminarse el modal, este es el último
  // punto en el que se puede parar sin haber escrito nada: si no alcanza, no hay
  // corrida, no hay llamada a Apollo, no hay usage log y no hay créditos.
  const budgetMode = resolvePhoneRevealCreditBudgetMode({
    legacyLushaOnly: false,
    lushaEligible: lushaLeg.eligible,
    lushaIdentityResolved: lushaLeg.eligible && !requiresIdentitySearch,
  });
  // RESERVA Y CORRIDA, en una sola transacción (4F). No hay estado intermedio que
  // compensar: o existen las dos cosas, o no existe ninguna.
  const creditGate = await reserveWaterfallCreditsAndCreateRunOrBlock({
    mode: budgetMode,
    candidateId,
    authorizedBy: deps.actor.internalUserId,
    deps,
    buildRun: (reservationGroupId) => ({
      candidateId,
      status: 'apollo_in_flight',
      // Modalidad EXPLÍCITA aunque sea el default de la columna: el INSERT dice cuál
      // es en vez de dejar que se deduzca (AGENT2A-PHONE-WATERFALL-2).
      runMode: 'full_waterfall',
      authorizedAt: deps.nowIso,
      authorizedBy: deps.actor.internalUserId,
      authorizedByRole: cleanText(deps.actor.roleKey),
      maxCreditsAuthorized,
      apolloAttemptedAt: deps.nowIso,
      lushaEligible: lushaLeg.eligible,
      lushaSkippedReason: lushaLeg.skippedReason,
      // Asociación ATÓMICA con la exposición: va en el INSERT, no en un UPDATE después.
      creditReservationGroupId: reservationGroupId,
    }),
  });
  if (!creditGate.started) return { started: false, reason: creditGate.reason };

  return {
    started: true,
    runId: creditGate.runId,
    maxCreditsAuthorized,
    lushaEligible: lushaLeg.eligible,
    requiresIdentitySearch,
  };
}

// ── Ruta legacy: Apollo ya intentó ANTES de que existiera la tabla ──
// (AGENT2A-PHONE-WATERFALL-2)

/**
 * Estados de `contact_enrichment_candidates.status` que dejan al candidato NO
 * editable. Espejo EXACTO de TERMINAL_CANDIDATE_STATE_VALUES en
 * lusha-phone-fallback-eligibility.ts, que sigue siendo el gate canónico y se
 * ejecuta igual aguas abajo (dentro de `runLushaPhoneFallbackReveal`): esto es un
 * pre-filtro que evita crear una corrida condenada, no un permiso alternativo.
 */
export const PHONE_REVEAL_WATERFALL_LEGACY_TERMINAL_CANDIDATE_STATUSES: readonly string[] =
  ['approved', 'rejected', 'discarded', 'archived'];

/**
 * Evidencia PERSISTIDA que se exige para afirmar "Apollo ya intentó y terminó sin
 * teléfono". Se lee de columnas canónicas del candidato, NUNCA de un texto de UI ni
 * de un contador de intentos.
 *
 * PII-free: ni teléfono, ni nombre, ni email, ni LinkedIn. `hasPhone` es un booleano
 * derivado y `sourceContactId` es un id opaco que nunca se imprime.
 */
export interface PhoneRevealWaterfallLegacyEvidence {
  /** `contact_enrichment_candidates.status` crudo. */
  candidateStatus: string | null;
  /** `phone_reveal_status`: debe ser exactamente `no_phone_found`. */
  phoneRevealStatus: string | null;
  /**
   * `phone_reveal_provider`: debe ser exactamente `apollo`. Es lo que distingue un
   * `no_phone_found` de APOLLO de uno de LUSHA — un `no_phone_found` que ya lo
   * produjo Lusha no autoriza volver a llamar a Lusha.
   */
  phoneRevealProvider: string | null;
  /**
   * `phone_reveal_completed_at`: la marca de que el intento CERRÓ. Un
   * `no_phone_found` sin cierre no es un desenlace terminal fechado, así que no
   * cuenta como evidencia (fail-closed). NO se inventa cuando falta.
   */
  phoneRevealCompletedAt: string | null;
  /** true si el candidato YA tiene teléfono persistido. Nunca el número. */
  hasPhone: boolean;
  source: string | null;
  sourceContactId: string | null;
  /**
   * Identidades provider-native ya persistidas (`contact_provider_identities`,
   * migración 124) (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1).
   *
   * AUSENTE ⇒ ninguna, que es el estado de todo candidato anterior a la 124 y el
   * comportamiento byte-idéntico al anterior a este hito. Nunca se infiere: si la
   * lectura falla, el cargador falla hacia arriba en vez de devolver «ninguna» — decir
   * «ninguna» significaría «hay que pagar una búsqueda» y podría comprar algo que ya
   * teníamos.
   */
  providerIdentities?: readonly ProviderContactIdentityRecord[];
  /**
   * Datos con los que se PODRÍA construir UNA búsqueda de identidad exacta. Ausente ⇒
   * esa vía no se evalúa y la ruta legacy es exactamente la de antes del hito: sin id
   * Lusha propio, no hay pata Lusha. Ninguno de estos datos viaja jamás a un log.
   */
  identitySearchFacts?: LushaIdentitySearchCandidateFacts;
}

/**
 * Por qué la ruta legacy NO aplica. Vocabulario cerrado y PII-free; viaja a la UI y
 * al diagnóstico como código mecánico.
 */
export type PhoneRevealWaterfallLegacyIneligibleReason =
  | 'feature_disabled'
  | 'role_not_allowed'
  | 'invalid_candidate'
  | 'candidate_not_found'
  /** `phone_reveal_status` no es `no_phone_found` (incluye `error`, `requested`, `pending`, null). */
  | 'apollo_not_exhausted'
  /** El `no_phone_found` no lo produjo Apollo (p. ej. lo produjo Lusha), o no hay proveedor registrado. */
  | 'apollo_evidence_missing'
  /** `no_phone_found` sin `phone_reveal_completed_at`: el intento no cerró de forma fechada. */
  | 'apollo_outcome_not_closed'
  | 'existing_phone_present'
  | 'candidate_not_editable'
  | 'missing_lusha_contact_id'
  | 'active_run_exists'
  /**
   * El pozo de Lusha NO cubre los 5 créditos de su pata
   * (AGENT2A-PHONE-WATERFALL-4D/4E). No se creó corrida y no se llamó a Lusha.
   */
  | 'insufficient_credits'
  /**
   * Lusha NO tiene regla de crédito configurada (AGENT2A-PHONE-WATERFALL-4E). No hay
   * disponibilidad contra la que reservar, así que la corrida legacy no arranca.
   */
  | 'budget_not_configured'
  /** El presupuesto no se pudo verificar. Fail-closed: tampoco se creó corrida. */
  | 'credit_balance_unavailable'
  /**
   * El presupuesto SÍ se verificó, pero la escritura atómica de reserva + corrida no se
   * pudo ejecutar (AGENT2A-PHONE-WATERFALL-4F). Fail-closed: 0 corridas, 0 Lusha, 0
   * créditos.
   */
  | 'run_creation_unavailable'
  /**
   * La corrida histórica pertenece al flujo COMPLETO (`full_waterfall`), así que el
   * candidato no es legacy: su caso lo gobierna el waterfall normal, con Apollo
   * incluido. La ruta legacy NO puede usarse para saltárselo.
   */
  | 'incompatible_historical_run'
  /**
   * La corrida legacy anterior YA consiguió teléfono. No hay nada que reautorizar y
   * volver a llamar a Lusha gastaría créditos repitiendo un resultado ya pagado.
   */
  | 'previous_run_revealed_phone'
  /**
   * Chocó el índice único de la CORRIDA y la re-lectura posterior NO encontró ninguna
   * corrida activa (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1). Ya NO significa
   * «hay una autorización viva»: significa que la escritura no pudo completarse y que
   * nadie puede señalar la corrida que lo explicaría. 0 corridas, 0 reservas, 0 Lusha.
   */
  | 'create_conflict'
  /**
   * Chocó el índice único de la RESERVA (`already_reserved`) y la re-lectura posterior
   * NO encontró ninguna corrida activa. Es el caso que motivó este hito: la exposición
   * colisionó, la transacción se deshizo entera —0 corridas y 0 reservas— y al operador
   * se le decía que su candidato ya tenía una revelación en curso. Es infraestructura,
   * no una autorización viva, y nunca vuelve a compartir código con `active_run_exists`.
   */
  | 'reservation_conflict'
  /**
   * AGENT2A-PHONE-REVEAL-4O-F-R2 — bloqueos de la puerta de privacidad evaluada ANTES
   * de reservar (`checkPrivacyGateBeforeReserving`, opcional y sólo cableada por el
   * disparo manual). Vocabulario REUTILIZADO: son los mismos códigos que ya escriben
   * el webhook, el recovery y la pata Lusha del waterfall.
   *
   * En los tres casos: 0 corridas, 0 reservas, 0 llamadas a Lusha, 0 usage-logs, 0
   * créditos. `suppression_check_unavailable` es fail-closed —bloquea igual que un
   * tombstone confirmado— pero se registra distinto: el efecto es el mismo, la
   * afirmación no.
   */
  | 'blocked_suppressed'
  | 'do_not_contact'
  | 'suppression_check_unavailable'
  /**
   * El tope que el operador ACEPTÓ es MENOR que el que esta modalidad legacy exige
   * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1). El caso que lo motiva es
   * exactamente el de la ruta completa: la vista previa dijo 5, la modalidad real
   * resultó 6, y subirla en silencio cobraría un crédito de búsqueda que nadie vio.
   *
   * Se detecta DESPUÉS de conocer la modalidad real y ANTES del preflight de
   * presupuesto y de `reserve_and_create_phone_reveal_run`, así que por construcción:
   * 0 reservas, 0 corridas, 0 llamadas a Lusha, 0 usage-logs y 0 créditos. Y 0
   * llamadas a Apollo, que en esta ruta no se hacen NUNCA.
   */
  | 'authorization_ceiling_mismatch';

export interface PhoneRevealWaterfallLegacyEligibility {
  eligible: boolean;
  reason: PhoneRevealWaterfallLegacyIneligibleReason | null;
  /**
   * true cuando la pata Lusha es alcanzable pero exige PAGAR antes una búsqueda de
   * identidad (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1). Es la señal que
   * separa un tope de 6 de uno de 5, y se resuelve en la MISMA evaluación que la
   * elegibilidad porque preguntarlo más tarde significaría decidir el tope después de
   * habérselo enseñado al operador.
   *
   * OPCIONAL para que un caller anterior al hito compile sin cambios; su ausencia se
   * lee como `false`.
   */
  requiresIdentitySearch?: boolean;
}

// ── Clasificación del historial de corridas (reautorización) ────
// (AGENT2A-PHONE-WATERFALL-2C)

/**
 * Proyección MÍNIMA para clasificar el historial. La cumplen tanto la fila completa
 * (`PhoneRevealWaterfallRunRecord`) como la vista de auditoría que consume la UI
 * (`PhoneRevealWaterfallAuditView`), así que servidor y cliente clasifican con la
 * MISMA función sobre la MISMA fila (las dos leen
 * `findLatestWaterfallRunForCandidate`) y no puede haber un botón que ofrezca lo que
 * el servidor rechaza, ni al contrario.
 */
export interface PhoneRevealWaterfallHistoricalRun {
  status: PhoneRevealWaterfallStatus;
  runMode: PhoneRevealWaterfallRunMode;
  lushaOutcome: PhoneRevealWaterfallLushaOutcome | null;
  finalProvider: PhoneRevealWaterfallFinalProvider | null;
}

/** Por qué el historial permite (o no) una autorización legacy NUEVA. */
export type PhoneRevealWaterfallLegacyHistoryVerdict =
  | {
      reauthorizable: true;
      /** `no_previous_run` = primera vez; `terminal_legacy_run` = reautorización. */
      basis: 'no_previous_run' | 'terminal_legacy_run';
    }
  | {
      reauthorizable: false;
      reason: Extract<
        PhoneRevealWaterfallLegacyIneligibleReason,
        'active_run_exists' | 'incompatible_historical_run' | 'previous_run_revealed_phone'
      >;
    };

/**
 * ¿Permite el historial una autorización legacy NUEVA? Clasifica la corrida MÁS
 * RECIENTE del candidato en las cuatro clases que el contrato distingue, en vez de
 * rechazar por el simple hecho de que exista historial:
 *
 *   1. NO hay corrida               ⇒ primera autorización legacy.
 *   2. corrida NO terminal          ⇒ `active_run_exists`. Ya hay una autorización
 *      viva: se usa esa o se espera su cierre. Nunca se abre una segunda en paralelo
 *      (el índice único parcial lo garantiza además a nivel de escritura).
 *   3. corrida terminal `full_waterfall` ⇒ `incompatible_historical_run`. El
 *      candidato pertenece al flujo completo; una corrida suya NO lo convierte en
 *      legacy y la ruta legacy no es una vía para saltarse Apollo.
 *   4. corrida terminal `legacy_lusha_only`:
 *        * si YA reveló teléfono   ⇒ `previous_run_revealed_phone` (nada que
 *          reautorizar; repetir Lusha pagaría dos veces la misma respuesta);
 *        * si NO reveló            ⇒ REAUTORIZABLE. Cubre `no_phone_found`, error de
 *          Lusha, `suppressed`, `suppression_check_unavailable`, autorización vencida
 *          y cualquier otro cierre sin teléfono. Cada reautorización es una corrida
 *          NUEVA: id nuevo, `authorized_at` nuevo, tope 5 otra vez y TODOS los gates
 *          revalidados — incluida la comprobación de supresión/DNC, que se ejecuta de
 *          cero. El veredicto de privacidad anterior NUNCA se reutiliza como permiso.
 *
 * Por qué basta con la corrida MÁS RECIENTE y no hace falta escanear el historial
 * completo: una corrida legacy solo puede crearse cuando la más reciente es nula o es
 * legacy terminal, así que por inducción "la más reciente es legacy" implica que TODAS
 * lo son. Y si en algún momento se añade una `full_waterfall` (el START de Apollo no
 * consulta el historial, solo la corrida activa), pasa a ser la más reciente y cierra
 * la ruta legacy desde ese momento — que es exactamente el efecto que exige el punto 3.
 *
 * PURA y sin I/O: recibe la fila ya leída.
 */
export function classifyPhoneRevealWaterfallLegacyHistory(
  latestRun: PhoneRevealWaterfallHistoricalRun | null,
): PhoneRevealWaterfallLegacyHistoryVerdict {
  if (!latestRun) return { reauthorizable: true, basis: 'no_previous_run' };

  if (!PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES.includes(latestRun.status)) {
    return { reauthorizable: false, reason: 'active_run_exists' };
  }

  if (latestRun.runMode !== 'legacy_lusha_only') {
    return { reauthorizable: false, reason: 'incompatible_historical_run' };
  }

  // "Ya consiguió teléfono" se comprueba por TRES señales independientes y basta una:
  // el desenlace de Lusha, el proveedor final y el propio status de cierre. Son
  // redundantes por diseño — una fila anómala en la que solo una de las tres lo diga
  // debe bloquear igual, porque el error caro es cobrar de nuevo un teléfono ya pagado.
  if (
    latestRun.lushaOutcome === 'revealed' ||
    latestRun.finalProvider === 'lusha' ||
    latestRun.finalProvider === 'apollo' ||
    latestRun.status === 'completed_lusha' ||
    latestRun.status === 'completed_apollo'
  ) {
    return { reauthorizable: false, reason: 'previous_run_revealed_phone' };
  }

  return { reauthorizable: true, basis: 'terminal_legacy_run' };
}

/**
 * ¿Este candidato entra en la ruta legacy? PURA, sin I/O, y fail-closed en todas las
 * ramas: cualquier duda sobre la evidencia devuelve NO elegible.
 *
 * La evidencia canónica es la TERNA `phone_reveal_status = 'no_phone_found'` +
 * `phone_reveal_provider = 'apollo'` + `phone_reveal_completed_at IS NOT NULL`, que
 * es exactamente lo que escriben los tres caminos terminales de Apollo (el webhook
 * en phone-reveal-webhook-core.ts y el recovery en phone-reveal-recovery-core.ts
 * persisten los tres campos juntos). Se exigen los TRES:
 *
 *   * `no_phone_found` solo — no distingue proveedor: el fallback manual de Lusha
 *     escribe el MISMO status con `phone_reveal_provider = 'lusha'`, y volver a
 *     llamar a Lusha sobre su propio `no_phone_found` gastaría créditos repitiendo
 *     una respuesta ya conocida;
 *   * `provider = 'apollo'` solo — no dice que el intento terminara: un candidato en
 *     vuelo también lleva provider apollo;
 *   * `completed_at` solo — no dice CÓMO terminó.
 *
 * Un `phone_reveal_status = 'error'` NO es evidencia: un fallo técnico no significa
 * "no existe teléfono", y el camino correcto ahí es reintentar Apollo, no excusarlo.
 *
 * `phone_reveal_attempt_count` NO se usa: es un contador que también sube en
 * caminos de error, así que no afirma un desenlace.
 */
export function evaluatePhoneRevealWaterfallLegacyEligibility(
  evidence: PhoneRevealWaterfallLegacyEvidence,
  /**
   * ¿Esta autorización puede cubrir una búsqueda de identidad PAGADA?
   * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1)
   *
   * AUSENTE ⇒ `false`, y ese default es el contrato: la ruta legacy existía antes de
   * este hito reservando UNA pata de teléfono y ningún crédito de búsqueda, así que
   * todo caller que no diga nada sigue obteniendo EXACTAMENTE ese veredicto. La vía de
   * pago sólo existe cuando alguien la enciende explícitamente.
   */
  options?: { identitySearchAuthorized?: boolean },
): PhoneRevealWaterfallLegacyEligibility {
  if (cleanText(evidence.phoneRevealStatus) !== 'no_phone_found') {
    return { eligible: false, reason: 'apollo_not_exhausted' };
  }
  if (cleanText(evidence.phoneRevealProvider) !== 'apollo') {
    return { eligible: false, reason: 'apollo_evidence_missing' };
  }
  if (!cleanText(evidence.phoneRevealCompletedAt)) {
    return { eligible: false, reason: 'apollo_outcome_not_closed' };
  }
  if (evidence.hasPhone) {
    return { eligible: false, reason: 'existing_phone_present' };
  }
  const candidateStatus = cleanText(evidence.candidateStatus);
  if (
    candidateStatus !== null &&
    PHONE_REVEAL_WATERFALL_LEGACY_TERMINAL_CANDIDATE_STATUSES.includes(candidateStatus)
  ) {
    return { eligible: false, reason: 'candidate_not_editable' };
  }
  // Sin id Lusha propio —ni identidad persistida, ni identificador exacto con el que
  // comprarla— la pata Lusha no existe, así que autorizar créditos sería pedir permiso
  // para una llamada que estructuralmente no puede ocurrir.
  //
  // La vía PAGADA se pasa tal cual: cuando no está autorizada, el veredicto vuelve a
  // ser el de antes del hito, y es el veredicto VERDADERO para esa autorización.
  const lushaLeg = evaluatePhoneRevealWaterfallLushaLeg(evidence, {
    identitySearchAuthorized: options?.identitySearchAuthorized === true,
  });
  if (!lushaLeg.eligible) {
    return {
      eligible: false,
      reason: 'missing_lusha_contact_id',
      requiresIdentitySearch: false,
    };
  }
  return {
    eligible: true,
    reason: null,
    requiresIdentitySearch: lushaLeg.requiresIdentitySearch === true,
  };
}

/**
 * Vista previa de la autorización LEGACY, ANTES del clic
 * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1).
 *
 * Gemela de `buildPhoneRevealWaterfallAuthorizationPreview` y por la misma razón: ES la
 * función que usa el ARRANQUE legacy, así que es la que debe usar la UI para su copy.
 * Mientras las dos llamen aquí, el botón no puede prometer 5 donde el servidor va a
 * reservar 6, ni ofrecer 6 donde la búsqueda no se puede ejecutar.
 *
 * PII-free por construcción: un booleano, un código mecánico y dos enteros. No decide
 * permisos y no lee nada — la evidencia llega ya cargada.
 */
export interface LegacyPhoneRevealAuthorizationPreview {
  /** ¿La ruta legacy aplica a este candidato bajo esta autorización? */
  eligible: boolean;
  /** Código mecánico cuando NO aplica. null cuando sí. */
  reason: PhoneRevealWaterfallLegacyIneligibleReason | null;
  /** ¿Alcanzar a Lusha exige pagar antes una búsqueda de identidad? */
  requiresIdentitySearch: boolean;
  /** Tope que el operador debe aceptar: 5 o 6. Jamás 8, 13 ni 14. */
  maxCredits: number;
}

export function buildLegacyPhoneRevealAuthorizationPreview(
  evidence: PhoneRevealWaterfallLegacyEvidence,
  options?: { identitySearchAuthorized?: boolean },
): LegacyPhoneRevealAuthorizationPreview {
  const eligibility = evaluatePhoneRevealWaterfallLegacyEligibility(evidence, options);
  const requiresIdentitySearch = eligibility.requiresIdentitySearch === true;
  return {
    eligible: eligibility.eligible,
    reason: eligibility.reason,
    requiresIdentitySearch,
    maxCredits: resolveLegacyPhoneRevealMaxCredits(requiresIdentitySearch),
  };
}

export interface StartLegacyPhoneRevealWaterfallInput {
  candidateId: string;
  /**
   * Tope de créditos que el operador ACEPTÓ en la UI, tal cual llegó del cliente
   * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1).
   *
   * Mismo contrato que en el arranque completo, con el suelo de ESTA ruta: ausente o no
   * finito ⇒ `PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS` (5), NUNCA la modalidad
   * requerida. Un cliente que no manda el tope no puede acabar comprando la búsqueda
   * de identidad por omisión: en el peor caso se le vuelve a preguntar.
   */
  acceptedMaxCredits?: number;
}

export interface StartLegacyPhoneRevealWaterfallDeps
  extends PhoneRevealWaterfallCreditReservationDeps {
  /** ENABLE_PHONE_REVEAL_WATERFALL ya resuelto por el wrapper. */
  flagEnabled: boolean;
  actor: { internalUserId: string; roleKey: string | null };
  nowIso: string;
  /** Evidencia persistida del intento Apollo histórico. */
  loadLegacyEvidence: (
    candidateId: string,
  ) => Promise<PhoneRevealWaterfallLegacyEvidence | null>;
  /** Corrida NO terminal existente (índice único parcial de la migración 102). */
  findActiveRun: (
    candidateId: string,
  ) => Promise<PhoneRevealWaterfallRunRecord | null>;
  /**
   * Corrida MÁS RECIENTE del candidato, terminal o no. Su CLASE decide, vía
   * `classifyPhoneRevealWaterfallLegacyHistory`, si cabe una autorización nueva: una
   * corrida activa bloquea, una `full_waterfall` bloquea, y una legacy terminal que no
   * consiguió teléfono es REAUTORIZABLE (AGENT2A-PHONE-WATERFALL-2C). Su mera
   * existencia NO bloquea.
   */
  findLatestRun: (
    candidateId: string,
  ) => Promise<PhoneRevealWaterfallRunRecord | null>;
  /**
   * AGENT2A-PHONE-REVEAL-4O-F-R2 — puerta de privacidad ANTES DE RESERVAR. OPCIONAL.
   *
   * OMITIDA (defecto) = comportamiento byte-idéntico al anterior: la server action
   * legacy no la cablea, y la re-comprobación de supresión/DNC sigue ocurriendo donde
   * ya ocurría, en `continuePhoneRevealWaterfall`, justo antes de llamar a Lusha.
   *
   * PRESENTE = el disparo manual, que la cablea para cumplir el orden exigido
   * `auth → elegibilidad → DNC → supresión → RESERVA → proveedor`. Sin ella, un
   * candidato ya bloqueado GRATIS consumiría el camino caro: crear una corrida,
   * reservar 5 créditos, cerrar sin llamar a nadie y liberar. El efecto económico neto
   * era ya 0 —la liquidación libera la pata no intentada— pero se escribían una corrida
   * y una reserva innecesarias, y durante ese intervalo la exposición quedaba ocupada
   * contra el pozo de Lusha. Gatear aquí lo reduce a 0 escrituras.
   *
   * Fail-closed: cualquier estado distinto de `clear` bloquea, y un fallo de LECTURA
   * bloquea igual (se traduce a `check_unavailable` por el llamador). No se degrada a
   * "adelante".
   *
   * NO sustituye a la puerta de `continuePhoneRevealWaterfall`: esa sigue corriendo
   * después, sobre el estado ya reservado, y es la que protege la ventana entre la
   * reserva y la llamada.
   */
  checkPrivacyGateBeforeReserving?: (
    candidateId: string,
  ) => Promise<PhoneRevealWaterfallSuppressionState>;
  /**
   * ¿Esta ruta puede COMPRAR la identidad Lusha que le falta al candidato?
   * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1)
   *
   * AUSENTE ⇒ `false`, y con eso el arranque legacy es byte-idéntico al anterior al
   * hito: un candidato sin id Lusha propio sale `missing_lusha_contact_id`, el tope
   * sigue siendo 5 y no se reserva ningún crédito de búsqueda.
   *
   * `true` sólo lo pasa el cableado que además carga los hechos de identidad y cuya UI
   * enseña el tope de 6. No es un flag de producto nuevo: es la forma de que UNA de las
   * dos entradas a esta ruta (la server action del waterfall) gane la capacidad sin que
   * la otra (el disparo manual `legacy_lusha_only`, cuya autorización reserva 5 y cuyo
   * copy dice 5) la herede por accidente.
   */
  identitySearchAllowed?: boolean;
}

/**
 * Clase del historial de corridas, como ENUM cerrado y PII-free
 * (AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1).
 *
 * Es el veredicto de `classifyPhoneRevealWaterfallLegacyHistory` aplanado a un literal:
 * las dos bases reautorizables y los tres bloqueos. Sirve para el diagnóstico sin
 * exponer la fila, el id de la corrida ni ninguna fecha.
 */
export type PhoneRevealWaterfallLegacyHistoryClassification =
  | 'no_previous_run'
  | 'terminal_legacy_run'
  | 'active_run_exists'
  | 'incompatible_historical_run'
  | 'previous_run_revealed_phone';

/**
 * Lo que el arranque legacy OBSERVÓ, en booleanos, enteros y literales cerrados
 * (AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1).
 *
 * POR QUÉ EXISTE: un rechazo de esta ruta se veía en Producción como una sola frase
 * genérica, y desde fuera del proceso era indistinguible qué puerta lo produjo — un
 * hecho de privacidad, una corrida viva, el techo humano o una lectura que falló. Estos
 * hechos sólo existen DENTRO del core, así que si el core no los devuelve nadie puede
 * reconstruirlos después sin inventarlos.
 *
 * `null` significa SIEMPRE «no se llegó a evaluar», nunca «salió que no»: la diferencia
 * es justo lo que hace útil el registro.
 *
 * PII-free por CONSTRUCCIÓN: el tipo no admite texto libre, así que no hay ninguna clave
 * por la que pudiera colarse un nombre, un correo, un LinkedIn, un teléfono o un id
 * nativo de proveedor.
 */
export interface LegacyPhoneRevealStartDiagnostics {
  /** `ENABLE_PHONE_REVEAL_WATERFALL` tal y como lo resolvió el wrapper. */
  outerFlagEnabled: boolean;
  roleAuthorized: boolean;
  /** ¿Esta entrada podía COMPRAR la identidad Lusha que falta? */
  identitySearchAllowed: boolean;
  /** Modalidad REAL resuelta por la vista previa. `null` si no se llegó a resolver. */
  requiresIdentitySearch: boolean | null;
  /** Veredicto de la puerta de privacidad previa a la reserva. `null` si no corrió. */
  privacyState: PhoneRevealWaterfallSuppressionState | null;
  /** ¿Había una corrida VIVA? `null` si no se llegó a consultar. */
  activeRunFound: boolean | null;
  historyClassification: PhoneRevealWaterfallLegacyHistoryClassification | null;
  /**
   * ¿La escritura atómica chocó contra un índice único?
   * (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1). `null` = no se llegó a intentar.
   *
   * Separado de `activeRunFound` A PROPÓSITO: la contradicción que hizo indiagnosticable
   * el incidente era precisamente un evento con `active_run_found = false` y
   * `reason = active_run_exists`. Con los dos campos, un conflicto se lee como lo que es
   * —una colisión de escritura— sin tener que deducirlo del motivo final.
   */
  atomicCreateConflict: boolean | null;
  /** QUÉ chocó. `null` = no hubo conflicto de unicidad. */
  conflictClass: PhoneRevealWaterfallConflictClass | null;
  /**
   * Qué respondió la re-lectura POSTERIOR al conflicto. `null` = no se llegó a consultar
   * (sin conflicto, sin dep, o la lectura falló). `false` = se consultó y NO había
   * corrida: es la prueba de que el conflicto no era una revelación en curso.
   */
  postConflictActiveRunFound: boolean | null;
}

export type StartLegacyPhoneRevealWaterfallResult =
  | {
      started: true;
      runId: string;
      maxCreditsAuthorized: number;
      /**
       * Hechos observados, PII-free. Obligatorio en las DOS ramas: el desenlace sin
       * diagnóstico es exactamente lo que dejó a Producción sin forma de saber qué
       * puerta actuó (AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1).
       */
      diagnostics: LegacyPhoneRevealStartDiagnostics;
      /**
       * true cuando el tope autorizado incluye la búsqueda de identidad de Lusha (6 en
       * vez de 5). Lo consume el copy para desglosar «búsqueda hasta 1 + teléfono hasta
       * 5» en vez de enseñar un 6 sin explicar.
       */
      requiresIdentitySearch?: boolean;
    }
  | {
      started: false;
      reason: PhoneRevealWaterfallLegacyIneligibleReason;
      /** Ver la rama de éxito: el diagnóstico no es opcional en un rechazo. */
      diagnostics: LegacyPhoneRevealStartDiagnostics;
      /**
       * Solo en `authorization_ceiling_mismatch`: qué exigía la modalidad real y qué
       * había aceptado el operador. Dos enteros, PII-free, para que el wrapper pueda
       * volver a pedir la confirmación con el número correcto sin re-resolver nada.
       */
      requiredMaxCredits?: number;
      acceptedMaxCredits?: number;
    };

/**
 * Crea la corrida `legacy_lusha_only`. Es la operación EXPLÍCITA de la ruta legacy:
 * comparte el store, el claim, el TTL y la re-comprobación de supresión con el
 * waterfall normal, pero NO tiene ninguna fase que llame a Apollo.
 *
 * Orden barato→caro y fail-closed: con el flag apagado o un rol no admin no se lee
 * el candidato ni se escribe nada.
 *
 * La corrida nace en `lusha_pending` con:
 *   * `run_mode = 'legacy_lusha_only'`  (modalidad explícita, nunca inferida)
 *   * `apollo_attempted_at = null`      (Apollo NO corre aquí; no se falsifica)
 *   * `apollo_outcome = 'no_phone_found'` (transcripción del desenlace histórico)
 *   * `apollo_cost_credits = null` + `apollo_cost_source = 'unknown'`
 *   * `max_credits_authorized = 5` (identidad Lusha ya conocida) o `6` (hay que
 *     comprarla: búsqueda 1 + teléfono 5). JAMÁS 8, 13 ni 14 — los 8 de Apollo
 *     pertenecen a la autorización histórica que ya los pagó.
 *
 * NO llama a ningún proveedor y NO gasta créditos: solo registra la autorización.
 */
export async function startLegacyPhoneRevealWaterfall(
  input: StartLegacyPhoneRevealWaterfallInput,
  deps: StartLegacyPhoneRevealWaterfallDeps,
): Promise<StartLegacyPhoneRevealWaterfallResult> {
  // Diagnóstico PII-free acumulado por CONSTRUCCIÓN: cada salida se lleva SÓLO los
  // hechos que a esa altura ya se habían observado, y el resto viaja `null` — «no se
  // evaluó», que es distinto de «salió que no»
  // (AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1). No se muta nada: cada `diag()`
  // construye un objeto nuevo.
  const identitySearchAllowed = deps.identitySearchAllowed === true;
  const diag = (
    patch: Partial<LegacyPhoneRevealStartDiagnostics> = {},
  ): LegacyPhoneRevealStartDiagnostics => ({
    outerFlagEnabled: deps.flagEnabled,
    roleAuthorized: isPhoneRevealWaterfallRoleAuthorized(deps.actor.roleKey),
    identitySearchAllowed,
    requiresIdentitySearch: null,
    privacyState: null,
    activeRunFound: null,
    historyClassification: null,
    atomicCreateConflict: null,
    conflictClass: null,
    postConflictActiveRunFound: null,
    ...patch,
  });

  if (!deps.flagEnabled) {
    return { started: false, reason: 'feature_disabled', diagnostics: diag() };
  }
  if (!isPhoneRevealWaterfallRoleAuthorized(deps.actor.roleKey)) {
    return { started: false, reason: 'role_not_allowed', diagnostics: diag() };
  }

  const candidateId = cleanText(
    typeof input.candidateId === 'string' ? input.candidateId : null,
  );
  if (!candidateId) {
    return { started: false, reason: 'invalid_candidate', diagnostics: diag() };
  }

  const evidence = await deps.loadLegacyEvidence(candidateId);
  if (!evidence) {
    return { started: false, reason: 'candidate_not_found', diagnostics: diag() };
  }

  // La modalidad se resuelve por la MISMA función que alimenta el copy del botón
  // (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1), así que el número que se
  // enseña antes del clic y el que se reserva después son el mismo por CONSTRUCCIÓN.
  const preview = buildLegacyPhoneRevealAuthorizationPreview(evidence, {
    identitySearchAuthorized: identitySearchAllowed,
  });
  if (!preview.eligible) {
    return {
      started: false,
      reason: preview.reason ?? 'apollo_evidence_missing',
      diagnostics: diag({ requiresIdentitySearch: preview.requiresIdentitySearch }),
    };
  }
  const requiresIdentitySearch = preview.requiresIdentitySearch;
  const maxCreditsAuthorized = preview.maxCredits;

  // Una sola autorización viva por candidato (índice único parcial).
  const active = await deps.findActiveRun(candidateId);
  if (active) {
    return {
      started: false,
      reason: 'active_run_exists',
      diagnostics: diag({
        requiresIdentitySearch,
        activeRunFound: true,
        historyClassification: 'active_run_exists',
      }),
    };
  }

  // El historial se CLASIFICA, no se cuenta (AGENT2A-PHONE-WATERFALL-2C): una corrida
  // legacy terminal que no consiguió teléfono admite una autorización NUEVA, mientras
  // que una corrida del flujo completo — o una que ya reveló — la cierra.
  const historyVerdict = classifyPhoneRevealWaterfallLegacyHistory(
    await deps.findLatestRun(candidateId),
  );
  if (!historyVerdict.reauthorizable) {
    return {
      started: false,
      reason: historyVerdict.reason,
      diagnostics: diag({
        requiresIdentitySearch,
        activeRunFound: false,
        historyClassification: historyVerdict.reason,
      }),
    };
  }
  // A partir de aquí el historial ya está clasificado, así que viaja en TODAS las
  // salidas restantes.
  const observed = {
    requiresIdentitySearch,
    activeRunFound: false,
    historyClassification: historyVerdict.basis,
  } as const;

  // TECHO DE LA AUTORIZACIÓN HUMANA, también aquí
  // (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1).
  //
  // Va DESPUÉS de conocer la modalidad real y ANTES de la puerta de privacidad, del
  // preflight de presupuesto y de `reserve_and_create_phone_reveal_run` — es decir,
  // antes del primer paso que escribe o que lee a un proveedor. El caso que lo motiva
  // es el mismo que en la ruta completa: la vista previa dijo 5, entre el render y el
  // clic la modalidad real pasó a 6, y sin este corte se reservaría un crédito de
  // búsqueda que el operador nunca vio. No se sube el tope en silencio y no se
  // reintenta: una autorización humana obsoleta se vuelve a pedir.
  const acceptedMaxCredits = normalizeLegacyPhoneRevealAcceptedMaxCredits(
    input.acceptedMaxCredits,
  );
  if (
    !isPhoneRevealWaterfallAuthorizationCeilingHonored({
      requiredMaxCredits: maxCreditsAuthorized,
      acceptedMaxCredits,
    })
  ) {
    return {
      started: false,
      reason: 'authorization_ceiling_mismatch',
      diagnostics: diag(observed),
      requiredMaxCredits: maxCreditsAuthorized,
      acceptedMaxCredits,
    };
  }

  // PRIVACIDAD ANTES DE RESERVAR (AGENT2A-PHONE-REVEAL-4O-F-R2). Opcional: sólo el
  // disparo manual la cablea. Va DESPUÉS de los gates puros y de las dos lecturas de
  // corrida —que son baratas y ya ocurrían— y ANTES del preflight de presupuesto, que
  // es el primer paso que escribe. Un candidato bloqueado se para aquí con 0 corridas,
  // 0 reservas y 0 créditos, en vez de reservar exposición para liberarla acto seguido.
  //
  // Fail-closed en las TRES ramas. La puerta posterior de `continuePhoneRevealWaterfall`
  // NO se sustituye: sigue corriendo sobre la corrida ya creada, y es la que cubre la
  // ventana entre la reserva y la llamada al proveedor.
  let privacyState: PhoneRevealWaterfallSuppressionState | null = null;
  if (deps.checkPrivacyGateBeforeReserving) {
    const privacy = await deps.checkPrivacyGateBeforeReserving(candidateId);
    if (privacy !== 'clear') {
      return {
        started: false,
        reason:
          privacy === 'blocked_suppressed'
            ? 'blocked_suppressed'
            : privacy === 'do_not_contact'
              ? 'do_not_contact'
              : 'suppression_check_unavailable',
        diagnostics: diag({ ...observed, privacyState: privacy }),
      };
    }
    privacyState = privacy;
  }

  // PREFLIGHT + RESERVA (AGENT2A-PHONE-WATERFALL-4D/4E). Solo se exige y solo se reserva
  // la pata LUSHA (5): Apollo no se ejecuta bajo esta autorización, así que bloquear —o
  // reservar— por su pozo sería hacerlo por un proveedor que no va a correr. Se hace
  // ANTES del INSERT: sin exposición reservada no hay corrida nueva, no hay llamada a
  // Lusha, no hay usage log y no hay créditos.
  const creditGate = await reserveWaterfallCreditsAndCreateRunOrBlock({
    // La modalidad económica distingue las DOS formas de la ruta legacy: con identidad
    // ya conocida se reserva UNA pata de teléfono (5); sin ella se reservan DOS patas
    // de Lusha —búsqueda 1 + teléfono 5— contra el MISMO pozo. Apollo no aparece en
    // ninguna de las dos: no se ejecuta bajo esta autorización, así que ni se lee su
    // presupuesto ni se le ocupa exposición.
    mode: resolvePhoneRevealCreditBudgetMode({
      legacyLushaOnly: true,
      lushaEligible: true,
      lushaIdentityResolved: !requiresIdentitySearch,
    }),
    candidateId,
    authorizedBy: deps.actor.internalUserId,
    deps,
    buildRun: (reservationGroupId) => ({
      candidateId,
      status: 'lusha_pending',
      runMode: 'legacy_lusha_only',
      authorizedAt: deps.nowIso,
      authorizedBy: deps.actor.internalUserId,
      authorizedByRole: cleanText(deps.actor.roleKey),
      maxCreditsAuthorized,
      // Apollo NO se ejecuta bajo esta autorización: sin timestamp inventado.
      apolloAttemptedAt: null,
      // Transcripción del desenlace histórico, sin re-atribuir su costo.
      apolloOutcome: 'no_phone_found',
      apolloCostSource: 'unknown',
      lushaEligible: true,
      lushaSkippedReason: null,
      creditReservationGroupId: reservationGroupId,
    }),
  });
  if (!creditGate.started) {
    // Lo que el gate OBSERVÓ del conflicto viaja tal cual
    // (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1): sin estos tres campos el
    // evento no podía distinguir «había una corrida» de «chocó algo y no había ninguna»,
    // que es exactamente la ambigüedad que hizo indiagnosticable el incidente.
    const conflictClass = creditGate.conflictClass ?? null;
    return {
      started: false,
      reason: creditGate.reason,
      diagnostics: diag({
        ...observed,
        privacyState,
        atomicCreateConflict: conflictClass !== null,
        conflictClass,
        postConflictActiveRunFound: creditGate.postConflictActiveRunFound ?? null,
      }),
    };
  }

  return {
    started: true,
    runId: creditGate.runId,
    maxCreditsAuthorized,
    requiresIdentitySearch,
    // La corrida se creó: por construcción no hubo conflicto que resolver.
    diagnostics: diag({ ...observed, privacyState, atomicCreateConflict: false }),
  };
}

// ── Reconciliación del START de Apollo con la corrida ──────────

/** Patch de cierre/actualización de la corrida. Describe el UPDATE. */
export interface PhoneRevealWaterfallRunPatch {
  status?: PhoneRevealWaterfallStatus;
  apolloOutcome?: PhoneRevealWaterfallApolloOutcome;
  apolloCostCredits?: number | null;
  apolloCostSource?: PhoneRevealWaterfallCostSource;
  lushaOutcome?: PhoneRevealWaterfallLushaOutcome;
  lushaCostCredits?: number | null;
  lushaCostSource?: PhoneRevealWaterfallCostSource;
  lushaSkippedReason?: PhoneRevealWaterfallLushaSkippedReason | null;
  finalProvider?: PhoneRevealWaterfallFinalProvider;
  completedAt?: string | null;
  errorCode?: string | null;
}

/**
 * Cierre por comprobación de supresión/DNC NO VERIFICABLE. Se usa en los TRES
 * puntos donde puede ocurrir (START de Apollo, desenlace terminal de Apollo y
 * re-comprobación previa a Lusha) para que el registro sea idéntico en los tres.
 *
 * Propiedades del cierre:
 *   * `lusha_skipped_reason = 'suppression_check_unavailable'`, NUNCA `suppressed`:
 *     el motivo específico queda DIRECTAMENTE consultable en su columna, sin
 *     obligar a leer `error_code` ni metadata secundaria para distinguirlo.
 *   * `status = 'error'`, que es TERMINAL: la corrida no queda en los estados del
 *     índice único parcial, así que no bloquea una autorización futura, y no queda
 *     nada vivo que un disparador posterior (webhook, cron L2, revisión L3) pueda
 *     retomar ⇒ no hay reintento automático de Lusha con esta autorización.
 *   * el costo de Lusha se sella `null` + `unknown`: Lusha no se ejecutó y un costo
 *     desconocido JAMÁS se representa como 0. Que la pata no corrió lo dice
 *     `lusha_attempted_at IS NULL`, no la columna de costo.
 *   * el candidato NO se toca aquí (este core solo describe la corrida).
 */
function suppressionCheckUnavailablePatch(
  nowIso: string,
): PhoneRevealWaterfallRunPatch {
  return {
    status: 'error',
    lushaSkippedReason: 'suppression_check_unavailable',
    lushaCostCredits: null,
    lushaCostSource: 'unknown',
    finalProvider: 'none',
    completedAt: nowIso,
    errorCode: 'suppression_check_unavailable',
  };
}

/**
 * Traduce el status que devolvió el START de Apollo
 * (`RevealCandidatePhoneStatus`) al patch de la corrida. Se recibe como string
 * a propósito: mantiene este core sin importar el core de Apollo, y cualquier
 * status nuevo cae en el `default` conservador (abortar registrando el código)
 * en vez de dejar una corrida colgada.
 *
 * `null` significa "no toques la corrida": el reveal quedó en vuelo y lo cerrará
 * el webhook o el recovery.
 */
export function mapApolloStartStatusToWaterfallPatch(
  apolloStartStatus: string,
  nowIso: string,
): PhoneRevealWaterfallRunPatch | null {
  switch (apolloStartStatus) {
    // Camino feliz del START asíncrono: la corrida sigue en vuelo.
    case 'requested':
      return null;

    // Teléfono servido desde un reveal ya pagado: terminal e inmediato, sin
    // webhook y sin 2ª pata (ya hay número que revelar sería redundante).
    case 'revealed_from_cache':
      return {
        status: 'completed_apollo',
        apolloOutcome: 'revealed_from_cache',
        // Un hit de caché no cobra créditos nuevos, y eso SÍ está reportado.
        apolloCostCredits: 0,
        apolloCostSource: 'reported',
        finalProvider: 'apollo',
        lushaSkippedReason: 'apollo_revealed',
        completedAt: nowIso,
        errorCode: null,
      };

    // Supresión registrada (DSAR): la corrida se cierra SIN gastar la 2ª pata.
    case 'blocked_suppressed':
      return {
        status: 'aborted',
        apolloOutcome: 'blocked_suppressed',
        lushaSkippedReason: 'suppressed',
        finalProvider: 'none',
        completedAt: nowIso,
        errorCode: 'blocked_suppressed',
      };

    // La supresión NO se pudo verificar. Fail-closed en el EFECTO (la pata Lusha
    // no se gasta) pero NO en el registro: se anota como
    // `suppression_check_unavailable`, no como `suppressed`, porque no se sabe si
    // el candidato está suprimido — solo que no se pudo comprobar.
    case 'suppression_check_unavailable':
      return {
        apolloOutcome: 'suppression_check_unavailable',
        ...suppressionCheckUnavailablePatch(nowIso),
      };

    case 'cache_unavailable':
      return {
        status: 'error',
        apolloOutcome: 'cache_unavailable',
        lushaSkippedReason: 'provider_error',
        finalProvider: 'none',
        completedAt: nowIso,
        errorCode: 'cache_unavailable',
      };

    case 'do_not_contact':
      return {
        status: 'aborted',
        apolloOutcome: 'do_not_contact',
        lushaSkippedReason: 'dnc',
        finalProvider: 'none',
        completedAt: nowIso,
        errorCode: 'do_not_contact',
      };

    // Gates del START que impidieron siquiera intentar Apollo (rol, costo,
    // re-reveal, identidad insuficiente, flag, error real de Apollo…). La
    // corrida se aborta registrando el código: nunca queda activa bloqueando el
    // índice único parcial.
    default:
      return {
        status: 'aborted',
        lushaSkippedReason: 'not_needed',
        finalProvider: 'none',
        completedAt: nowIso,
        errorCode: cleanText(apolloStartStatus) ?? 'apollo_start_failed',
      };
  }
}

// ── Decisión de continuación tras un desenlace terminal Apollo ──

export interface PhoneRevealWaterfallContinuationInput {
  /** ENABLE_PHONE_REVEAL_WATERFALL ya resuelto. */
  flagEnabled: boolean;
  /** ENABLE_LUSHA_PHONE_REVEAL_FALLBACK ya resuelto: sin él no hay pata Lusha. */
  lushaFallbackFlagEnabled: boolean;
  nowIso: string;
  /** Corrida activa del candidato. null ⇒ no hay autorización que gastar. */
  run: PhoneRevealWaterfallRunRecord | null;
  /** Desenlace con el que Apollo acabó de terminalizar. */
  apolloOutcome: PhoneRevealWaterfallApolloOutcome;
  /** Candidato tras persistir el desenlace Apollo. null ⇒ no evaluable. */
  candidate: PhoneRevealWaterfallCandidateRecord | null;
}

/**
 * Decisión de continuación. `check_suppression` es el ÚNICO camino que sigue
 * hacia Lusha, y exige aún la re-comprobación de supresión/DNC.
 */
export type PhoneRevealWaterfallContinuationDecision =
  | { action: 'check_suppression' }
  | {
      action: 'close';
      patch: PhoneRevealWaterfallRunPatch;
    }
  | {
      /** No hay nada que hacer y NADA que escribir (idempotente). */
      action: 'noop';
      reason:
        | 'feature_disabled'
        | 'no_active_run'
        | 'run_already_terminal'
        | 'lusha_already_attempted'
        | 'apollo_not_terminal_no_phone_found'
        /**
         * Una corrida `legacy_lusha_only` recibió un evento de Apollo que NO es
         * `no_phone_found` (AGENT2A-PHONE-WATERFALL-2). No se escribe nada: Apollo
         * no corre bajo esa autorización, así que ningún desenlace suyo puede
         * reescribir su pata Apollo ni cerrar la corrida. El claim de Lusha queda
         * intacto para el disparador legítimo.
         */
        | 'legacy_run_ignores_apollo_event'
        /**
         * Una corrida `search_more` recibió un evento de Apollo
         * (AGENT2A-SEARCH-MORE-PHONES-1). Apollo NO corre bajo esa autorización, así que
         * ningún desenlace suyo puede cerrarla ni tomarle el claim de su pata. No se
         * escribe nada. A diferencia de la ruta legacy, aquí se ignora TODO desenlace de
         * Apollo —incluido `no_phone_found`— porque ninguno la creó.
         */
        | 'search_more_run_ignores_apollo_event';
    };

function closeRun(
  patch: PhoneRevealWaterfallRunPatch,
): PhoneRevealWaterfallContinuationDecision {
  return { action: 'close', patch };
}

/**
 * Decide, de forma PURA y sin I/O, qué hacer cuando Apollo terminalizó. El orden
 * es barato→caro y fail-closed: todo lo que puede evitar una llamada pagada a
 * Lusha se evalúa antes, y la re-comprobación de supresión (la única que cuesta
 * una lectura) se pide de último.
 *
 * NO recibe el estado de supresión a propósito: si lo recibiera, el caller
 * tendría que hacer esa lectura incluso en los casos en los que la decisión ya
 * estaba tomada (Apollo reveló, autorización vencida, sin id Lusha…).
 */
export function decidePhoneRevealWaterfallContinuation(
  input: PhoneRevealWaterfallContinuationInput,
): PhoneRevealWaterfallContinuationDecision {
  if (!input.flagEnabled) return { action: 'noop', reason: 'feature_disabled' };

  const run = input.run;
  if (!run) return { action: 'noop', reason: 'no_active_run' };
  if (PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES.includes(run.status)) {
    return { action: 'noop', reason: 'run_already_terminal' };
  }
  // Idempotencia entre disparadores: webhook, cron de recovery y revisión manual
  // L3 pueden ver el MISMO `no_phone_found`. El primero que reclamó la pata deja
  // `lusha_attempted_at` sellado y los demás no escriben nada.
  if (run.lushaAttemptedAt !== null) {
    return { action: 'noop', reason: 'lusha_already_attempted' };
  }

  // Una corrida legacy SOLO puede continuar por el desenlace que la creó
  // (`no_phone_found`, transcrito en el INSERT). Cualquier otro evento de Apollo es
  // ajeno a esa autorización — Apollo no corre bajo ella — así que se ignora sin
  // escribir nada, dejando el claim de Lusha disponible para el disparador legítimo.
  if (
    run.runMode === 'legacy_lusha_only' &&
    input.apolloOutcome !== 'no_phone_found'
  ) {
    return { action: 'noop', reason: 'legacy_run_ignores_apollo_event' };
  }

  // Una corrida `search_more` NO la continúa NINGÚN evento de Apollo, ni siquiera un
  // `no_phone_found` (AGENT2A-SEARCH-MORE-PHONES-1). Su pata la dispara el runner de
  // «Buscar más números», que ya tomó el claim antes de llamar al proveedor.
  //
  // Esta guarda no es defensiva por gusto: el candidato de una corrida `search_more`
  // está en `revealed`, así que un webhook o un recovery TARDÍO de la autorización
  // ANTERIOR puede llegar mientras esta corrida está viva y, sin la guarda, la
  // encontraría como «la corrida activa» del candidato. Entonces cerraría una
  // autorización que no es suya —y con una modalidad que jamás ejecutó Apollo— o le
  // robaría el claim de Lusha. Se ignora sin escribir NADA, que es exactamente el mismo
  // remedio que la 2A ya aplicó a la ruta legacy por la misma razón.
  if (run.runMode === 'search_more') {
    return { action: 'noop', reason: 'search_more_run_ignores_apollo_event' };
  }

  // Defensa en profundidad: el rol ya se validó al crear la corrida, pero la
  // continuación gasta créditos SIN un humano presente, así que se revalida
  // contra el rol almacenado en la propia autorización.
  if (!isPhoneRevealWaterfallRoleAuthorized(run.authorizedByRole)) {
    return closeRun({
      status: 'aborted',
      apolloOutcome: input.apolloOutcome,
      lushaSkippedReason: 'role_not_allowed',
      finalProvider: 'none',
      completedAt: input.nowIso,
      errorCode: 'role_not_allowed',
    });
  }

  switch (input.apolloOutcome) {
    // Apollo entregó el teléfono ⇒ la 2ª pata no se usa nunca.
    case 'revealed':
    case 'revealed_from_cache':
      return closeRun({
        status: 'completed_apollo',
        apolloOutcome: input.apolloOutcome,
        finalProvider: 'apollo',
        lushaSkippedReason: 'apollo_revealed',
        completedAt: input.nowIso,
        errorCode: null,
      });

    case 'blocked_suppressed':
      return closeRun({
        status: 'aborted',
        apolloOutcome: 'blocked_suppressed',
        lushaSkippedReason: 'suppressed',
        finalProvider: 'none',
        completedAt: input.nowIso,
        errorCode: 'blocked_suppressed',
      });

    case 'do_not_contact':
      return closeRun({
        status: 'aborted',
        apolloOutcome: 'do_not_contact',
        lushaSkippedReason: 'dnc',
        finalProvider: 'none',
        completedAt: input.nowIso,
        errorCode: 'do_not_contact',
      });

    // Fail-closed en el efecto (Lusha no se llama), explícito en el registro: la
    // comprobación no estuvo disponible, y eso NO es una supresión confirmada.
    case 'suppression_check_unavailable':
      return closeRun({
        apolloOutcome: 'suppression_check_unavailable',
        ...suppressionCheckUnavailablePatch(input.nowIso),
      });

    case 'cache_unavailable':
    case 'error':
      return closeRun({
        status: 'error',
        apolloOutcome: input.apolloOutcome,
        lushaSkippedReason: 'provider_error',
        finalProvider: 'none',
        completedAt: input.nowIso,
        errorCode:
          input.apolloOutcome === 'cache_unavailable'
            ? 'cache_unavailable'
            : 'apollo_reveal_error',
      });

    case 'no_phone_found':
      break;

    default:
      return { action: 'noop', reason: 'apollo_not_terminal_no_phone_found' };
  }

  // ── Desde aquí: Apollo terminó en `no_phone_found` ──────────────

  // Si aun así hay teléfono (llegó por otra vía entre la persistencia y este
  // hook), no se gasta nada más.
  //
  // En modalidad legacy el cierre NO puede ser `completed_apollo` + `apollo`: Apollo
  // no corrió bajo esta autorización, así que atribuirle el teléfono sería declarar
  // una ejecución que no existió. La corrida se aborta como innecesaria y el
  // proveedor final queda `none` — quién consiguió realmente ese número lo dice el
  // candidato, no esta corrida.
  if (!input.candidate || input.candidate.hasPhone) {
    const isLegacy = run.runMode === 'legacy_lusha_only';
    return closeRun({
      status: isLegacy ? 'aborted' : 'completed_apollo',
      apolloOutcome: 'no_phone_found',
      lushaSkippedReason: 'not_needed',
      finalProvider:
        !isLegacy && input.candidate?.hasPhone ? 'apollo' : 'none',
      completedAt: input.nowIso,
      errorCode: input.candidate ? null : 'candidate_not_found',
    });
  }

  // La autorización humana caducó: la pata Apollo ya está cerrada, pero la
  // segunda NO se gasta sobre una confirmación de costo vieja.
  if (
    isPhoneRevealWaterfallAuthorizationExpired(run.authorizedAt, input.nowIso)
  ) {
    return closeRun({
      status: 'aborted',
      apolloOutcome: 'no_phone_found',
      lushaSkippedReason: 'authorization_expired',
      finalProvider: 'none',
      completedAt: input.nowIso,
      errorCode: 'authorization_expired',
    });
  }

  // El fallback Lusha sigue siendo el kill switch de cualquier reveal Lusha:
  // este flag NO lo sustituye ni lo debilita.
  if (!input.lushaFallbackFlagEnabled) {
    return closeRun({
      status: 'exhausted',
      apolloOutcome: 'no_phone_found',
      lushaSkippedReason: 'feature_disabled',
      finalProvider: 'none',
      completedAt: input.nowIso,
      errorCode: null,
    });
  }

  // Sin id Lusha propio no hay 2ª pata: se agota aquí, con 0 llamadas a Lusha.
  //
  // La búsqueda PAGADA de identidad sólo se admite si el tope que el operador aceptó la
  // incluye (14 = Apollo 8 + búsqueda 1 + teléfono 5). Se comprueba contra
  // `max_credits_authorized` porque es el ÚNICO hecho durable que demuestra qué se
  // autorizó y qué se reservó: una corrida `legacy_lusha_only` (tope 5) y cualquier
  // corrida creada antes de encender el flag (tope 13) no reservaron crédito de
  // búsqueda, y para ellas la vía de pago no existe. Reutilizar una identidad YA
  // persistida sigue permitido en todas: cuesta 0.
  const lushaLeg = evaluatePhoneRevealWaterfallLushaLeg(input.candidate, {
    identitySearchAuthorized: doesRunAuthorizeIdentitySearch(run),
  });
  if (!lushaLeg.eligible) {
    return closeRun({
      status: 'exhausted',
      apolloOutcome: 'no_phone_found',
      lushaSkippedReason: lushaLeg.skippedReason ?? 'missing_lusha_contact_id',
      finalProvider: 'none',
      completedAt: input.nowIso,
      errorCode: null,
    });
  }

  // Único camino que continúa. Falta la re-comprobación de supresión/DNC.
  return { action: 'check_suppression' };
}

// ── Re-comprobación de supresión / DNC antes de la pata Lusha ──

/**
 * Estado de la re-comprobación inmediatamente anterior a la llamada Lusha. El
 * reveal Apollo pudo empezar hace horas: una DSAR o un `do_not_contact` pueden
 * haberse registrado en el intervalo, y la pata Lusha es una llamada NUEVA a un
 * proveedor NUEVO, así que se vuelve a comprobar en vez de heredar el veredicto.
 */
export type PhoneRevealWaterfallSuppressionState =
  | 'clear'
  | 'blocked_suppressed'
  | 'do_not_contact'
  /** No se pudo verificar (tabla ausente, timeout, dep no cableada). */
  | 'check_unavailable';

/**
 * Traduce la re-comprobación a decisión. `null` = adelante con Lusha; cualquier
 * otro valor devuelve el patch de cierre.
 *
 * Fail-closed: `check_unavailable` bloquea la llamada IGUAL que un tombstone
 * confirmado, pero se REGISTRA distinto (`suppression_check_unavailable` vs
 * `suppressed`): el efecto es el mismo, la afirmación no.
 */
export function resolvePhoneRevealWaterfallSuppressionBlock(
  state: PhoneRevealWaterfallSuppressionState,
  nowIso: string,
): PhoneRevealWaterfallRunPatch | null {
  switch (state) {
    case 'clear':
      return null;
    case 'blocked_suppressed':
      return {
        status: 'aborted',
        lushaSkippedReason: 'suppressed',
        finalProvider: 'none',
        completedAt: nowIso,
        errorCode: 'blocked_suppressed',
      };
    case 'do_not_contact':
      return {
        status: 'aborted',
        lushaSkippedReason: 'dnc',
        finalProvider: 'none',
        completedAt: nowIso,
        errorCode: 'do_not_contact',
      };
    case 'check_unavailable':
    default:
      return suppressionCheckUnavailablePatch(nowIso);
  }
}

// ── Mapeo del resultado Lusha al patch de la corrida ───────────

/**
 * Resultado de la pata Lusha tal y como lo entrega el fallback ya existente
 * (`LushaPhoneFallbackActionResult` + el costo que reportó el proveedor). Se
 * recibe estructuralmente para no importar el core de Lusha.
 */
export interface PhoneRevealWaterfallLushaLegResult {
  /** `revealed` | `no_phone_found` | cualquier otro ⇒ error. */
  status: string;
  /** Créditos reportados por Lusha (billing.creditsCharged). null si no vino. */
  creditsCharged: number | null;
  /** Código de error mecánico, sin PII. null en los caminos correctos. */
  errorCode: string | null;
}

/**
 * Código de error de la pata Lusha que significa «respondió, COBRÓ, y todos sus
 * números son tombstones» (AGENT2A-PHONE-REVEAL-4O-E1 § 10).
 *
 * Espejo de `LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE` en
 * lusha-phone-fallback-core.ts. Se declara aquí en vez de importarse para que este
 * core siga sin depender del core de Lusha (misma convención que
 * `PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS`); un test estático verifica que las dos
 * constantes no se separen.
 *
 * Es el ÚNICO error de esta pata que viene acompañado de un costo REAL, y por eso
 * necesita reconocerse: la regla general «un error no reporta costo» es correcta
 * para una red caída o un 402, y falsa aquí.
 */
export const PHONE_REVEAL_WATERFALL_LUSHA_SUPPRESSED_ERROR_CODE =
  'phone_suppressed' as const;

/**
 * Cierra la corrida con el resultado de la pata Lusha.
 *
 * `revealed` ⇒ `completed_lusha` + `final_provider = 'lusha'`. `no_phone_found`
 * ⇒ `exhausted` + `final_provider = 'none'` (Lusha intentó, no reveló: NO puede
 * figurar como proveedor final). Cualquier otro status ⇒ `error`, también con
 * `final_provider = 'none'`.
 *
 * El costo se registra SIEMPRE en las columnas de Lusha, jamás sumado a las de
 * Apollo, y un costo no reportado queda `null` + `unknown`, nunca 0.
 *
 * EXCEPCIÓN ANCLADA A EVIDENCIA (4O-E1 § 10): cuando el error es
 * `phone_suppressed` Y el proveedor reportó créditos, la corrida conserva ese
 * costo real. Antes de este hito cualquier status distinto de
 * `revealed`/`no_phone_found` borraba la cifra a `null` + `unknown`, de modo que
 * una llamada pagada cuyo resultado quedó bloqueado por privacidad se registraba
 * como si Lusha no hubiera cobrado nada — y esa es la única lectura de la que
 * dispone la liquidación de la reserva. No se generaliza a «todos los errores
 * tienen costo»: hace falta el código específico Y una cifra presente.
 */
export function mapLushaLegResultToWaterfallPatch(
  result: PhoneRevealWaterfallLushaLegResult,
  nowIso: string,
): PhoneRevealWaterfallRunPatch {
  const lushaCostCredits =
    typeof result.creditsCharged === 'number' && Number.isFinite(result.creditsCharged)
      ? result.creditsCharged
      : null;
  const lushaCostSource = resolvePhoneRevealWaterfallCostSource(lushaCostCredits);

  if (result.status === 'revealed') {
    return {
      status: 'completed_lusha',
      lushaOutcome: 'revealed',
      lushaCostCredits,
      lushaCostSource,
      finalProvider: 'lusha',
      completedAt: nowIso,
      errorCode: null,
    };
  }

  if (result.status === 'no_phone_found') {
    return {
      status: 'exhausted',
      lushaOutcome: 'no_phone_found',
      lushaCostCredits,
      lushaCostSource,
      finalProvider: 'none',
      completedAt: nowIso,
      errorCode: null,
    };
  }

  // Supresión confirmada DESPUÉS de una llamada pagada. El desenlace de la pata
  // sigue siendo `error` (Lusha no reveló nada persistible), pero la corrida se
  // cierra `aborted` como cualquier otro bloqueo de privacidad, y el costo real se
  // conserva. `lushaSkippedReason` se deja SIN tocar: Lusha sí se ejecutó, así que
  // escribir `suppressed` ahí afirmaría que se omitió por supresión, que es
  // literalmente lo contrario de lo que pasó.
  if (
    cleanText(result.errorCode) === PHONE_REVEAL_WATERFALL_LUSHA_SUPPRESSED_ERROR_CODE &&
    lushaCostCredits !== null
  ) {
    return {
      status: 'aborted',
      lushaOutcome: 'error',
      lushaCostCredits,
      lushaCostSource,
      finalProvider: 'none',
      completedAt: nowIso,
      // Vocabulario de privacidad de la corrida, el mismo que usan los demás
      // cierres por tombstone. El detalle del proveedor (`phone_suppressed`) queda
      // en el usage-log de la pata, que no se reescribe.
      errorCode: 'blocked_suppressed',
    };
  }

  return {
    status: 'error',
    lushaOutcome: 'error',
    // Un error nunca reporta un costo real: se deja `null` + `unknown`, jamás 0.
    lushaCostCredits: null,
    lushaCostSource: 'unknown',
    finalProvider: 'none',
    completedAt: nowIso,
    errorCode: cleanText(result.errorCode) ?? 'lusha_reveal_error',
  };
}

// ── Continuación completa (con claim atómico) ──────────────────

export interface ContinuePhoneRevealWaterfallInput {
  candidateId: string;
  /** Desenlace con el que Apollo acabó de terminalizar. */
  apolloOutcome: PhoneRevealWaterfallApolloOutcome;
  /** Créditos que Apollo reportó en ese desenlace. null si no los reportó. */
  apolloCostCredits?: number | null;
}

export interface ContinuePhoneRevealWaterfallDeps {
  flagEnabled: boolean;
  lushaFallbackFlagEnabled: boolean;
  nowIso: string;
  findActiveRun: (
    candidateId: string,
  ) => Promise<PhoneRevealWaterfallRunRecord | null>;
  loadCandidate: (
    candidateId: string,
  ) => Promise<PhoneRevealWaterfallCandidateRecord | null>;
  /** Aplica el UPDATE de cierre/actualización de la corrida. */
  updateRun: (runId: string, patch: PhoneRevealWaterfallRunPatch) => Promise<void>;
  /**
   * Re-comprueba supresión + do-not-contact. Solo se invoca cuando la decisión
   * ya llegó a `check_suppression`. Debe devolver `check_unavailable` (o lanzar,
   * que el caller traduce a lo mismo) si la lectura no se pudo completar.
   */
  checkSuppressionAndDoNotContact: (
    candidateId: string,
  ) => Promise<PhoneRevealWaterfallSuppressionState>;
  /**
   * CLAIM ATÓMICO de la pata Lusha. Debe ser un UPDATE condicional:
   *   SET lusha_attempted_at = now(), status = 'lusha_running'
   *   WHERE id = runId
   *     AND lusha_attempted_at IS NULL
   *     AND status IN ('apollo_in_flight','lusha_pending')
   *     AND authorized_at > now() - interval '24 hours'
   * Devuelve true SOLO si actualizó 1 fila. false ⇒ otro disparador ya tomó la
   * pata (o la autorización venció en el intervalo) y NO se debe llamar a Lusha.
   */
  claimLushaAttempt: (runId: string) => Promise<boolean>;
  /**
   * Ejecuta la pata Lusha (fallback ya existente, en modo waterfall). Solo se
   * invoca DESPUÉS de un claim exitoso. Una sola vez, sin retry.
   */
  callLushaLeg: (args: {
    candidateId: string;
    runId: string;
    /** Actor almacenado en la autorización: no hay humano en este momento. */
    authorizedBy: string;
    /**
     * ROL almacenado en la autorización (`authorized_by_role`)
     * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1). Viaja para que el ejecutor pueda
     * REVALIDARLO contra la autoridad canónica del reveal antes de llamar al
     * proveedor, en vez de dar por hecho que quien autorizó era admin. Puede ser
     * `null` en corridas históricas cuyo rol no se registró: el ejecutor lo trata
     * fail-closed.
     */
    authorizedByRole: string | null;
    maxCreditsAuthorized: number;
    /**
     * Id NATIVO de Lusha con el que pedir el teléfono, ya resuelto por el paso de
     * identidad. Ausente ⇒ el ejecutor lo deriva del candidato como siempre (solo
     * sirve si el candidato nació en Lusha). Nunca transporta un id de otro proveedor:
     * quien lo rellena es el resolutor, que consulta `provider_key = 'lusha'`.
     */
    lushaContactId?: string;
  }) => Promise<PhoneRevealWaterfallLushaLegResult>;
  /**
   * Resuelve la identidad nativa de Lusha ANTES del reveal
   * (AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1).
   *
   * OPCIONAL: sin esta dep el comportamiento es EXACTAMENTE el anterior al hito —el
   * candidato llega a Lusha solo si ya tiene id propio— así que ningún caller
   * existente cambia por el hecho de que exista.
   */
  resolveLushaIdentity?: (args: {
    candidateId: string;
    runId: string;
  }) => Promise<ResolveLushaIdentityResult>;
  /**
   * Sella en la corrida el desenlace de la búsqueda de identidad y su claim. Best
   * effort y separado de `updateRun` para que el sello de la búsqueda no dependa de
   * que la corrida se cierre en la misma escritura.
   */
  recordIdentitySearchOutcome?: (args: {
    runId: string;
    outcome: LushaIdentitySearchRunOutcome;
    creditsCharged: number | null;
  }) => Promise<void>;
  /**
   * Deja en el CANDIDATO el rastro terminal de una supresión confirmada por la
   * re-comprobación previa a Lusha (AGENT2A-PHONE-REVEAL-4O-E1 § 7).
   *
   * Hasta este hito ese gate hacía todo lo demás bien —0 llamadas, 0 créditos,
   * corrida `aborted` con `lusha_skipped_reason = 'suppressed'`— pero el candidato
   * no recibía NADA: se quedaba en el `no_phone_found` que Apollo escribió, que es
   * exactamente el estado que lo vuelve a hacer elegible para un reveal pagado. La
   * decisión de privacidad quedaba solo en la corrida, y el gate manual no la lee.
   *
   * Se declara ESTRUCTURALMENTE (y no importando el contrato compartido) para que
   * este core siga sin dependencias de la capa de supresión ni riesgo de arrastrar
   * módulos server-only a un bundle que lo importe por su vista de auditoría.
   *
   * OPCIONAL y BEST-EFFORT: solo se invoca con un tombstone CONFIRMADO (nunca con
   * `check_unavailable`, que no afirma nada), su resultado no altera el cierre de la
   * corrida, y sin la dep el comportamiento es idéntico al anterior al hito. La
   * escritura tiene que ser CONDICIONAL sobre `expectedStatuses`: la fila puede
   * haber cambiado mientras se leía la supresión, y pisar un `revealed` ajeno sería
   * peor que no dejar rastro.
   */
  terminalizeSuppressedCandidate?: (args: {
    candidateId: string;
    /** Estados en los que la fila DEBE seguir para que la escritura gane. */
    expectedStatuses: readonly string[];
  }) => Promise<unknown>;
}

export type ContinuePhoneRevealWaterfallOutcome =
  | 'lusha_revealed'
  | 'lusha_no_phone_found'
  | 'lusha_error'
  | 'lusha_claim_lost'
  | 'closed_without_lusha'
  /**
   * La identidad nativa de Lusha no se pudo resolver, así que NO hubo reveal
   * (AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1). Es un cierre terminal
   * propio y no un `closed_without_lusha` cualquiera: en tres de sus cuatro motivos
   * SÍ se pagó 1 crédito de búsqueda, y colapsarlo con un cierre gratuito escondería
   * ese gasto.
   */
  | 'lusha_identity_unresolved'
  /** Otro disparador tiene el claim de la BÚSQUEDA. 0 llamadas, 0 escrituras. */
  | 'lusha_identity_claim_lost'
  | 'noop';

export interface ContinuePhoneRevealWaterfallResult {
  outcome: ContinuePhoneRevealWaterfallOutcome;
  /** Motivo PII-free (código mecánico) para diagnóstico. null si no aplica. */
  reason: string | null;
  /** true solo si se llegó a llamar a Lusha en esta invocación. */
  lushaCalled: boolean;
}

/**
 * Continúa el waterfall tras un desenlace terminal de Apollo. Es el ÚNICO punto
 * que puede disparar la pata Lusha, y lo hace como máximo una vez por corrida.
 *
 * Se invoca BEST-EFFORT desde el webhook, el cron de recovery y la revisión
 * manual L3: el caller envuelve la llamada para que un fallo aquí no convierta
 * un webhook correcto en 5xx (lo que provocaría reintentos de Apollo).
 *
 * NUNCA: search de Lusha, waterfallReveal de Lusha, HubSpot, bulk, retry
 * automático, aprobación de candidato.
 */
export async function continuePhoneRevealWaterfall(
  input: ContinuePhoneRevealWaterfallInput,
  deps: ContinuePhoneRevealWaterfallDeps,
): Promise<ContinuePhoneRevealWaterfallResult> {
  if (!deps.flagEnabled) {
    return { outcome: 'noop', reason: 'feature_disabled', lushaCalled: false };
  }

  const candidateId = cleanText(input.candidateId);
  if (!candidateId) {
    return { outcome: 'noop', reason: 'invalid_candidate', lushaCalled: false };
  }

  const run = await deps.findActiveRun(candidateId);
  // Sin corrida activa no hay autorización que gastar: se sale sin escribir.
  if (!run) return { outcome: 'noop', reason: 'no_active_run', lushaCalled: false };

  // El candidato solo se lee cuando la corrida sigue viva y la pata Lusha sigue
  // sin reclamar: cualquier otro caso ya está decidido sin necesitar la fila.
  const needsCandidate =
    run.lushaAttemptedAt === null &&
    !PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES.includes(run.status) &&
    input.apolloOutcome === 'no_phone_found';
  const candidate = needsCandidate ? await deps.loadCandidate(candidateId) : null;

  const decision = decidePhoneRevealWaterfallContinuation({
    flagEnabled: deps.flagEnabled,
    lushaFallbackFlagEnabled: deps.lushaFallbackFlagEnabled,
    nowIso: deps.nowIso,
    run,
    apolloOutcome: input.apolloOutcome,
    candidate,
  });

  // Costo de la pata Apollo: se sella en su propia columna en cualquier cierre,
  // nunca mezclado con el de Lusha.
  const apolloCostPatch: PhoneRevealWaterfallRunPatch =
    input.apolloCostCredits === undefined
      ? {}
      : {
          apolloCostCredits:
            typeof input.apolloCostCredits === 'number' &&
            Number.isFinite(input.apolloCostCredits)
              ? input.apolloCostCredits
              : null,
          apolloCostSource: resolvePhoneRevealWaterfallCostSource(
            input.apolloCostCredits,
          ),
        };

  if (decision.action === 'noop') {
    return { outcome: 'noop', reason: decision.reason, lushaCalled: false };
  }

  if (decision.action === 'close') {
    await deps.updateRun(run.id, { ...apolloCostPatch, ...decision.patch });
    return {
      outcome: 'closed_without_lusha',
      reason: decision.patch.lushaSkippedReason ?? decision.patch.errorCode ?? null,
      lushaCalled: false,
    };
  }

  // ── Camino hacia Lusha ─────────────────────────────────────────

  // 1. Supresión / DNC re-comprobadas AHORA. Fail-closed si no se puede leer.
  let suppressionState: PhoneRevealWaterfallSuppressionState;
  try {
    suppressionState = await deps.checkSuppressionAndDoNotContact(candidateId);
  } catch {
    suppressionState = 'check_unavailable';
  }
  const suppressionBlock = resolvePhoneRevealWaterfallSuppressionBlock(
    suppressionState,
    deps.nowIso,
  );
  if (suppressionBlock) {
    // 4O-E1 § 7 — rastro terminal en el CANDIDATO, y SOLO con tombstone confirmado.
    // `check_unavailable` y `do_not_contact` NO pasan por aquí: el primero no afirma
    // ninguna supresión (no se pudo comprobar) y el segundo es otra decisión, con su
    // propio registro. Se hace ANTES de cerrar la corrida para que, si el proceso
    // muriera en medio, el estado que sobreviva sea el que MÁS protege: candidato
    // bloqueado con la corrida todavía viva (que el cierre posterior resuelve) en vez
    // de una corrida cerrada sobre un candidato que sigue pareciendo comprable.
    if (suppressionState === 'blocked_suppressed' && deps.terminalizeSuppressedCandidate) {
      const observedStatus = cleanText(candidate?.phoneRevealStatus);
      if (observedStatus) {
        try {
          await deps.terminalizeSuppressedCandidate({
            candidateId,
            // El estado que este core observó al decidir. En este punto es siempre
            // el desenlace terminal que Apollo acababa de persistir
            // (`no_phone_found`): la decisión solo llega a `check_suppression` con
            // `apolloOutcome === 'no_phone_found'`, y una corrida legacy exige ese
            // mismo desenlace ya persistido para poder crearse. No se asume: se
            // exige la fila tal como se leyó.
            expectedStatuses: [observedStatus],
          });
        } catch {
          // Silencio acotado: el cierre de la corrida y la liquidación de la reserva
          // no pueden depender de este rastro. El escritor ya registra su fallo.
        }
      }
    }
    await deps.updateRun(run.id, {
      ...apolloCostPatch,
      apolloOutcome: input.apolloOutcome,
      ...suppressionBlock,
    });
    return {
      outcome: 'closed_without_lusha',
      // `error_code` ya distingue los tres cierres de privacidad
      // (`blocked_suppressed` | `do_not_contact` | `suppression_check_unavailable`).
      // El fallback usa el motivo de omisión, NUNCA un 'suppressed' literal: este
      // camino también cubre "no se pudo verificar", que no es una supresión.
      reason: suppressionBlock.errorCode ?? suppressionBlock.lushaSkippedReason ?? null,
      lushaCalled: false,
    };
  }

  // 2. IDENTIDAD NATIVA DE LUSHA (AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1).
  //
  //    Va DESPUÉS de la privacidad y ANTES del claim del reveal, y ese orden no es
  //    negociable: la búsqueda es una llamada PAGADA a un proveedor sobre una persona,
  //    así que ni un tombstone de supresión ni un DNC pueden quedar por detrás de ella.
  //    Un candidato suprimido produce 0 búsquedas Y 0 reveals, no 0 reveals a secas.
  //
  //    Sin la dep, este bloque entero no existe y el comportamiento es el de antes del
  //    hito: solo un candidato con id Lusha propio llega al reveal.
  let resolvedLushaContactId: string | undefined;
  if (deps.resolveLushaIdentity) {
    const identity = await deps.resolveLushaIdentity({ candidateId, runId: run.id });

    if (identity.status === 'claim_lost') {
      // Otro disparador tiene la BÚSQUEDA, o la tuvo y cayó. En ninguno de los dos
      // casos se vuelve a buscar (sería el segundo cobro) y no se escribe nada: el
      // claim del reveal queda libre para quien legítimamente lo tome.
      return {
        outcome: 'lusha_identity_claim_lost',
        reason: identity.reason,
        lushaCalled: false,
      };
    }

    // El sello del desenlace va ANTES de decidir el cierre, y es best-effort: si la
    // corrida se cerrara sin él, la auditoría no sabría si esta corrida pagó una
    // búsqueda ni con qué resultado.
    if (deps.recordIdentitySearchOutcome) {
      try {
        await deps.recordIdentitySearchOutcome({
          runId: run.id,
          outcome: identity.runOutcome,
          creditsCharged: identity.searchCreditsCharged,
        });
      } catch {
        // Silencio acotado: el escritor registra su propio fallo y el cierre de la
        // corrida no puede depender de un sello de auditoría.
      }
    }

    if (identity.status === 'blocked') {
      // Terminal SIN reveal. La pata del reveal NUNCA se reclama, así que su reserva
      // se libera intacta; la de la búsqueda se liquida por su cuenta según lo que el
      // proveedor cobró (o al tope, si no lo reportó).
      await deps.updateRun(run.id, {
        ...apolloCostPatch,
        apolloOutcome: input.apolloOutcome,
        status: 'aborted',
        lushaSkippedReason: identity.skippedReason,
        completedAt: deps.nowIso,
        finalProvider: 'none',
      });
      return {
        outcome: 'lusha_identity_unresolved',
        reason: identity.skippedReason,
        lushaCalled: false,
      };
    }

    resolvedLushaContactId = identity.contactId;
  }

  // 3. Claim atómico del REVEAL. Si no actualiza fila, otro disparador ya tomó la
  //    pata: se sale SIN llamar a Lusha y sin escribir nada más.
  const claimed = await deps.claimLushaAttempt(run.id);
  if (!claimed) {
    return {
      outcome: 'lusha_claim_lost',
      reason: 'already_attempted',
      lushaCalled: false,
    };
  }

  // 4. UNA llamada a Lusha, sin retry. El actor es el operador que autorizó.
  let legResult: PhoneRevealWaterfallLushaLegResult;
  try {
    legResult = await deps.callLushaLeg({
      candidateId,
      runId: run.id,
      authorizedBy: run.authorizedBy,
      authorizedByRole: run.authorizedByRole,
      maxCreditsAuthorized: run.maxCreditsAuthorized,
      ...(resolvedLushaContactId ? { lushaContactId: resolvedLushaContactId } : {}),
    });
  } catch {
    // La pata quedó reclamada, así que NO se reintenta: se cierra como error con
    // un código mecánico y el costo real permanece desconocido (nunca 0).
    legResult = {
      status: 'error',
      creditsCharged: null,
      errorCode: 'lusha_leg_threw',
    };
  }

  const patch = mapLushaLegResultToWaterfallPatch(legResult, deps.nowIso);
  await deps.updateRun(run.id, {
    ...apolloCostPatch,
    apolloOutcome: input.apolloOutcome,
    ...patch,
  });

  if (patch.lushaOutcome === 'revealed') {
    return { outcome: 'lusha_revealed', reason: null, lushaCalled: true };
  }
  if (patch.lushaOutcome === 'no_phone_found') {
    return { outcome: 'lusha_no_phone_found', reason: null, lushaCalled: true };
  }
  return {
    outcome: 'lusha_error',
    reason: patch.errorCode ?? 'lusha_reveal_error',
    lushaCalled: true,
  };
}

// ── Vista de auditoría para la UI (PII-free) ───────────────────

/**
 * Proyección que la UI muestra en el bloque de auditoría del drawer. Solo
 * códigos mecánicos, booleanos y conteos: ni teléfono, ni identidad, ni ids de
 * proveedor. `runId` NO se incluye a propósito — el operador no lo necesita y es
 * un identificador más que no tiene por qué viajar al cliente.
 */
export interface PhoneRevealWaterfallAuditView {
  status: PhoneRevealWaterfallStatus;
  /**
   * Modalidad, para que la UI no tenga que deducirla (AGENT2A-PHONE-WATERFALL-2).
   * Sin ella, `apolloAttempted: false` en una corrida legacy se leería como "Apollo
   * nunca se intentó", cuando lo cierto es que se intentó ANTES y fuera de esta
   * autorización.
   */
  runMode: PhoneRevealWaterfallRunMode;
  isTerminal: boolean;
  maxCreditsAuthorized: number;
  apolloAttempted: boolean;
  apolloOutcome: PhoneRevealWaterfallApolloOutcome | null;
  apolloCostCredits: number | null;
  apolloCostSource: PhoneRevealWaterfallCostSource | null;
  lushaEligible: boolean;
  lushaAttempted: boolean;
  lushaSkippedReason: PhoneRevealWaterfallLushaSkippedReason | null;
  lushaOutcome: PhoneRevealWaterfallLushaOutcome | null;
  lushaCostCredits: number | null;
  lushaCostSource: PhoneRevealWaterfallCostSource | null;
  finalProvider: PhoneRevealWaterfallFinalProvider | null;
}

/** Construye la vista de auditoría desde la fila de la corrida. */
export function buildPhoneRevealWaterfallAuditView(
  run: PhoneRevealWaterfallRunRecord,
): PhoneRevealWaterfallAuditView {
  return {
    status: run.status,
    runMode: run.runMode,
    isTerminal: PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES.includes(run.status),
    maxCreditsAuthorized: run.maxCreditsAuthorized,
    apolloAttempted: run.apolloAttemptedAt !== null,
    apolloOutcome: run.apolloOutcome,
    apolloCostCredits: run.apolloCostCredits,
    apolloCostSource: run.apolloCostSource,
    lushaEligible: run.lushaEligible === true,
    lushaAttempted: run.lushaAttemptedAt !== null,
    lushaSkippedReason: run.lushaSkippedReason,
    lushaOutcome: run.lushaOutcome,
    lushaCostCredits: run.lushaCostCredits,
    lushaCostSource: run.lushaCostSource,
    finalProvider: run.finalProvider,
  };
}

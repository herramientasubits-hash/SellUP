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
 *   * admin-only. `commercial_manager` keeps the Apollo-only flow and never gets
 *     a run row, so the Lusha leg is structurally unreachable for that role.
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
 *     re-comprobación de supresión/DNC fail-closed, admin-only, una sola llamada a
 *     Lusha, sin retry automático, sin HubSpot, sin bulk.
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
  buildPhoneRevealCreditReservationLegs,
  type PhoneRevealCreditReservationOutcome,
  type PhoneRevealCreditReservationReleaseReason,
  type PhoneRevealCreditReservationRequest,
  type PhoneRevealCreditReservedLeg,
} from './phone-reveal-credit-reservation-core';

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
export type PhoneRevealWaterfallLushaOutcome =
  | 'revealed'
  | 'no_phone_found'
  | 'error';

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
 *
 * Es una columna y no una inferencia a propósito: `apollo_attempted_at IS NULL` es
 * un efecto colateral, no una afirmación, y no distingue "Apollo no se ejecutó
 * porque ya corrió antes" de "la pata Apollo nunca se registró".
 */
export const PHONE_REVEAL_WATERFALL_RUN_MODES = [
  'full_waterfall',
  'legacy_lusha_only',
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

/**
 * Roles autorizados a disparar el waterfall completo: SOLO admin, igual que el
 * fallback manual de Lusha (LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS) y más
 * estrecho que el reveal Apollo (que además admite `commercial_manager`). Un
 * `commercial_manager` conserva el flujo Apollo-only y NO genera corrida.
 */
export const PHONE_REVEAL_WATERFALL_AUTHORIZED_ROLE_KEYS: readonly string[] = ['admin'];

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
 * Tope de una corrida `legacy_lusha_only` (AGENT2A-PHONE-WATERFALL-2): SOLO la pata
 * Lusha, así que es exactamente el tope de Lusha y NUNCA incluye los 8 de Apollo.
 * Apollo ya corrió y ya se cobró bajo OTRA autorización; sumarlo aquí cobraría dos
 * veces el mismo intento en la confirmación que ve el operador.
 */
export const PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS =
  PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS;

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
}

// ── Elegibilidad de la pata Lusha ──────────────────────────────

export interface PhoneRevealWaterfallLushaLegEligibility {
  eligible: boolean;
  /** Motivo cuando NO es elegible. null cuando sí lo es. */
  skippedReason: PhoneRevealWaterfallLushaSkippedReason | null;
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
  candidate: Pick<PhoneRevealWaterfallCandidateRecord, 'source' | 'sourceContactId'>,
): PhoneRevealWaterfallLushaLegEligibility {
  if (cleanText(candidate.source) !== 'lusha') {
    return { eligible: false, skippedReason: 'missing_lusha_contact_id' };
  }
  if (!cleanText(candidate.sourceContactId)) {
    return { eligible: false, skippedReason: 'missing_lusha_contact_id' };
  }
  return { eligible: true, skippedReason: null };
}

/**
 * Tope de créditos que el operador debe aceptar: 13 cuando Lusha es una 2ª pata
 * posible (Apollo hasta 8 + Lusha 5) y 8 cuando no lo es. Es el UMBRAL de
 * confirmación, no una predicción del cobro: el costo real de cada pata sale
 * exclusivamente de lo que reporta cada proveedor.
 */
export function resolvePhoneRevealWaterfallMaxCredits(lushaEligible: boolean): number {
  return lushaEligible
    ? PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA
    : PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS;
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

/** ¿El rol almacenado en la corrida sigue autorizado para el waterfall? */
export function isPhoneRevealWaterfallRoleAuthorized(roleKey: string | null): boolean {
  const role = cleanText(roleKey);
  return !!role && PHONE_REVEAL_WATERFALL_AUTHORIZED_ROLE_KEYS.includes(role);
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
 * Reserva ATÓMICA de la exposición máxima (AGENT2A-PHONE-WATERFALL-4E). Es una dep
 * porque la atomicidad solo existe dentro de la transacción de Postgres (migración
 * 104): este core decide QUÉ reservar, no CÓMO serializarlo.
 *
 * Contrato: nunca lanza. Un fallo se expresa como `{ status: 'unavailable' }`, que el
 * core traduce a fail-closed — jamás a una autorización.
 */
export type PhoneRevealWaterfallCreditReserver = (
  request: PhoneRevealCreditReservationRequest,
) => Promise<PhoneRevealCreditReservationOutcome>;

/**
 * Liberación de la exposición reservada. Se invoca SOLO en los caminos en los que la
 * pata provablemente no se ejecutó: la corrida no se pudo crear, o el índice único
 * parcial la rechazó. Nunca lanza.
 */
export type PhoneRevealWaterfallCreditReleaser = (args: {
  reservations: readonly PhoneRevealCreditReservedLeg[];
  reason: PhoneRevealCreditReservationReleaseReason;
}) => Promise<void>;

/** Deps de reserva compartidas por los DOS arranques (completo y legacy). */
interface PhoneRevealWaterfallCreditReservationDeps {
  /** Presupuesto por proveedor, resuelto ANTES de reservar. Fail-closed. */
  readCreditPools: PhoneRevealWaterfallCreditPoolReader;
  /** Reserva atómica de todas las patas, all-or-nothing. */
  reserveCredits: PhoneRevealWaterfallCreditReserver;
  /** Compensación: devuelve la exposición cuando la corrida no llegó a existir. */
  releaseCredits: PhoneRevealWaterfallCreditReleaser;
  /**
   * Id del grupo de reserva. Es una dep porque el core es puro y no puede llamar a
   * `crypto.randomUUID()`; en tests es determinista.
   */
  newReservationGroupId: () => string;
  /**
   * Asocia las patas a la corrida ya creada (cara de conveniencia). La asociación
   * AUTORITATIVA es `credit_reservation_group_id` en la propia corrida, escrita dentro
   * del INSERT, así que un fallo aquí no invalida nada. Nunca lanza.
   */
  attachReservationsToRun: (args: {
    reservationGroupId: string;
    runId: string;
  }) => Promise<void>;
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
  /**
   * INSERT de la corrida. Devuelve el id, o null si el índice único parcial la
   * rechazó porque otra corrida activa ganó la carrera (no es un error: significa
   * que ya hay una autorización viva y el reveal Apollo devolverá
   * `already_pending`).
   */
  createRun: (draft: PhoneRevealWaterfallRunDraft) => Promise<string | null>;
}

export type StartPhoneRevealWaterfallResult =
  | {
      started: true;
      runId: string;
      maxCreditsAuthorized: number;
      lushaEligible: boolean;
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
        | 'create_conflict';
    };

// ── Reserva atómica compartida por los dos arranques ───────────

/** Desenlace del gate de crédito: o hay exposición reservada, o hay un motivo. */
type PhoneRevealWaterfallCreditGate =
  | {
      reserved: true;
      reservationGroupId: string;
      reservations: readonly PhoneRevealCreditReservedLeg[];
    }
  | {
      reserved: false;
      reason:
        | 'insufficient_credits'
        | 'budget_not_configured'
        | 'credit_balance_unavailable'
        | 'active_run_exists';
    };

/**
 * Resuelve el presupuesto y RESERVA la exposición máxima de la modalidad, en ese orden y
 * antes de escribir nada (AGENT2A-PHONE-WATERFALL-4E).
 *
 * Dos pasos y no uno, a propósito:
 *
 *   1. La evaluación PURA distingue los tres rechazos con precisión —no alcanza / no hay
 *      presupuesto / no se pudo leer— y evita una RPC cuando ya se sabe que va a fallar.
 *      Es lo que le permite al operador leer el motivo exacto.
 *   2. La reserva ATÓMICA es la autoridad. Vuelve a comparar dentro de la transacción,
 *      con la exposición ya reservada por otras autorizaciones incluida, que es lo único
 *      que el paso 1 no puede saber sin condición de carrera.
 *
 * `already_reserved` se traduce a `active_run_exists`: ese candidato ya tiene exposición
 * viva, así que hay una autorización en curso y no se abre una segunda.
 */
async function reserveWaterfallCreditsOrBlock(args: {
  mode: PhoneRevealCreditBudgetMode;
  candidateId: string;
  authorizedBy: string;
  deps: PhoneRevealWaterfallCreditReservationDeps;
}): Promise<PhoneRevealWaterfallCreditGate> {
  const { mode, deps } = args;

  const pools = await deps.readCreditPools(
    resolvePhoneRevealCreditBudgetProviders(mode),
  );
  const budget = { model: 'per_provider' as const, pools };
  const verdict = evaluatePhoneRevealCreditBudget({ mode, budget });

  if (verdict.decision === 'insufficient_credits') {
    return { reserved: false, reason: 'insufficient_credits' };
  }
  if (verdict.decision === 'budget_not_configured') {
    return { reserved: false, reason: 'budget_not_configured' };
  }
  if (verdict.decision === 'balance_unavailable') {
    return { reserved: false, reason: 'credit_balance_unavailable' };
  }

  const outcome = await deps.reserveCredits({
    candidateId: args.candidateId,
    authorizedBy: args.authorizedBy,
    reservationGroupId: deps.newReservationGroupId(),
    legs: buildPhoneRevealCreditReservationLegs({ mode, budget }),
  });

  switch (outcome.status) {
    case 'reserved':
      return {
        reserved: true,
        reservationGroupId: outcome.reservationGroupId,
        reservations: outcome.reservations,
      };
    case 'insufficient_credits':
      return { reserved: false, reason: 'insufficient_credits' };
    case 'budget_not_configured':
      return { reserved: false, reason: 'budget_not_configured' };
    case 'already_reserved':
      return { reserved: false, reason: 'active_run_exists' };
    case 'unavailable':
      return { reserved: false, reason: 'credit_balance_unavailable' };
    default: {
      // Un desenlace nuevo rompe la compilación: decidir si una respuesta inédita de la
      // reserva puede seguir gastando proveedores es una decisión de producto.
      const exhaustive: never = outcome;
      void exhaustive;
      return { reserved: false, reason: 'credit_balance_unavailable' };
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
  const maxCreditsAuthorized = resolvePhoneRevealWaterfallMaxCredits(lushaLeg.eligible);

  // PREFLIGHT + RESERVA (AGENT2A-PHONE-WATERFALL-4D/4E). Van justo ANTES del INSERT y
  // DESPUÉS de conocer la modalidad, porque lo exigido depende de ella (Apollo 8 + Lusha
  // 5 con pata Lusha, solo Apollo 8 sin ella). Al eliminarse el modal, este es el último
  // punto en el que se puede parar sin haber escrito nada: si no alcanza, no hay
  // corrida, no hay llamada a Apollo, no hay usage log y no hay créditos.
  const budgetMode = resolvePhoneRevealCreditBudgetMode({
    legacyLushaOnly: false,
    lushaEligible: lushaLeg.eligible,
  });
  const creditGate = await reserveWaterfallCreditsOrBlock({
    mode: budgetMode,
    candidateId,
    authorizedBy: deps.actor.internalUserId,
    deps,
  });
  if (!creditGate.reserved) return { started: false, reason: creditGate.reason };

  // Desde aquí la exposición está OCUPADA. Todo camino que no acabe en una corrida viva
  // tiene que devolverla, o quedaría bloqueando disponibilidad para siempre.
  let runId: string | null;
  try {
    runId = await deps.createRun({
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
      creditReservationGroupId: creditGate.reservationGroupId,
    });
  } catch (err) {
    // El store falló (tabla ausente, timeout, credenciales…). La reserva se libera antes
    // de propagar: ningún proveedor corrió, así que ningún crédito puede haberse gastado.
    await deps.releaseCredits({
      reservations: creditGate.reservations,
      reason: 'run_creation_failed',
    });
    throw err;
  }
  if (!runId) {
    // 23505: otra corrida activa ganó la carrera. Es benigno para el reveal (devolverá
    // `already_pending`) pero la exposición de ESTA autorización no la va a gastar nadie.
    await deps.releaseCredits({
      reservations: creditGate.reservations,
      reason: 'create_conflict',
    });
    return { started: false, reason: 'create_conflict' };
  }

  // Cara de conveniencia de la asociación (la autoritativa ya quedó en el INSERT).
  await deps.attachReservationsToRun({
    reservationGroupId: creditGate.reservationGroupId,
    runId,
  });

  return {
    started: true,
    runId,
    maxCreditsAuthorized,
    lushaEligible: lushaLeg.eligible,
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
  | 'create_conflict';

export interface PhoneRevealWaterfallLegacyEligibility {
  eligible: boolean;
  reason: PhoneRevealWaterfallLegacyIneligibleReason | null;
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
  // Sin id Lusha propio la pata Lusha no existe, así que autorizar 5 créditos sería
  // pedir permiso para una llamada que estructuralmente no puede ocurrir.
  const lushaLeg = evaluatePhoneRevealWaterfallLushaLeg(evidence);
  if (!lushaLeg.eligible) {
    return { eligible: false, reason: 'missing_lusha_contact_id' };
  }
  return { eligible: true, reason: null };
}

export interface StartLegacyPhoneRevealWaterfallInput {
  candidateId: string;
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
  createRun: (draft: PhoneRevealWaterfallRunDraft) => Promise<string | null>;
}

export type StartLegacyPhoneRevealWaterfallResult =
  | {
      started: true;
      runId: string;
      maxCreditsAuthorized: number;
    }
  | {
      started: false;
      reason: PhoneRevealWaterfallLegacyIneligibleReason;
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
 *   * `max_credits_authorized = 5`      (solo Lusha; jamás 13)
 *
 * NO llama a ningún proveedor y NO gasta créditos: solo registra la autorización.
 */
export async function startLegacyPhoneRevealWaterfall(
  input: StartLegacyPhoneRevealWaterfallInput,
  deps: StartLegacyPhoneRevealWaterfallDeps,
): Promise<StartLegacyPhoneRevealWaterfallResult> {
  if (!deps.flagEnabled) return { started: false, reason: 'feature_disabled' };
  if (!isPhoneRevealWaterfallRoleAuthorized(deps.actor.roleKey)) {
    return { started: false, reason: 'role_not_allowed' };
  }

  const candidateId = cleanText(
    typeof input.candidateId === 'string' ? input.candidateId : null,
  );
  if (!candidateId) return { started: false, reason: 'invalid_candidate' };

  const evidence = await deps.loadLegacyEvidence(candidateId);
  if (!evidence) return { started: false, reason: 'candidate_not_found' };

  const eligibility = evaluatePhoneRevealWaterfallLegacyEligibility(evidence);
  if (!eligibility.eligible) {
    return {
      started: false,
      reason: eligibility.reason ?? 'apollo_evidence_missing',
    };
  }

  // Una sola autorización viva por candidato (índice único parcial).
  const active = await deps.findActiveRun(candidateId);
  if (active) return { started: false, reason: 'active_run_exists' };

  // El historial se CLASIFICA, no se cuenta (AGENT2A-PHONE-WATERFALL-2C): una corrida
  // legacy terminal que no consiguió teléfono admite una autorización NUEVA, mientras
  // que una corrida del flujo completo — o una que ya reveló — la cierra.
  const historyVerdict = classifyPhoneRevealWaterfallLegacyHistory(
    await deps.findLatestRun(candidateId),
  );
  if (!historyVerdict.reauthorizable) {
    return { started: false, reason: historyVerdict.reason };
  }

  // PREFLIGHT + RESERVA (AGENT2A-PHONE-WATERFALL-4D/4E). Solo se exige y solo se reserva
  // la pata LUSHA (5): Apollo no se ejecuta bajo esta autorización, así que bloquear —o
  // reservar— por su pozo sería hacerlo por un proveedor que no va a correr. Se hace
  // ANTES del INSERT: sin exposición reservada no hay corrida nueva, no hay llamada a
  // Lusha, no hay usage log y no hay créditos.
  const creditGate = await reserveWaterfallCreditsOrBlock({
    mode: 'legacy_lusha_only',
    candidateId,
    authorizedBy: deps.actor.internalUserId,
    deps,
  });
  if (!creditGate.reserved) return { started: false, reason: creditGate.reason };

  let runId: string | null;
  try {
    runId = await deps.createRun({
      candidateId,
      status: 'lusha_pending',
      runMode: 'legacy_lusha_only',
      authorizedAt: deps.nowIso,
      authorizedBy: deps.actor.internalUserId,
      authorizedByRole: cleanText(deps.actor.roleKey),
      maxCreditsAuthorized: PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
      // Apollo NO se ejecuta bajo esta autorización: sin timestamp inventado.
      apolloAttemptedAt: null,
      // Transcripción del desenlace histórico, sin re-atribuir su costo.
      apolloOutcome: 'no_phone_found',
      apolloCostSource: 'unknown',
      lushaEligible: true,
      lushaSkippedReason: null,
      creditReservationGroupId: creditGate.reservationGroupId,
    });
  } catch (err) {
    await deps.releaseCredits({
      reservations: creditGate.reservations,
      reason: 'run_creation_failed',
    });
    throw err;
  }
  if (!runId) {
    await deps.releaseCredits({
      reservations: creditGate.reservations,
      reason: 'create_conflict',
    });
    return { started: false, reason: 'create_conflict' };
  }

  await deps.attachReservationsToRun({
    reservationGroupId: creditGate.reservationGroupId,
    runId,
  });

  return {
    started: true,
    runId,
    maxCreditsAuthorized: PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
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
        | 'legacy_run_ignores_apollo_event';
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
  const lushaLeg = evaluatePhoneRevealWaterfallLushaLeg(input.candidate);
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
 * Cierra la corrida con el resultado de la pata Lusha.
 *
 * `revealed` ⇒ `completed_lusha` + `final_provider = 'lusha'`. `no_phone_found`
 * ⇒ `exhausted` + `final_provider = 'none'` (Lusha intentó, no reveló: NO puede
 * figurar como proveedor final). Cualquier otro status ⇒ `error`, también con
 * `final_provider = 'none'`.
 *
 * El costo se registra SIEMPRE en las columnas de Lusha, jamás sumado a las de
 * Apollo, y un costo no reportado queda `null` + `unknown`, nunca 0.
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
    maxCreditsAuthorized: number;
  }) => Promise<PhoneRevealWaterfallLushaLegResult>;
}

export type ContinuePhoneRevealWaterfallOutcome =
  | 'lusha_revealed'
  | 'lusha_no_phone_found'
  | 'lusha_error'
  | 'lusha_claim_lost'
  | 'closed_without_lusha'
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

  // 2. Claim atómico. Si no actualiza fila, otro disparador ya tomó la pata: se
  //    sale SIN llamar a Lusha y sin escribir nada más.
  const claimed = await deps.claimLushaAttempt(run.id);
  if (!claimed) {
    return {
      outcome: 'lusha_claim_lost',
      reason: 'already_attempted',
      lushaCalled: false,
    };
  }

  // 3. UNA llamada a Lusha, sin retry. El actor es el operador que autorizó.
  let legResult: PhoneRevealWaterfallLushaLegResult;
  try {
    legResult = await deps.callLushaLeg({
      candidateId,
      runId: run.id,
      authorizedBy: run.authorizedBy,
      maxCreditsAuthorized: run.maxCreditsAuthorized,
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

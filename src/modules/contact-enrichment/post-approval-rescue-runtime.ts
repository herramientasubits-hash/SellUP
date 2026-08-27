// Agente 2A — ORQUESTACIÓN de las tres salidas de rescate del contacto OFICIAL
// (AGENT2A-POST-APPROVAL-RESCUE-PARITY)
//
// Sin red, sin DB, sin auth propia, sin reloj y sin un solo import de servidor: todo lo que toca
// el mundo entra por `deps`. Mismo reparto que `post-approval-reveal-runtime.ts`, y por la misma
// razón: las propiedades que este hito tiene que demostrar —«revisar el resultado no compra
// nada», «la continuación a Lusha no llama a Apollo», «sin candidato fuente no se gasta»— son
// afirmaciones sobre QUÉ dependencias se invocan, y con dependencias inyectadas eso se mide
// contando llamadas.
//
// ── EL CONTRATO, Y CÓMO SE VERIFICA ────────────────────────────
//
// NO hay aquí un segundo waterfall, un segundo Search More ni un segundo recovery. Las tres vías
// son server actions QUE YA EXISTEN, keyed por `candidateId`, con sus gates, su presupuesto, su
// privacidad y su claim atómico:
//
//   deps.recoverRevealNow      → recoverCandidatePhoneRevealNowAction
//   deps.startLushaContinuation→ startLegacyPhoneRevealWaterfallAction
//   deps.startSearchMore       → searchMoreCandidatePhonesAction
//
// Este módulo aporta exactamente dos cosas que ninguna de ellas puede aportar:
//
//   1. resolver el CANDIDATO FUENTE desde el contacto, con la MISMA prueba durable de #352
//      (`contacts.metadata.source_candidate_id`), fail-closed. El navegador manda un id de
//      CONTACTO y nunca uno de candidato, así que no puede apuntar un gasto a un candidato que
//      él elija;
//   2. PROYECTAR el resultado sobre el contacto oficial cuando alguna de las tres consigue un
//      número — que es la sentencia que el pipeline del candidato no tiene.

import {
  classifyOfficialContactPhoneRevealOffer,
  type ProjectApprovedCandidatePhonesOutcome,
} from './post-approval-reveal-core';
import {
  classifyOfficialContactRescueFromStatus,
  type OfficialContactRescueView,
  type LegacyContinuationPreview,
  type SearchMorePreflight,
} from './post-approval-rescue-core';
import {
  projectThenFollowUp,
  type OfficialContactPhoneRevealDeps,
  type OfficialContactRevealContact,
} from './post-approval-reveal-runtime';
import { isPhoneRevealRoleAuthorized } from './phone-reveal-authorized-roles';

// ── Resultados reducidos de las tres tuberías ──────────────────

/** Lo que la revisión manual devuelve, reducido a lo que esta capa necesita. NUNCA el teléfono. */
export interface DelegatedRecoveryResult {
  readonly ok: boolean;
  readonly status: string;
  readonly phoneRevealed: boolean;
  readonly noPhoneFound: boolean;
  readonly stillPending: boolean;
}

export interface DelegatedLegacyResult {
  readonly status: string;
  readonly reason: string | null;
  readonly maxCreditsAuthorized: number | null;
  readonly requiredMaxCredits: number | null;
}

export interface DelegatedSearchMoreResult {
  readonly outcome: string;
  readonly reason: string | null;
  readonly newDistinctPhoneCount: number;
}

export interface OfficialContactRescueDeps extends OfficialContactPhoneRevealDeps {
  /** Estado durable + presencia del id recuperable. `null` ⇒ candidato ilegible. LANZAR ⇒ cerrado. */
  readonly loadRescueFacts: (candidateId: string) => Promise<{
    readonly phoneRevealStatus: string | null;
    readonly hasRecoveryHandle: boolean;
  } | null>;
  /** Vista previa de la continuación a Lusha. `null` ⇒ no se pudo calcular ⇒ no se ofrece. */
  readonly loadLegacyPreview: (candidateId: string) => Promise<LegacyContinuationPreview | null>;
  /** Preflight de «Buscar más números». `null` ⇒ no disponible. */
  readonly loadSearchMorePreflight: (candidateId: string) => Promise<SearchMorePreflight | null>;
  /** GRATIS por contrato: un `GET` al resultado ya producido. No inicia un reveal. */
  readonly recoverRevealNow: (candidateId: string) => Promise<DelegatedRecoveryResult>;
  /** Puede gastar Lusha. NUNCA Apollo. */
  readonly startLushaContinuation: (input: {
    readonly candidateId: string;
    readonly acceptedMaxCredits: number;
  }) => Promise<DelegatedLegacyResult>;
  /** Puede gastar Lusha. NUNCA Apollo. */
  readonly startSearchMore: (candidateId: string) => Promise<DelegatedSearchMoreResult>;
}

function cleanId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const NO_RESCUE: OfficialContactRescueView = {
  recovery: { available: false },
  lushaContinuation: { available: false, maxCredits: null, requiresIdentitySearch: false },
  searchMore: { available: false, maxCredits: null },
};

/**
 * Resuelve el candidato fuente y si el contacto ya tiene teléfono. UNA función, porque las cuatro
 * entradas de este módulo tienen que responder la MISMA pregunta y con la misma precedencia:
 * cuatro copias divergirían, y la que divergiera lo haría hacia autorizar un gasto sin vínculo.
 *
 * `null` = no hay nada que hacer sobre este contacto, por la razón que sea. Es fail-closed: un
 * fallo de lectura no se distingue de «no existe», porque para autorizar un gasto significan lo
 * mismo.
 */
async function resolveRescueTarget(
  contactId: string,
  deps: OfficialContactRescueDeps,
): Promise<{ candidateId: string; contactHasPhone: boolean } | null> {
  let contact: OfficialContactRevealContact | null = null;
  try {
    contact = await deps.loadContact(contactId);
  } catch (err) {
    deps.onReadUnavailable?.(err instanceof Error ? err.message : 'unknown error');
    return null;
  }
  if (!contact) return null;

  const link = classifyOfficialContactPhoneRevealOffer({
    contact,
    liveOfficialPhoneCount: 0,
    candidateLivePhoneCount: 0,
    candidateRevealState: 'unreadable',
  });
  // `missing_source_candidate` y `contact_archived` llegan aquí sin candidato: en los dos casos no
  // se compra nada para este contacto, que es exactamente lo que #352 §9 exige.
  if (!link.candidateId) return null;
  if (link.status === 'contact_archived') return null;

  let liveOfficial = 0;
  try {
    liveOfficial = await deps.countLiveOfficialPhones(contact.id);
  } catch (err) {
    deps.onReadUnavailable?.(err instanceof Error ? err.message : 'unknown error');
    return null;
  }

  const hasScalar =
    cleanId(contact.phone).length > 0 || cleanId(contact.mobilePhone).length > 0;

  return { candidateId: link.candidateId, contactHasPhone: hasScalar || liveOfficial > 0 };
}

// ── 1. Qué salidas hay, ANTES de cualquier clic ────────────────

/**
 * SOLO LECTURA. Ninguna de las tres tuberías se invoca en ningún camino de esta función: la ficha
 * puede preguntar «¿qué puedo hacer?» tantas veces como quiera sin que eso cueste un crédito.
 *
 * Las dos vistas previas se piden en PARALELO y sólo cuando hay candidato. Un fallo de cualquiera
 * de las dos apaga SU oferta y no las otras: no poder calcular el tope de Lusha no es razón para
 * esconder el botón gratis de revisar el resultado.
 */
export async function runOfficialContactRescueOptions(
  contactId: string,
  deps: OfficialContactRescueDeps,
): Promise<OfficialContactRescueView> {
  const id = cleanId(contactId);
  if (!id) return NO_RESCUE;
  if (!isPhoneRevealRoleAuthorized(deps.actor.roleKey)) return NO_RESCUE;

  const target = await resolveRescueTarget(id, deps);
  if (!target) return NO_RESCUE;

  let facts: { phoneRevealStatus: string | null; hasRecoveryHandle: boolean } | null = null;
  try {
    facts = await deps.loadRescueFacts(target.candidateId);
  } catch (err) {
    deps.onReadUnavailable?.(err instanceof Error ? err.message : 'unknown error');
    return NO_RESCUE;
  }
  if (!facts) return NO_RESCUE;

  const [legacy, searchMore] = await Promise.all([
    deps
      .loadLegacyPreview(target.candidateId)
      .catch(() => null),
    deps
      .loadSearchMorePreflight(target.candidateId)
      .catch(() => null),
  ]);

  return classifyOfficialContactRescueFromStatus(facts.phoneRevealStatus, {
    contactHasPhone: target.contactHasPhone,
    hasRecoveryHandle: facts.hasRecoveryHandle,
    legacy,
    searchMore,
  });
}

// ── 2. Revisar AHORA el resultado (gratis) ─────────────────────

export interface OfficialContactRescueOutcome {
  readonly ok: boolean;
  /** Código mecánico del subsistema delegado, TAL CUAL. No se re-mapea a una segunda taxonomía. */
  readonly status: string;
  /** true SOLO si el número quedó guardado en el CONTACTO en esta misma llamada. */
  readonly phoneProjected: boolean;
  readonly projectionStatus: ProjectApprovedCandidatePhonesOutcome['status'] | null;
  /** Sólo en la continuación a Lusha: el tope que la modalidad real exige, si cambió. */
  readonly requiredMaxCredits: number | null;
  /** Sólo en Search More: cuántos números NUEVOS y distintos entraron en la colección. */
  readonly newDistinctPhoneCount: number;
}

const CLOSED: OfficialContactRescueOutcome = {
  ok: false,
  status: 'not_available',
  phoneProjected: false,
  projectionStatus: null,
  requiredMaxCredits: null,
  newDistinctPhoneCount: 0,
};

/**
 * Proyecta lo que el candidato tenga AHORA y devuelve el desenlace unificado.
 *
 * Se llama después de las tres tuberías, y siempre por el MISMO camino: la 128 es idempotente
 * —`ON CONFLICT DO NOTHING` bajo el lock—, así que proyectar cuando no hubo número nuevo no
 * escribe nada y no dispara la fase 2 de HubSpot (su puerta es «¿lo dejó ESTA proyección?»).
 */
async function projectAfterRescue(
  args: { candidateId: string; contactId: string },
  deps: OfficialContactRescueDeps,
  base: Omit<OfficialContactRescueOutcome, 'phoneProjected' | 'projectionStatus'>,
): Promise<OfficialContactRescueOutcome> {
  const { projected } = await projectThenFollowUp(
    { ...args, actorId: deps.actor.internalUserId },
    deps,
  );
  return {
    ...base,
    phoneProjected: projected?.status === 'projected' && projected.phonesInserted > 0,
    projectionStatus: projected ? projected.status : null,
  };
}

/**
 * Revisa AHORA el resultado de un reveal en vuelo. Es LA salida del «se queda cargando»: no
 * espera al webhook, va a preguntar.
 *
 * GRATIS por contrato del subsistema delegado: como máximo un `GET /webhook_result/{id}`, que no
 * crea un reveal y no consume créditos de revelación. Por eso NO se exige que la oferta sea
 * accionable ni se consulta el tope: no hay nada que autorizar.
 */
export async function runOfficialContactRecoverReveal(
  contactId: string,
  deps: OfficialContactRescueDeps,
): Promise<OfficialContactRescueOutcome> {
  const id = cleanId(contactId);
  if (!id) return CLOSED;
  if (!isPhoneRevealRoleAuthorized(deps.actor.roleKey)) return CLOSED;

  const target = await resolveRescueTarget(id, deps);
  if (!target) return CLOSED;

  const result = await deps.recoverRevealNow(target.candidateId);

  // Se proyecta SIEMPRE que la revisión haya cerrado el caso con número. Si sigue pendiente no se
  // abre una transacción para descubrir que no hay nada: sería una transacción por cada consulta.
  if (!result.phoneRevealed) {
    return {
      ok: result.ok,
      status: result.status,
      phoneProjected: false,
      projectionStatus: null,
      requiredMaxCredits: null,
      newDistinctPhoneCount: 0,
    };
  }

  return projectAfterRescue(
    { candidateId: target.candidateId, contactId: id },
    deps,
    { ok: result.ok, status: result.status, requiredMaxCredits: null, newDistinctPhoneCount: 0 },
  );
}

// ── 3. Continuar a Lusha cuando Apollo cerró sin número ────────

/**
 * La pata Lusha, sobre un candidato cuyo Apollo ya cerró. NUNCA llama a Apollo: la única vía es
 * `deps.startLushaContinuation`, y `deps.startCandidateReveal` no se invoca en ningún camino de
 * esta función.
 *
 * `acceptedMaxCredits` es el tope que el operador ACABA de leer y viaja al servidor como límite
 * superior duro: si entre el render y el clic la modalidad subió, el servidor corta sin reservar y
 * devuelve `requiredMaxCredits` para que la ficha vuelva a preguntar con la cifra correcta.
 */
export async function runOfficialContactLushaContinuation(
  input: { readonly contactId: string; readonly acceptedMaxCredits: number },
  deps: OfficialContactRescueDeps,
): Promise<OfficialContactRescueOutcome> {
  const id = cleanId(input?.contactId);
  if (!id) return CLOSED;
  if (!isPhoneRevealRoleAuthorized(deps.actor.roleKey)) return CLOSED;

  const target = await resolveRescueTarget(id, deps);
  if (!target) return CLOSED;

  // Un contacto que YA tiene teléfono no continúa a Lusha: para números adicionales existe
  // «Buscar más números», que es la operación que el operador quiso pedir.
  if (target.contactHasPhone) return { ...CLOSED, status: 'phone_already_present' };

  const result = await deps.startLushaContinuation({
    candidateId: target.candidateId,
    acceptedMaxCredits: input.acceptedMaxCredits,
  });

  return projectAfterRescue(
    { candidateId: target.candidateId, contactId: id },
    deps,
    {
      ok: result.status === 'completed',
      status: result.status,
      requiredMaxCredits: result.requiredMaxCredits,
      newDistinctPhoneCount: 0,
    },
  );
}

// ── 4. Buscar más números ──────────────────────────────────────

/**
 * Números ADICIONALES en Lusha, y su proyección al contacto. Es la única de las tres que tiene
 * sentido con un teléfono ya presente: ése es literalmente su propósito.
 *
 * Todo lo que decide el gasto —plan, presupuesto, reserva, privacidad, claim— lo recomputa el
 * runtime delegado sobre estado recargado. Aquí no se re-deriva ni el tope.
 */
export async function runOfficialContactSearchMore(
  contactId: string,
  deps: OfficialContactRescueDeps,
): Promise<OfficialContactRescueOutcome> {
  const id = cleanId(contactId);
  if (!id) return CLOSED;
  if (!isPhoneRevealRoleAuthorized(deps.actor.roleKey)) return CLOSED;

  const target = await resolveRescueTarget(id, deps);
  if (!target) return CLOSED;

  const result = await deps.startSearchMore(target.candidateId);

  return projectAfterRescue(
    { candidateId: target.candidateId, contactId: id },
    deps,
    {
      ok: result.outcome === 'completed',
      status: result.reason ?? result.outcome,
      requiredMaxCredits: null,
      newDistinctPhoneCount: result.newDistinctPhoneCount,
    },
  );
}

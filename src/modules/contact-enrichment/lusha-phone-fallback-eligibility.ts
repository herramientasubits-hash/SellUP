/**
 * lusha-phone-fallback-eligibility.ts — Pure eligibility gate for the FUTURE,
 * manual, single-candidate Lusha phone reveal fallback (Agente 2A ·
 * LUSHA-PHONE-FALLBACK-1S).
 *
 * Context: Apollo phone reveal is closed/live. Lusha phone reveal is
 * separately approved as a manual fallback (Legal/Compliance GO, Product GO,
 * Spend GO conditioned) ONLY after a candidate's Apollo reveal already
 * returned `no_phone_found`. Scope: single candidate, manual, no bulk, no
 * automatic retry, no HubSpot write.
 *
 * A senior Lusha support ticket must still confirm two open questions before
 * this can go live: whether a `v1.`-prefixed contact id can be reused
 * days/weeks later (`lushaContactIdReuseConfirmed`), and whether
 * `reveal:["phones"]` requires an additional entitlement
 * (`lushaPhoneEntitlementConfirmed`). Both inputs represent facts the ticket
 * must confirm, so no real caller can truthfully set either to `true` until
 * the ticket resolves — today's production callers therefore always hit
 * `waiting_lusha_ticket` (both unconfirmed) or one of the two narrower codes
 * below, never `eligible`. This module does not hardcode that as an
 * unconditional constant: it evaluates exactly the inputs it is given, which
 * keeps every branch — including the eligible path — reachable and testable.
 *
 * Pure: no I/O, no DB, no provider call, no process.env read. The resolved
 * feature-flag value is injected via `featureFlagEnabled` (see
 * isLushaPhoneRevealFallbackEnabled in src/lib/feature-flags.server.ts) so
 * this module stays trivially unit-testable. Checks run in a fixed, testable
 * order and return at the first blocking condition — mirrors the ordered-gate
 * convention in apollo-enrichment-eligibility-gate.ts.
 */

/**
 * Structured reason the fallback was not offered. Every non-`eligible` value
 * means: 0 Lusha calls, 0 credits, no UI action surfaced.
 */
export type LushaPhoneFallbackEligibilityReasonCode =
  | 'feature_disabled'
  | 'unauthorized_role'
  | 'bulk_not_allowed'
  | 'candidate_not_editable'
  | 'apollo_not_exhausted'
  | 'existing_phone_present'
  | 'missing_lusha_contact_id'
  | 'waiting_lusha_ticket'
  | 'lusha_id_reuse_unconfirmed'
  | 'entitlement_unconfirmed'
  | 'missing_cost_confirmation'
  | 'eligible';

/**
 * Evaluation order, declared as data so precedence is testable and readable
 * without tracing branches (same convention as APOLLO_ENRICHMENT_GATE_ORDER).
 */
export const LUSHA_PHONE_FALLBACK_ELIGIBILITY_GATE_ORDER: readonly LushaPhoneFallbackEligibilityReasonCode[] =
  [
    'feature_disabled',
    'unauthorized_role',
    'bulk_not_allowed',
    'candidate_not_editable',
    'apollo_not_exhausted',
    'existing_phone_present',
    'missing_lusha_contact_id',
    'waiting_lusha_ticket',
    'lusha_id_reuse_unconfirmed',
    'entitlement_unconfirmed',
    'missing_cost_confirmation',
  ] as const;

/**
 * AGENT2A-APPROVED-CANDIDATE-LUSHA-LEG — estados que dejan al candidato NO editable SIN
 * excepción posible. `approved` YA NO está aquí, y ésa es toda la corrección.
 *
 * ═══════════════════════════════════════════════════════════════
 * POR QUÉ `approved` ERA UN DEFECTO Y NO UNA PROTECCIÓN
 * ═══════════════════════════════════════════════════════════════
 *
 * Todo contacto oficial ES, por definición, un candidato `approved`. Con `approved` en la lista
 * de arriba, la pata Lusha era ESTRUCTURALMENTE imposible para el 100 % de los contactos
 * aprobados: Apollo corría, cerraba `no_phone_found`, Lusha se intentaba y moría en esta puerta
 * con `candidate_not_editable`. Medido en Producción: 5 corridas consecutivas sobre el mismo
 * contacto, las cinco idénticas, `lusha_eligible = true`, `lusha_skipped_reason = null`,
 * `lusha_outcome = error`, `final_provider = none`.
 *
 * Y la puerta era ADEMÁS asimétrica: la pata de APOLLO no comprueba editabilidad en ningún
 * punto —`runRevealCandidatePhone` no tiene este gate— y por tanto ya escribía
 * `phone_reveal_status`, la colección de teléfonos y la metadata sobre candidatos aprobados. Lo
 * demuestra el mismo dato de Producción: esas cinco corridas dejaron `no_phone_found` ESCRITO en
 * un candidato `approved`. Así que «aprobado = congelado» no era una regla del sistema: era una
 * regla de UN proveedor, y la que dejaba al otro sin poder contestar.
 *
 * La premisa original —que un candidato aprobado está congelado porque ya se promovió a
 * contacto— quedó obsoleta con la migración 128
 * (`project_approved_candidate_phones_onto_contact`), que existe precisamente para llevar los
 * teléfonos de un candidato aprobado a SU contacto oficial.
 *
 * `rejected`, `discarded` y `archived` siguen bloqueados sin excepción: ésos no tienen un
 * contacto vivo al que proyectar nada, y ahí «no editable» sigue siendo la verdad.
 */
const PERMANENTLY_NOT_EDITABLE_STATE_VALUES: ReadonlySet<string> = new Set([
  'rejected',
  'discarded',
  'archived',
]);

export interface CandidatePhoneCollectionEditabilityInput {
  readonly candidateStatus: string | null;
  readonly candidateReviewStatus: string | null;
  readonly candidateArchivedAt: string | null;
  /**
   * `contact_enrichment_candidates.matched_contacts_id`: el contacto oficial que la APROBACIÓN
   * registró. Es el MISMO valor que la migración 128 exige como token de confirmación, así que
   * exigirlo aquí no inventa un vínculo nuevo — usa el único que ya es autoridad.
   *
   * `null` sobre un candidato `approved` ⇒ sigue bloqueado, fail-closed: sin destino registrado
   * no hay dónde proyectar el teléfono que se compraría.
   */
  readonly officialContactId: string | null;
}

/**
 * ¿Se puede RECOLECTAR TELÉFONO para este candidato?
 *
 * Es deliberadamente una pregunta distinta de «¿se puede editar la revisión del candidato?». Un
 * candidato aprobado está cerrado para la REVISIÓN —no se vuelve a aprobar ni a rechazar— y sigue
 * abierto para el TELÉFONO, porque su contacto oficial existe y lo necesita.
 *
 * Vive en UNA función exportada, y no repetida en cada puerta, por la razón de siempre: son dos
 * los sitios que la preguntan —el gate canónico de abajo y el pre-filtro del waterfall legacy— y
 * dos copias divergirían. La que divergiera lo haría en la dirección peligrosa: volver a prohibir
 * el único camino que le queda a un contacto sin teléfono.
 */
export function isCandidateEditableForPhoneCollection(
  input: CandidatePhoneCollectionEditabilityInput,
): boolean {
  if (input.candidateArchivedAt !== null) return false;

  for (const value of [input.candidateReviewStatus, input.candidateStatus]) {
    if (value !== null && PERMANENTLY_NOT_EDITABLE_STATE_VALUES.has(value)) return false;
  }

  // `approved` en CUALQUIERA de los dos campos exige destino registrado. Se comprueba sobre los
  // dos y no sólo sobre `status` para que un futuro `candidateReviewStatus` no abra una segunda
  // puerta más laxa que ésta.
  const approvedSomewhere =
    input.candidateReviewStatus === 'approved' || input.candidateStatus === 'approved';
  if (approvedSomewhere && input.officialContactId === null) return false;

  return true;
}

/**
 * Roles authorized to see/trigger the fallback. Deliberately the MOST
 * restrictive option (admin only) rather than mirroring Apollo's
 * admin + commercial_manager pair.
 *
 * TODO(LUSHA-PHONE-FALLBACK): if business decides to equalize with Apollo's
 * PHONE_REVEAL_AUTHORIZED_ROLE_KEYS, widen this in a later, separate block —
 * not implicitly here.
 */
const LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS: ReadonlySet<string> = new Set([
  'admin',
]);

export interface LushaPhoneFallbackEligibilityInput {
  candidateStatus: string | null;
  candidateReviewStatus: string | null;
  candidateArchivedAt: string | null;
  /**
   * AGENT2A-APPROVED-CANDIDATE-LUSHA-LEG — el contacto oficial que la aprobación registró
   * (`matched_contacts_id`). OBLIGATORIO y sin `?`: un llamador nuevo que se olvidara de
   * resolverlo rompe la compilación en vez de heredar en silencio el defecto que este cambio
   * cierra —un candidato aprobado que vuelve a ser «no editable» y deja al contacto sin teléfono.
   */
  officialContactId: string | null;
  /** Apollo's phone_reveal_status vocabulary value for this candidate. */
  phoneRevealStatus: string | null;
  hasExistingPhone: boolean;
  hasLushaContactId: boolean;
  /** True only once the pending Lusha ticket confirms id reuse is safe. */
  lushaContactIdReuseConfirmed: boolean;
  /** True only once the pending Lusha ticket confirms the entitlement exists. */
  lushaPhoneEntitlementConfirmed: boolean;
  featureFlagEnabled: boolean;
  actorRole: string | null;
  hasConfirmedCost: boolean;
  isBulkAction: boolean;
}

export interface LushaPhoneFallbackEligibilityResult {
  eligible: boolean;
  reasonCode: LushaPhoneFallbackEligibilityReasonCode;
}

/**
 * Evaluates whether the Lusha phone reveal fallback should be offered for one
 * candidate. Eligible only when every gate below passes, in order.
 */
export function evaluateLushaPhoneFallbackEligibility(
  input: LushaPhoneFallbackEligibilityInput,
): LushaPhoneFallbackEligibilityResult {
  if (!input.featureFlagEnabled) {
    return { eligible: false, reasonCode: 'feature_disabled' };
  }
  if (!input.actorRole || !LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS.has(input.actorRole)) {
    return { eligible: false, reasonCode: 'unauthorized_role' };
  }
  if (input.isBulkAction) {
    return { eligible: false, reasonCode: 'bulk_not_allowed' };
  }
  // AGENT2A-APPROVED-CANDIDATE-LUSHA-LEG: la editabilidad PARA TELÉFONO, que es una pregunta
  // distinta de la editabilidad de la revisión. Un candidato aprobado con contacto oficial
  // registrado pasa; `rejected`/`discarded`/`archived` siguen bloqueados igual que antes.
  if (
    !isCandidateEditableForPhoneCollection({
      candidateStatus: input.candidateStatus,
      candidateReviewStatus: input.candidateReviewStatus,
      candidateArchivedAt: input.candidateArchivedAt,
      officialContactId: input.officialContactId,
    })
  ) {
    return { eligible: false, reasonCode: 'candidate_not_editable' };
  }
  if (input.phoneRevealStatus !== 'no_phone_found') {
    return { eligible: false, reasonCode: 'apollo_not_exhausted' };
  }
  if (input.hasExistingPhone) {
    return { eligible: false, reasonCode: 'existing_phone_present' };
  }
  if (!input.hasLushaContactId) {
    return { eligible: false, reasonCode: 'missing_lusha_contact_id' };
  }
  if (!input.lushaContactIdReuseConfirmed && !input.lushaPhoneEntitlementConfirmed) {
    // Neither open ticket question has been confirmed yet — the whole ticket
    // is still pending, not just one specific fact.
    return { eligible: false, reasonCode: 'waiting_lusha_ticket' };
  }
  if (!input.lushaContactIdReuseConfirmed) {
    return { eligible: false, reasonCode: 'lusha_id_reuse_unconfirmed' };
  }
  if (!input.lushaPhoneEntitlementConfirmed) {
    return { eligible: false, reasonCode: 'entitlement_unconfirmed' };
  }
  if (!input.hasConfirmedCost) {
    return { eligible: false, reasonCode: 'missing_cost_confirmation' };
  }
  return { eligible: true, reasonCode: 'eligible' };
}

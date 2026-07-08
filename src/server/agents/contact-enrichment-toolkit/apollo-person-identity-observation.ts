/**
 * Apollo Person Identity Observation — Agente 2A · 17B.4X.3
 *
 * Funciones puras (sin llamadas de red, sin Supabase, sin IA) que hacen
 * OBSERVABLE la correlación entre la identidad de un candidato Apollo tal
 * como llegó de `people_search` y la identidad devuelta por `people/match`
 * durante el completado selectivo (`contact-completion-adapter.ts`).
 *
 * Modo OBSERVATION_FIRST (17B.4X.2A/2B): esta observación es exclusivamente
 * informativa. NO decide aprobación, NO participa en el gate de identidad de
 * `runApproveCandidate` (que solo lee `enrichment_metadata.person_identity`),
 * y se persiste en una clave separada:
 * `enrichment_metadata.apollo_person_identity_observation`.
 *
 * Prohibido explícitamente:
 *   - agregar `identity_consistency` (estado agregado) — solo evidencia por campo
 *   - fuzzy matching / IA / score de confianza
 *   - persistir email crudo o cualquier payload del proveedor
 *   - atribuir las señales a "lo que Apollo usó internamente": solo reflejan
 *     los campos que SellUp efectivamente envió en el request de match
 */

import type { MatchPersonParams } from '@/server/integrations/apollo-client';
import type { NormalizedApolloContact } from './contact-normalizer';
import {
  computePersonIdConsistency,
  computePersonNameConsistency,
  type IdentityFieldConsistency,
} from './lusha-person-identity-evidence';

export type { IdentityFieldConsistency };

/** Señales presentes en el request de `people/match` efectivamente enviado a Apollo. */
export interface ApolloMatchRequestSignalPresenceV1 {
  id: boolean;
  linkedin: boolean;
  email: boolean;
  name: boolean;
  company: boolean;
}

/**
 * Evidencia observacional de identidad de persona para el flujo Apollo
 * search → match. Se persiste en
 * `contact_enrichment_candidates.enrichment_metadata.apollo_person_identity_observation`.
 *
 * No contiene: payload crudo del proveedor, email, score de confianza,
 * estado agregado de consistencia ni notas de observación.
 */
export interface ApolloPersonIdentityObservationV1 {
  /** sourceContactId (Apollo person ID) del candidato en people_search. */
  search_contact_id: string | null;
  search_full_name: string | null;
  search_linkedin_url: string | null;

  /** Identidad devuelta por people/match. Null cuando no hubo persona coincidente. */
  match_contact_id: string | null;
  match_full_name: string | null;
  match_linkedin_url: string | null;

  /** Campos presentes en el `MatchPersonParams` realmente enviado a Apollo. */
  match_request_signals: ApolloMatchRequestSignalPresenceV1;

  /** Consistencia exacta del provider contact ID (sin normalización). */
  id_consistency: IdentityFieldConsistency;
  /** Consistencia del nombre normalizado (determinista, sin fuzzy). */
  name_consistency: IdentityFieldConsistency;
}

/**
 * Deriva las señales de identidad presentes en el `MatchPersonParams`
 * efectivamente construido y enviado a `matchPerson`. Refleja el request de
 * SellUp, no una atribución de qué usó Apollo internamente para resolver el match.
 */
export function computeApolloMatchRequestSignals(
  matchParams: MatchPersonParams,
): ApolloMatchRequestSignalPresenceV1 {
  return {
    id: !!matchParams.id,
    linkedin: !!matchParams.linkedin_url,
    email: !!matchParams.email,
    name: !!(matchParams.first_name || matchParams.last_name),
    company: !!(matchParams.organization_name || matchParams.domain),
  };
}

export interface ComputeApolloPersonIdentityObservationInput {
  /** Candidato tal como llegó de people_search (identidad de búsqueda). */
  searchContact: NormalizedApolloContact;
  /**
   * Contacto normalizado devuelto por people/match. Null cuando el request se
   * ejecutó pero Apollo no devolvió una persona coincidente (o el intento falló).
   */
  matchContact: NormalizedApolloContact | null;
  /** Params exactos enviados al request de people/match realmente ejecutado. */
  matchParams: MatchPersonParams;
}

/**
 * Construye la observación de identidad Apollo a partir de la identidad de
 * search, la identidad de match (si existe) y los params del request real.
 * Determinista: mismos inputs producen siempre el mismo output.
 */
export function computeApolloPersonIdentityObservation(
  input: ComputeApolloPersonIdentityObservationInput,
): ApolloPersonIdentityObservationV1 {
  const { searchContact, matchContact, matchParams } = input;

  return {
    search_contact_id: searchContact.sourceContactId ?? null,
    search_full_name: searchContact.fullName ?? null,
    search_linkedin_url: searchContact.linkedinUrl ?? null,

    match_contact_id: matchContact?.sourceContactId ?? null,
    match_full_name: matchContact?.fullName ?? null,
    match_linkedin_url: matchContact?.linkedinUrl ?? null,

    match_request_signals: computeApolloMatchRequestSignals(matchParams),

    id_consistency: computePersonIdConsistency(
      searchContact.sourceContactId,
      matchContact?.sourceContactId ?? null,
    ),
    name_consistency: computePersonNameConsistency(
      searchContact.fullName,
      matchContact?.fullName ?? null,
    ),
  };
}

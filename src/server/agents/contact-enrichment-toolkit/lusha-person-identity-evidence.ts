/**
 * Lusha Person Identity Evidence — Agente 2A · 17B.4W.6
 *
 * Funciones puras (sin llamadas de red, sin Supabase, sin IA) para hacer
 * OBSERVABLE la suposición de identidad de persona en el flujo Lusha
 * company-first (prospecting → enrich).
 *
 * Este hito es NO bloqueante: no decide si se crea un candidato, no aprueba,
 * no rechaza y no infiere propiedad del correo. Solo captura la identidad
 * usada para pedir el enrich (prospecting) y la identidad devuelta por el
 * enrich, y calcula una observación determinista de consistencia.
 *
 * Prohibido explícitamente (17B.4W.6 §7/§9):
 *   - heurística de propiedad del correo / local-part
 *   - fuzzy matching / tokenización por similitud
 *   - reordenar nombres, traducir, inferir apodos
 *   - IA / scores de confianza
 */

/** Consistencia de un campo de identidad individual (ID o nombre). */
export type IdentityFieldConsistency = 'match' | 'mismatch' | 'not_available';

/** Estado agregado de consistencia de identidad de la persona. */
export type OverallIdentityConsistency =
  | 'consistent'
  | 'mismatch'
  | 'insufficient_evidence';

/**
 * Evidencia mínima y tipada de consistencia de identidad para un candidato
 * Lusha company-first. Se persiste dentro de
 * `contact_enrichment_candidates.enrichment_metadata.person_identity`.
 *
 * No contiene: payload crudo del proveedor, secretos, veredicto de propiedad
 * del correo, score de confianza ni análisis por IA.
 */
export interface LushaPersonIdentityEvidenceV1 {
  /** contactId usado en la fase de prospecting para pedir el enrich. */
  prospect_contact_id: string;
  /** Nombre completo crudo del contacto en prospecting. */
  prospect_full_name: string | null;
  /** LinkedIn del contacto en prospecting (identificador de búsqueda). */
  prospect_linkedin_url: string | null;

  /** id de persona devuelto por el enrich de Lusha. */
  enrich_contact_id: string | null;
  /** Nombre completo devuelto por el enrich de Lusha. */
  enrich_full_name: string | null;
  /** LinkedIn devuelto por el enrich de Lusha. */
  enrich_linkedin_url: string | null;

  /** Consistencia exacta del provider contact ID (sin normalización). */
  id_consistency: IdentityFieldConsistency;
  /** Consistencia del nombre normalizado (determinista, sin fuzzy). */
  name_consistency: IdentityFieldConsistency;
  /** Estado agregado observable de la identidad. */
  identity_consistency: OverallIdentityConsistency;
}

/**
 * Normaliza un nombre de persona SOLO para comparación de identidad:
 *   - trim
 *   - minúsculas
 *   - Unicode NFD
 *   - elimina marcas combinantes (acentos): "Cláudia" ≡ "claudia"
 *   - colapsa espacios múltiples
 *
 * NO reordena, NO tokeniza por similitud, NO traduce, NO infiere apodos.
 * Espeja el contrato de `nameKey` de contact-deduplicator (privado a ese
 * módulo); se mantiene local para no ampliar el alcance del hito.
 */
export function normalizePersonNameForIdentity(
  input: string | null | undefined,
): string | null {
  if (input == null) return null;
  const normalized = input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

/**
 * Consistencia exacta del provider contact ID. Sin normalización, sin
 * coincidencia parcial, sin fallback al nombre.
 */
export function computePersonIdConsistency(
  prospectContactId: string | null | undefined,
  enrichContactId: string | null | undefined,
): IdentityFieldConsistency {
  const prospect = typeof prospectContactId === 'string' ? prospectContactId : null;
  const enrich = typeof enrichContactId === 'string' ? enrichContactId : null;
  if (!prospect || !enrich) return 'not_available';
  return prospect === enrich ? 'match' : 'mismatch';
}

/**
 * Consistencia del nombre por igualdad exacta del nombre normalizado.
 * Observación determinista: un mismatch NO prueba que el proveedor devolvió
 * la persona equivocada.
 */
export function computePersonNameConsistency(
  prospectFullName: string | null | undefined,
  enrichFullName: string | null | undefined,
): IdentityFieldConsistency {
  const prospect = normalizePersonNameForIdentity(prospectFullName);
  const enrich = normalizePersonNameForIdentity(enrichFullName);
  if (!prospect || !enrich) return 'not_available';
  return prospect === enrich ? 'match' : 'mismatch';
}

/**
 * Agregación determinista del estado de identidad.
 *   - cualquier mismatch (id o nombre) → mismatch
 *   - id match Y nombre match          → consistent
 *   - en otro caso                     → insufficient_evidence
 */
export function computeOverallIdentityConsistency(
  idConsistency: IdentityFieldConsistency,
  nameConsistency: IdentityFieldConsistency,
): OverallIdentityConsistency {
  if (idConsistency === 'mismatch' || nameConsistency === 'mismatch') {
    return 'mismatch';
  }
  if (idConsistency === 'match' && nameConsistency === 'match') {
    return 'consistent';
  }
  return 'insufficient_evidence';
}

export interface BuildLushaPersonIdentityEvidenceInput {
  prospectContactId: string;
  prospectFullName: string | null;
  prospectLinkedinUrl: string | null;
  enrichContactId: string | null;
  enrichFullName: string | null;
  enrichLinkedinUrl: string | null;
}

/**
 * Construye la evidencia de identidad v1 a partir de la identidad de
 * prospecting (usada para pedir el enrich) y la identidad devuelta por el
 * enrich. Todos los estados de consistencia se calculan de forma determinista.
 */
export function buildLushaPersonIdentityEvidence(
  input: BuildLushaPersonIdentityEvidenceInput,
): LushaPersonIdentityEvidenceV1 {
  const idConsistency = computePersonIdConsistency(
    input.prospectContactId,
    input.enrichContactId,
  );
  const nameConsistency = computePersonNameConsistency(
    input.prospectFullName,
    input.enrichFullName,
  );
  const identityConsistency = computeOverallIdentityConsistency(
    idConsistency,
    nameConsistency,
  );

  return {
    prospect_contact_id: input.prospectContactId,
    prospect_full_name: input.prospectFullName,
    prospect_linkedin_url: input.prospectLinkedinUrl,
    enrich_contact_id: input.enrichContactId,
    enrich_full_name: input.enrichFullName,
    enrich_linkedin_url: input.enrichLinkedinUrl,
    id_consistency: idConsistency,
    name_consistency: nameConsistency,
    identity_consistency: identityConsistency,
  };
}

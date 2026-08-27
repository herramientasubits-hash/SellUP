// Agente 2A — Candidate Review Core (Hito 17A.4B)
// Lógica pura y orquestación inyectable para aprobar/rechazar candidatos de
// contacto. Sin red, sin DB, sin auth: las dependencias se inyectan para poder
// testear sin Supabase. Las server actions (actions.ts) cablean las
// implementaciones reales sobre estos contratos.
//
// Reglas del hito:
//  - Aprobar crea un contacto oficial en `contacts` y marca el candidato approved.
//  - Para crear contacto oficial DEBE existir una cuenta SellUp (contacts.account_id
//    es NOT NULL). Sin account_id ⇒ se bloquea la aprobación.
//  - Antes de crear, se valida duplicidad contra los contactos de la cuenta.
//  - NUNCA se llama a Apollo ni a HubSpot desde aquí.

import type {
  ContactSource as OfficialContactSource,
  ContactSeniority,
} from '@/modules/contacts/types';
import type {
  ContactSource as CandidateSource,
  ContactCandidateStatus,
  ContactDuplicateStatus,
  ContactCandidatePhoneRevealAudit,
  PhoneType,
  PhoneSource,
} from './types';
import {
  buildInitialHubSpotSyncState,
  writeHubSpotSyncState,
  type HubSpotSyncState,
} from '@/modules/contacts/contact-hubspot-sync-state';

// ── Normalización de claves de deduplicación ───────────────────
// Espejo de las reglas de contact-deduplicator.ts (email/linkedin exactos,
// nombre como posible duplicado), pero aplicadas contra `contacts` por cuenta.

export function emailKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value.trim().toLowerCase();
  return k.length > 0 ? k : null;
}

export function linkedinKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value.trim().toLowerCase().replace(/\/+$/, '');
  return k.length > 0 ? k : null;
}

export function nameKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
  return k.length > 0 ? k : null;
}

// ── Deduplicación contra contactos existentes de la cuenta ──────

export interface ExistingContactForDedup {
  id: string;
  email: string | null;
  linkedin_url: string | null;
  full_name: string;
}

export interface CandidateDedupInput {
  email: string | null;
  linkedin_url: string | null;
  full_name: string;
}

export interface DuplicateMatch {
  contactId: string;
  matchedBy: 'email' | 'linkedin' | 'name';
}

/**
 * Encuentra un contacto existente que duplique al candidato dentro de la misma
 * cuenta. Orden: email → linkedin → (solo si no hay email ni linkedin) nombre.
 * Devuelve `null` si no hay coincidencia.
 */
export function findDuplicateContact(
  candidate: CandidateDedupInput,
  existing: ExistingContactForDedup[],
): DuplicateMatch | null {
  const eKey = emailKey(candidate.email);
  const lKey = linkedinKey(candidate.linkedin_url);
  const nKey = nameKey(candidate.full_name);

  if (eKey) {
    const match = existing.find((c) => emailKey(c.email) === eKey);
    if (match) return { contactId: match.id, matchedBy: 'email' };
  }

  if (lKey) {
    const match = existing.find((c) => linkedinKey(c.linkedin_url) === lKey);
    if (match) return { contactId: match.id, matchedBy: 'linkedin' };
  }

  // Fallback por nombre solo cuando el candidato no tiene email ni linkedin.
  if (!eKey && !lKey && nKey) {
    const match = existing.find((c) => nameKey(c.full_name) === nKey);
    if (match) return { contactId: match.id, matchedBy: 'name' };
  }

  return null;
}

export function duplicateStatusFromMatch(match: DuplicateMatch): ContactDuplicateStatus {
  return match.matchedBy === 'name' ? 'possible_duplicate' : 'exact_duplicate';
}

// ── Identidad CONFIABLE de un contacto existente (4O-H3-B) ──────
//
// `findDuplicateContact()` responde «¿debo AVISAR de que esto ya existe?». Lo que sigue responde
// una pregunta distinta y mucho más exigente: «¿puedo ESCRIBIR en esa fila?». Avisar de más es
// una molestia; escribir en la fila equivocada mezcla los datos de dos personas, y por eso las
// dos preguntas no comparten respuesta.
//
// Diferencias deliberadas con `findDuplicateContact()`:
//
//   * el NOMBRE no participa. Ni exacto, ni normalizado, ni parecido;
//   * `.find()` (el PRIMER match del array) se sustituye por un CONTEO. Dos contactos con el
//     mismo email en una cuenta no identifican a nadie, y quedarse con el primero es elegir al
//     azar cuál de los dos recibe los teléfonos;
//   * dos señales exactas que apuntan a contactos distintos son un rechazo, no un desempate.
//
// No hay una tercera señal. En particular no existe una por identificador de persona del
// proveedor: `contacts` no tiene ninguna columna que lo guarde — ni `apollo_person_id` ni
// equivalente —, así que no hay nada que comparar, y fingir que lo hay sería inventar la
// evidencia. El día que esa columna exista, se añade aquí y en ningún otro sitio.

/** Las únicas dos señales que pueden acreditar por sí solas la identidad de un contacto. */
export type TrustedMatchSignal = 'email' | 'linkedin';

export type ExistingContactMatchVerdict =
  /** Identidad exacta, única e inequívoca. La ÚNICA que habilita ofrecer el merge. */
  | { kind: 'trusted'; contactId: string; signal: TrustedMatchSignal }
  /** Varios contactos posibles, o dos señales exactas en desacuerdo. Fail-closed. */
  | { kind: 'ambiguous'; reason: 'multiple_contacts' | 'conflicting_signals' }
  /** Sin identidad exacta. `name_only` es el duplicado por nombre: se rechaza y se dice. */
  | { kind: 'untrusted'; reason: 'name_only' | 'no_exact_signal' };

export type ExistingContactMergeBlockReason =
  | 'multiple_contacts'
  | 'conflicting_signals'
  | 'name_only'
  | 'no_exact_signal'
  | 'no_recorded_match'
  | 'recorded_match_mismatch';

/**
 * Resuelve el contacto existente en el que se PODRÍA fusionar el candidato.
 *
 * Fail-closed por construcción: todo lo que no sea «exactamente un contacto, acreditado por una
 * igualdad exacta, y sin que otra señal exacta señale a otro» devuelve rechazo con motivo. NO
 * desempata, NO puntúa, NO prefiere el más reciente y NO se queda con el primero de la lista.
 */
export function resolveTrustedExistingContactMatch(args: {
  candidate: Pick<CandidateDedupInput, 'email' | 'linkedin_url'>;
  existingContacts: readonly ExistingContactForDedup[];
}): ExistingContactMatchVerdict {
  const eKey = emailKey(args.candidate.email);
  const lKey = linkedinKey(args.candidate.linkedin_url);

  const emailMatches = eKey
    ? uniqueContactIds(args.existingContacts.filter((c) => emailKey(c.email) === eKey))
    : [];
  const linkedinMatches = lKey
    ? uniqueContactIds(args.existingContacts.filter((c) => linkedinKey(c.linkedin_url) === lKey))
    : [];

  if (emailMatches.length > 1 || linkedinMatches.length > 1) {
    return { kind: 'ambiguous', reason: 'multiple_contacts' };
  }

  const byEmail = emailMatches[0] ?? null;
  const byLinkedin = linkedinMatches[0] ?? null;

  if (byEmail && byLinkedin && byEmail !== byLinkedin) {
    return { kind: 'ambiguous', reason: 'conflicting_signals' };
  }

  if (byEmail) return { kind: 'trusted', contactId: byEmail, signal: 'email' };
  if (byLinkedin) return { kind: 'trusted', contactId: byLinkedin, signal: 'linkedin' };

  if (!eKey && !lKey) return { kind: 'untrusted', reason: 'name_only' };
  return { kind: 'untrusted', reason: 'no_exact_signal' };
}

function uniqueContactIds(rows: readonly ExistingContactForDedup[]): string[] {
  return [...new Set(rows.map((r) => r.id))];
}

/**
 * ¿Se le puede OFRECER al humano «Agregar información al contacto existente»?
 *
 * Exige las dos cosas a la vez: una identidad confiable Y que el contacto que el servidor
 * registró como duplicado (`matched_contacts_id`) sea ESE mismo. Si el registro apunta a otro, la
 * oferta se retira: el destino que la transacción aceptará es el registrado, y ofrecer algo
 * distinto de lo que va a ocurrir es peor que no ofrecer nada.
 */
export function resolveExistingContactMergeOffer(args: {
  candidate: Pick<CandidateDedupInput, 'email' | 'linkedin_url'>;
  existingContacts: readonly ExistingContactForDedup[];
  recordedMatchContactId: string | null | undefined;
}): ExistingContactMergeOffer {
  const verdict = resolveTrustedExistingContactMatch({
    candidate: args.candidate,
    existingContacts: args.existingContacts,
  });

  if (verdict.kind !== 'trusted') return { offered: false, reason: verdict.reason };

  const recorded = cleanString(args.recordedMatchContactId);
  if (!recorded) return { offered: false, reason: 'no_recorded_match' };
  if (recorded !== verdict.contactId) return { offered: false, reason: 'recorded_match_mismatch' };

  return { offered: true, contactId: verdict.contactId, signal: verdict.signal };
}

// ── Mapeo candidato → contacto oficial ──────────────────────────

const CANDIDATE_SOURCE_TO_CONTACT: Record<CandidateSource, OfficialContactSource> = {
  apollo: 'apollo',
  lusha: 'lusha',
  hubspot: 'hubspot',
  manual: 'manual',
  // `contacts.source` no admite 'mock'; lo registramos como 'other'.
  mock: 'other',
};

export function mapCandidateSource(source: CandidateSource): OfficialContactSource {
  return CANDIDATE_SOURCE_TO_CONTACT[source] ?? 'other';
}

// Vocabulario de seniority del normalizador Apollo → enum CHECK de `contacts`.
// Valores fuera del mapa quedan en null (la columna lo permite) para no violar
// la restricción CHECK de la tabla.
const CANDIDATE_SENIORITY_TO_CONTACT: Record<string, ContactSeniority> = {
  owner: 'c_level',
  executive: 'c_level',
  c_level: 'c_level',
  c_suite: 'c_level',
  vp: 'vp',
  director: 'director',
  head: 'director',
  manager: 'manager',
  employee: 'individual_contributor',
  entry: 'individual_contributor',
  senior: 'individual_contributor',
  individual_contributor: 'individual_contributor',
};

export function mapCandidateSeniority(raw: string | null | undefined): ContactSeniority | null {
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return CANDIDATE_SENIORITY_TO_CONTACT[key] ?? null;
}

function sanitizeEmail(email: string | null | undefined): string | null {
  if (!email || !email.trim()) return null;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parsea un nombre completo en firstName y lastName.
 * Reglas simples: una palabra → lastName null; dos o más → primera + resto.
 * Colapsa espacios múltiples. Preserva acentos y caracteres latinos.
 */
export function parseContactName(fullName: string): {
  firstName: string | null;
  lastName: string | null;
  normalizedFullName: string;
} {
  const normalized = fullName.trim().replace(/\s+/g, ' ');
  if (!normalized) return { firstName: null, lastName: null, normalizedFullName: '' };
  const parts = normalized.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null, normalizedFullName: normalized };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
    normalizedFullName: normalized,
  };
}

/**
 * Normaliza una URL de LinkedIn para almacenamiento:
 * añade https:// si parece linkedin.com/... sin protocolo.
 */
function normalizeLinkedinUrl(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  if (/^(www\.)?linkedin\.com\//i.test(cleaned)) {
    return 'https://' + cleaned.replace(/^www\./i, '');
  }
  return cleaned;
}

// ── Registro del candidato cargado (proyección para review) ─────

export interface CandidateRecord {
  id: string;
  status: ContactCandidateStatus;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  seniority: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  source: CandidateSource;
  enrichment_metadata: Record<string, unknown>;
  enrichment_run_id: string | null;
  /** account_id resuelto desde el run que originó al candidato. */
  account_id: string | null;
  /** HubSpot company id del run. Presente en candidatos HubSpot-only. */
  hubspot_company_id: string | null;
  /** Nombre de empresa del run (para crear cuenta si no existe). */
  company_name: string | null;
  /** Dominio de empresa del run (para dedup por dominio). */
  company_domain: string | null;
  /** Código ISO-2 del país resuelto en el run (MX, CO, CL…). Puede ser null. */
  country_code: string | null;
  /**
   * AGENT2A-PHONE-REVEAL-4O-H3-B — el contacto que el SERVIDOR registró al detectar el
   * duplicado. Opcional porque las proyecciones anteriores a este hito no lo leían; es el ancla
   * de confianza del merge y NUNCA se acepta un destino distinto de éste.
   */
  matched_contacts_id?: string | null;
  /**
   * Auditoría del futuro Apollo phone reveal (PHONE-3D.2). Campos aditivos y
   * opcionales/nullable: los candidatos actuales no los tienen y este hito NO
   * revela nada. El reveal real, el costo y la obligatoriedad de la base de
   * tratamiento llegan en PHONE-3D.3/3D.4.
   */
  phone_reveal_status?: ContactCandidatePhoneRevealAudit['phone_reveal_status'];
  phone_revealed_at?: ContactCandidatePhoneRevealAudit['phone_revealed_at'];
  phone_revealed_by?: ContactCandidatePhoneRevealAudit['phone_revealed_by'];
  phone_reveal_provider?: ContactCandidatePhoneRevealAudit['phone_reveal_provider'];
  phone_reveal_cost_credits?: ContactCandidatePhoneRevealAudit['phone_reveal_cost_credits'];
  phone_reveal_cost_usd?: ContactCandidatePhoneRevealAudit['phone_reveal_cost_usd'];
  phone_reveal_error_code?: ContactCandidatePhoneRevealAudit['phone_reveal_error_code'];
  phone_processing_basis?: ContactCandidatePhoneRevealAudit['phone_processing_basis'];
  phone_processing_basis_note?: ContactCandidatePhoneRevealAudit['phone_processing_basis_note'];
}

export interface ContactInsertPayload {
  account_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  job_title: string | null;
  department: string | null;
  seniority: ContactSeniority | null;
  source: OfficialContactSource;
  contact_status: 'active';
  // PHONE-3C: metadata de teléfono trasladada desde el candidato enriquecido.
  // Aditivo y nullable — el teléfono nunca es obligatorio y NO se revela aquí.
  phone_type: PhoneType | null;
  phone_source: PhoneSource | null;
  phone_raw_type: string | null;
  phone_revealed_at: string | null;
  phone_processing_basis: string | null;
  metadata: Record<string, unknown>;
  created_by: string;
  updated_by: string;
}

/**
 * Trazabilidad de origen guardada en `contacts.metadata`. Solo referencias y
 * resúmenes; nunca payload crudo del proveedor.
 */
export function buildContactTraceMetadata(candidate: CandidateRecord): Record<string, unknown> {
  const meta = candidate.enrichment_metadata ?? {};
  return {
    source: 'contact_enrichment_candidate',
    source_candidate_id: candidate.id,
    source_enrichment_run_id: candidate.enrichment_run_id,
    candidate_source: candidate.source,
    relevance: (meta.relevance as unknown) ?? null,
    completion: (meta.completion ?? meta.contact_completion ?? null) as unknown,
    post_completion: (meta.post_completion ?? null) as unknown,
    company_consistency: (meta.company_consistency ?? null) as unknown,
  };
}

// ── Copia de metadata de teléfono al contacto oficial (PHONE-3C) ─
// Traslada el tipo/fuente/raw_type que PHONE-3A ya conservó de forma gratuita
// en `enrichment_metadata.phone` (payload de búsqueda de Apollo). NO revela
// teléfonos, NO llama proveedores, NO gasta créditos: solo mueve metadata ya
// existente. Valores de tipo/fuente fuera del vocabulario estable → null.

const ALLOWED_PHONE_TYPES: readonly PhoneType[] = [
  'personal_mobile',
  'mobile',
  'direct_dial',
  'work',
  'hq',
  'other',
  'unknown',
];

const ALLOWED_PHONE_SOURCES: readonly PhoneSource[] = [
  'apollo_search',
  'apollo_reveal',
  // APOLLO-PHONE-CACHE-1b: la procedencia "reutilizado desde caché" debe
  // sobrevivir a la aprobación. Si no estuviera en la allowlist se normalizaría
  // a null y el contacto oficial perdería la trazabilidad del reuso.
  'apollo_cache',
  'lusha_reveal',
  'provider_payload',
  'manual',
  'unknown',
];

function normalizePhoneType(value: unknown): PhoneType | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return (ALLOWED_PHONE_TYPES as readonly string[]).includes(v) ? (v as PhoneType) : null;
}

function normalizePhoneSource(value: unknown): PhoneSource | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return (ALLOWED_PHONE_SOURCES as readonly string[]).includes(v) ? (v as PhoneSource) : null;
}

export interface ContactPhoneMetadataCopy {
  phone_type: PhoneType | null;
  phone_source: PhoneSource | null;
  phone_raw_type: string | null;
  phone_revealed_at: string | null;
  phone_processing_basis: string | null;
}

/**
 * Extrae la metadata de teléfono a copiar en el contacto oficial desde
 * `candidate.enrichment_metadata.phone`. Si no hay metadata, todos los campos
 * quedan null (comportamiento actual intacto: el teléfono nunca es obligatorio).
 *
 * `phone_revealed_at` y `phone_processing_basis` quedan SIEMPRE null en este
 * hito: no se revela ningún teléfono (apollo_search entrega el tipo gratis en
 * la búsqueda) y no hay una política legal de reveal definida todavía.
 */
export function buildContactPhoneMetadata(
  candidate: Pick<CandidateRecord, 'enrichment_metadata'>,
): ContactPhoneMetadataCopy {
  const empty: ContactPhoneMetadataCopy = {
    phone_type: null,
    phone_source: null,
    phone_raw_type: null,
    phone_revealed_at: null,
    phone_processing_basis: null,
  };

  const phoneMeta = candidate.enrichment_metadata?.phone as
    | { type?: unknown; source?: unknown; raw_type?: unknown }
    | null
    | undefined;
  if (!phoneMeta || typeof phoneMeta !== 'object') return empty;

  const rawType = typeof phoneMeta.raw_type === 'string' ? phoneMeta.raw_type : null;

  return {
    phone_type: normalizePhoneType(phoneMeta.type),
    phone_source: normalizePhoneSource(phoneMeta.source),
    phone_raw_type: cleanString(rawType),
    // No reveal en este hito → siempre null para apollo_search / search-derived.
    phone_revealed_at: null,
    // Sin política legal de reveal definida → null para apollo_search.
    phone_processing_basis: null,
  };
}

/**
 * Construye el payload de inserción en `contacts` a partir del candidato.
 *
 * `hubspotSyncState` es OPCIONAL y su ausencia NO es un valor por defecto: cuando no se pasa,
 * el contacto se crea SIN bloque `hubspot_sync`, que es exactamente el estado —desconocido—
 * en el que está hoy cada contacto de Producción. Escribir un estado sin haber leído la
 * empresa HubSpot de la cuenta sería afirmar un bloqueo que nadie comprobó.
 */
export function buildContactInsertPayload(args: {
  candidate: CandidateRecord;
  accountId: string;
  internalUserId: string;
  hubspotSyncState?: HubSpotSyncState;
}): ContactInsertPayload {
  const { candidate, accountId, internalUserId, hubspotSyncState } = args;

  // Normalización de nombre: usa first/last del candidato si ya vienen completos,
  // con fallback a parsear full_name cuando son null (p. ej. aprobaciones manuales).
  const parsedName = parseContactName(candidate.full_name);
  const firstName = cleanString(candidate.first_name) ?? parsedName.firstName;
  const lastName = cleanString(candidate.last_name) ?? parsedName.lastName;
  const fullName = parsedName.normalizedFullName || candidate.full_name.trim();

  const email = sanitizeEmail(candidate.email);
  const linkedinUrl = normalizeLinkedinUrl(candidate.linkedin_url);
  const phone = cleanString(candidate.phone);

  const normalizedFields: string[] = ['full_name'];
  if (firstName !== null) normalizedFields.push('first_name');
  if (lastName !== null) normalizedFields.push('last_name');
  if (email !== null) normalizedFields.push('email');
  if (linkedinUrl !== null) normalizedFields.push('linkedin_url');
  if (phone !== null) normalizedFields.push('phone');

  const titleNormalization =
    (candidate.enrichment_metadata?.apollo_title_normalization as Record<string, unknown> | null | undefined) ?? null;

  // PHONE-3C: traslada tipo/fuente de teléfono ya conservados por PHONE-3A.
  // Sin metadata ⇒ todos null (el teléfono nunca es obligatorio).
  const phoneMetadata = buildContactPhoneMetadata(candidate);

  return {
    account_id: accountId,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    email,
    phone,
    linkedin_url: linkedinUrl,
    job_title: cleanString(candidate.title),
    department: cleanString(candidate.department),
    seniority: mapCandidateSeniority(candidate.seniority),
    source: mapCandidateSource(candidate.source),
    contact_status: 'active',
    phone_type: phoneMetadata.phone_type,
    phone_source: phoneMetadata.phone_source,
    phone_raw_type: phoneMetadata.phone_raw_type,
    phone_revealed_at: phoneMetadata.phone_revealed_at,
    phone_processing_basis: phoneMetadata.phone_processing_basis,
    metadata: buildContactMetadata({
      candidate,
      normalizedFields,
      titleNormalization,
      hubspotSyncState,
    }),
    created_by: internalUserId,
    updated_by: internalUserId,
  };
}

/**
 * Metadata del contacto oficial: trazabilidad de origen, normalización y —cuando el llamador
 * la conoce— el estado durable inicial de sincronización con HubSpot.
 *
 * Aprobar NO llama a HubSpot. Lo que se escribe aquí es sólo la lectura de dos requisitos que
 * ya se conocen en ese momento (email del contacto, empresa HubSpot de la cuenta), para que la
 * ficha pueda decir por qué un contacto todavía no está en HubSpot sin salir a la red.
 */
function buildContactMetadata(args: {
  candidate: CandidateRecord;
  normalizedFields: string[];
  titleNormalization: Record<string, unknown> | null;
  hubspotSyncState: HubSpotSyncState | undefined;
}): Record<string, unknown> {
  const { candidate, normalizedFields, titleNormalization, hubspotSyncState } = args;
  const base: Record<string, unknown> = {
    ...buildContactTraceMetadata(candidate),
    normalization: { status: 'normalized', fields: normalizedFields },
    ...(titleNormalization ? { apollo_title_normalization: titleNormalization } : {}),
  };
  return hubspotSyncState ? writeHubSpotSyncState(base, hubspotSyncState) : base;
}

// ── Metadata de revisión (enrichment_metadata.review) ───────────

/**
 * Evidencia truthful de un override humano de discrepancia de identidad
 * (Hito 17B.4W.8). Solo se persiste cuando el candidato es `mismatch` y el
 * humano aprobó explícitamente con acknowledgement + motivo.
 */
export interface IdentityApprovalOverrideEvidenceV1 {
  acknowledged: true;
  reason: string;
  identity_state_at_override: 'mismatch';
  reviewed_by: string;
  reviewed_at: string;
}

export interface ReviewMetadata {
  status: 'approved' | 'discarded' | 'duplicate';
  reason?: string;
  reviewed_at: string;
  reviewed_by: string;
  created_contact_id?: string;
  matched_contact_id?: string;
  matched_by?: DuplicateMatch['matchedBy'];
  identity_override?: IdentityApprovalOverrideEvidenceV1;
  /**
   * 4O-H3-B — lo ÚNICO que distingue de forma durable un duplicado FUSIONADO de uno DESCARTADO.
   * `matched_contacts_id` no puede hacerlo: el veredicto duplicado lo escribe en ambos casos.
   * Lo INYECTA la transacción de la 117, nunca el llamador, y es también su clave de
   * idempotencia. Se declara aquí para que el tipo describa la forma real del bloque `review`.
   */
  merged_into_contact_id?: string;
  merged_at?: string;
  /** Señal exacta que acreditó la identidad del contacto destino. Nunca `name`. */
  merged_match_signal?: TrustedMatchSignal;
}

/** Inserta/actualiza la clave `review` sin perder relevance/completion previos. */
export function mergeReview(
  existing: Record<string, unknown> | null | undefined,
  review: ReviewMetadata,
): Record<string, unknown> {
  return { ...(existing ?? {}), review };
}

// ── Identity approval state (Hito 17B.4W.8) ─────────────────────
// Clasifica al candidato según la evidencia persistida en
// enrichment_metadata.person_identity (17B.4W.6). Política genérica: no usa
// provider_key, source, email local-part, confianza ni heurísticas — solo
// identity_consistency.

export type CandidateIdentityApprovalStateV1 =
  | 'consistent'
  | 'mismatch'
  | 'insufficient_evidence'
  | 'no_evidence';

/** Payload de entrada de un override humano de discrepancia de identidad. */
export interface IdentityApprovalOverrideInputV1 {
  acknowledged: boolean;
  reason: string;
}

const IDENTITY_CONSISTENCY_TO_STATE: Record<string, CandidateIdentityApprovalStateV1> = {
  consistent: 'consistent',
  mismatch: 'mismatch',
  insufficient_evidence: 'insufficient_evidence',
};

/**
 * Resuelve el estado de aprobación de identidad de un candidato a partir de
 * `enrichment_metadata.person_identity?.identity_consistency`. Ausente, nulo
 * o valor no reconocido ⇒ `no_evidence` (candidatos legacy o sin proveedor
 * que registre evidencia).
 */
export function resolveCandidateIdentityApprovalState(
  candidate: Pick<CandidateRecord, 'enrichment_metadata'>,
): CandidateIdentityApprovalStateV1 {
  const personIdentity = candidate.enrichment_metadata?.person_identity as
    | { identity_consistency?: unknown }
    | null
    | undefined;
  const raw = personIdentity?.identity_consistency;
  if (typeof raw !== 'string') return 'no_evidence';
  return IDENTITY_CONSISTENCY_TO_STATE[raw] ?? 'no_evidence';
}

/**
 * Valida un override humano: requiere acknowledgement explícito y un motivo
 * no vacío (tras trim). Devuelve el motivo ya recortado cuando es válido.
 */
export function validateIdentityApprovalOverride(
  input: IdentityApprovalOverrideInputV1 | null | undefined,
): { valid: true; reason: string } | { valid: false } {
  if (!input || input.acknowledged !== true) return { valid: false };
  const reason = input.reason.trim();
  if (reason.length === 0) return { valid: false };
  return { valid: true, reason };
}

/** Construye la evidencia truthful de override para persistir en `review`. */
export function buildIdentityApprovalOverrideEvidence(args: {
  reason: string;
  actorId: string;
  nowIso: string;
}): IdentityApprovalOverrideEvidenceV1 {
  return {
    acknowledged: true,
    reason: args.reason,
    identity_state_at_override: 'mismatch',
    reviewed_by: args.actorId,
    reviewed_at: args.nowIso,
  };
}

// ── Patch aplicado al candidato ─────────────────────────────────

export interface CandidateReviewPatch {
  status: ContactCandidateStatus;
  duplicate_status?: ContactDuplicateStatus;
  matched_contacts_id?: string | null;
  review_notes?: string | null;
  reviewed_by: string;
  reviewed_at: string;
  enrichment_metadata: Record<string, unknown>;
}

// ── Resultados ──────────────────────────────────────────────────

export type ApproveResult =
  | { ok: true; contactId: string; message: string; accountCreated?: boolean }
  | {
      ok: false;
      error: string;
      duplicate?: boolean;
      contactId?: string;
      code?: 'IDENTITY_MISMATCH_REQUIRES_REVIEW' | 'IDENTITY_OVERRIDE_REASON_REQUIRED';
      /**
       * AGENT2A-PHONE-REVEAL-4O-H3-B — presente SOLO en el veredicto `duplicate`. Dice si la
       * identidad del contacto existente es lo bastante fuerte como para OFRECERLE al humano
       * «Agregar información al contacto existente». Nunca fusiona por sí solo: es la oferta,
       * y la decisión la toma una segunda acción explícita.
       */
      mergeOffer?: ExistingContactMergeOffer;
    };

/**
 * AGENT2A-PHONE-REVEAL-4O-H3-B — la oferta de merge que acompaña a un veredicto `duplicate`.
 * `offered: false` viaja con su motivo para que la UI pueda decir la verdad («no podemos
 * confirmar que sea la misma persona») en lugar de callar.
 */
export type ExistingContactMergeOffer =
  | { offered: true; contactId: string; signal: TrustedMatchSignal }
  | { offered: false; reason: ExistingContactMergeBlockReason };

export type DiscardResult = { ok: true; message: string } | { ok: false; error: string };

const MSG = {
  invalid: 'Candidato inválido.',
  notFound: 'El candidato no existe o ya fue revisado.',
  notPending: 'El candidato ya fue revisado.',
  noAccount:
    'No se puede aprobar este candidato porque no está asociado a una cuenta SellUp ni vinculado a HubSpot.',
  duplicate: 'Este candidato parece estar duplicado con un contacto existente.',
  createFailed: 'No fue posible crear el contacto oficial.',
  approveFailed: 'No fue posible aprobar el candidato.',
  discardFailed: 'No fue posible rechazar el candidato.',
  approved: 'Contacto aprobado y creado en SellUp.',
  approvedNewAccount: 'Cuenta creada en SellUp y contacto aprobado.',
  approvedLinkedAccount: 'Contacto aprobado y asociado a la cuenta existente.',
  discarded: 'Candidato rechazado.',
  identityMismatchRequiresReview:
    'Este candidato tiene una discrepancia de identidad sin revisar. Revísala antes de aprobar.',
  identityOverrideReasonRequired:
    'Debes confirmar que revisaste la discrepancia e indicar un motivo antes de aprobar.',
} as const;

// ── Dependencias inyectables ────────────────────────────────────

export interface AuditEntry {
  contactId: string;
  accountId: string;
  actorUserId: string | null;
  /** true solo cuando el candidato era `mismatch` y se aprobó vía override humano válido. */
  identityOverrideApplied?: boolean;
}

/**
 * Resultado de la transacción de aprobación (4O-H3). `alreadyApproved` NO es un fallo: es el
 * candidato que otra ejecución —o el segundo clic de la misma— ya aprobó, devolviendo el
 * contacto que existe en vez de crear un segundo.
 */
export type ApproveTransactionResult =
  | { ok: true; contactId: string; alreadyApproved: boolean }
  | { ok: false; error: string; personSuppressed?: boolean };

export interface ApproveTransactionInput {
  candidateId: string;
  accountId: string;
  contactPayload: ContactInsertPayload;
  reviewPatch: CandidateReviewPatch;
  candidate: CandidateRecord;
}

export interface ApproveDeps {
  actorId: string;
  nowIso: string;
  loadCandidate: (id: string) => Promise<CandidateRecord | null>;
  loadExistingContacts: (accountId: string) => Promise<ExistingContactForDedup[]>;
  /**
   * AGENT2A-PHONE-REVEAL-4O-H3 — la ÚNICA autoridad transaccional de la aprobación. Crea el
   * contacto, promueve la colección oficial de teléfonos con su procedencia, proyecta el
   * escalar y marca el candidato aprobado, todo en UNA transacción de PostgreSQL. Sustituye al
   * par `insertContact` + `updateCandidate(approved)` que antes eran dos escrituras sueltas con
   * una ventana entre ellas en la que el contacto existía y el candidato seguía pendiente.
   */
  approveTransactionally: (input: ApproveTransactionInput) => Promise<ApproveTransactionResult>;
  /** Sigue usándose SOLO para el veredicto `duplicate`, que no crea contacto. */
  updateCandidate: (id: string, patch: CandidateReviewPatch) => Promise<{ error?: string }>;
  logAudit?: (entry: AuditEntry) => Promise<void>;
  /**
   * Resuelve o crea una cuenta SellUp para candidatos HubSpot-only
   * (cuando run.account_id es null pero hubspot_company_id existe).
   * Si no se provee y account_id es null, la aprobación se bloquea.
   */
  resolveOrCreateAccount?: (args: {
    hubspot_company_id: string;
    company_name: string | null;
    company_domain: string | null;
    run_id: string | null;
    country_code: string | null;
  }) => Promise<{ accountId: string; outcome: string; countryCodeApplied: string | null; countryResolutionSource: string } | { error: string }>;
  /**
   * AGENT2-CONTACT-HUBSPOT-SYNC-STATE-CUT1 — lee `accounts.hubspot_company_id` de la cuenta ya
   * resuelta. Es la MISMA fila que la sincronización manual consulta después: si el estado
   * inicial se dedujera del `hubspot_company_id` del RUN, un candidato con cuenta preexistente
   * quedaría marcado «la empresa no está en HubSpot» mientras la sincronización, leyendo la
   * cuenta, la encuentra sin problema.
   *
   * OPCIONAL, y su ausencia significa desconocido: sin ella el contacto se crea sin bloque
   * `hubspot_sync` en vez de con uno adivinado.
   */
  loadAccountHubSpotCompanyId?: (accountId: string) => Promise<string | null>;
  /**
   * Actualiza contact_enrichment_runs con el account_id recién resuelto/creado
   * y registra metadata de trazabilidad. Se llama solo cuando se resuelve una
   * cuenta nueva para un candidato HubSpot-only.
   */
  updateRunAccountId?: (
    runId: string,
    accountId: string,
    outcome: string,
    countryCodeApplied: string | null,
    countryResolutionSource: string,
  ) => Promise<void>;
}

export interface DiscardDeps {
  actorId: string;
  nowIso: string;
  loadCandidate: (id: string) => Promise<CandidateRecord | null>;
  updateCandidate: (id: string, patch: CandidateReviewPatch) => Promise<{ error?: string }>;
}

// ── Orquestación: aprobar ───────────────────────────────────────

/**
 * Resuelve el estado durable INICIAL de sincronización HubSpot de un contacto que se está
 * aprobando. NO llama a HubSpot: sólo lee la cuenta.
 *
 * Devuelve `undefined` —desconocido, no un estado— en dos casos, y en ambos el contacto se
 * crea exactamente como antes de este corte:
 *
 *  - el llamador no inyectó el lector de la cuenta;
 *  - el lector falló. Aprobar no puede romperse porque una lectura INFORMATIVA no salga:
 *    bloquear la decisión humana por el estado de un badge sería invertir las prioridades.
 *    Un estado ausente lo repara el primer clic de sincronización manual.
 */
async function resolveInitialHubSpotSyncStateForApproval(args: {
  candidate: CandidateRecord;
  accountId: string;
  loadAccountHubSpotCompanyId?: (accountId: string) => Promise<string | null>;
}): Promise<HubSpotSyncState | undefined> {
  const { candidate, accountId, loadAccountHubSpotCompanyId } = args;
  if (!loadAccountHubSpotCompanyId) return undefined;

  let hubspotCompanyId: string | null;
  try {
    hubspotCompanyId = await loadAccountHubSpotCompanyId(accountId);
  } catch {
    return undefined;
  }

  return buildInitialHubSpotSyncState({
    // EL MISMO normalizador que produce `contacts.email` en el payload, y por tanto el mismo
    // valor que la sincronización manual leerá después. Dos normalizaciones distintas del
    // mismo email dejarían un `never_attempted` que la sincronización rechaza por MISSING_EMAIL.
    email: sanitizeEmail(candidate.email),
    hubspotCompanyId,
  });
}

/**
 * Aprueba un candidato: valida estado y cuenta, deduplica, crea el contacto
 * oficial y marca el candidato approved. NO ejecuta Apollo ni HubSpot.
 */
export async function runApproveCandidate(
  candidateId: string,
  deps: ApproveDeps,
  identityOverride?: IdentityApprovalOverrideInputV1,
): Promise<ApproveResult> {
  if (typeof candidateId !== 'string' || !candidateId.trim()) {
    return { ok: false, error: MSG.invalid };
  }

  const candidate = await deps.loadCandidate(candidateId.trim());
  if (!candidate) return { ok: false, error: MSG.notFound };
  if (candidate.status !== 'pending_review') return { ok: false, error: MSG.notPending };

  // Gate de identidad (Hito 17B.4W.8): se evalúa ANTES de cualquier mutación
  // (cuenta, contacto, estado del candidato, audit). Política genérica: solo
  // mismatch requiere override explícito; consistent/insufficient_evidence/
  // no_evidence siguen el flujo normal sin cambios.
  const identityState = resolveCandidateIdentityApprovalState(candidate);
  let identityOverrideEvidence: IdentityApprovalOverrideEvidenceV1 | undefined;

  if (identityState === 'mismatch') {
    const validation = validateIdentityApprovalOverride(identityOverride);
    if (!identityOverride) {
      return {
        ok: false,
        error: MSG.identityMismatchRequiresReview,
        code: 'IDENTITY_MISMATCH_REQUIRES_REVIEW',
      };
    }
    if (!validation.valid) {
      return {
        ok: false,
        error: MSG.identityOverrideReasonRequired,
        code: 'IDENTITY_OVERRIDE_REASON_REQUIRED',
      };
    }
    identityOverrideEvidence = buildIdentityApprovalOverrideEvidence({
      reason: validation.reason,
      actorId: deps.actorId,
      nowIso: deps.nowIso,
    });
  }

  // Resolver cuenta SellUp: usa la existente o crea/vincula una para candidatos HubSpot-only.
  let accountId = candidate.account_id;
  let resolvedAccountOutcome: string | null = null;

  if (!accountId) {
    if (!candidate.hubspot_company_id || !deps.resolveOrCreateAccount) {
      return { ok: false, error: MSG.noAccount };
    }
    const resolved = await deps.resolveOrCreateAccount({
      hubspot_company_id: candidate.hubspot_company_id,
      company_name: candidate.company_name,
      company_domain: candidate.company_domain,
      run_id: candidate.enrichment_run_id,
      country_code: candidate.country_code,
    });
    if ('error' in resolved) return { ok: false, error: resolved.error };
    accountId = resolved.accountId;
    resolvedAccountOutcome = resolved.outcome;
    if (candidate.enrichment_run_id && deps.updateRunAccountId) {
      await deps.updateRunAccountId(
        candidate.enrichment_run_id,
        accountId,
        resolved.outcome,
        resolved.countryCodeApplied,
        resolved.countryResolutionSource,
      );
    }
  }

  // Deduplicación contra los contactos existentes de la cuenta.
  const existing = await deps.loadExistingContacts(accountId);
  const duplicate = findDuplicateContact(candidate, existing);

  if (duplicate) {
    const review: ReviewMetadata = {
      status: 'duplicate',
      reason: 'Duplicado de un contacto existente',
      reviewed_at: deps.nowIso,
      reviewed_by: deps.actorId,
      matched_contact_id: duplicate.contactId,
      matched_by: duplicate.matchedBy,
    };
    await deps.updateCandidate(candidate.id, {
      status: 'duplicate',
      duplicate_status: duplicateStatusFromMatch(duplicate),
      matched_contacts_id: duplicate.contactId,
      review_notes: 'Duplicado de un contacto existente',
      reviewed_by: deps.actorId,
      reviewed_at: deps.nowIso,
      enrichment_metadata: mergeReview(candidate.enrichment_metadata, review),
    });
    // 4O-H3-B — el veredicto no cambia y el candidato queda terminalizado exactamente igual que
    // antes de este hito. Lo que se añade es la OFERTA: si la identidad del contacto existente
    // es exacta e inequívoca, el humano puede además elegir agregarle la información en vez de
    // limitarse a descartar. La oferta no fusiona nada — eso lo hace una segunda acción
    // explícita — y su ancla es el MISMO id que se acaba de escribir en `matched_contacts_id`.
    const mergeOffer = resolveExistingContactMergeOffer({
      candidate,
      existingContacts: existing,
      recordedMatchContactId: duplicate.contactId,
    });
    return {
      ok: false,
      error: MSG.duplicate,
      duplicate: true,
      contactId: duplicate.contactId,
      mergeOffer,
    };
  }

  // ── Aprobación ATÓMICA (4O-H3) ────────────────────────────────
  // Antes eran dos escrituras: `contacts` INSERT y luego el patch del candidato. Entre las dos
  // había una ventana real —documentada en el propio `return` que devolvía `approveFailed` CON
  // un `contactId`— en la que el contacto existía y el candidato seguía `pending_review`, de
  // modo que el siguiente clic creaba un segundo contacto para la misma persona. Y el INSERT
  // sólo llevaba `candidate.phone`: los demás números revelados se perdían.
  //
  // Ahora las dos escrituras y la propagación de TODA la colección de teléfonos ocurren dentro
  // de una única transacción de PostgreSQL, que además vuelve a bloquear el candidato y a
  // comprobar la supresión por persona bajo ese lock — cosas que esta capa, que leyó antes,
  // no puede prometer.
  //
  // `matched_contacts_id` lo escribe la transacción con el id del contacto que acaba de crear:
  // el llamador no puede conocerlo antes del INSERT, y ese campo es también el vínculo durable
  // que hace idempotente una segunda aprobación.
  // Estado durable INICIAL de sincronización con HubSpot. Se calcula ANTES de construir el
  // payload porque viaja dentro de `contacts.metadata`, es decir, dentro de la MISMA
  // transacción que crea el contacto: no hay una segunda escritura que pueda perderse ni una
  // ventana en la que el contacto exista sin estado.
  //
  // Aquí no se llama a HubSpot. Se leen dos hechos que ya están en la base —si el contacto
  // tendrá email y si su cuenta tiene empresa vinculada— y se registra cuál de ellos, si
  // alguno, impide sincronizar.
  const hubspotSyncState = await resolveInitialHubSpotSyncStateForApproval({
    candidate,
    accountId,
    loadAccountHubSpotCompanyId: deps.loadAccountHubSpotCompanyId,
  });

  const payload = buildContactInsertPayload({
    candidate,
    accountId,
    internalUserId: deps.actorId,
    hubspotSyncState,
  });

  // El override de identidad solo se persiste cuando el estado evaluado fue `mismatch`; nunca
  // se escribe para consistent/insufficient_evidence/no_evidence aunque el llamador haya
  // enviado un payload de override innecesario.
  const review: ReviewMetadata = {
    status: 'approved',
    reviewed_at: deps.nowIso,
    reviewed_by: deps.actorId,
    ...(identityOverrideEvidence ? { identity_override: identityOverrideEvidence } : {}),
  };
  const reviewPatch: CandidateReviewPatch = {
    status: 'approved',
    duplicate_status: 'no_match',
    review_notes: null,
    reviewed_by: deps.actorId,
    reviewed_at: deps.nowIso,
    enrichment_metadata: mergeReview(candidate.enrichment_metadata, review),
  };

  const approved = await deps.approveTransactionally({
    candidateId: candidate.id,
    accountId,
    contactPayload: payload,
    reviewPatch,
    candidate,
  });
  if (!approved.ok) {
    return { ok: false, error: approved.error };
  }

  const contactId = approved.contactId;

  // La auditoría queda FUERA de la transacción a propósito, y sólo puede correr después de que
  // ésta haya confirmado. Al revés —dentro— una fila que dice `contact_created` sobreviviría a
  // un rollback del contacto que dice haber creado. Un candidato ya aprobado no se vuelve a
  // auditar: no se creó ningún contacto en esta ejecución.
  if (!approved.alreadyApproved) {
    await deps.logAudit?.({
      contactId,
      accountId,
      actorUserId: deps.actorId,
      identityOverrideApplied: identityOverrideEvidence !== undefined,
    });
  }

  let message: string = MSG.approved;
  if (resolvedAccountOutcome === 'created') message = MSG.approvedNewAccount;
  else if (resolvedAccountOutcome !== null) message = MSG.approvedLinkedAccount;

  return { ok: true, contactId, message };
}

// ── Orquestación: rechazar ──────────────────────────────────────

/**
 * Rechaza un candidato: valida estado y lo marca discarded guardando el motivo.
 * No crea contacto.
 */
export async function runDiscardCandidate(
  candidateId: string,
  rawReason: string | null | undefined,
  deps: DiscardDeps,
): Promise<DiscardResult> {
  if (typeof candidateId !== 'string' || !candidateId.trim()) {
    return { ok: false, error: MSG.invalid };
  }

  const candidate = await deps.loadCandidate(candidateId.trim());
  if (!candidate) return { ok: false, error: MSG.notFound };
  if (candidate.status !== 'pending_review') return { ok: false, error: MSG.notPending };

  const reason = cleanString(rawReason) ?? 'Otro';

  const review: ReviewMetadata = {
    status: 'discarded',
    reason,
    reviewed_at: deps.nowIso,
    reviewed_by: deps.actorId,
  };
  const updateResult = await deps.updateCandidate(candidate.id, {
    status: 'discarded',
    review_notes: reason,
    reviewed_by: deps.actorId,
    reviewed_at: deps.nowIso,
    enrichment_metadata: mergeReview(candidate.enrichment_metadata, review),
  });
  if (updateResult.error) {
    return { ok: false, error: MSG.discardFailed };
  }

  return { ok: true, message: MSG.discarded };
}

// ── Orquestación: fusionar en un contacto EXISTENTE (4O-H3-B) ───
//
// La TERCERA decisión humana sobre un candidato, junto a aprobar y rechazar, y la única que
// escribe sobre una fila que este candidato no creó. Empieza donde el veredicto duplicado
// termina: el candidato ya está en `duplicate`, el servidor ya escribió en `matched_contacts_id`
// el contacto que emparejó, y el humano ha elegido explícitamente agregarle la información en
// lugar de descartar.
//
// NO resuelve identidad por su cuenta más allá de reconfirmar la señal exacta, NO fusiona
// automáticamente, NO llama a ningún proveedor y NO gasta un crédito: cada número que promueve
// ya fue observado y ya fue pagado.

export type MergeIntoExistingContactResult =
  | { ok: true; contactId: string; message: string; alreadyMerged: boolean }
  | { ok: false; error: string; code?: MergeIntoExistingContactErrorCode };

export type MergeIntoExistingContactErrorCode =
  | 'INVALID_INPUT'
  | 'CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_NOT_MERGEABLE'
  | 'MERGE_NOT_TRUSTED'
  | 'CONTACT_MISMATCH'
  | 'MERGE_FAILED';

/** Lo que la transacción de la 117 devuelve, traducido al contrato de esta capa. */
export type MergeTransactionResult =
  | { ok: true; contactId: string; alreadyMerged: boolean; phonesInserted: number; sourcesInserted: number }
  | { ok: false; error: string; code?: MergeIntoExistingContactErrorCode };

export interface MergeTransactionInput {
  candidateId: string;
  contactId: string;
  accountId: string;
  reviewPatch: CandidateReviewPatch;
  candidate: CandidateRecord;
  /** El escalar heredado del CONTACTO destino, leído fuera del lock y revalidado dentro. */
  incumbentScalar: ExistingContactScalarForMerge;
}

/** Proyección mínima del contacto destino: sólo lo que decide el bootstrap del escalar. */
export interface ExistingContactScalarForMerge {
  id: string;
  phone: string | null;
  phone_type: string | null;
  phone_source: string | null;
  phone_raw_type: string | null;
}

export interface MergeAuditEntry {
  contactId: string;
  accountId: string;
  candidateId: string;
  actorUserId: string | null;
  matchSignal: TrustedMatchSignal;
  phonesInserted: number;
  sourcesInserted: number;
}

export interface MergeIntoExistingContactDeps {
  actorId: string;
  nowIso: string;
  loadCandidate: (id: string) => Promise<CandidateRecord | null>;
  loadExistingContacts: (accountId: string) => Promise<ExistingContactForDedup[]>;
  /** Lee el escalar heredado del contacto destino. `null` si el contacto ya no existe. */
  loadExistingContactScalar: (
    contactId: string,
    accountId: string,
  ) => Promise<ExistingContactScalarForMerge | null>;
  /** La ÚNICA autoridad transaccional del merge (migración 117). */
  mergeTransactionally: (input: MergeTransactionInput) => Promise<MergeTransactionResult>;
  logAudit?: (entry: MergeAuditEntry) => Promise<void>;
}

const MERGE_MSG = {
  invalid: 'Solicitud inválida.',
  notFound: 'El candidato no existe.',
  notDuplicate: 'Este candidato no está marcado como duplicado de un contacto existente.',
  notTrusted:
    'No podemos confirmar que este candidato y el contacto existente sean la misma persona, así que no es posible agregarle la información.',
  contactMismatch: 'El contacto indicado no coincide con el que se registró como duplicado.',
  contactMissing: 'El contacto existente ya no está disponible.',
  failed: 'No fue posible agregar la información al contacto existente.',
  merged: 'Información agregada al contacto existente.',
  alreadyMerged: 'La información de este candidato ya estaba agregada al contacto existente.',
} as const;

/**
 * Agrega al contacto EXISTENTE la información del candidato duplicado, tras una decisión humana
 * explícita.
 *
 * Revalida TODO en el servidor y en este orden, porque cada paso depende del anterior:
 *   1. el candidato existe y sigue en `duplicate` — no se fusiona lo que nadie marcó;
 *   2. tiene una cuenta resuelta — sin ella no hay alcance en el que buscar contactos;
 *   3. la identidad vuelve a resolverse contra los contactos VIVOS de la cuenta, y el destino
 *      registrado debe ser ese mismo;
 *   4. el `contactId` que llega en la petición debe coincidir con el resuelto. Es un token de
 *      CONFIRMACIÓN, nunca una instrucción: un uuid arbitrario no llega ni a la transacción, y
 *      si llegara la 117 lo rechazaría igual contra `matched_contacts_id`.
 */
export async function runMergeCandidateIntoExistingContact(
  candidateId: string,
  requestedContactId: string,
  deps: MergeIntoExistingContactDeps,
): Promise<MergeIntoExistingContactResult> {
  if (typeof candidateId !== 'string' || !candidateId.trim()) {
    return { ok: false, error: MERGE_MSG.invalid, code: 'INVALID_INPUT' };
  }
  if (typeof requestedContactId !== 'string' || !requestedContactId.trim()) {
    return { ok: false, error: MERGE_MSG.invalid, code: 'INVALID_INPUT' };
  }

  const candidate = await deps.loadCandidate(candidateId.trim());
  if (!candidate) return { ok: false, error: MERGE_MSG.notFound, code: 'CANDIDATE_NOT_FOUND' };

  // `pending_review` es territorio de la aprobación (116) y los demás estados terminales son
  // conclusiones que alguien ya tomó. Sólo se fusiona lo que el veredicto duplicado marcó.
  if (candidate.status !== 'duplicate') {
    return { ok: false, error: MERGE_MSG.notDuplicate, code: 'CANDIDATE_NOT_MERGEABLE' };
  }

  const accountId = candidate.account_id;
  if (!accountId) {
    return { ok: false, error: MERGE_MSG.notDuplicate, code: 'CANDIDATE_NOT_MERGEABLE' };
  }

  const existing = await deps.loadExistingContacts(accountId);
  const offer = resolveExistingContactMergeOffer({
    candidate,
    existingContacts: existing,
    recordedMatchContactId: candidate.matched_contacts_id ?? null,
  });
  if (!offer.offered) {
    return { ok: false, error: MERGE_MSG.notTrusted, code: 'MERGE_NOT_TRUSTED' };
  }

  // EL guardia contra IDOR en esta capa. El de la 117 —`matched_contacts_id` bajo el lock— es el
  // definitivo; éste evita además que una petición forjada llegue siquiera a abrir transacción.
  if (requestedContactId.trim() !== offer.contactId) {
    return { ok: false, error: MERGE_MSG.contactMismatch, code: 'CONTACT_MISMATCH' };
  }

  const incumbentScalar = await deps.loadExistingContactScalar(offer.contactId, accountId);
  if (!incumbentScalar) {
    return { ok: false, error: MERGE_MSG.contactMissing, code: 'CONTACT_MISMATCH' };
  }

  // El patch REPITE el veredicto duplicado; no lo cambia. `status` sigue siendo `duplicate`
  // porque el candidato SIGUE siendo un duplicado — fusionarlo no lo convierte en otra cosa —, y
  // la 117 rechaza cualquier patch que diga otra cosa. Lo que distingue fusionado de descartado
  // lo inyecta la transacción, que es la única que sabe que llegó a confirmar.
  const review: ReviewMetadata = {
    status: 'duplicate',
    reason: 'Duplicado fusionado con un contacto existente',
    reviewed_at: deps.nowIso,
    reviewed_by: deps.actorId,
    matched_contact_id: offer.contactId,
    merged_match_signal: offer.signal,
  };
  const reviewPatch: CandidateReviewPatch = {
    status: 'duplicate',
    duplicate_status: 'exact_duplicate',
    review_notes: 'Duplicado fusionado con un contacto existente',
    reviewed_by: deps.actorId,
    reviewed_at: deps.nowIso,
    enrichment_metadata: mergeReview(candidate.enrichment_metadata, review),
  };

  const merged = await deps.mergeTransactionally({
    candidateId: candidate.id,
    contactId: offer.contactId,
    accountId,
    reviewPatch,
    candidate,
    incumbentScalar,
  });
  if (!merged.ok) {
    return { ok: false, error: merged.error, code: merged.code ?? 'MERGE_FAILED' };
  }

  // La auditoría queda FUERA de la transacción a propósito y sólo corre después de que ésta haya
  // confirmado: al revés, una fila que dice `contact_updated` sobreviviría al rollback de la
  // escritura que dice haber hecho. Un merge ya hecho no se vuelve a auditar.
  if (!merged.alreadyMerged) {
    await deps.logAudit?.({
      contactId: merged.contactId,
      accountId,
      candidateId: candidate.id,
      actorUserId: deps.actorId,
      matchSignal: offer.signal,
      phonesInserted: merged.phonesInserted,
      sourcesInserted: merged.sourcesInserted,
    });
  }

  return {
    ok: true,
    contactId: merged.contactId,
    alreadyMerged: merged.alreadyMerged,
    message: merged.alreadyMerged ? MERGE_MSG.alreadyMerged : MERGE_MSG.merged,
  };
}

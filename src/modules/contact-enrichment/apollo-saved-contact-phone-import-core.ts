// Agente 2A — Importación de teléfonos YA GUARDADOS en Apollo (APOLLO-SAVED-CONTACT-PHONES-1)
//
// Soporte humano de Apollo (2026-10-21): un teléfono que el equipo ya reveló y GUARDÓ
// como Contact en Apollo no se vuelve a cobrar. `POST /api/v1/contacts/search` busca en
// esos contactos guardados y cuesta 0 créditos (doc de Apollo). La prueba sin escritura
// del 21-10 encontró 33 personas sin teléfono en SellUp con número guardado en Apollo.
//
// Este módulo es el NÚCLEO PURO de esa importación: decide, persona por persona, si el
// teléfono guardado en Apollo puede entrar a SellUp y, si no, por qué. Sin red, sin DB,
// sin process.env. La lectura (Supabase + Apollo) vive en el script de ops; la
// escritura todavía NO existe (necesita una migración aprobada aparte).
//
// Reglas, todas fail-closed:
//   * identidad: sólo por person_id de Apollo, LinkedIn o correo — NUNCA por nombre. Si
//     el person_id del objetivo y el del contacto guardado difieren, es OTRA persona aunque
//     coincida el correo. Dos contactos guardados distintos que coinciden ⇒ ambiguo.
//   * no contactar: `blocked_suppressed`, `check_unavailable` y `not_evaluable` descartan.
//     «No pude verificar» nunca equivale a «permitido».
//   * «no llamar» de Apollo: cualquier `dnc_status` que no sea explícitamente limpio
//     descarta ESE número.
//   * números borrados antes por una DSAR (tombstone por dedupe key) no se re-escriben.

import { normalizeApolloPersonId } from '@/server/integrations/apollo-person-id';
import {
  mapApolloPhoneTypeToPhoneType,
  pickBestApolloPhone,
  type PhoneType,
} from '@/server/agents/contact-enrichment-toolkit/phone-classification';
import {
  CANDIDATE_PHONE_TYPE_RANKING,
  normalizeCandidatePhone,
  type CandidatePhoneStatus,
} from './phone-collection-core';
import { mapApolloPhoneStatus } from './apollo-phone-collection-capture';
import type { PhoneProcessingBasis } from './types';

// ── Entradas ───────────────────────────────────────────────────

/** Registro de SellUp sin teléfono: un candidato de contacto o un contacto oficial. */
export interface SavedContactImportTarget {
  kind: 'candidate' | 'contact';
  id: string;
  /** Cuenta SellUp; sólo alimenta la mitad legada de la lectura de supresión. */
  accountId: string | null;
  /** Ya resuelto con `resolvePhoneRevealProviderIdentity` (null en contactos oficiales). */
  apolloPersonId: string | null;
  email: string | null;
  linkedinUrl: string | null;
}

/** Entrada de `phone_numbers[]` de un contacto guardado. Forma no documentada: todo opcional. */
export interface ApolloSavedContactPhoneEntry {
  raw_number?: string | null;
  sanitized_number?: string | null;
  type_cd?: string | null;
  type?: string | null;
  status_cd?: string | null;
  status?: string | null;
  dnc_status?: unknown;
}

/** Contacto guardado tal como lo devuelve `contacts/search` (sólo lo que usamos). */
export interface ApolloSavedContact {
  id?: string | null;
  person_id?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  phone_numbers?: readonly (ApolloSavedContactPhoneEntry | null)[] | null;
  sanitized_phone?: string | null;
}

// ── Identidad ──────────────────────────────────────────────────

export type SavedContactMatch =
  | { kind: 'matched'; contact: ApolloSavedContact; matchedBy: 'person_id' | 'linkedin' | 'email' }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'identity_conflict' }
  | { kind: 'none' };

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLinkedin(value: unknown): string | null {
  const raw = clean(value)?.toLowerCase();
  if (!raw) return null;
  return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '') || null;
}

function normalizeEmail(value: unknown): string | null {
  return clean(value)?.toLowerCase() ?? null;
}

function contactKey(contact: ApolloSavedContact, index: number): string {
  return clean(contact.id) ?? normalizeApolloPersonId(contact.person_id) ?? `idx:${index}`;
}

/**
 * Busca, entre los contactos guardados que devolvió Apollo, el que es la MISMA persona
 * que el objetivo. Nunca por nombre: la búsqueda por texto de Apollo devuelve homónimos.
 */
export function matchApolloSavedContact(
  target: SavedContactImportTarget,
  contacts: readonly ApolloSavedContact[],
): SavedContactMatch {
  const targetPid = normalizeApolloPersonId(target.apolloPersonId);
  const targetLinkedin = normalizeLinkedin(target.linkedinUrl);
  const targetEmail = normalizeEmail(target.email);

  const hits = new Map<string, { contact: ApolloSavedContact; matchedBy: 'person_id' | 'linkedin' | 'email' }>();
  let conflict = false;

  contacts.forEach((contact, index) => {
    const contactPid = normalizeApolloPersonId(contact.person_id);
    let matchedBy: 'person_id' | 'linkedin' | 'email' | null = null;
    if (targetPid && contactPid && targetPid === contactPid) matchedBy = 'person_id';
    else if (targetLinkedin && normalizeLinkedin(contact.linkedin_url) === targetLinkedin) matchedBy = 'linkedin';
    else if (targetEmail && normalizeEmail(contact.email) === targetEmail) matchedBy = 'email';
    if (!matchedBy) return;

    // Un canal secundario coincide pero Apollo dice que es OTRA persona: no se confía.
    if (matchedBy !== 'person_id' && targetPid && contactPid && targetPid !== contactPid) {
      conflict = true;
      return;
    }
    const key = contactKey(contact, index);
    const previous = hits.get(key);
    if (!previous || (previous.matchedBy !== 'person_id' && matchedBy === 'person_id')) {
      hits.set(key, { contact, matchedBy });
    }
  });

  if (hits.size > 1) return { kind: 'ambiguous', count: hits.size };
  const only = [...hits.values()][0];
  if (only) return { kind: 'matched', ...only };
  return conflict ? { kind: 'identity_conflict' } : { kind: 'none' };
}

// ── Teléfonos del contacto guardado ────────────────────────────

export type ApolloDncClass = 'none' | 'flagged';

const DNC_CLEAR_VALUES = new Set(['not_on_dnc', 'clear']);

/** `dnc_status` de Apollo. Sólo ausente/vacío o un «limpio» explícito pasa. */
export function classifyApolloDncStatus(raw: unknown): ApolloDncClass {
  if (raw === undefined || raw === null) return 'none';
  if (typeof raw !== 'string') return 'flagged';
  const key = raw.trim().toLowerCase();
  if (!key) return 'none';
  return DNC_CLEAR_VALUES.has(key) ? 'none' : 'flagged';
}

export interface SavedContactPhone {
  displayPhone: string;
  normalizedPhone: string | null;
  dedupeKey: string;
  phoneType: PhoneType;
  phoneStatus: CandidatePhoneStatus;
  rawType: string | null;
  rawStatus: string | null;
  dnc: ApolloDncClass;
  rawDncStatus: string | null;
}

function isEntry(value: unknown): value is ApolloSavedContactPhoneEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Teléfonos utilizables del contacto guardado, con la misma normalización y clave de
 * duplicados que la colección de SellUp. Dos entradas del mismo número colapsan; si
 * una de ellas trae «no llamar», gana la marca.
 */
export function extractSavedContactPhones(contact: ApolloSavedContact): SavedContactPhone[] {
  const entries: ApolloSavedContactPhoneEntry[] = Array.isArray(contact.phone_numbers)
    ? contact.phone_numbers.filter(isEntry)
    : [];
  const sources: ApolloSavedContactPhoneEntry[] =
    entries.length > 0 ? entries : clean(contact.sanitized_phone) ? [{ sanitized_number: contact.sanitized_phone }] : [];

  const byKey = new Map<string, SavedContactPhone>();
  for (const entry of sources) {
    const number = clean(entry.sanitized_number) ?? clean(entry.raw_number);
    if (!number) continue;
    const normalized = normalizeCandidatePhone({ displayPhone: number, sanitizedPhone: number, countryCode: null });
    const rawType = clean(entry.type_cd) ?? clean(entry.type);
    const rawStatus = clean(entry.status_cd) ?? clean(entry.status);
    const dnc = classifyApolloDncStatus(entry.dnc_status);
    const phone: SavedContactPhone = {
      displayPhone: normalized.displayPhone ?? number,
      normalizedPhone: normalized.normalizedPhone,
      dedupeKey: normalized.dedupeKey,
      phoneType: mapApolloPhoneTypeToPhoneType(rawType),
      phoneStatus: mapApolloPhoneStatus(rawStatus),
      rawType,
      rawStatus,
      dnc,
      rawDncStatus: typeof entry.dnc_status === 'string' ? clean(entry.dnc_status) : null,
    };
    const previous = byKey.get(phone.dedupeKey);
    if (!previous) byKey.set(phone.dedupeKey, phone);
    else if (previous.dnc === 'none' && phone.dnc === 'flagged') byKey.set(phone.dedupeKey, { ...previous, dnc: 'flagged', rawDncStatus: phone.rawDncStatus });
  }
  return [...byKey.values()];
}

// ── Decisión ───────────────────────────────────────────────────

/** Resultado de `evaluatePhoneRevealSuppression` (sólo el discriminante importa aquí). */
export interface SavedContactSuppressionResult {
  kind: 'allowed' | 'not_evaluable' | 'blocked_suppressed' | 'check_unavailable';
}

export type SavedContactSkipReason =
  | 'skip_not_saved_in_apollo'
  | 'skip_ambiguous_match'
  | 'skip_identity_conflict'
  | 'skip_suppressed'
  | 'skip_suppression_unverifiable'
  | 'skip_saved_without_phone'
  | 'skip_all_numbers_do_not_call'
  | 'skip_all_numbers_tombstoned';

interface DecisionBase {
  targetKind: SavedContactImportTarget['kind'];
  targetId: string;
  /** Identidad Apollo usada para la supresión (la del objetivo o, si falta, la del contacto guardado). */
  apolloPersonId: string | null;
  matchedBy: 'person_id' | 'linkedin' | 'email' | null;
  apolloContactId: string | null;
}

export type SavedContactImportDecision =
  | (DecisionBase & { decision: SavedContactSkipReason })
  | (DecisionBase & {
      decision: 'would_import';
      phones: SavedContactPhone[];
      primaryDedupeKey: string;
      droppedDoNotCall: number;
      droppedTombstoned: number;
    });

/** Identidad Apollo con la que se consulta la supresión de este objetivo. */
export function resolveSavedContactSuppressionPersonId(
  target: SavedContactImportTarget,
  match: SavedContactMatch,
): string | null {
  return (
    normalizeApolloPersonId(target.apolloPersonId) ??
    (match.kind === 'matched' ? normalizeApolloPersonId(match.contact.person_id) : null)
  );
}

export function decideSavedContactPhoneImport(input: {
  target: SavedContactImportTarget;
  match: SavedContactMatch;
  suppression: SavedContactSuppressionResult;
  /** Dedupe keys de números suprimidos (tombstones) que ya existen para este objetivo. */
  tombstonedDedupeKeys: ReadonlySet<string>;
}): SavedContactImportDecision {
  const { target, match, suppression } = input;
  const base: DecisionBase = {
    targetKind: target.kind,
    targetId: target.id,
    apolloPersonId: resolveSavedContactSuppressionPersonId(target, match),
    matchedBy: match.kind === 'matched' ? match.matchedBy : null,
    apolloContactId: match.kind === 'matched' ? clean(match.contact.id) : null,
  };

  if (match.kind === 'none') return { ...base, decision: 'skip_not_saved_in_apollo' };
  if (match.kind === 'ambiguous') return { ...base, decision: 'skip_ambiguous_match' };
  if (match.kind === 'identity_conflict') return { ...base, decision: 'skip_identity_conflict' };

  if (suppression.kind === 'blocked_suppressed') return { ...base, decision: 'skip_suppressed' };
  if (suppression.kind !== 'allowed') return { ...base, decision: 'skip_suppression_unverifiable' };

  const all = extractSavedContactPhones(match.contact);
  if (all.length === 0) return { ...base, decision: 'skip_saved_without_phone' };

  const callable = all.filter((phone) => phone.dnc === 'none');
  if (callable.length === 0) return { ...base, decision: 'skip_all_numbers_do_not_call' };

  const phones = callable.filter((phone) => !input.tombstonedDedupeKeys.has(phone.dedupeKey));
  if (phones.length === 0) return { ...base, decision: 'skip_all_numbers_tombstoned' };

  return {
    ...base,
    decision: 'would_import',
    phones,
    primaryDedupeKey: pickPrimary(phones).dedupeKey,
    droppedDoNotCall: all.length - callable.length,
    droppedTombstoned: callable.length - phones.length,
  };
}

/** Principal: el mejor tipo entre los no inválidos (mismo ranking que el resto de SellUp). */
function pickPrimary(phones: readonly SavedContactPhone[]): SavedContactPhone {
  const eligible = phones.filter((phone) => phone.phoneStatus !== 'invalid');
  const pool = eligible.length > 0 ? eligible : phones;
  const best = pickBestApolloPhone(pool.map((phone) => ({ sanitized_number: phone.displayPhone, type: phone.rawType })));
  return pool.find((phone) => phone.displayPhone === best?.number) ?? pool[0];
}

// ── Payload de las funciones de la migración 155 ───────────────

/**
 * Base de tratamiento registrada para estos números. Decisión de la dueña (21-10): la misma
 * que usan los reveals. Sólo se escribe donde la columna está vacía.
 */
export const SAVED_CONTACT_PHONE_PROCESSING_BASIS: PhoneProcessingBasis = 'legitimate_interest_b2b';

/** Prefijo que la migración 155 EXIGE en `source_event_key`. */
export const SAVED_CONTACT_SOURCE_EVENT_KEY_PREFIX = 'apollo_saved_contact:';

export interface SavedContactImportPayload {
  phones: Array<{
    dedupe_key: string;
    normalized_phone: string | null;
    display_phone: string;
    phone_type: PhoneType;
    phone_status: CandidatePhoneStatus;
  }>;
  /**
   * `(apollo, reveal)`: son números revelados en Apollo por el equipo. Un modo nuevo
   * sobreviviría al borrado DSAR de las migraciones 112/115/116/117/128 (ver cabecera de la
   * 155). Sin waterfall_run_id / reservation_id / provider_usage_log_id: no hubo gasto.
   */
  sources: Array<{
    dedupe_key: string;
    provider: 'apollo';
    acquisition_mode: 'reveal';
    raw_provider_type: string | null;
    raw_provider_status: string | null;
    source_event_key: string;
  }>;
  /** En orden de preferencia; nunca incluye un número que Apollo marca inválido. */
  primaryCandidates: Array<{ dedupe_key: string; phone: string; phone_type: PhoneType; raw_type: string | null }>;
}

type ImportableDecision = Extract<SavedContactImportDecision, { decision: 'would_import' }>;

export function buildSavedContactImportPayload(decision: ImportableDecision): SavedContactImportPayload {
  const eventKey =
    SAVED_CONTACT_SOURCE_EVENT_KEY_PREFIX +
    (decision.apolloContactId ?? `person:${decision.apolloPersonId ?? 'unknown'}`);
  const rank = (phone: SavedContactPhone) => {
    const position = CANDIDATE_PHONE_TYPE_RANKING.indexOf(phone.phoneType);
    return position === -1 ? CANDIDATE_PHONE_TYPE_RANKING.length : position;
  };
  const eligible = decision.phones.filter((phone) => phone.phoneStatus !== 'invalid');
  const primary = eligible.find((phone) => phone.dedupeKey === decision.primaryDedupeKey);
  const ordered = [
    ...(primary ? [primary] : []),
    ...eligible.filter((phone) => phone !== primary).sort((a, b) => rank(a) - rank(b)),
  ];

  return {
    phones: decision.phones.map((phone) => ({
      dedupe_key: phone.dedupeKey,
      normalized_phone: phone.normalizedPhone,
      display_phone: phone.displayPhone,
      phone_type: phone.phoneType,
      phone_status: phone.phoneStatus,
    })),
    sources: decision.phones.map((phone) => ({
      dedupe_key: phone.dedupeKey,
      provider: 'apollo',
      acquisition_mode: 'reveal',
      raw_provider_type: phone.rawType,
      raw_provider_status: phone.rawStatus,
      source_event_key: eventKey,
    })),
    primaryCandidates: ordered.map((phone) => ({
      dedupe_key: phone.dedupeKey,
      phone: phone.displayPhone,
      phone_type: phone.phoneType,
      raw_type: phone.rawType,
    })),
  };
}

/** Para informes: nunca más de los 2 últimos dígitos. */
export function maskPhoneForReport(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length === 0 ? '—' : `••••${digits.slice(-2)}`;
}

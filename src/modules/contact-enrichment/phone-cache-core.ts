// Agente 2A — Apollo Phone Cache: PURE core (APOLLO-PHONE-CACHE-1b)
//
// Decision logic for reusing an Apollo phone reveal that was ALREADY paid for,
// keyed by the Apollo person id persisted in CACHE-1a. This module is PURE and
// dependency-free, exactly like the START / WEBHOOK / RECOVERY cores: no
// network, no Supabase, no env, no clock (`nowIso` is always injected). Every
// decision below is therefore testable offline with no provider and no DB.
//
// Approved privacy policy (product + legal GO) — every rule lives here, never
// in a migration and never in an adapter:
//   * TTL 90 days from the ORIGINAL reveal. Expired ⇒ miss ⇒ normal reveal.
//     A hit NEVER extends the TTL (no refresh-on-read).
//   * Reuse scope = SAME ACCOUNT ONLY. No cross-account reuse, ever.
//   * Reuse scope = SAME COUNTRY ONLY. Unknown country ⇒ miss (fail-closed).
//   * Lawful processing basis is mandatory on a cache hit too — a hit is a new
//     use of personal data, not a free read.
//   * A tombstone (suppression) blocks BOTH the cache hit AND the automatic
//     reveal that would otherwise follow the miss. The tombstone check does NOT
//     depend on ENABLE_APOLLO_PHONE_CACHE (FIX 2): that flag governs REUSE of a
//     cached number, never compliance with an erasure. Its key is
//     (provider, person, account) — country-independent on purpose.
//   * A cache hit costs 0 credits because NO provider call happens.
//   * Apollo only. Lusha is never read from, never written to, never cached.
//   * No bulk: every entry point here is single-candidate.
//
// PII contract: this module never emits a phone, email, name or linkedin in any
// log/audit shape it builds. The phone travels ONLY inside the persistence patch
// (which the caller writes to the candidate row) and never into usage metadata.

import { normalizeApolloPersonId } from '@/server/integrations/apollo-person-id';
import type { PhoneType } from '@/server/agents/contact-enrichment-toolkit/phone-classification';
import type { PhoneProcessingBasis } from './types';

// ── Constantes de política ─────────────────────────────────────

/** Único proveedor cacheable. Sin Lusha, por contrato legal/producto. */
export const PHONE_CACHE_PROVIDER = 'apollo' as const;

/** TTL de reutilización aprobado: 90 días desde el reveal ORIGINAL. */
export const PHONE_CACHE_TTL_DAYS = 90;

/** Alcance de reutilización aprobado. No hay variante cross-account. */
export const PHONE_CACHE_REUSE_SCOPE = 'same_account' as const;

/** operation_key propio del cache hit. NUNCA se mezcla con person_phone_reveal. */
export const PHONE_CACHE_HIT_OPERATION_KEY = 'person_phone_cache_hit';

/** cost_source del cache hit: no hubo llamada al proveedor. */
export const PHONE_CACHE_HIT_COST_SOURCE = 'cache' as const;

/** reveal_phase del usage-log del hit (distinto de start / webhook / recovery_poll). */
export const PHONE_CACHE_HIT_REVEAL_PHASE = 'cache_hit' as const;

/** Un cache hit no llama al proveedor ⇒ cuesta 0 créditos. */
export const PHONE_CACHE_HIT_CREDITS = 0;

/**
 * Procedencia del teléfono servido desde caché. Debe ser SIEMPRE distinguible de
 * `apollo_reveal`: un número reutilizado no es un reveal nuevo.
 */
export const PHONE_CACHE_HIT_PHONE_SOURCE = 'apollo_cache' as const;

/** Procedencia del valor CACHEADO. Solo un reveal real y pagado es cacheable. */
export const PHONE_CACHE_ENTRY_PHONE_SOURCE = 'apollo_reveal' as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Helpers puros ──────────────────────────────────────────────

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normaliza un país a ISO-3166-1 alpha-2 en mayúsculas. Cualquier otra cosa
 * (nombre completo, vacío, código de 3 letras, null) ⇒ null = país desconocido.
 * Fail-closed: país desconocido NO se cachea y NUNCA reutiliza.
 */
export function normalizePhoneCacheCountryCode(
  value: string | null | undefined,
): string | null {
  const raw = cleanText(value);
  if (!raw) return null;
  return /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null;
}

/**
 * Resuelve el país de alcance de caché de un candidato de forma DETERMINISTA.
 * El mismo resolver se usa en escritura y en lectura, así que un candidato nunca
 * puede escribir bajo un país y leer bajo otro (lo que produciría un falso hit
 * cross-country). Prioriza el país del candidato y cae al país de la empresa del
 * run; si ninguno es ISO-2 devuelve null (⇒ sin caché, sin reutilización).
 */
export function resolvePhoneCacheCountryCode(input: {
  candidateCountry?: string | null;
  runCompanyCountryCode?: string | null;
}): string | null {
  return (
    normalizePhoneCacheCountryCode(input.candidateCountry) ??
    normalizePhoneCacheCountryCode(input.runCompanyCountryCode)
  );
}

/**
 * Resuelve el Apollo person id utilizable como clave de caché. Prioriza la
 * columna `apollo_person_id` (CACHE-1a) y cae al `source_contact_id` SOLO cuando
 * el candidato es origen Apollo. Ids de otros proveedores (p.ej. Lusha `v1.*`)
 * se descartan en el validador: nunca leen ni escriben caché.
 */
export function resolvePhoneCachePersonId(input: {
  apolloPersonId?: string | null;
  sourceProvider?: string | null;
  sourceContactId?: string | null;
}): string | null {
  const fromColumn = normalizeApolloPersonId(input.apolloPersonId);
  if (fromColumn) return fromColumn;
  const provider = cleanText(input.sourceProvider)?.toLowerCase() ?? null;
  if (provider !== PHONE_CACHE_PROVIDER) return null;
  return normalizeApolloPersonId(input.sourceContactId);
}

/** expires_at = original_revealed_at + 90 días. Nunca se recalcula en lectura. */
export function computePhoneCacheExpiresAt(originalRevealedAtIso: string): string {
  const base = Date.parse(originalRevealedAtIso);
  if (!Number.isFinite(base)) {
    throw new Error('phone-cache: original_revealed_at is not a valid ISO date');
  }
  return new Date(base + PHONE_CACHE_TTL_DAYS * MS_PER_DAY).toISOString();
}

// ── Clave y entrada de caché ───────────────────────────────────

/**
 * Clave de búsqueda. Los cuatro campos son obligatorios: sin cuenta o sin país
 * no hay búsqueda posible (fail-closed), que es exactamente la garantía
 * "no cross-account / no cross-country / país desconocido = no reuso".
 */
export interface PhoneCacheLookupKey {
  provider: typeof PHONE_CACHE_PROVIDER;
  providerPersonId: string;
  accountId: string;
  countryCode: string;
}

/**
 * Fila de caché tal y como la devuelve el store. `normalizedPhone` es el único
 * campo con dato personal y NUNCA sale de aquí hacia un log.
 */
export interface PhoneCacheEntry {
  id: string;
  provider: string;
  providerPersonId: string;
  accountId: string;
  countryCode: string;
  normalizedPhone: string | null;
  phoneType: PhoneType | string | null;
  phoneSource: string;
  originalRevealedAt: string;
  expiresAt: string;
  hitCount: number;
  suppressedAt: string | null;
}

// ── Comprobación de SUPRESIÓN, independiente del flag (FIX 2) ──

/**
 * Clave del tombstone. Tiene TRES campos, no cuatro: el país NO entra, porque la
 * unicidad de la tabla es (provider, provider_person_id, account_id) y una
 * supresión debe bloquear a esa persona en esa cuenta con independencia del país
 * que resuelva el candidato. Si el país entrase aquí, un candidato con país
 * desconocido — o resuelto a otro país — esquivaría el tombstone.
 */
export interface PhoneCacheSuppressionLookupKey {
  provider: typeof PHONE_CACHE_PROVIDER;
  providerPersonId: string;
  accountId: string;
}

/**
 * Proyección MÍNIMA del tombstone. Deliberadamente no incluye el teléfono: con
 * `ENABLE_APOLLO_PHONE_CACHE` apagado el reveal comprueba la supresión pero NO
 * debe leer ningún número, así que la comprobación se hace sobre una fila que no
 * puede contener dato personal alguno.
 */
export interface PhoneCacheSuppressionState {
  suppressedAt: string | null;
}

export type PhoneCacheSuppressionStatus = 'suppressed' | 'not_suppressed';

/**
 * Decide si existe supresión. Sin fila ⇒ nunca se suprimió ⇒ `not_suppressed`.
 * Una fila con `suppressed_at` ⇒ `suppressed`, y eso bloquea tanto el hit de
 * caché como el reveal automático. Un FALLO de la lectura no se representa aquí:
 * lo trata el llamador como "no verificable" (fail-closed, sin llamar a Apollo),
 * porque "no pude comprobarlo" nunca puede equivaler a "no está suprimido".
 */
export function evaluatePhoneCacheSuppressionState(
  state: PhoneCacheSuppressionState | null,
): PhoneCacheSuppressionStatus {
  if (!state) return 'not_suppressed';
  return cleanText(state.suppressedAt) ? 'suppressed' : 'not_suppressed';
}

// ── Evaluación de la búsqueda (pura) ───────────────────────────

export type PhoneCacheLookupOutcome =
  /** Hay entrada viva, del mismo proveedor/cuenta/país y con teléfono. */
  | 'hit'
  /** Tombstone: bloquea el hit Y el reveal automático posterior. */
  | 'blocked_suppressed'
  | 'miss_no_entry'
  | 'miss_expired'
  | 'miss_no_phone'
  | 'miss_provider_mismatch'
  | 'miss_account_mismatch'
  | 'miss_country_mismatch';

export interface PhoneCacheLookupEvaluation {
  outcome: PhoneCacheLookupOutcome;
  /** La entrada servible. Solo presente cuando outcome === 'hit'. */
  entry: PhoneCacheEntry | null;
}

/**
 * Decide, de forma PURA, si una entrada puede servirse. El orden importa: la
 * supresión gana sobre todo lo demás (un tombstone bloquea aunque la entrada
 * estuviera expirada o fuera de alcance), y los mismatches de alcance se
 * evalúan aunque el store ya haya filtrado por ellos — defensa en profundidad
 * para que un store mal cableado no pueda producir un hit cross-account o
 * cross-country.
 */
export function evaluatePhoneCacheLookup(
  key: PhoneCacheLookupKey,
  entry: PhoneCacheEntry | null,
  nowIso: string,
): PhoneCacheLookupEvaluation {
  if (!entry) return { outcome: 'miss_no_entry', entry: null };

  // Tombstone: bloquea antes que cualquier otra consideración.
  if (cleanText(entry.suppressedAt)) {
    return { outcome: 'blocked_suppressed', entry: null };
  }

  if (entry.provider !== key.provider) {
    return { outcome: 'miss_provider_mismatch', entry: null };
  }
  if (entry.accountId !== key.accountId) {
    return { outcome: 'miss_account_mismatch', entry: null };
  }
  if (
    normalizePhoneCacheCountryCode(entry.countryCode) !==
    normalizePhoneCacheCountryCode(key.countryCode)
  ) {
    return { outcome: 'miss_country_mismatch', entry: null };
  }
  if (!cleanText(entry.normalizedPhone)) {
    return { outcome: 'miss_no_phone', entry: null };
  }

  const expiresAt = Date.parse(entry.expiresAt);
  const now = Date.parse(nowIso);
  // Fecha ilegible ⇒ se trata como expirada (fail-closed, nunca se sirve).
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now) || expiresAt <= now) {
    return { outcome: 'miss_expired', entry: null };
  }

  return { outcome: 'hit', entry };
}

// ── Decisión de ESCRITURA (pura) ───────────────────────────────

export interface PhoneCacheWriteInput {
  /** Proveedor del reveal que produjo el teléfono. Solo 'apollo' se cachea. */
  provider: string | null;
  /** Apollo person id ya validado por el llamador (o crudo: se revalida aquí). */
  providerPersonId: string | null;
  accountId: string | null;
  countryCode: string | null;
  /** Teléfono revelado. Sin teléfono no hay nada que cachear. */
  normalizedPhone: string | null;
  phoneType: PhoneType | string | null;
  /** Procedencia del teléfono revelado. Solo 'apollo_reveal' es cacheable. */
  phoneSource: string | null;
  /** Momento del reveal ORIGINAL (base del TTL). */
  originalRevealedAt: string;
  sourceCandidateId?: string | null;
  /** Tombstone existente para (provider, person, account), si el store lo vio. */
  existingSuppressedAt?: string | null;
}

export type PhoneCacheWriteSkipReason =
  | 'cache_disabled'
  | 'provider_not_apollo'
  | 'invalid_person_id'
  | 'missing_account'
  | 'unknown_country'
  | 'missing_phone'
  | 'phone_source_not_reveal'
  | 'invalid_revealed_at'
  | 'suppressed_tombstone';

/** Fila lista para upsert. `normalizedPhone` es el único campo con PII. */
export interface PhoneCacheWriteRow {
  provider: typeof PHONE_CACHE_PROVIDER;
  providerPersonId: string;
  accountId: string;
  countryCode: string;
  normalizedPhone: string;
  phoneType: string | null;
  phoneSource: typeof PHONE_CACHE_ENTRY_PHONE_SOURCE;
  originalRevealedAt: string;
  expiresAt: string;
  sourceCandidateId: string | null;
}

export type PhoneCacheWriteDecision =
  | { write: true; row: PhoneCacheWriteRow }
  | { write: false; reason: PhoneCacheWriteSkipReason };

/**
 * Decide si un reveal terminado en `revealed` puede cachearse, y con qué fila.
 * Fail-closed en TODAS las condiciones: cualquier dato ausente o fuera de
 * política produce un skip con motivo mecánico (sin PII) en vez de una escritura
 * parcial. Respeta el tombstone: una entrada suprimida NUNCA se rellena de nuevo.
 */
export function buildPhoneCacheWriteDecision(
  input: PhoneCacheWriteInput,
  cacheEnabled: boolean,
): PhoneCacheWriteDecision {
  if (!cacheEnabled) return { write: false, reason: 'cache_disabled' };

  // Un tombstone gana sobre cualquier reveal posterior: la supresión es
  // definitiva hasta que alguien la revierta explícitamente (fuera de alcance).
  if (cleanText(input.existingSuppressedAt)) {
    return { write: false, reason: 'suppressed_tombstone' };
  }

  const provider = cleanText(input.provider)?.toLowerCase() ?? null;
  if (provider !== PHONE_CACHE_PROVIDER) {
    return { write: false, reason: 'provider_not_apollo' };
  }

  const personId = normalizeApolloPersonId(input.providerPersonId);
  if (!personId) return { write: false, reason: 'invalid_person_id' };

  const accountId = cleanText(input.accountId);
  if (!accountId) return { write: false, reason: 'missing_account' };

  const countryCode = normalizePhoneCacheCountryCode(input.countryCode);
  if (!countryCode) return { write: false, reason: 'unknown_country' };

  const phone = cleanText(input.normalizedPhone);
  if (!phone) return { write: false, reason: 'missing_phone' };

  // Solo un reveal real y pagado es cacheable: un hit de caché jamás se re-cachea.
  if (cleanText(input.phoneSource) !== PHONE_CACHE_ENTRY_PHONE_SOURCE) {
    return { write: false, reason: 'phone_source_not_reveal' };
  }

  const revealedAt = cleanText(input.originalRevealedAt);
  if (!revealedAt || !Number.isFinite(Date.parse(revealedAt))) {
    return { write: false, reason: 'invalid_revealed_at' };
  }

  return {
    write: true,
    row: {
      provider: PHONE_CACHE_PROVIDER,
      providerPersonId: personId,
      accountId,
      countryCode,
      normalizedPhone: phone,
      phoneType: cleanText(input.phoneType),
      phoneSource: PHONE_CACHE_ENTRY_PHONE_SOURCE,
      originalRevealedAt: revealedAt,
      expiresAt: computePhoneCacheExpiresAt(revealedAt),
      sourceCandidateId: cleanText(input.sourceCandidateId),
    },
  };
}

/**
 * Construye la entrada de escritura a partir de un reveal Apollo terminado en
 * `revealed`. Es el ÚNICO constructor usado por el webhook y por el recovery, de
 * modo que ambos caminos aplican exactamente la misma política (mismo resolver
 * de país, mismo `phone_source`, misma base de TTL). Devolver la entrada no
 * escribe nada: `buildPhoneCacheWriteDecision` sigue teniendo la última palabra.
 */
export function buildRevealPhoneCacheWriteInput(args: {
  personId: string | null;
  accountId: string | null;
  candidateCountry?: string | null;
  runCompanyCountryCode?: string | null;
  phone: string | null;
  phoneType: string | null;
  revealedAtIso: string;
  candidateId: string;
}): PhoneCacheWriteInput {
  return {
    provider: PHONE_CACHE_PROVIDER,
    providerPersonId: args.personId,
    accountId: args.accountId,
    countryCode: resolvePhoneCacheCountryCode({
      candidateCountry: args.candidateCountry ?? null,
      runCompanyCountryCode: args.runCompanyCountryCode ?? null,
    }),
    normalizedPhone: args.phone,
    phoneType: args.phoneType,
    // Solo un reveal real y pagado alimenta la caché.
    phoneSource: PHONE_CACHE_ENTRY_PHONE_SOURCE,
    originalRevealedAt: args.revealedAtIso,
    sourceCandidateId: args.candidateId,
  };
}

// ── Usage-log del cache hit (SIN PII) ──────────────────────────

/**
 * Metadata permitida en `provider_usage_logs` para un cache hit. Es una
 * allowlist cerrada: NO hay teléfono, email, nombre, linkedin ni payload crudo.
 * El person id viaja HASHEADO (`provider_person_id_hash`) para poder correlacionar
 * sin publicar el identificador del proveedor.
 */
export interface PhoneCacheHitUsageLogEntry {
  operationKey: typeof PHONE_CACHE_HIT_OPERATION_KEY;
  provider: typeof PHONE_CACHE_PROVIDER;
  triggeredBy: string;
  creditsUsed: typeof PHONE_CACHE_HIT_CREDITS;
  costUsd: 0;
  status: 'success';
  metadata: {
    candidate_id: string;
    account_id: string;
    cache_entry_id: string;
    provider_person_id_hash: string;
    actor_role: string;
    reveal_phase: typeof PHONE_CACHE_HIT_REVEAL_PHASE;
    phone_present: true;
    phone_type: string | null;
    original_revealed_at: string;
    ttl_days: typeof PHONE_CACHE_TTL_DAYS;
    reuse_scope: typeof PHONE_CACHE_REUSE_SCOPE;
    phone_processing_basis: PhoneProcessingBasis;
    cost_source: typeof PHONE_CACHE_HIT_COST_SOURCE;
    credits_used: typeof PHONE_CACHE_HIT_CREDITS;
  };
}

/**
 * Construye el usage-log del hit. `providerPersonIdHash` lo calcula el wrapper
 * (el hash necesita crypto, que no pertenece a un core puro), pero la forma de
 * la metadata — y por tanto la garantía de que no hay PII — se decide aquí.
 */
export function buildPhoneCacheHitUsageLog(args: {
  candidateId: string;
  accountId: string;
  cacheEntryId: string;
  providerPersonIdHash: string;
  actorUserId: string;
  actorRole: string;
  phoneType: string | null;
  originalRevealedAt: string;
  processingBasis: PhoneProcessingBasis;
}): PhoneCacheHitUsageLogEntry {
  return {
    operationKey: PHONE_CACHE_HIT_OPERATION_KEY,
    provider: PHONE_CACHE_PROVIDER,
    triggeredBy: args.actorUserId,
    creditsUsed: PHONE_CACHE_HIT_CREDITS,
    costUsd: 0,
    status: 'success',
    metadata: {
      candidate_id: args.candidateId,
      account_id: args.accountId,
      cache_entry_id: args.cacheEntryId,
      provider_person_id_hash: args.providerPersonIdHash,
      actor_role: args.actorRole,
      reveal_phase: PHONE_CACHE_HIT_REVEAL_PHASE,
      phone_present: true,
      phone_type: args.phoneType,
      original_revealed_at: args.originalRevealedAt,
      ttl_days: PHONE_CACHE_TTL_DAYS,
      reuse_scope: PHONE_CACHE_REUSE_SCOPE,
      phone_processing_basis: args.processingBasis,
      cost_source: PHONE_CACHE_HIT_COST_SOURCE,
      credits_used: PHONE_CACHE_HIT_CREDITS,
    },
  };
}

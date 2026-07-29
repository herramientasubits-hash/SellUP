// Agente 2A — Apollo Phone Cache: Supabase STORE (APOLLO-PHONE-CACHE-1b)
//
// Thin service-role adapter over `phone_reveal_cache`. It contains I/O ONLY: no
// policy decisions live here — TTL, reuse scope, tombstone semantics and the
// PII-free log shapes all live in the pure cores (phone-cache-core.ts /
// phone-cache-suppression-core.ts). Keeping the policy out of the adapter is
// what makes the whole contract testable offline.
//
// Safety:
//   * every entry point is single-key: there is no bulk read or bulk write.
//   * the cache write is BEST-EFFORT: a failure must never break the reveal
//     persistence that already succeeded, so `writePhoneCacheEntry` catches and
//     reports instead of throwing. Errors are logged WITHOUT any PII: no phone,
//     no email, no name, no linkedin, and never the person id in clear.
//   * a suppressed row (tombstone) is NEVER refilled with a phone.
//   * the table holds phone numbers, so it is service-role only.

// Server-only: this module uses node:crypto and a service-role Supabase client.
// It must never be imported from a client component (same convention as
// feature-flags.server.ts and the other service-role adapters in this module).

import { createHash } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  buildPhoneCacheWriteDecision,
  PHONE_CACHE_PROVIDER,
  type PhoneCacheEntry,
  type PhoneCacheLookupKey,
  type PhoneCacheWriteInput,
  type PhoneCacheWriteSkipReason,
} from './phone-cache-core';

/** Nombre de la tabla de caché. Único punto donde se escribe el literal. */
export const PHONE_REVEAL_CACHE_TABLE = 'phone_reveal_cache';

const CACHE_ENTRY_SELECT = `id, provider, provider_person_id, account_id, country_code,
   normalized_phone, phone_type, phone_source, original_revealed_at, expires_at,
   hit_count, suppressed_at`;

/**
 * Hash estable (SHA-256, hex) del Apollo person id para auditoría. Permite
 * correlacionar eventos de la misma persona sin publicar el identificador del
 * proveedor en `provider_usage_logs`.
 */
export function hashProviderPersonId(personId: string): string {
  return createHash('sha256').update(personId).digest('hex');
}

function mapCacheEntry(row: Record<string, unknown>): PhoneCacheEntry {
  return {
    id: row.id as string,
    provider: (row.provider as string) ?? PHONE_CACHE_PROVIDER,
    providerPersonId: (row.provider_person_id as string) ?? '',
    accountId: (row.account_id as string) ?? '',
    countryCode: (row.country_code as string) ?? '',
    normalizedPhone: (row.normalized_phone as string | null) ?? null,
    phoneType: (row.phone_type as string | null) ?? null,
    phoneSource: (row.phone_source as string) ?? '',
    originalRevealedAt: (row.original_revealed_at as string) ?? '',
    expiresAt: (row.expires_at as string) ?? '',
    hitCount: typeof row.hit_count === 'number' ? row.hit_count : 0,
    suppressedAt: (row.suppressed_at as string | null) ?? null,
  };
}

// ── Lectura ────────────────────────────────────────────────────

/**
 * Lee la entrada de (provider, person, account). Deliberadamente NO filtra por
 * `suppressed_at`, `expires_at` ni `normalized_phone`: esa evaluación es del
 * core puro (`evaluatePhoneCacheLookup`), que necesita VER el tombstone para
 * poder bloquear. Filtrarlo aquí convertiría una supresión en un simple miss —
 * y un miss dispararía un reveal nuevo, que es justo lo que hay que impedir.
 *
 * El país NO entra en el WHERE por el mismo motivo: el core compara los países y
 * devuelve `miss_country_mismatch`, de modo que una entrada de otro país nunca
 * se sirve pero tampoco se duplica silenciosamente.
 */
export async function readPhoneCacheEntry(
  key: PhoneCacheLookupKey,
): Promise<PhoneCacheEntry | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from(PHONE_REVEAL_CACHE_TABLE)
    .select(CACHE_ENTRY_SELECT)
    .eq('provider', key.provider)
    .eq('provider_person_id', key.providerPersonId)
    .eq('account_id', key.accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCacheEntry(data as Record<string, unknown>) : null;
}

// ── Escritura (best-effort) ────────────────────────────────────

export type PhoneCacheWriteOutcome =
  | { written: true; entryId: string | null }
  | { written: false; reason: PhoneCacheWriteSkipReason | 'write_failed' };

/**
 * Cachea un teléfono recién revelado. BEST-EFFORT por contrato: nunca lanza, así
 * que un fallo de caché no puede tumbar la persistencia del reveal (que ya
 * ocurrió y ya se pagó). Cualquier fallo se reporta como
 * `{ written: false, reason: 'write_failed' }` y se registra en consola SIN PII.
 *
 * Respeta el tombstone: si ya existe una entrada suprimida para
 * (provider, person, account) no se reinserta el teléfono.
 */
export async function writePhoneCacheEntry(
  input: PhoneCacheWriteInput,
  cacheEnabled: boolean,
): Promise<PhoneCacheWriteOutcome> {
  if (!cacheEnabled) return { written: false, reason: 'cache_disabled' };

  try {
    // Decisión preliminar (sin tocar DB) para no leer si ya sabemos que no se
    // puede cachear: evita una consulta por cada no_phone_found / id inválido.
    const preliminary = buildPhoneCacheWriteDecision(input, cacheEnabled);
    if (!preliminary.write) return { written: false, reason: preliminary.reason };

    const existing = await readPhoneCacheEntry({
      provider: PHONE_CACHE_PROVIDER,
      providerPersonId: preliminary.row.providerPersonId,
      accountId: preliminary.row.accountId,
      countryCode: preliminary.row.countryCode,
    });

    // Re-decide con el tombstone real a la vista: la supresión gana siempre.
    const decision = buildPhoneCacheWriteDecision(
      { ...input, existingSuppressedAt: existing?.suppressedAt ?? null },
      cacheEnabled,
    );
    if (!decision.write) return { written: false, reason: decision.reason };

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from(PHONE_REVEAL_CACHE_TABLE)
      .upsert(
        {
          provider: decision.row.provider,
          provider_person_id: decision.row.providerPersonId,
          account_id: decision.row.accountId,
          country_code: decision.row.countryCode,
          normalized_phone: decision.row.normalizedPhone,
          phone_type: decision.row.phoneType,
          phone_source: decision.row.phoneSource,
          original_revealed_at: decision.row.originalRevealedAt,
          expires_at: decision.row.expiresAt,
          source_candidate_id: decision.row.sourceCandidateId,
        },
        { onConflict: 'provider,provider_person_id,account_id' },
      )
      .select('id')
      .maybeSingle();

    if (error) {
      // Sin PII: solo el mensaje del driver, nunca el teléfono ni el person id.
      console.error('[phone-cache] cache write failed:', error.message);
      return { written: false, reason: 'write_failed' };
    }
    return { written: true, entryId: (data?.id as string | undefined) ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[phone-cache] cache write failed:', message);
    return { written: false, reason: 'write_failed' };
  }
}

// ── Telemetría de reutilización ────────────────────────────────

/**
 * Marca el uso de una entrada: `last_used_at` y `hit_count + 1`. NO toca
 * `expires_at`: por política aprobada un hit jamás extiende el TTL.
 * Best-effort: nunca lanza.
 */
export async function touchPhoneCacheEntry(
  cacheEntryId: string,
  usedAtIso: string,
): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error: readError } = await admin
      .from(PHONE_REVEAL_CACHE_TABLE)
      .select('hit_count')
      .eq('id', cacheEntryId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    const currentHits = typeof data?.hit_count === 'number' ? data.hit_count : 0;
    const { error } = await admin
      .from(PHONE_REVEAL_CACHE_TABLE)
      .update({ last_used_at: usedAtIso, hit_count: currentHits + 1 })
      .eq('id', cacheEntryId);
    if (error) throw new Error(error.message);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[phone-cache] hit telemetry failed:', message);
  }
}

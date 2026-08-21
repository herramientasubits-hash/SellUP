// Agente 2A — I/O de la supresión NATIVA del proveedor
// (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4, Fase 1)
//
// Todo lo que decide vive en `provider-suppression-core.ts` (puro). Aquí sólo hay
// acceso a la base: dos lecturas y dos escrituras, ninguna con teléfono.
//
// ═══════════════════════════════════════════════════════════════════
// LA SEPARACIÓN QUE ESTE ARCHIVO MATERIALIZA
// ═══════════════════════════════════════════════════════════════════
//
// `phone_reveal_cache` sigue siendo LO QUE ES: una caché de REUTILIZACIÓN acotada por
// cuenta. Nada de este hito cambia su clave de unicidad, su TTL, su alcance ni su
// política de reuso — cambiar la unicidad de una caché "para que la privacidad
// funcione" habría sido resolver un problema de privacidad rompiendo un contrato de
// gasto.
//
// `provider_suppressions` (migración 120) es la privacidad: clave nativa del proveedor,
// SIN cuenta.
//
// La consecuencia práctica es la que abre el producto de pre-aprobación:
//
//   sin cuenta  ⇒ no se reutiliza caché (igual que hoy)
//               ⇒ pero la privacidad SÍ se evalúa
//
// "No hay cuenta" deja de ser un fallo de privacidad y vuelve a ser lo que siempre fue:
// la ausencia de un ámbito de reutilización.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readPhoneCacheSuppression } from './phone-cache-store';
import {
  PHONE_CACHE_PROVIDER,
  type PhoneCacheSuppressionState,
} from './phone-cache-core';
import {
  type PhoneRevealSuppressionLookupKey,
  type ProviderSuppressionIdentity,
  type ProviderSuppressionRecord,
  type SuppressionProvider,
} from './provider-suppression-core';

export const PROVIDER_SUPPRESSIONS_TABLE = 'provider_suppressions' as const;
export const PROVIDER_SUPPRESSION_AUDIT_TABLE = 'provider_suppression_audit' as const;

// ── Clave de la lectura COMPUESTA ──────────────────────────────
//
// `PhoneRevealSuppressionLookupKey` y `PhoneRevealSuppressionLookup` viven en
// `provider-suppression-core.ts` (hoja) porque los cuatro gates —incluido el START, que
// está dentro de `phone-reveal-core`— tienen que poder tiparse con ellos sin arrastrar
// este módulo de I/O ni crear un ciclo. Se re-exportan aquí para quien ya importa el
// store.

export type {
  PhoneRevealSuppressionLookup,
  PhoneRevealSuppressionLookupKey,
} from './provider-suppression-core';

// ── Lectura del modelo NUEVO ───────────────────────────────────

/**
 * Lee la supresión nativa de (provider, provider_person_id). NO recibe cuenta y no
 * filtra por ninguna: la tabla no tiene esa columna.
 *
 * LANZA si la lectura falla (tabla ausente, permisos, timeout). El core lo traduce a
 * `check_unavailable` y ningún proveedor se llama: degradarlo a "no suprimido" sería
 * exactamente el fail-open que este subsistema existe para impedir.
 */
export async function readProviderSuppression(
  key: ProviderSuppressionIdentity,
): Promise<ProviderSuppressionRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from(PROVIDER_SUPPRESSIONS_TABLE)
    .select('suppressed_at')
    .eq('provider', key.provider)
    .eq('provider_person_id', key.providerPersonId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    suppressedAt:
      ((data as Record<string, unknown>).suppressed_at as string | null) ?? null,
  };
}

// ── Lectura COMPUESTA (la que se cablea en los cuatro gates) ────

/**
 * Resuelve la supresión combinando los DOS modelos, con la precedencia que la Fase 1
 * exige:
 *
 *   1. modelo NUEVO, nativo del proveedor y sin cuenta. Si suprime, se devuelve ya: un
 *      `clear` del legado no puede sobrescribir un `suppressed` del nuevo;
 *   2. modelo LEGADO, acotado por cuenta, SÓLO cuando su clave es evaluable de verdad
 *      —proveedor Apollo (el único que el CHECK de la 099 admite) y cuenta presente—.
 *      Si suprime, bloquea: un `clear` del nuevo no puede sobrescribir un `suppressed`
 *      del legado mientras el legado siga siendo consultable.
 *
 * Los dos son ADITIVOS y ninguno hace redundante al otro. Que el legado no se pueda
 * consultar (sin cuenta, o candidato de origen Lusha) NO bloquea por sí mismo: ése es
 * precisamente el fail-closed que la Fase 1 sustituye por una evaluación real.
 *
 * LANZA si cualquiera de las dos lecturas falla. Las dos viven en la misma base, así
 * que un fallo casi siempre afecta a ambas; tratar el fallo del legado como "sin
 * tombstone" convertiría una caída en un permiso.
 */
export async function readPhoneRevealSuppression(
  key: PhoneRevealSuppressionLookupKey,
): Promise<ProviderSuppressionRecord | null> {
  const native = await readProviderSuppression({
    provider: key.provider,
    providerPersonId: key.providerPersonId,
  });
  if (native && typeof native.suppressedAt === 'string' && native.suppressedAt.trim()) {
    return native;
  }

  const accountId =
    typeof key.accountId === 'string' && key.accountId.trim().length > 0
      ? key.accountId.trim()
      : null;
  // El legado sólo existe para Apollo: `phone_reveal_cache` tiene
  // `CHECK (provider = 'apollo')`, así que consultarlo con `lusha` no devolvería nunca
  // una fila y sólo gastaría una ida y vuelta.
  if (!accountId || key.provider !== PHONE_CACHE_PROVIDER) return native;

  const legacy: PhoneCacheSuppressionState | null = await readPhoneCacheSuppression({
    provider: PHONE_CACHE_PROVIDER,
    providerPersonId: key.providerPersonId,
    accountId,
  });
  if (legacy && typeof legacy.suppressedAt === 'string' && legacy.suppressedAt.trim()) {
    return { suppressedAt: legacy.suppressedAt };
  }

  return native ?? legacy ?? null;
}

// ── Escritura ──────────────────────────────────────────────────

export interface ProviderSuppressionWriteInput {
  identity: ProviderSuppressionIdentity;
  suppressedAt: string;
  suppressionReason: string;
  suppressedBy: string | null;
}

export type ProviderSuppressionWriteOutcome =
  /** Fila creada por esta llamada. */
  | { kind: 'created' }
  /** Ya existía una supresión para esa identidad; se reafirmó sin degradarla. */
  | { kind: 'already_present' }
  /** La escritura falló. La supresión NO quedó registrada en el modelo nuevo. */
  | { kind: 'failed'; message: string };

/**
 * Registra la supresión nativa. Idempotente por la clave única
 * (provider, provider_person_id) de la migración 120.
 *
 * Un conflicto se resuelve `ignoreDuplicates` a propósito: reafirmar una supresión
 * existente NO debe mover su `suppressed_at` hacia adelante. La fecha en que se ejerció
 * el derecho es la PRIMERA, y reescribirla con la de una segunda DSAR falsificaría el
 * momento del ejercicio. Que ya exista es un éxito, no un error: la persona sigue
 * bloqueada, que es lo que la operación pedía.
 *
 * NUNCA lanza: devuelve un desenlace mecánico para que el llamador pueda declarar una
 * supresión PARCIAL en lugar de un éxito falso.
 */
export async function insertProviderSuppression(
  input: ProviderSuppressionWriteInput,
): Promise<ProviderSuppressionWriteOutcome> {
  const admin = createSupabaseAdminClient();
  try {
    const { data, error } = await admin
      .from(PROVIDER_SUPPRESSIONS_TABLE)
      .upsert(
        {
          provider: input.identity.provider,
          provider_person_id: input.identity.providerPersonId,
          suppressed_at: input.suppressedAt,
          suppression_reason: input.suppressionReason,
          suppressed_by: input.suppressedBy,
        },
        { onConflict: 'provider,provider_person_id', ignoreDuplicates: true },
      )
      .select('id');
    if (error) return { kind: 'failed', message: error.message };
    return (data?.length ?? 0) > 0 ? { kind: 'created' } : { kind: 'already_present' };
  } catch (err) {
    return {
      kind: 'failed',
      message: err instanceof Error ? err.message : 'provider suppression write failed',
    };
  }
}

export interface ProviderSuppressionAuditInput {
  provider: SuppressionProvider;
  providerPersonIdHash: string;
  operation: 'suppression_created' | 'suppression_reaffirmed';
  result: 'applied' | 'already_present' | 'failed';
  reasonCode: string;
  origin: 'dsar_action' | 'legacy_backfill';
  actorUserId: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Escribe la evidencia durable. Se intenta SIEMPRE, incluso cuando la supresión falló,
 * porque la constancia del INTENTO es parte de la garantía: una DSAR que no se pudo
 * completar tiene que ser visible, no invisible.
 *
 * El sujeto viaja SÓLO como hash. Nunca teléfono, email, nombre ni LinkedIn.
 */
export async function insertProviderSuppressionAudit(
  input: ProviderSuppressionAuditInput,
): Promise<{ persisted: boolean }> {
  const admin = createSupabaseAdminClient();
  try {
    const { error } = await admin.from(PROVIDER_SUPPRESSION_AUDIT_TABLE).insert({
      provider: input.provider,
      provider_person_id_hash: input.providerPersonIdHash,
      operation: input.operation,
      result: input.result,
      reason_code: input.reasonCode,
      origin: input.origin,
      actor_user_id: input.actorUserId,
      metadata: input.metadata ?? {},
    });
    return { persisted: !error };
  } catch {
    return { persisted: false };
  }
}

// Agente 2A — Escritura REAL de la colección de teléfonos del candidato
// (AGENT2A-PHONE-REVEAL-4O-C)
//
// Implementación server-only del contrato `PersistCandidatePhoneCollection`
// (candidate-phone-collection-writer.ts) sobre las dos tablas de la migración
// 109. Es el ÚNICO sitio del repositorio que escribe en ellas: el webhook y el
// recovery la inyectan, y ninguno de los dos arma SQL por su cuenta.
//
// ── POR QUÉ NO HAY UNA TRANSACCIÓN ─────────────────────────────
//
// Dicho sin adornos: esta escritura NO es una transacción de base de datos. El
// cliente de Supabase habla PostgREST, que no expone BEGIN/COMMIT, y el
// repositorio no tiene ninguna función SQL reutilizable que cubra este caso — la
// única forma de conseguir atomicidad real sería una función nueva, es decir una
// migración nueva, que este hito no está autorizado a crear.
//
// Lo que se hace en su lugar NO es «la misma secuencia sin transacción y a ver
// qué pasa». Las tres propiedades que sí se garantizan, y que son las que el
// contrato pedía:
//
//   1. ORDEN. La colección se escribe ANTES de que el caller toque el candidato.
//      El estado prohibido —escalar con teléfono y colección vacía— es por tanto
//      inalcanzable: si esta función no termina, el caller aborta y el candidato
//      ni siquiera pasa a terminal.
//   2. IDEMPOTENCIA. Cada paso converge al repetirse: las filas canónicas se
//      insertan o refrescan por (candidate_id, dedupe_key), las procedencias se
//      insertan con ON CONFLICT DO NOTHING sobre (candidate_phone_id,
//      source_event_key), y el principal se recalcula entero.
//   3. CONVERGENCIA. Un fallo a mitad deja un SUBCONJUNTO de la colección y
//      ningún cambio visible: el reveal queda no terminal y el siguiente poll de
//      recuperación —que no cuesta créditos— vuelve a ejecutar exactamente esta
//      misma escritura y la completa.
//
// El estado intermedio observable en el peor caso es «faltan filas por escribir»,
// nunca «el candidato dice que tiene teléfono y la colección no lo tiene».
//
// ── PRIVILEGIOS ────────────────────────────────────────────────
// La migración concede SELECT/INSERT/UPDATE en la tabla canónica (sin DELETE) y
// SELECT/INSERT en la de procedencias (append-and-read). Este módulo se mantiene
// dentro de ese sobre: no borra filas y no reescribe procedencias.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
// No imprime nada. Los errores se propagan con el mensaje de PostgREST, que
// describe la operación, no el dato; ningún mensaje se construye aquí con un
// número, un display ni una `dedupe_key`.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  aggregateCandidatePhoneStatus,
  aggregateCandidatePhoneType,
  type CandidatePhoneStatus,
} from './phone-collection-core';
import type {
  CandidatePhoneCollectionWriteRequest,
  CandidatePhoneCollectionWriteResult,
} from './candidate-phone-collection-writer';
import type { PhoneType } from '@/server/agents/contact-enrichment-toolkit/phone-classification';

export const CANDIDATE_PHONES_TABLE = 'contact_enrichment_candidate_phones';
export const CANDIDATE_PHONE_SOURCES_TABLE =
  'contact_enrichment_candidate_phone_sources';

/** Proyección mínima de una fila ya existente. Se pide `dedupe_key`, no el número. */
interface ExistingPhoneRow {
  id: string;
  dedupe_key: string;
  phone_type: string | null;
  phone_status: string | null;
  is_primary: boolean;
  suppressed_at: string | null;
}

function asPhoneType(value: string | null): PhoneType | null {
  return (value as PhoneType | null) ?? null;
}

function asPhoneStatus(value: string | null): CandidatePhoneStatus {
  return (value as CandidatePhoneStatus | null) ?? 'unknown';
}

/**
 * Persiste la colección observada y devuelve qué quedó realmente escrito.
 *
 * FUSIÓN, no reemplazo: lo que ya estaba se conserva y se refresca. Un callback
 * que trae dos números no borra un tercero visto antes; el modelo acumula
 * evidencia, y sustituir la colección haría exactamente la pérdida que este hito
 * corrige, solo que un evento más tarde.
 */
export async function persistCandidatePhoneCollection(
  request: CandidatePhoneCollectionWriteRequest,
): Promise<CandidatePhoneCollectionWriteResult> {
  const admin = createSupabaseAdminClient();

  const empty: CandidatePhoneCollectionWriteResult = {
    inserted_phone_count: 0,
    updated_phone_count: 0,
    inserted_source_count: 0,
    suppressed_skipped_count: 0,
    primary_dedupe_key: null,
  };
  if (request.phones.length === 0) return empty;

  // ── 1. Estado actual del candidato ───────────────────────────
  const { data: existingRaw, error: readError } = await admin
    .from(CANDIDATE_PHONES_TABLE)
    .select('id, dedupe_key, phone_type, phone_status, is_primary, suppressed_at')
    .eq('candidate_id', request.candidateId);
  if (readError) throw new Error(readError.message);

  const existing = new Map<string, ExistingPhoneRow>();
  for (const row of (existingRaw ?? []) as ExistingPhoneRow[]) {
    existing.set(row.dedupe_key, row);
  }

  // ── 2. Reparto: nuevas / a refrescar / suprimidas ────────────
  // Una fila con `suppressed_at` se salta ENTERA: no se reescribe el número, no
  // se anota la procedencia y no se considera para principal. Anotar la
  // procedencia sería registrar que se volvió a ver a una persona que pidió
  // dejar de ser vista, y reescribir el número violaría además el CHECK del
  // tombstone.
  const toInsert: typeof request.phones[number][] = [];
  const toUpdate: Array<{
    row: ExistingPhoneRow;
    phone: typeof request.phones[number];
  }> = [];
  let suppressedSkipped = 0;

  for (const phone of request.phones) {
    const row = existing.get(phone.dedupeKey);
    if (!row) {
      toInsert.push(phone);
      continue;
    }
    if (row.suppressed_at !== null) {
      suppressedSkipped += 1;
      continue;
    }
    toUpdate.push({ row, phone });
  }

  // ── 3. Filas canónicas nuevas ────────────────────────────────
  // `is_primary` se deja en false aquí y se resuelve en el paso 6: promover
  // durante el INSERT chocaría con el índice parcial de un principal por
  // candidato mientras el anterior sigue en pie.
  const insertedIds = new Map<string, string>();
  if (toInsert.length > 0) {
    const { data, error } = await admin
      .from(CANDIDATE_PHONES_TABLE)
      .insert(
        toInsert.map((phone) => ({
          candidate_id: request.candidateId,
          normalized_phone: phone.normalizedPhone,
          display_phone: phone.displayPhone,
          dedupe_key: phone.dedupeKey,
          phone_type: phone.phoneType,
          phone_status: phone.phoneStatus,
          is_primary: false,
          first_seen_at: phone.firstSeenAt,
          last_seen_at: phone.lastSeenAt,
        })),
      )
      .select('id, dedupe_key');
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ id: string; dedupe_key: string }>) {
      insertedIds.set(row.dedupe_key, row.id);
    }
  }

  // ── 4. Filas canónicas ya conocidas: se refrescan, no se pisan ──
  // El estado y el tipo se AGREGAN con las mismas reglas puras de 4O-B: un
  // proveedor que ahora no logra verificar un número no degrada un `valid`
  // anterior, y un tipo mejor sí mejora la fila. `first_seen_at` no se toca: es
  // la primera vez que se vio, y una observación posterior no la cambia.
  for (const { row, phone } of toUpdate) {
    const mergedStatus = aggregateCandidatePhoneStatus([
      asPhoneStatus(row.phone_status),
      phone.phoneStatus,
    ]);
    const existingType = asPhoneType(row.phone_type);
    const mergedType = aggregateCandidatePhoneType(
      existingType ? [existingType, phone.phoneType ?? 'unknown'] : [phone.phoneType ?? 'unknown'],
    );
    const { error } = await admin
      .from(CANDIDATE_PHONES_TABLE)
      .update({
        phone_status: mergedStatus,
        phone_type: mergedType,
        last_seen_at: request.observedAt,
      })
      .eq('id', row.id);
    if (error) throw new Error(error.message);
  }

  // ── 5. Procedencias (append-only, idempotentes) ──────────────
  const idByKey = new Map<string, string>();
  for (const [key, id] of insertedIds) idByKey.set(key, id);
  for (const { row, phone } of toUpdate) idByKey.set(phone.dedupeKey, row.id);

  const sourceRows = request.phones.flatMap((phone) => {
    const candidatePhoneId = idByKey.get(phone.dedupeKey);
    if (!candidatePhoneId) return [];
    return phone.sources.map((source) => ({
      candidate_phone_id: candidatePhoneId,
      provider: source.provider,
      acquisition_mode: source.acquisitionMode,
      raw_provider_type: source.rawProviderType,
      raw_provider_status: source.rawProviderStatus,
      waterfall_run_id: source.waterfallRunId,
      reservation_id: source.reservationId,
      provider_usage_log_id: source.providerUsageLogId,
      source_event_key: source.sourceEventKey,
      observed_at: source.observedAt,
    }));
  });

  let insertedSourceCount = 0;
  if (sourceRows.length > 0) {
    // `ignoreDuplicates` ⇒ ON CONFLICT DO NOTHING: reprocesar el mismo webhook no
    // añade una segunda procedencia, y no hace falta UPDATE (que la tabla, siendo
    // append-and-read, tampoco tiene concedido).
    const { data, error } = await admin
      .from(CANDIDATE_PHONE_SOURCES_TABLE)
      .upsert(sourceRows, {
        onConflict: 'candidate_phone_id,source_event_key',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) throw new Error(error.message);
    insertedSourceCount = (data ?? []).length;
  }

  // ── 6. Principal: la primera preferencia que no esté suprimida ──
  // El writer NO rankea: recorre la lista que le dio la lógica pura y descarta
  // las que la base dice que están suprimidas. Un tombstone nunca vuelve a ser
  // principal, aunque el ranking lo prefiriera.
  let primaryDedupeKey: string | null = null;
  for (const key of request.primaryPreference) {
    const row = existing.get(key);
    if (row?.suppressed_at) continue;
    if (!idByKey.has(key)) continue;
    primaryDedupeKey = key;
    break;
  }

  const currentPrimary = [...existing.values()].find((row) => row.is_primary) ?? null;

  if (primaryDedupeKey && currentPrimary?.dedupe_key !== primaryDedupeKey) {
    // Degradar SIEMPRE antes de promover: el índice parcial único no admite dos
    // principales ni por un instante.
    if (currentPrimary) {
      const { error } = await admin
        .from(CANDIDATE_PHONES_TABLE)
        .update({ is_primary: false })
        .eq('id', currentPrimary.id);
      if (error) throw new Error(error.message);
    }
    const { error } = await admin
      .from(CANDIDATE_PHONES_TABLE)
      .update({ is_primary: true })
      .eq('id', idByKey.get(primaryDedupeKey)!);
    if (error) throw new Error(error.message);
  } else if (!primaryDedupeKey && currentPrimary) {
    // No hay preferencia viable en ESTE evento. El principal que ya existía se
    // respeta: no había nada mejor y quitarlo dejaría al candidato sin principal
    // sin que nadie lo hubiera pedido.
    primaryDedupeKey = currentPrimary.dedupe_key;
  }

  return {
    inserted_phone_count: insertedIds.size,
    updated_phone_count: toUpdate.length,
    inserted_source_count: insertedSourceCount,
    suppressed_skipped_count: suppressedSkipped,
    primary_dedupe_key: primaryDedupeKey,
  };
}

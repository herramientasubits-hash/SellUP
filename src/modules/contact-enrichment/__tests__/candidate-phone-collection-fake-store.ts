/**
 * Agente 2A — Doble en memoria de la colección de teléfonos del candidato
 * (AGENT2A-PHONE-REVEAL-4O-C)
 *
 * NO es un test: es el almacén que comparten las suites de webhook, recovery y
 * cross-path. Reproduce las reglas de `candidate-phone-collection-persistence.ts`
 * —saltar tombstones, insertar/refrescar por `dedupe_key`, procedencias
 * append-only con clave única, y promover la primera preferencia no suprimida—
 * sin tocar Supabase.
 *
 * Que sea UN solo doble compartido es deliberado: probar la idempotencia entre
 * webhook y recovery con dos almacenes distintos no probaría nada, porque el
 * escenario real es que ambos caminos escriben en la MISMA tabla.
 *
 * Solo se usan números sintéticos 555 en las suites que lo consumen.
 */

import {
  aggregateCandidatePhoneStatus,
  aggregateCandidatePhoneType,
  type CandidatePhoneStatus,
} from '../phone-collection-core';
import type {
  CandidatePhoneCollectionWriteRequest,
  CandidatePhoneCollectionWriteResult,
} from '../candidate-phone-collection-writer';
import type { PhoneType } from '@/server/agents/contact-enrichment-toolkit/phone-classification';

export interface FakeCandidatePhoneRow {
  id: string;
  candidateId: string;
  dedupeKey: string;
  normalizedPhone: string | null;
  displayPhone: string | null;
  phoneType: PhoneType | null;
  phoneStatus: CandidatePhoneStatus;
  isPrimary: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  suppressedAt: string | null;
}

export interface FakeCandidatePhoneSourceRow {
  candidatePhoneId: string;
  provider: string;
  acquisitionMode: string;
  rawProviderType: string | null;
  rawProviderStatus: string | null;
  waterfallRunId: string | null;
  reservationId: string | null;
  providerUsageLogId: string | null;
  sourceEventKey: string;
  observedAt: string;
}

export class FakeCandidatePhoneStore {
  readonly phones: FakeCandidatePhoneRow[] = [];
  readonly sources: FakeCandidatePhoneSourceRow[] = [];
  /** Peticiones recibidas, para poder afirmar «el writer NO fue llamado». */
  readonly writes: CandidatePhoneCollectionWriteRequest[] = [];
  /** Cuando es true la siguiente escritura LANZA, como una base caída. */
  failNextWrite = false;

  private nextId = 1;

  /** Marca un número como suprimido (tombstone), tal como haría una DSAR. */
  suppress(candidateId: string, dedupeKey: string, at: string): void {
    const row = this.rowFor(candidateId, dedupeKey);
    if (!row) throw new Error('no such phone row');
    row.suppressedAt = at;
    row.normalizedPhone = null;
    row.displayPhone = null;
    row.phoneType = null;
    row.isPrimary = false;
  }

  rowFor(candidateId: string, dedupeKey: string): FakeCandidatePhoneRow | null {
    return (
      this.phones.find(
        (row) => row.candidateId === candidateId && row.dedupeKey === dedupeKey,
      ) ?? null
    );
  }

  livePhones(candidateId: string): FakeCandidatePhoneRow[] {
    return this.phones.filter(
      (row) => row.candidateId === candidateId && row.suppressedAt === null,
    );
  }

  primaryOf(candidateId: string): FakeCandidatePhoneRow | null {
    return (
      this.phones.find((row) => row.candidateId === candidateId && row.isPrimary) ?? null
    );
  }

  sourcesFor(candidateId: string): FakeCandidatePhoneSourceRow[] {
    const ids = new Set(
      this.phones.filter((row) => row.candidateId === candidateId).map((row) => row.id),
    );
    return this.sources.filter((source) => ids.has(source.candidatePhoneId));
  }

  /** La dep inyectable, con la firma exacta de `PersistCandidatePhoneCollection`. */
  readonly persist = async (
    request: CandidatePhoneCollectionWriteRequest,
  ): Promise<CandidatePhoneCollectionWriteResult> => {
    this.writes.push(request);
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('collection write failed');
    }

    let inserted = 0;
    let updated = 0;
    let insertedSources = 0;
    let suppressedSkipped = 0;
    const idByKey = new Map<string, string>();

    for (const phone of request.phones) {
      const existing = this.rowFor(request.candidateId, phone.dedupeKey);
      if (existing?.suppressedAt) {
        suppressedSkipped += 1;
        continue;
      }
      if (!existing) {
        const row: FakeCandidatePhoneRow = {
          id: `phone-${this.nextId++}`,
          candidateId: request.candidateId,
          dedupeKey: phone.dedupeKey,
          normalizedPhone: phone.normalizedPhone,
          displayPhone: phone.displayPhone,
          phoneType: phone.phoneType,
          phoneStatus: phone.phoneStatus,
          isPrimary: false,
          firstSeenAt: phone.firstSeenAt,
          lastSeenAt: phone.lastSeenAt,
          suppressedAt: null,
        };
        this.phones.push(row);
        idByKey.set(phone.dedupeKey, row.id);
        inserted += 1;
      } else {
        existing.phoneStatus = aggregateCandidatePhoneStatus([
          existing.phoneStatus,
          phone.phoneStatus,
        ]);
        existing.phoneType = aggregateCandidatePhoneType(
          existing.phoneType
            ? [existing.phoneType, phone.phoneType ?? 'unknown']
            : [phone.phoneType ?? 'unknown'],
        );
        existing.lastSeenAt = request.observedAt;
        idByKey.set(phone.dedupeKey, existing.id);
        updated += 1;
      }

      const candidatePhoneId = idByKey.get(phone.dedupeKey)!;
      for (const source of phone.sources) {
        const duplicate = this.sources.some(
          (row) =>
            row.candidatePhoneId === candidatePhoneId &&
            row.sourceEventKey === source.sourceEventKey,
        );
        if (duplicate) continue;
        this.sources.push({
          candidatePhoneId,
          provider: source.provider,
          acquisitionMode: source.acquisitionMode,
          rawProviderType: source.rawProviderType,
          rawProviderStatus: source.rawProviderStatus,
          waterfallRunId: source.waterfallRunId,
          reservationId: source.reservationId,
          providerUsageLogId: source.providerUsageLogId,
          sourceEventKey: source.sourceEventKey,
          observedAt: source.observedAt,
        });
        insertedSources += 1;
      }
    }

    let primaryDedupeKey: string | null = null;
    for (const key of request.primaryPreference) {
      const row = this.rowFor(request.candidateId, key);
      if (row?.suppressedAt) continue;
      if (!idByKey.has(key)) continue;
      primaryDedupeKey = key;
      break;
    }

    const currentPrimary = this.primaryOf(request.candidateId);
    if (primaryDedupeKey && currentPrimary?.dedupeKey !== primaryDedupeKey) {
      if (currentPrimary) currentPrimary.isPrimary = false;
      this.rowFor(request.candidateId, primaryDedupeKey)!.isPrimary = true;
    } else if (!primaryDedupeKey && currentPrimary) {
      primaryDedupeKey = currentPrimary.dedupeKey;
    }

    return {
      inserted_phone_count: inserted,
      updated_phone_count: updated,
      inserted_source_count: insertedSources,
      suppressed_skipped_count: suppressedSkipped,
      primary_dedupe_key: primaryDedupeKey,
    };
  };
}

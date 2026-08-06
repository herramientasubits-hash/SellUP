/**
 * Agente 2A — Doble en memoria de la colección de teléfonos del candidato
 * (AGENT2A-PHONE-REVEAL-4O-C · ámbito transaccional en 4O-C-R1)
 *
 * NO es un test: es el almacén que comparten las suites de webhook, recovery y
 * cross-path. Reproduce la SEMÁNTICA DE REFERENCIA de la función
 * `persist_candidate_apollo_phone_reveal_result` (migración 110) —saltar
 * tombstones, insertar/refrescar por `dedupe_key`, procedencias append-only con
 * clave única, promover la primera candidata elegible, y aplicar el estado
 * terminal del candidato— sin tocar Supabase.
 *
 * ⚠️ LO QUE ESTE DOBLE NO PUEDE DEMOSTRAR. Es un simulador en TypeScript: no tiene
 * transacciones, así que la ATOMICIDAD no se prueba aquí. Se prueba contra un
 * PostgreSQL real en `candidate-phone-reveal-persistence-postgres-4o-c-r1.test.ts`.
 * Este doble fija el CONTRATO (qué se escribe y qué se devuelve); esa otra suite
 * fija la GARANTÍA (que o se escribe todo o no se escribe nada).
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

/**
 * Estado del candidato que la MISMA transacción escribe (4O-C-R1). Existe en el
 * doble porque desde este hito el estado terminal no es un write aparte del
 * caller: es parte de lo que la función persiste, y un doble que no lo modelara
 * no podría afirmar «no quedó terminalizado».
 */
export interface FakeCandidateTerminalRow {
  phone: string | null;
  phoneMetadata: { number: string; type: string; source: string; raw_type: string | null } | null;
  phoneRevealStatus: string | null;
  phoneRevealRequestId: string | null;
  phoneRevealProvider: string | null;
  phoneRevealedAt: string | null;
  phoneRevealCompletedAt: string | null;
  phoneRevealWebhookReceivedAt: string | null;
  phoneRevealLastCheckedAt: string | null;
  phoneRevealCostCredits: number | null;
  phoneRevealCostSource: string | null;
  phoneRevealErrorCode: string | null;
  phoneProcessingBasis: string | null;
  apolloPersonId: string | null;
}

/** Los mismos estados terminales que `TERMINAL_STATUSES` del webhook core. */
const TERMINAL_STATUSES: readonly string[] = ['revealed', 'no_phone_found', 'error'];

function blankCandidate(requestId: string | null): FakeCandidateTerminalRow {
  return {
    phone: null,
    phoneMetadata: null,
    // En vuelo: es el estado en el que un reveal está cuando llega su resultado.
    phoneRevealStatus: 'pending',
    phoneRevealRequestId: requestId,
    phoneRevealProvider: null,
    phoneRevealedAt: null,
    phoneRevealCompletedAt: null,
    phoneRevealWebhookReceivedAt: null,
    phoneRevealLastCheckedAt: null,
    phoneRevealCostCredits: null,
    phoneRevealCostSource: null,
    phoneRevealErrorCode: null,
    phoneProcessingBasis: null,
    apolloPersonId: null,
  };
}

export class FakeCandidatePhoneStore {
  readonly phones: FakeCandidatePhoneRow[] = [];
  readonly sources: FakeCandidatePhoneSourceRow[] = [];
  /** Estado terminal por candidato, escrito por la misma «transacción». */
  readonly candidates = new Map<string, FakeCandidateTerminalRow>();
  /** Peticiones recibidas, para poder afirmar «el writer NO fue llamado». */
  readonly writes: CandidatePhoneCollectionWriteRequest[] = [];
  /**
   * Cuántas veces se escribió el ESTADO TERMINAL del candidato. Un reveal debe
   * escribirlo exactamente una vez: si esto llegara a 2, la transacción y el parche
   * secuencial estarían pisándose, que es lo que 4O-C-R1 elimina.
   */
  terminalWrites = 0;
  /** Cuando es true la siguiente escritura LANZA, como una base caída. */
  failNextWrite = false;

  private nextId = 1;

  /**
   * Fija el estado de partida de un candidato. Sin registrarlo, el doble asume el
   * caso normal —en vuelo y apuntando al request id que trae la petición—, que es
   * el que la inmensa mayoría de las suites necesitan.
   */
  registerCandidate(
    candidateId: string,
    overrides: Partial<FakeCandidateTerminalRow> = {},
  ): FakeCandidateTerminalRow {
    const row = { ...blankCandidate(null), ...overrides };
    this.candidates.set(candidateId, row);
    return row;
  }

  candidateOf(candidateId: string): FakeCandidateTerminalRow | null {
    return this.candidates.get(candidateId) ?? null;
  }

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

    const { terminal } = request;
    const nothingWritten = (
      status: CandidatePhoneCollectionWriteResult['status'],
      suppressedSkipped = 0,
    ): CandidatePhoneCollectionWriteResult => ({
      status,
      inserted_phone_count: 0,
      updated_phone_count: 0,
      inserted_source_count: 0,
      suppressed_skipped_count: suppressedSkipped,
      primary_dedupe_key: null,
      primary_persisted: this.primaryOf(request.candidateId) !== null,
      candidate_terminalized: false,
    });

    // ── Guarda de evento, bajo el «bloqueo» ─────────────────────
    const candidate =
      this.candidates.get(request.candidateId) ??
      this.registerCandidate(request.candidateId, {
        phoneRevealRequestId: terminal.expectedRequestId,
      });

    if (candidate.phoneRevealStatus && TERMINAL_STATUSES.includes(candidate.phoneRevealStatus)) {
      if (
        terminal.expectedRequestId !== null &&
        candidate.phoneRevealStatus === 'revealed' &&
        candidate.phoneRevealRequestId === terminal.expectedRequestId
      ) {
        // El MISMO evento ya cerró: el estado deseado ya está puesto.
        return {
          ...nothingWritten('idempotent'),
          candidate_terminalized: true,
        };
      }
      return nothingWritten('stale_event');
    }
    if (
      terminal.expectedRequestId !== null &&
      candidate.phoneRevealRequestId !== terminal.expectedRequestId
    ) {
      return nothingWritten('stale_event');
    }

    // ── Tombstones, antes de escribir nada ──────────────────────
    const suppressedIncoming = request.phones.filter(
      (phone) => this.rowFor(request.candidateId, phone.dedupeKey)?.suppressedAt,
    ).length;
    if (request.phones.length > 0 && suppressedIncoming === request.phones.length) {
      // Todos los números son tombstones: el escalar caería al heredado, que es uno
      // de ellos. Fail-closed y sin terminalizar.
      return nothingWritten('suppressed', suppressedIncoming);
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

    // ── Principal: la primera candidata ELEGIBLE ────────────────
    // Las tres condiciones son las del CHECK `..._primary_requires_live_number` de
    // la migración 109, igual que en la función SQL: viva, con número y no inválida.
    let primaryDedupeKey: string | null = null;
    let primaryScalar: string | null = null;
    let primaryType: string | null = null;
    let primaryRawType: string | null = null;
    for (const candidateKey of request.primaryCandidates) {
      const row = this.rowFor(request.candidateId, candidateKey.dedupeKey);
      if (!row) continue;
      if (row.suppressedAt) continue;
      if (row.normalizedPhone === null) continue;
      if (row.phoneStatus === 'invalid') continue;
      primaryDedupeKey = candidateKey.dedupeKey;
      // El escalar sale de LA MISMA entrada que la clave elegida.
      primaryScalar = candidateKey.phone;
      primaryType = candidateKey.phoneType;
      primaryRawType = candidateKey.rawType;
      break;
    }

    const currentPrimary = this.primaryOf(request.candidateId);
    if (primaryDedupeKey) {
      if (currentPrimary && currentPrimary.dedupeKey !== primaryDedupeKey) {
        currentPrimary.isPrimary = false;
      }
      this.rowFor(request.candidateId, primaryDedupeKey)!.isPrimary = true;
    } else {
      // Ninguna candidata de ESTE evento califica: el principal que ya estaba se
      // respeta y el escalar cae al heredado, byte a byte como antes de 4O-C.
      if (currentPrimary) primaryDedupeKey = currentPrimary.dedupeKey;
      primaryScalar = terminal.legacyPhone;
      primaryType = terminal.legacyPhoneType;
      primaryRawType = terminal.legacyRawType;
    }

    // ── Estado terminal del candidato, misma «transacción» ──────
    this.terminalWrites += 1;
    candidate.phone = primaryScalar;
    candidate.phoneMetadata = {
      number: primaryScalar!,
      type: primaryType!,
      source: 'apollo_reveal',
      raw_type: primaryRawType,
    };
    candidate.phoneRevealStatus = 'revealed';
    candidate.phoneRevealProvider = 'apollo';
    candidate.phoneRevealedAt = terminal.revealedAt;
    candidate.phoneRevealCompletedAt = terminal.completedAt;
    // null ⇒ la columna no se toca: es lo que distingue la fase que sí la escribe.
    if (terminal.webhookReceivedAt !== null) {
      candidate.phoneRevealWebhookReceivedAt = terminal.webhookReceivedAt;
    }
    if (terminal.lastCheckedAt !== null) {
      candidate.phoneRevealLastCheckedAt = terminal.lastCheckedAt;
    }
    candidate.phoneRevealCostCredits = terminal.costCredits;
    candidate.phoneRevealCostSource = terminal.costSource;
    candidate.phoneRevealErrorCode = null;
    if (terminal.processingBasis !== null) {
      candidate.phoneProcessingBasis = terminal.processingBasis;
    }
    if (terminal.apolloPersonId) {
      candidate.apolloPersonId = terminal.apolloPersonId;
    }

    return {
      status: 'persisted',
      inserted_phone_count: inserted,
      updated_phone_count: updated,
      inserted_source_count: insertedSources,
      suppressed_skipped_count: suppressedSkipped,
      primary_dedupe_key: primaryDedupeKey,
      primary_persisted: this.primaryOf(request.candidateId) !== null,
      candidate_terminalized: true,
    };
  };
}

// ═══════════════════════════════════════════════════════════════════
// Estado terminal observado, independiente del mecanismo
// ═══════════════════════════════════════════════════════════════════

/**
 * Lo que el candidato acabó teniendo, leído de donde se haya escrito.
 *
 * POR QUÉ ESTE INDIRECTO. Desde 4O-C-R1 el estado terminal lo escribe la MISMA
 * transacción que la colección (migración 110), no un `deps.persist` posterior.
 * Las suites siguen afirmando sobre el RESULTADO —qué número quedó visible, con
 * qué tipo, con qué costo— porque eso es el contrato; cuál de los dos mecanismos lo
 * escribió es un detalle de cableado, y una aserción atada al mecanismo se rompería
 * cada vez que el cableado cambia sin que el comportamiento lo haga.
 *
 * `writes` suma los dos caminos a propósito: si alguna vez valiera 2, significaría
 * que la transacción y el parche secuencial se están pisando.
 */
export interface ObservedCandidateTerminalState {
  phone: string | null | undefined;
  phoneType: string | null | undefined;
  rawType: string | null | undefined;
  status: string | null | undefined;
  revealedAt: string | null | undefined;
  completedAt: string | null | undefined;
  webhookReceivedAt: string | null | undefined;
  lastCheckedAt: string | null | undefined;
  costCredits: number | null | undefined;
  costSource: string | null | undefined;
  processingBasis: string | null | undefined;
  apolloPersonId: string | null | undefined;
  writes: number;
}

/**
 * Vista de SOLO LECTURA del parche secuencial, con las claves que las dos fases
 * comparten. No es `Record<string, unknown>` a propósito: los dos tipos de parche
 * son interfaces sin índice, así que un record no las aceptaría, y aflojar la firma
 * con un `as any` escondería justo los cambios de nombre que esto debe detectar.
 */
interface LoosePatch {
  phone?: string | null;
  enrichment_metadata?: {
    phone?: { type?: unknown; raw_type?: unknown } | null;
  } | null;
  phone_reveal_status?: string;
  phone_revealed_at?: string | null;
  phone_reveal_completed_at?: string | null;
  phone_reveal_webhook_received_at?: string | null;
  phone_reveal_last_checked_at?: string | null;
  phone_reveal_cost_credits?: number | null;
  phone_reveal_cost_source?: string;
  phone_processing_basis?: string;
  apollo_person_id?: string | null;
}

export function observedTerminalState(args: {
  store: FakeCandidatePhoneStore;
  candidateId: string;
  patches: ReadonlyArray<LoosePatch>;
}): ObservedCandidateTerminalState {
  const writes = args.store.terminalWrites + args.patches.length;
  const row = args.store.candidateOf(args.candidateId);
  if (row && args.store.terminalWrites > 0) {
    return {
      phone: row.phone,
      phoneType: row.phoneMetadata?.type,
      rawType: row.phoneMetadata?.raw_type,
      status: row.phoneRevealStatus,
      revealedAt: row.phoneRevealedAt,
      completedAt: row.phoneRevealCompletedAt,
      webhookReceivedAt: row.phoneRevealWebhookReceivedAt,
      lastCheckedAt: row.phoneRevealLastCheckedAt,
      costCredits: row.phoneRevealCostCredits,
      costSource: row.phoneRevealCostSource,
      processingBasis: row.phoneProcessingBasis,
      apolloPersonId: row.apolloPersonId,
      writes,
    };
  }
  const patch = args.patches[0];
  return {
    phone: patch?.phone,
    phoneType: patch?.enrichment_metadata?.phone?.type as string | undefined,
    rawType: patch?.enrichment_metadata?.phone?.raw_type as string | null | undefined,
    status: patch?.phone_reveal_status,
    revealedAt: patch?.phone_revealed_at,
    completedAt: patch?.phone_reveal_completed_at,
    webhookReceivedAt: patch?.phone_reveal_webhook_received_at,
    lastCheckedAt: patch?.phone_reveal_last_checked_at,
    costCredits: patch?.phone_reveal_cost_credits,
    costSource: patch?.phone_reveal_cost_source,
    processingBasis: patch?.phone_processing_basis,
    apolloPersonId: patch?.apollo_person_id,
    writes,
  };
}

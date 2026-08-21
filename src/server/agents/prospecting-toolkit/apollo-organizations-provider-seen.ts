/**
 * apollo-organizations-provider-seen.ts — la memoria provider-seen de Apollo, en
 * el ÚNICO sitio por el que pasan sus dos modalidades de company discovery.
 *
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-1 · P0-2.
 *
 * ── El orden, dicho una sola vez (y es el mismo que Lusha ya cumple) ─────────
 *
 *   respuesta VÁLIDA y normalizada
 *     → se recuerda TODA identidad que el proveedor devolvió
 *       → recién entonces corren el dedupe entre páginas y el tope de candidatos
 *
 * Registrar después del recorte heredaría sus criterios y volvería a olvidar
 * justo lo que hay que recordar: lo truncado, lo repetido y lo descartado. Todo
 * eso YA se pagó. Ver `provider-seen-recording` para la formulación canónica.
 *
 * ── 🔴 Qué identidad se guarda, exactamente ──────────────────────────────────
 *
 *   provider              = `apollo`
 *   providerEntityId      = `providerReference.providerOrganizationId`
 *   normalizedDomain      = `primaryDomain`, y SÓLO el primario
 *
 * 🔴 `normalizedDomains` (primario + alias) NO se expande aquí. La tabla de la
 * M123 modela UNA señal de dominio por fila, así que repartir los alias en filas
 * hermanas sería una decisión de esquema y de política —qué alias cuenta como la
 * misma empresa— que este hito no tiene autorización para tomar. Se guarda el
 * primario, que es la señal que el planificador de exclusión ya usa.
 *
 * 🔴 Tampoco se inventa una semántica combinada id+dominio: la clave la calcula
 * `providerSeenObservationKey`, que es la misma que usa la ruta Lusha.
 *
 * 🔴 El país NO se guarda: `ProviderSeenObservation` no tiene ese campo y añadirlo
 * sería tocar el contrato del store, que este hito deja intacto.
 *
 * ── 🔴 Fail-soft, y NUNCA en silencio ────────────────────────────────────────
 *
 * La página ya está comprada y sus empresas ya están en la mano cuando esto
 * corre. Un fallo de memoria no puede tirar la búsqueda —eso convertiría una
 * optimización económica en una forma nueva de perder lo que se acaba de
 * comprar—, pero sí queda contado y con su último motivo preservado.
 */

import {
  planProviderSeenRecording,
  type ProviderSeenRecordingBlockReason,
} from '@/modules/prospect-batches/provider-seen/provider-seen-recording';
import {
  providerSeenObservationKey,
  type ProviderSeenCandidateInput,
  type ProviderSeenObservation,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import type {
  ProviderSeenWriteInput,
  ProviderSeenWriteResult,
} from '@/server/prospect-batches/provider-seen/provider-seen-store';
import type { NormalizedApolloOrganization } from './apollo-organizations-response-normalizer';

/** Motivo con el que el store declara que no escribió por no haber nada que escribir. */
const NO_OBSERVATIONS_SKIPPED_REASON = 'no_observations';

/** Motivo sintético cuando la escritura LANZÓ. No lo produce ningún store. */
export const APOLLO_PROVIDER_SEEN_RECORD_THREW = 'record_threw' as const;

/** El escritor inyectado. Devuelve el resultado del store; nunca se le exige no lanzar. */
export type ApolloProviderSeenRecorder = (
  input: ProviderSeenWriteInput,
) => Promise<ProviderSeenWriteResult>;

/**
 * Convierte una organización normalizada en la identidad mínima recordable.
 *
 * `primaryDomain` y nada más — ver la cabecera.
 */
export function toApolloProviderSeenCandidate(
  organization: NormalizedApolloOrganization,
): ProviderSeenCandidateInput {
  return {
    providerEntityId: organization.providerReference.providerOrganizationId,
    domain: organization.primaryDomain,
  };
}

export function toApolloProviderSeenCandidates(
  organizations: readonly NormalizedApolloOrganization[],
): ProviderSeenCandidateInput[] {
  return organizations.map(toApolloProviderSeenCandidate);
}

/** Lo que la memoria rindió a lo largo de TODA la búsqueda paginada. */
export type ApolloProviderSeenSummary = {
  /** ¿Se presentó al menos una respuesta válida al recorder? */
  attempted: boolean;
  /** Páginas exitosas cuyas identidades se presentaron. */
  pagesPresented: number;
  /** Identidades presentadas, sumando páginas (con repetición entre páginas). */
  identitiesPresented: number;
  /** Identidades ÚNICAS presentadas en toda la búsqueda. */
  uniqueIdentities: number;
  /** Filas sin id NI dominio. No se recuerdan; se cuentan. */
  unidentifiableResults: number;
  /** Filas repetidas DENTRO de una misma página. */
  withinPageDuplicates: number;
  /** Identidades ya presentadas en una página ANTERIOR de esta misma búsqueda. */
  crossPageDuplicateIdentities: number;
  newIdsRecorded: number;
  newDomainsRecorded: number;
  /** Escrituras que no llegaron a la tabla sobre páginas YA pagadas. */
  writeFailures: number;
  /** Motivo de la última escritura no realizada. `null` si no hubo ninguna. */
  lastWriteSkippedReason: string | null;
  /** Motivos por los que una página válida no generó memoria. Nunca inventados. */
  blockedReasons: readonly ProviderSeenRecordingBlockReason[];
};

export const EMPTY_APOLLO_PROVIDER_SEEN_SUMMARY: ApolloProviderSeenSummary = {
  attempted: false,
  pagesPresented: 0,
  identitiesPresented: 0,
  uniqueIdentities: 0,
  unidentifiableResults: 0,
  withinPageDuplicates: 0,
  crossPageDuplicateIdentities: 0,
  newIdsRecorded: 0,
  newDomainsRecorded: 0,
  writeFailures: 0,
  lastWriteSkippedReason: null,
  blockedReasons: [],
};

/**
 * Acumulador de una búsqueda. Vive lo que vive la búsqueda y no se comparte.
 *
 * Es un objeto mutable a propósito, igual que `ApolloPageLedger`: la alternativa
 * —rehacer el resumen entero por página— no compra nada y sí oscurece el punto de
 * registro, que es lo único que este hito tiene que dejar evidente.
 */
export type ApolloProviderSeenLedger = {
  observePage(organizations: readonly NormalizedApolloOrganization[]): {
    observations: readonly ProviderSeenObservation[];
  } | null;
  noteWrite(result: ProviderSeenWriteResult): void;
  noteWriteFailure(reason: string): void;
  summary(): ApolloProviderSeenSummary;
};

export function createApolloProviderSeenLedger(): ApolloProviderSeenLedger {
  const seenKeys = new Set<string>();
  const blockedReasons: ProviderSeenRecordingBlockReason[] = [];

  let attempted = false;
  let pagesPresented = 0;
  let identitiesPresented = 0;
  let unidentifiableResults = 0;
  let withinPageDuplicates = 0;
  let crossPageDuplicateIdentities = 0;
  let newIdsRecorded = 0;
  let newDomainsRecorded = 0;
  let writeFailures = 0;
  let lastWriteSkippedReason: string | null = null;

  return {
    observePage(organizations) {
      attempted = true;

      // 🔴 La validez la fija el llamador comprobando `response.ok`, jamás el
      // tamaño de la lista: una lista vacía es una respuesta legítima sin
      // empresas, y un error no es «cero empresas» sino ninguna información.
      const plan = planProviderSeenRecording({
        provider: 'apollo',
        providerCallMade: true,
        responseValid: true,
        results: toApolloProviderSeenCandidates(organizations),
      });

      if (!plan.record) {
        if (!blockedReasons.includes(plan.reason)) blockedReasons.push(plan.reason);
        return null;
      }

      pagesPresented++;
      identitiesPresented += plan.observations.length;
      unidentifiableResults += plan.unidentifiableCount;
      withinPageDuplicates += plan.duplicateCount;

      for (const observation of plan.observations) {
        const key = providerSeenObservationKey(observation);
        if (seenKeys.has(key)) {
          crossPageDuplicateIdentities++;
          continue;
        }
        seenKeys.add(key);
      }

      return { observations: plan.observations };
    },

    noteWrite(result) {
      newIdsRecorded += result.newIdsRecorded;
      newDomainsRecorded += result.newDomainsRecorded;
      // 🔴 `written === false` con un motivo NO es un no-evento: significa que
      // esta página, ya pagada, no quedó recordada y la próxima corrida la
      // volverá a pagar. «Sin observaciones» no cuenta: es una respuesta válida
      // sin nada identificable, no una escritura perdida.
      if (
        !result.written &&
        result.skippedReason !== null &&
        result.skippedReason !== NO_OBSERVATIONS_SKIPPED_REASON
      ) {
        writeFailures++;
        lastWriteSkippedReason = result.skippedReason;
      }
    },

    noteWriteFailure(reason) {
      writeFailures++;
      lastWriteSkippedReason = reason;
    },

    summary() {
      return {
        attempted,
        pagesPresented,
        identitiesPresented,
        uniqueIdentities: seenKeys.size,
        unidentifiableResults,
        withinPageDuplicates,
        crossPageDuplicateIdentities,
        newIdsRecorded,
        newDomainsRecorded,
        writeFailures,
        lastWriteSkippedReason,
        blockedReasons: [...blockedReasons],
      };
    },
  };
}

/**
 * Presenta las identidades de UNA página ya pagada a la memoria.
 *
 * NUNCA lanza. Sin recorder inyectado se contabiliza la observación igual —el
 * embudo de benchmark sigue siendo veraz— y sencillamente no se escribe.
 */
export async function recordApolloProviderSeenPage(
  ledger: ApolloProviderSeenLedger,
  organizations: readonly NormalizedApolloOrganization[],
  deps: {
    record?: ApolloProviderSeenRecorder | undefined;
    correlationId: string | null;
    observedAt: string;
  },
): Promise<void> {
  const observed = ledger.observePage(organizations);
  if (observed === null) return;
  if (!deps.record) return;

  try {
    const written = await deps.record({
      observations: observed.observations,
      correlationId: deps.correlationId,
      observedAt: deps.observedAt,
    });
    ledger.noteWrite(written);
  } catch {
    // 🔴 Fail-open hacia el producto, pero NO en silencio hacia el operador: la
    // página ya está pagada. Ver la cabecera.
    ledger.noteWriteFailure(APOLLO_PROVIDER_SEEN_RECORD_THREW);
  }
}

/** Clave del bloque en `metadata`. */
export const APOLLO_PROVIDER_SEEN_METADATA_KEY = 'apollo_provider_seen' as const;

/** Bloque plano y sin PII para `provider_usage_logs.metadata`. */
export function toApolloProviderSeenMetadata(
  summary: ApolloProviderSeenSummary,
): Record<string, unknown> {
  return {
    attempted: summary.attempted,
    pages_presented: summary.pagesPresented,
    identities_presented: summary.identitiesPresented,
    unique_identities: summary.uniqueIdentities,
    unidentifiable_results: summary.unidentifiableResults,
    within_page_duplicates: summary.withinPageDuplicates,
    cross_page_duplicate_identities: summary.crossPageDuplicateIdentities,
    new_ids_recorded: summary.newIdsRecorded,
    new_domains_recorded: summary.newDomainsRecorded,
    // Un 0 en los dos contadores de novedad sólo se puede leer como «no había
    // nada nuevo» si este número es 0 también.
    write_failures: summary.writeFailures,
    write_skipped_reason: summary.lastWriteSkippedReason,
    blocked_reasons: [...summary.blockedReasons],
  };
}

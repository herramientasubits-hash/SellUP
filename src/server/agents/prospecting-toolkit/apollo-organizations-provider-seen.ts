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
 *
 * ── AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 8, 9, 11, 12 — la memoria PREVIA ──
 *
 * El corte 1 registraba lo devuelto y no podía cruzarlo contra nada: el embudo
 * publicaba `provider_seen_hit: null` con su costura nombrada. Este corte carga la
 * memoria ANTES de buscar y la pasa aquí como SNAPSHOT inmutable.
 *
 * El orden que eso obliga, y que este módulo sostiene por construcción:
 *
 *   memoria PREVIA (snapshot, cargado antes de la llamada)
 *     -> página devuelta y normalizada
 *       -> aciertos contra el SNAPSHOT           (`observePage`)
 *         -> escritura de la página en la memoria (`recordApolloProviderSeenPage`)
 *
 * 🔴 El snapshot NO se muta nunca. Es lo único que impide que la página 1, ya
 * escrita, se cuente como «conocimiento previo» al procesar la página 2 — que
 * convertiría cualquier búsqueda multipágina en un acierto artificial y haría
 * parecer que Apollo repite empresas que en realidad acabamos de descubrir.
 *
 * 🔴 Los aciertos se cuentan sobre identidades ÚNICAS de la búsqueda, no por
 * página: la misma empresa devuelta en dos páginas es UNA empresa que ya
 * conocíamos, y contarla dos veces haría que `provider_seen_hit` pudiera superar a
 * `unique` — un embudo cuyo segundo escalón es mayor que el primero no describe
 * nada.
 *
 * 🔴 Sin memoria previa disponible el contador es `null`, JAMÁS 0. Ver § 11: un 0
 * dice «se midió y no había aciertos»; aquí el hecho es «no se pudo medir».
 */

import {
  planProviderSeenRecording,
  type ProviderSeenRecordingBlockReason,
} from '@/modules/prospect-batches/provider-seen/provider-seen-recording';
import {
  isProviderSeenKnown,
  providerSeenObservationKey,
  type ProviderSeenCandidateInput,
  type ProviderSeenMemory,
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
  /**
   * CUT-2 §§ 9, 11 — identidades ÚNICAS de esta búsqueda que la memoria PREVIA
   * ya conocía.
   *
   * 🔴 `null` cuando no hubo snapshot que consultar. Nunca 0 por defecto.
   */
  priorSeenHits: number | null;
  /** CUT-2 § 12 — ¿hubo snapshot previo con el que cruzar? */
  priorMemoryAvailable: boolean;
  /** CUT-2 §§ 11, 12 — por qué no lo hubo. `null` cuando sí lo hubo. */
  priorMemoryUnavailableReason: string | null;
};

/**
 * CUT-2 § 11 — el motivo por defecto: nadie inyectó snapshot en esta invocación.
 *
 * Es el estado de la ruta legacy de Apollo (`web-search-tool.ts`), que no atraviesa
 * la capa previa al pago y por tanto no tiene memoria que pasar. Se NOMBRA en vez
 * de dejar un null sin explicación.
 */
export const APOLLO_PRIOR_MEMORY_NOT_PROVIDED = 'prior_provider_seen_memory_not_provided' as const;

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
  priorSeenHits: null,
  priorMemoryAvailable: false,
  priorMemoryUnavailableReason: APOLLO_PRIOR_MEMORY_NOT_PROVIDED,
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

/**
 * CUT-2 §§ 8, 12 — el snapshot previo y, cuando no lo hay, por qué.
 *
 * 🔴 Los dos campos son excluyentes a propósito: un llamador que pase memoria
 * pasa memoria, y uno que no pueda pasarla tiene que decir la razón. No hay una
 * tercera forma en la que «no hay aciertos» se pueda colar sin explicación.
 */
export type ApolloPriorProviderSeen =
  | { available: true; memory: ProviderSeenMemory }
  | { available: false; unavailableReason: string };

export function createApolloProviderSeenLedger(
  prior: ApolloPriorProviderSeen = {
    available: false,
    unavailableReason: APOLLO_PRIOR_MEMORY_NOT_PROVIDED,
  },
): ApolloProviderSeenLedger {
  const seenKeys = new Set<string>();
  const blockedReasons: ProviderSeenRecordingBlockReason[] = [];

  // 🔴 Se captura UNA vez y no se vuelve a tocar. El snapshot es de antes de la
  // llamada: nada de lo que esta búsqueda escriba puede entrar en él.
  const priorMemory = prior.available ? prior.memory : null;
  // 🔴 El contador es un entero normal y la AUSENCIA se decide al publicar, desde
  // `prior.available`. Un `number | null` incrementado con `?? 0` habría dejado en
  // el código el patrón exacto que el hito prohíbe —degradar un null a cero— y una
  // guarda estática no puede distinguir un `?? 0` inocente de uno que miente.
  let priorSeenHits = 0;

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
        // 🔴 CUT-2 § 9 — el acierto se decide con la función CANÓNICA
        // (`isProviderSeenKnown`), la misma que usa la ruta Lusha, y contra el
        // snapshot PREVIO. No hay un segundo emparejador de dominios o de ids
        // aquí: dos definiciones de «la misma empresa» harían incomparables los
        // dos embudos, que es justo lo que este hito existe para evitar.
        //
        // Va dentro del bloque de identidades NUEVAS de la búsqueda: una empresa
        // repetida entre páginas ya se contó, y volver a contarla dejaría
        // `priorSeenHits > uniqueIdentities`.
        if (priorMemory !== null && isProviderSeenKnown(priorMemory, observation)) {
          priorSeenHits++;
        }
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
        // 🔴 Sin snapshot NO hay medición, así que no hay número: `null`. El cero
        // sólo existe cuando alguien pudo mirar y no encontró nada.
        priorSeenHits: prior.available ? priorSeenHits : null,
        priorMemoryAvailable: prior.available,
        priorMemoryUnavailableReason: prior.available ? null : prior.unavailableReason,
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
    // CUT-2 §§ 11, 12 — el cruce contra la memoria PREVIA, y su ausencia dicha con
    // su nombre. `null` no es 0 y este bloque no los mezcla.
    prior_seen_hits: summary.priorSeenHits,
    prior_memory_available: summary.priorMemoryAvailable,
    prior_memory_unavailable_reason: summary.priorMemoryUnavailableReason,
  };
}

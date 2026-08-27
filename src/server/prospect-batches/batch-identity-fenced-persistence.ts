/**
 * AGENT1-CUT3B4 — el bucle de reintento optimista, UNA sola vez para los tres
 * escritores.
 *
 * ── Por qué es compartido ────────────────────────────────────────────────────
 *
 * `candidate-writer`, `structured-source-candidate-writer` y la ruta de Lusha
 * tienen tres formas de escritura distintas (fila a fila con `select().single()`,
 * fila a fila sin selección, y un bloque atómico). Lo que NO puede ser distinto es
 * qué significa `stale`, cuántas veces se reintenta, con qué autoridad se
 * re-evalúa y qué pasa al agotar el tope. Tres implementaciones de eso serían tres
 * políticas de concurrencia, y la tercera divergiría en la primera corrección.
 *
 * ── El algoritmo ─────────────────────────────────────────────────────────────
 *
 *   cargar foto (filas + época)
 *   evaluar con la autoridad de B23  ← `evaluateCandidateIdentity`, nunca otra
 *     duplicado duro ⇒ devolver duplicado (no es error, no consume objetivo)
 *     si no      ⇒ insertar vallado contra la época de ESA foto
 *   insertado ⇒ persistido
 *   stale     ⇒ RE-CARGAR, RE-EVALUAR con la misma autoridad, reintentar
 *   tope agotado ⇒ fallo CERRADO
 *
 * 🔴 La re-evaluación NO es cosmética. Un candidato que era único contra la foto
 * vieja puede haberse vuelto duplicado contra la nueva —ése es exactamente el
 * caso que B4 existe para atrapar— y puede seguir siendo legítimo, por ejemplo
 * cuando el que ganó la carrera trae una identidad fiscal CONTRADICTORIA: TIER 0
 * manda y las dos personas jurídicas conviven. Por eso se re-pregunta al registro
 * en vez de suponer.
 *
 * ── Fallo CERRADO al agotar el tope ──────────────────────────────────────────
 *
 * 🔴 No hay caída a un insert directo. Escribir sin valla tras perder tres
 * carreras es precisamente la fila fantasma que este corte existe para impedir:
 * sería una decisión de admisión tomada contra un estado que ya se sabe caduco.
 * Se devuelve `retry_exhausted`, que el escritor cuenta como ERROR real.
 *
 * ── La ÚNICA excepción, y la decide el esquema ───────────────────────────────
 *
 * `capability_absent` — la migración 126 no está aplicada. Entonces, y sólo
 * entonces, se ejecuta la ruta de escritura ANTERIOR a B4, tal cual estaba. No es
 * un flag, no es una preferencia y nadie puede activarla a mano: la base responde
 * que la función no existe. En cuanto la 126 se aplique, esta rama es inalcanzable
 * y no queda ningún desvío directo.
 *
 * ── 🔴 «Sin época» NO es «sin migración» (CUT-3B4-CORRECCIÓN) ────────────────
 *
 * Este módulo llegó a decidir la ruta legada con `snapshot.epoch === null` a
 * secas, y ése es un fallo ABIERTO: una lectura caída, un lote que no se ve o un
 * cliente no soportado también dejan la época en `null`, así que una AVERÍA real
 * se convertía en una escritura sin valla. La autorización exige las TRES
 * condiciones juntas —`epoch === null`, `fenceCapabilityAbsent === true`,
 * `degraded === false`—, que es lo que `isProvenFenceCapabilityAbsent` comprueba.
 * Todo lo demás devuelve `snapshot_unavailable`: fallo CERRADO, cero escrituras,
 * un error real para el escritor.
 *
 * ── 🔴 La capacidad es MONÓTONA dentro de una tentativa ──────────────────────
 *
 * La prueba de ausencia se toma UNA vez, sobre la foto INICIAL. Si esa foto trajo
 * una época no nula, la valla se OBSERVÓ activa y a partir de ahí no hay vuelta
 * atrás: que la RPC de escritura responda después «la función no existe», o que
 * una recarga degrade a `null`, es una INCONSISTENCIA del despliegue y falla
 * CERRADO. Antes, cualquiera de esas dos cosas caía a la ruta legada — es decir,
 * la valla podía «desaparecer» a mitad de la admisión y abrir la escritura
 * directa que este corte existe para cerrar.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BatchIdentityDecision } from '@/server/agents/prospecting-toolkit/batch-identity-registry';
import {
  insertFencedProspectCandidates,
  MAX_IDENTITY_EPOCH_RETRIES,
  type FencedCandidateInsertResult,
} from './batch-identity-fence';
import {
  loadBatchIdentityRegistry,
  type BatchIdentitySeedOutcome,
} from './batch-identity-registry-store';

/**
 * Lo que el escritor decide, contra UNA foto concreta, sobre UNA unidad de
 * escritura (una fila en las rutas del asistente y de fuente estructurada; el
 * conjunto entero en la ruta de Lusha).
 *
 * Lo produce el llamador porque sólo él sabe construir sus filas — pero la
 * decisión de identidad SIEMPRE sale de `evaluateCandidateIdentity`.
 */
export type FencedAdmissionPlan =
  | {
      kind: 'duplicate';
      /** La decisión que lo retiró. Viaja para que el escritor la reporte. */
      decision: BatchIdentityDecision;
    }
  | {
      kind: 'persist';
      /** Filas listas para `prospect_candidates`. `batch_id` lo fuerza la RPC. */
      rows: ReadonlyArray<Record<string, unknown>>;
      /** Decisiones admitidas, en el mismo orden que `rows`. */
      decisions: ReadonlyArray<BatchIdentityDecision>;
    };

/** Telemetría de concurrencia. Sólo conteos y estados: NUNCA valores. */
export type FencedPersistenceTelemetry = {
  /** Época de la primera foto. `null` = no se pudo establecer. */
  identityEpochInitial: number | null;
  /** Época tras el desenlace. `null` = no se llegó a vallar. */
  identityEpochFinal: number | null;
  /** Cuántas veces la decisión llegó caduca. NO es un error. */
  identityEpochStaleRetries: number;
  /** El tope se agotó y se falló CERRADO. */
  identityEpochRetryExhausted: boolean;
  /** Se descubrió duplicado SÓLO tras re-evaluar. La carrera hizo su trabajo. */
  identityDuplicateAfterStaleRetry: boolean;
  /** La 126 no está aplicada y se conservó la ruta anterior a B4. */
  identityFenceCapabilityAbsent: boolean;
  /**
   * No se pudo establecer una foto vallable y NO había prueba de esquema. Fallo
   * CERRADO: cero escrituras y cero caída a la ruta legada.
   */
  identitySnapshotUnavailable: boolean;
  /**
   * La valla se OBSERVÓ activa y luego dejó de estar disponible. Fallo CERRADO:
   * una capacidad observada no puede degradarse a la ruta anterior a B4.
   */
  identityFenceCapabilityLost: boolean;
};

/**
 * Por qué NO se pudo vallar, cuando la causa no es una ausencia PROBADA de la
 * migración 126. Las dos son averías; ninguna autoriza la ruta anterior a B4.
 */
export type FencedPersistenceUnavailableReason =
  /** La foto llegó sin época y sin prueba de esquema: lectura caída, lote no
   * visible, o cliente no soportado. */
  | 'snapshot_degraded'
  /** La valla se OBSERVÓ activa y después dejó de estar disponible. */
  | 'fence_capability_lost';

export type FencedPersistenceResult =
  | {
      status: 'persisted';
      candidateIds: ReadonlyArray<string>;
      insertedCount: number;
      decisions: ReadonlyArray<BatchIdentityDecision>;
      /** Foto vigente TRAS la escritura: la siguiente unidad parte de aquí. */
      snapshot: BatchIdentitySeedOutcome;
      telemetry: FencedPersistenceTelemetry;
    }
  | {
      status: 'duplicate';
      decision: BatchIdentityDecision;
      snapshot: BatchIdentitySeedOutcome;
      telemetry: FencedPersistenceTelemetry;
    }
  | {
      /** La 126 no está aplicada: el escritor ejecuta su ruta anterior a B4. */
      status: 'capability_absent';
      plan: Extract<FencedAdmissionPlan, { kind: 'persist' }>;
      snapshot: BatchIdentitySeedOutcome;
      telemetry: FencedPersistenceTelemetry;
    }
  | {
      /** Tope agotado. CERO escrituras. Error real. */
      status: 'retry_exhausted';
      snapshot: BatchIdentitySeedOutcome;
      telemetry: FencedPersistenceTelemetry;
    }
  | {
      /**
       * 🔴 No se puede vallar y NO hay prueba de que la 126 falte. CERO
       * escrituras y CERO caída a la ruta legada: el escritor lo cuenta como
       * error real de persistencia/concurrencia.
       */
      status: 'snapshot_unavailable';
      reason: FencedPersistenceUnavailableReason;
      snapshot: BatchIdentitySeedOutcome;
      telemetry: FencedPersistenceTelemetry;
    }
  | {
      /** Fallo REAL de escritura. La transacción revirtió: ni fila ni época. */
      status: 'insert_failed';
      code: string;
      raw: unknown;
      decisions: ReadonlyArray<BatchIdentityDecision>;
      snapshot: BatchIdentitySeedOutcome;
      telemetry: FencedPersistenceTelemetry;
    };

function emptyTelemetry(initial: number | null): FencedPersistenceTelemetry {
  return {
    identityEpochInitial: initial,
    identityEpochFinal: null,
    identityEpochStaleRetries: 0,
    identityEpochRetryExhausted: false,
    identityDuplicateAfterStaleRetry: false,
    identityFenceCapabilityAbsent: false,
    identitySnapshotUnavailable: false,
    identityFenceCapabilityLost: false,
  };
}

/**
 * 🔴 La ÚNICA condición que autoriza la ruta de escritura ANTERIOR a B4.
 *
 * Las tres cosas a la vez, y ninguna deducida:
 *
 *   · `epoch === null`                — no hay contra qué vallar,
 *   · `fenceCapabilityAbsent === true`— la BASE dijo que la función no existe
 *                                       (42883 / PGRST202), y
 *   · `degraded === false`            — la lectura NO falló, así que ese `null`
 *                                       es esquema y no avería.
 *
 * `epoch === null` a secas era el defecto: una lectura caída, un lote invisible o
 * un cliente no soportado también lo producen, y cada uno de ellos se convertía
 * en una escritura sin valla. Se exporta para que la guarda estática pueda
 * comprobar que nadie vuelve a decidirlo con una condición más débil.
 *
 * 🔴 CUT9A-FIX — acepta la EVIDENCIA, no la foto entera. La mitad de pago de Lusha
 * relee la época sin necesitar el registro sembrado, y tenía que poder consultar
 * esta MISMA conjunción: reescribirla allí habría creado dos vocabularios que
 * divergen en la primera corrección, que es exactamente lo que la cabecera de
 * `batch-identity-registry-store` advierte. `BatchIdentitySeedOutcome` sigue
 * siendo asignable, así que ninguna llamada existente cambia.
 */
export type FenceCapabilityEvidence = Pick<
  BatchIdentitySeedOutcome,
  'epoch' | 'fenceCapabilityAbsent' | 'degraded'
>;

export function isProvenFenceCapabilityAbsent(snapshot: FenceCapabilityEvidence): boolean {
  return (
    snapshot.epoch === null &&
    snapshot.fenceCapabilityAbsent === true &&
    snapshot.degraded === false
  );
}

/**
 * Telemetría inicial de un lote, derivada de su primera foto.
 *
 * Existe para que los tres escritores no repitan —ni diverjan en— la semántica de
 * `identityFenceCapabilityAbsent`: sólo es `true` si la ausencia está PROBADA.
 */
export function initialFencedPersistenceTelemetry(
  snapshot: BatchIdentitySeedOutcome,
): FencedPersistenceTelemetry {
  return {
    ...emptyTelemetry(snapshot.epoch),
    identityEpochFinal: snapshot.epoch,
    identityFenceCapabilityAbsent: isProvenFenceCapabilityAbsent(snapshot),
  };
}

/** Vista para metadata. Sólo números y booleanos; sin PII, sin valores fiscales. */
export function toFencedPersistenceMetadata(
  telemetry: FencedPersistenceTelemetry,
): Record<string, number | boolean | null> {
  return {
    identity_epoch_initial: telemetry.identityEpochInitial,
    identity_epoch_final: telemetry.identityEpochFinal,
    identity_epoch_stale_retries: telemetry.identityEpochStaleRetries,
    identity_epoch_retry_exhausted: telemetry.identityEpochRetryExhausted,
    identity_duplicate_after_stale_retry: telemetry.identityDuplicateAfterStaleRetry,
    identity_fence_capability_absent: telemetry.identityFenceCapabilityAbsent,
    identity_snapshot_unavailable: telemetry.identitySnapshotUnavailable,
    identity_fence_capability_lost: telemetry.identityFenceCapabilityLost,
  };
}

/** Suma dos telemetrías de unidades sucesivas del mismo lote. */
export function mergeFencedPersistenceTelemetry(
  accumulated: FencedPersistenceTelemetry,
  next: FencedPersistenceTelemetry,
): FencedPersistenceTelemetry {
  return {
    identityEpochInitial: accumulated.identityEpochInitial ?? next.identityEpochInitial,
    identityEpochFinal: next.identityEpochFinal ?? accumulated.identityEpochFinal,
    identityEpochStaleRetries:
      accumulated.identityEpochStaleRetries + next.identityEpochStaleRetries,
    identityEpochRetryExhausted:
      accumulated.identityEpochRetryExhausted || next.identityEpochRetryExhausted,
    identityDuplicateAfterStaleRetry:
      accumulated.identityDuplicateAfterStaleRetry || next.identityDuplicateAfterStaleRetry,
    identityFenceCapabilityAbsent:
      accumulated.identityFenceCapabilityAbsent || next.identityFenceCapabilityAbsent,
    identitySnapshotUnavailable:
      accumulated.identitySnapshotUnavailable || next.identitySnapshotUnavailable,
    identityFenceCapabilityLost:
      accumulated.identityFenceCapabilityLost || next.identityFenceCapabilityLost,
  };
}

export type RunFencedPersistenceArgs = {
  client: SupabaseClient;
  batchId: string;
  /**
   * La foto vigente. La primera la carga el escritor; las siguientes las devuelve
   * este mismo módulo, así que un lote de N candidatos hace UNA lectura y no N.
   */
  snapshot: BatchIdentitySeedOutcome;
  /**
   * Decide, contra una foto, si esta unidad es duplicado o se persiste.
   *
   * 🔴 Tiene que resolverse con `evaluateCandidateIdentity`. Este módulo NO
   * implementa un segundo evaluador de duplicados y no debe hacerlo nunca: la
   * autoridad de TIER 0-5 vive en `batch-identity-registry`.
   */
  plan: (snapshot: BatchIdentitySeedOutcome) => FencedAdmissionPlan;
  maxRetries?: number;
  /** Inyectable SÓLO para pruebas; en producción es `loadBatchIdentityRegistry`. */
  reloadSnapshot?: (
    client: SupabaseClient,
    batchId: string,
  ) => Promise<BatchIdentitySeedOutcome>;
  /** Inyectable SÓLO para pruebas; en producción es la RPC vallada. */
  fencedInsert?: (
    client: SupabaseClient,
    args: {
      batchId: string;
      expectedEpoch: number;
      candidates: ReadonlyArray<Record<string, unknown>>;
    },
  ) => Promise<FencedCandidateInsertResult>;
};

/**
 * Ejecuta una unidad de persistencia bajo vallado, con reintento acotado.
 *
 * Nunca lanza: un duplicado, una carrera perdida o un tope agotado son
 * DESENLACES, y convertirlos en excepción haría que un lote legítimo muriera por
 * la contención que este mecanismo existe para tolerar.
 */
export async function runFencedPersistence(
  args: RunFencedPersistenceArgs,
): Promise<FencedPersistenceResult> {
  const maxRetries = args.maxRetries ?? MAX_IDENTITY_EPOCH_RETRIES;
  const reload = args.reloadSnapshot ?? loadBatchIdentityRegistry;
  const insert = args.fencedInsert ?? insertFencedProspectCandidates;

  // 🔴 CUT-3B4-CORRECCIÓN — la prueba de ausencia se toma UNA vez y no se
  // recupera. Si la foto INICIAL trajo época, la valla se OBSERVÓ activa y ya no
  // hay ninguna vuelta a la ruta legada dentro de esta tentativa: ni una recarga
  // degradada ni una RPC que desaparezca pueden reabrirla.
  const legacyFallbackAllowed = isProvenFenceCapabilityAbsent(args.snapshot);

  let snapshot = args.snapshot;
  let telemetry = emptyTelemetry(snapshot.epoch);
  let attempt = 0;

  for (;;) {
    const plan = args.plan(snapshot);

    if (plan.kind === 'duplicate') {
      return {
        status: 'duplicate',
        decision: plan.decision,
        snapshot,
        telemetry: {
          ...telemetry,
          identityEpochFinal: snapshot.epoch,
          // Sólo es «duplicado tras carrera» si hubo al menos una re-evaluación.
          identityDuplicateAfterStaleRetry: telemetry.identityEpochStaleRetries > 0,
        },
      };
    }

    // Sin época NO se puede vallar. Y «no se puede vallar» NO es «la 126 no está
    // aplicada»: sólo la conjunción PROBADA autoriza la ruta anterior a B4.
    if (snapshot.epoch === null) {
      if (legacyFallbackAllowed) {
        return {
          status: 'capability_absent',
          plan,
          snapshot,
          telemetry: {
            ...telemetry,
            identityEpochFinal: null,
            identityFenceCapabilityAbsent: true,
          },
        };
      }

      // 🔴 Fallo CERRADO. Lectura caída, lote invisible, cliente no soportado o
      // una recarga que degradó tras haber visto la valla activa: en los cuatro
      // casos hay una AVERÍA, y una avería no puede convertirse en permiso para
      // escribir sin valla.
      return {
        status: 'snapshot_unavailable',
        reason: 'snapshot_degraded',
        snapshot,
        telemetry: {
          ...telemetry,
          identityEpochFinal: null,
          identitySnapshotUnavailable: true,
        },
      };
    }

    const outcome = await insert(args.client, {
      batchId: args.batchId,
      expectedEpoch: snapshot.epoch,
      candidates: plan.rows,
    });

    if (outcome.status === 'inserted') {
      return {
        status: 'persisted',
        candidateIds: outcome.candidateIds,
        insertedCount: outcome.insertedCount,
        decisions: plan.decisions,
        // La foto avanza sin releer: las filas recién escritas las registra el
        // escritor con `acceptIdentity`, que es donde ya vivía esa verdad.
        snapshot: { ...snapshot, epoch: outcome.nextEpoch },
        telemetry: { ...telemetry, identityEpochFinal: outcome.nextEpoch },
      };
    }

    if (outcome.status === 'capability_absent') {
      // 🔴 Fallo CERRADO, y sin condición que lo module. Aquí sólo se llega
      // HABIENDO llamado a la valla, y sólo se la llama con una época no nula ⇒ la
      // capacidad se OBSERVÓ activa en esta misma tentativa. Que la RPC de
      // escritura diga ahora «la función no existe» es una inconsistencia del
      // despliegue (caché de esquema, función retirada a mitad de vuelo), nunca
      // una prueba de que la 126 no esté aplicada — y antes de esta corrección
      // caía a la ruta legada, es decir, la valla podía desvanecerse a mitad de la
      // admisión y abrir el insert directo.
      return {
        status: 'snapshot_unavailable',
        reason: 'fence_capability_lost',
        snapshot,
        telemetry: {
          ...telemetry,
          identityEpochFinal: snapshot.epoch,
          identityFenceCapabilityLost: true,
        },
      };
    }

    if (outcome.status === 'stale' || outcome.status === 'batch_not_found') {
      // `batch_not_found` se reintenta UNA vuelta por el mismo camino que `stale`:
      // el lote puede no ser visible todavía para esta sesión. Si sigue sin verse,
      // el tope se agota y se falla CERRADO, que es lo correcto.
      attempt += 1;
      telemetry = {
        ...telemetry,
        identityEpochStaleRetries: telemetry.identityEpochStaleRetries + 1,
      };

      if (attempt > maxRetries) {
        return {
          status: 'retry_exhausted',
          snapshot,
          telemetry: {
            ...telemetry,
            identityEpochFinal: snapshot.epoch,
            identityEpochRetryExhausted: true,
          },
        };
      }

      // 🔴 Se RE-CARGA la foto entera y se RE-EVALÚA con la misma autoridad. No se
      // reutiliza `currentEpoch` sin releer las filas: sería declarar una época
      // nueva sobre un estado viejo, que es la carrera original al revés.
      snapshot = await reload(args.client, args.batchId);
      continue;
    }

    if (outcome.status === 'invalid_input') {
      return {
        status: 'insert_failed',
        code: 'fence_invalid_input',
        raw: null,
        decisions: plan.decisions,
        snapshot,
        telemetry: { ...telemetry, identityEpochFinal: snapshot.epoch },
      };
    }

    return {
      status: 'insert_failed',
      code: outcome.code,
      raw: outcome.raw,
      decisions: plan.decisions,
      snapshot,
      telemetry: { ...telemetry, identityEpochFinal: snapshot.epoch },
    };
  }
}

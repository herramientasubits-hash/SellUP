/**
 * prospect-candidate-persistence-readiness.ts — ¿puede la base guardar lo que
 * la búsqueda va a encontrar?
 *
 * A1-APOLLO-PERSISTENCE-READINESS-4 · § 6 y § 7.
 *
 * El defecto que corrige: LIVE-QA-2 (lote `62fdf47b`) pagó 12 créditos, Apollo
 * devolvió una empresa elegible, y el INSERT del candidato murió con
 *
 *   Could not find the 'identity_key' column of 'prospect_candidates'
 *   in the schema cache
 *
 * porque la migración 092 nunca se aplicó en Producción. El gasto ya estaba
 * hecho cuando el esquema dijo que no. Aquí viven las dos mitades puras de la
 * corrección:
 *
 *   1. la CLASIFICACIÓN de un error de PostgREST/Postgres en un código propio y
 *      sanitizado, usable tanto por el preflight (antes de gastar) como por el
 *      writer (cuando ya se gastó);
 *   2. la DECISIÓN de si una corrida puede empezar, con su copy administrativo.
 *
 * Puro: sin I/O, sin Supabase, sin env, sin React. La sonda real vive en
 * `wizard-persistence-readiness-deps.ts`.
 */

// ─── Códigos ──────────────────────────────────────────────────────────────────

/**
 * Único código que viaja hacia el usuario/administrador y hacia el metadata del
 * lote cuando la columna de identidad no está disponible. Es un código nuestro,
 * no el de Postgres: el mensaje crudo del proveedor de base de datos no se
 * expone (§ 6).
 */
export const IDENTITY_KEY_UNAVAILABLE_ERROR_CODE =
  'prospect_candidates_identity_key_unavailable' as const;

/**
 * Fallo de escritura que NO es la columna ausente. Se conserva como código
 * genérico para no filtrar el mensaje del motor: un error de permisos, una
 * violación de CHECK o una conexión caída son fallos reales, pero su texto
 * puede contener SQL, nombres de columna y valores de fila.
 */
export const CANDIDATE_PERSISTENCE_FAILED_ERROR_CODE =
  'prospect_candidate_write_failed' as const;

export type PersistenceErrorCode =
  | typeof IDENTITY_KEY_UNAVAILABLE_ERROR_CODE
  | typeof CANDIDATE_PERSISTENCE_FAILED_ERROR_CODE;

/** Dónde falló la escritura. Se persiste; no lleva detalle libre. */
export type PersistenceErrorStage = 'candidate_insert' | 'batch_update' | 'schema_preflight';

// ─── Clasificación de errores ─────────────────────────────────────────────────

/**
 * Columna cuya ausencia mata la persistencia de candidatos de Agente 1.
 *
 * Es un literal compartido a propósito: el writer la escribe, la sonda la
 * selecciona y este detector la reconoce. Un nombre que se desvíe de la
 * migración fallaría en un solo lado y en silencio.
 */
export const PROSPECT_CANDIDATE_IDENTITY_COLUMN = 'identity_key' as const;

/**
 * Códigos que significan «esta columna no existe aquí».
 *
 * `42703` es `undefined_column` de Postgres; `PGRST204` es cómo PostgREST
 * reporta una columna ausente de su caché de esquema — el código EXACTO del
 * fallo de LIVE-QA-2. Nada más califica.
 */
const MISSING_COLUMN_ERROR_CODES: ReadonlySet<string> = new Set(['42703', 'PGRST204']);

/**
 * Cierto sólo para «la columna `identity_key` de prospect_candidates no existe».
 *
 * Estrecho en dos ejes, igual que el detector de la migración 100:
 *   - el código debe ser un código de columna indefinida;
 *   - el mensaje debe nombrar NUESTRA columna. Otra columna ausente es un
 *     defecto de esquema distinto y tiene que seguir siendo ruidoso en vez de
 *     quedar absorbido por un diagnóstico que no le corresponde.
 */
export function isMissingProspectCandidateIdentityKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== 'string' || !MISSING_COLUMN_ERROR_CODES.has(code)) return false;
  if (typeof message !== 'string' || message === '') return false;
  return message.includes(PROSPECT_CANDIDATE_IDENTITY_COLUMN);
}

/**
 * Proyecta un error de escritura a un código sanitizado.
 *
 * Nunca devuelve el mensaje del motor: el valor de retorno es uno de dos
 * literales conocidos, así que es imposible que este camino filtre SQL,
 * cabeceras, credenciales o datos de la fila.
 */
export function classifyCandidatePersistenceError(error: unknown): PersistenceErrorCode {
  return isMissingProspectCandidateIdentityKeyError(error)
    ? IDENTITY_KEY_UNAVAILABLE_ERROR_CODE
    : CANDIDATE_PERSISTENCE_FAILED_ERROR_CODE;
}

// ─── Sonda ────────────────────────────────────────────────────────────────────

/**
 * Resultado de la sonda real de esquema.
 *
 * `available` sólo se declara cuando la lectura de la columna funcionó de
 * verdad. Un error cualquiera —incluido uno que no sepamos clasificar— NO es
 * disponibilidad: es «no verificable», y no verificable bloquea (§ 6).
 */
export type PersistenceReadinessProbe =
  | { status: 'available' }
  | { status: 'identity_key_missing' }
  | { status: 'probe_failed' };

/** Traduce el error crudo de la sonda a su estado, sin exponerlo. */
export function toPersistenceReadinessProbe(error: unknown): PersistenceReadinessProbe {
  if (error == null) return { status: 'available' };
  return isMissingProspectCandidateIdentityKeyError(error)
    ? { status: 'identity_key_missing' }
    : { status: 'probe_failed' };
}

// ─── Decisión ─────────────────────────────────────────────────────────────────

/**
 * Copy administrativo. Dice las dos cosas que el operador necesita saber: que
 * la base no puede guardar, y que NO se gastó nada. El error crudo de
 * Postgres/PostgREST no aparece (§ 6).
 */
export const PERSISTENCE_NOT_READY_ADMIN_MESSAGE =
  'La base de datos no está preparada para guardar los candidatos. ' +
  'No se ejecutó la búsqueda ni se consumieron créditos.';

export type PersistenceReadinessDecision =
  | { ready: true }
  | {
      ready: false;
      errorCode: typeof IDENTITY_KEY_UNAVAILABLE_ERROR_CODE;
      reason: 'identity_key_missing' | 'probe_failed';
      stage: 'schema_preflight';
      adminMessage: string;
    };

/**
 * Decide si la ejecución puede continuar.
 *
 * Fail-closed por construcción: la única entrada que devuelve `ready: true` es
 * una sonda que leyó la columna. Ausencia y fallo comparten código de error a
 * propósito —para quien ejecuta, «no está» y «no se pudo comprobar» tienen la
 * misma consecuencia: no se gasta— pero se distinguen en `reason`, que es lo
 * que un operador necesita para saber si aplicar la migración o mirar la
 * conexión.
 */
export function decidePersistenceReadiness(
  probe: PersistenceReadinessProbe,
): PersistenceReadinessDecision {
  if (probe.status === 'available') return { ready: true };
  return {
    ready: false,
    errorCode: IDENTITY_KEY_UNAVAILABLE_ERROR_CODE,
    reason: probe.status === 'identity_key_missing' ? 'identity_key_missing' : 'probe_failed',
    stage: 'schema_preflight',
    adminMessage: PERSISTENCE_NOT_READY_ADMIN_MESSAGE,
  };
}

// ─── Resultado de la persistencia ─────────────────────────────────────────────

/**
 * Lo que REALMENTE pasó al guardar, en las cifras que el contrato de § 7 exige.
 *
 * `eligibleBeforePersistence` y `persistedCandidates` son cantidades distintas y
 * aquí no comparten campo: confundirlas es exactamente cómo una corrida con una
 * empresa encontrada y cero guardadas terminó anunciándose como un vacío normal.
 */
export type CandidatePersistenceOutcome = {
  eligibleBeforePersistence: number;
  persistedCandidates: number;
  persistenceFailureCount: number;
  persistenceFailed: boolean;
  persistenceErrorCode: PersistenceErrorCode | null;
  persistenceErrorStage: PersistenceErrorStage | null;
};

/**
 * Resultado «nada falló», para los caminos que no escriben y para los dobles de
 * prueba.
 *
 * Existe porque el campo es OBLIGATORIO en `CandidateWriterOutput` a propósito:
 * un campo opcional dejaría que un `return` futuro se olvidara de las cifras, y
 * olvidarlas es exactamente cómo un fallo de escritura acabó indistinguible de un
 * vacío legítimo. El constructor hace que cumplirlo cueste una línea.
 */
export function noCandidatePersistenceFailures(input?: {
  eligibleBeforePersistence?: number;
  persistedCandidates?: number;
}): CandidatePersistenceOutcome {
  return {
    eligibleBeforePersistence: input?.eligibleBeforePersistence ?? 0,
    persistedCandidates: input?.persistedCandidates ?? 0,
    persistenceFailureCount: 0,
    persistenceFailed: false,
    persistenceErrorCode: null,
    persistenceErrorStage: null,
  };
}

/** Forma sanitizada que se persiste en `prospect_batches.metadata`. */
export type CandidatePersistenceOutcomeMetadata = {
  eligible_before_persistence: number;
  persisted_candidates: number;
  persistence_failure_count: number;
  persistence_failed: boolean;
  persistence_error_code: string | null;
  persistence_error_stage: string | null;
};

export const CANDIDATE_PERSISTENCE_OUTCOME_METADATA_KEY = 'candidate_persistence' as const;

export function toCandidatePersistenceOutcomeMetadata(
  outcome: CandidatePersistenceOutcome,
): CandidatePersistenceOutcomeMetadata {
  return {
    eligible_before_persistence: outcome.eligibleBeforePersistence,
    persisted_candidates: outcome.persistedCandidates,
    persistence_failure_count: outcome.persistenceFailureCount,
    persistence_failed: outcome.persistenceFailed,
    persistence_error_code: outcome.persistenceErrorCode,
    persistence_error_stage: outcome.persistenceErrorStage,
  };
}

/**
 * Estado del lote coherente con el resultado de la persistencia.
 *
 * Vocabulario EXISTENTE de `prospect_batches.status`
 * (draft|generating|ready_for_review|in_review|completed|cancelled|failed): no
 * se crea ningún enum nuevo en la base.
 *
 *   `failed`           — había empresas elegibles y ninguna se guardó. El lote
 *                        NO puede quedarse en `ready_for_review`: es lo que hizo
 *                        LIVE-QA-2 y por eso el vacío se leyó como normal.
 *   `ready_for_review` — se guardó al menos una: hay algo real que revisar,
 *                        aunque parte se haya perdido.
 *   `completed`        — no hubo nada que guardar y nada falló.
 */
export function resolveBatchStatusForPersistenceOutcome(input: {
  persistedCandidates: number;
  persistenceFailureCount: number;
}): 'failed' | 'ready_for_review' | 'completed' {
  if (input.persistedCandidates > 0) return 'ready_for_review';
  return input.persistenceFailureCount > 0 ? 'failed' : 'completed';
}

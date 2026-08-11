/**
 * candidate-record-origin.ts — La procedencia del candidato la declara quien lo
 * crea, no un backfill posterior.
 *
 * AGENT1-APOLLO-CANDIDATE-OPERABILITY-VALIDATION-1 · § A.
 *
 * El defecto que cierra: `prospect_candidates.record_origin` nació en la
 * migración 093 como columna nullable «poblada por una fase autorizada
 * posterior». Esa fase fue un backfill único (Q3F-5AY.7) y nadie enseñó al
 * writer canónico a escribir la columna. El resultado en Producción:
 *
 *   - `web_ai` con `record_origin='production'` (61 filas) → todas con
 *     `classification_source='derived_status'`, es decir el backfill;
 *   - `web_ai` con `record_origin IS NULL` (22 filas) → todo lo que el writer
 *     escribió DESPUÉS del backfill;
 *   - `lusha` con `record_origin='production'` (57 filas) → las escribe su propio
 *     writer (`lusha-pending-review.ts`), que sí conoce la columna;
 *   - `apollo` con `record_origin IS NULL` (8 filas) → nunca hubo backfill que
 *     las cubriera.
 *
 * Y como la cola de revisión limpia exige `record_origin='production'`
 * (`PENDING_REVIEW_RECORD_ORIGIN`, y los cuatro gates de acción con ella), un
 * candidato REAL de una corrida REAL no se podía aprobar ni descartar. No era un
 * problema de Apollo: era del writer canónico, y Apollo sólo lo hizo visible por
 * ser la única procedencia sin backfill histórico.
 *
 * Reglas, ninguna negociable:
 *
 *   1. La verdad la deriva el clasificador CANÓNICO
 *      (`deriveRecordOriginClassification`, Q3F-5AY.2), el mismo que lee el
 *      modelo de efectividad. No se abre una segunda fuente de verdad.
 *   2. Una corrida en seco NUNCA etiqueta `production`. Devuelve ausencia, y una
 *      ausencia no se puede confundir con un dato.
 *   3. Un marcador de smoke/QA/limpieza/import GANA siempre. Esta función nunca
 *      asciende a `production` lo que el clasificador clasificó de otro modo.
 *   4. `source_primary` NO sustituye a `record_origin`: son dimensiones distintas
 *      («qué proveedor lo produjo» vs. «de qué clase de corrida salió»).
 *
 * Puro: sin I/O, sin reloj, sin env. No muta sus entradas.
 */

import {
  deriveRecordOriginClassification,
  type ClassifiableBatch,
  type ClassifiableCandidate,
  type RecordOriginClassification,
} from '@/modules/agent1-effectiveness/classification';

/** El único valor que la cola de revisión limpia acepta (`queries.ts` § 19). */
export const CANONICAL_PRODUCTION_RECORD_ORIGIN = 'production' as const;

/**
 * La columna `classification_source` responde «quién produjo la clasificación
 * persistida». Aquí la produce el writer, y `writer` es exactamente el término
 * que la CHECK `prospect_candidates_classification_source_check` admite para eso.
 *
 * Es el MISMO valor que ya escribe el proyector del enrichment de Apollo
 * (`toApolloEnrichmentCandidateColumns`), así que las dos vías coinciden y
 * ninguna sobrescribe a la otra con un término distinto.
 */
export const WRITER_CLASSIFICATION_SOURCE = 'writer' as const;

export type CandidateRecordOriginResolution = {
  /** `null` ⇒ corrida en seco: no se etiqueta nada. */
  recordOrigin: RecordOriginClassification['recordOrigin'] | null;
  rejectionReason: RecordOriginClassification['rejectionReason'];
  /** `null` ⇒ corrida en seco. */
  classificationSource: typeof WRITER_CLASSIFICATION_SOURCE | null;
  /**
   * Cómo lo habría derivado el modelo de lectura, conservado tal cual para poder
   * auditar la decisión sin volver a ejecutarla. No se pierde ni un dato al
   * publicar `writer` en la columna.
   */
  derivation: RecordOriginClassification | null;
  /** `true` sólo cuando la fila sale de una corrida real y limpia de producción. */
  isCleanProduction: boolean;
};

export type CandidateRecordOriginInput = {
  /** `true` ⇒ nada se etiqueta. La corrida en seco no escribe filas. */
  dryRun: boolean;
  /** La fila tal como se va a insertar. */
  candidate: ClassifiableCandidate;
  /** El lote al que pertenece, si se conoce. Sólo actúa como señal de respaldo. */
  batch?: ClassifiableBatch;
};

/**
 * Resuelve la procedencia de un candidato que el writer canónico está a punto de
 * crear.
 *
 * No inventa: delega en el clasificador canónico y sólo añade las dos reglas que
 * el clasificador no puede conocer porque son del writer — que una corrida en
 * seco no etiqueta, y que la clasificación la firma el writer.
 */
export function resolveCandidateRecordOriginForWriter(
  input: CandidateRecordOriginInput,
): CandidateRecordOriginResolution {
  // § 2 — fail-closed. Una corrida en seco no llega a insertar (el writer sale
  // antes), y si algún día lo hiciera, no arrastraría una etiqueta falsa.
  if (input.dryRun) {
    return {
      recordOrigin: null,
      rejectionReason: null,
      classificationSource: null,
      derivation: null,
      isCleanProduction: false,
    };
  }

  const derivation = deriveRecordOriginClassification(input.candidate, input.batch);

  return {
    recordOrigin: derivation.recordOrigin,
    rejectionReason: derivation.rejectionReason,
    classificationSource: WRITER_CLASSIFICATION_SOURCE,
    derivation,
    isCleanProduction:
      derivation.recordOrigin === CANONICAL_PRODUCTION_RECORD_ORIGIN &&
      derivation.rejectionReason === null,
  };
}

export type CandidateRecordOriginColumns = {
  record_origin?: RecordOriginClassification['recordOrigin'];
  rejection_reason?: NonNullable<RecordOriginClassification['rejectionReason']>;
};

/**
 * Proyección a columnas de `prospect_candidates`.
 *
 * Parcial a propósito, igual que el proyector del enrichment: una clave ausente
 * deja la columna como estaba; una clave con `null` la sobrescribiría con nada.
 *
 * DOS columnas de la migración 093 se dejan deliberadamente FUERA, y no por
 * descuido:
 *
 *   - `classification_source` — la gobierna el proyector del enrichment de Apollo
 *     (`toApolloEnrichmentCandidateColumns`), y el § 7 de
 *     SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 exige que quede INTACTA cuando no
 *     hay subindustria confirmada. Ese contrato existe porque escribir en ella el
 *     vocabulario de evidencia hacía fallar el INSERT completo con 23514
 *     (FORENSICS-1). Escribirla también desde aquí la convertiría en una columna
 *     con dos escritores y dos semánticas.
 *   - `classification_confidence` — mismo motivo: hoy publica la confianza de la
 *     clasificación de SUBINDUSTRIA, no la de `record_origin`.
 *
 * Ninguna de las dos hace falta para lo que este hito cierra: la cola de revisión
 * limpia y sus cuatro gates leen `record_origin`, y sólo `record_origin`. La
 * derivación completa —incluida la fuente y la confianza— viaja en la metadata del
 * candidato, donde no colisiona con nadie.
 */
export function toCandidateRecordOriginColumns(
  resolution: CandidateRecordOriginResolution,
): CandidateRecordOriginColumns {
  if (resolution.recordOrigin === null) return {};

  return {
    record_origin: resolution.recordOrigin,
    ...(resolution.rejectionReason !== null
      ? { rejection_reason: resolution.rejectionReason }
      : {}),
  };
}

/** Clave bajo la que la derivación aterriza en `prospect_candidates.metadata`. */
export const CANDIDATE_RECORD_ORIGIN_METADATA_KEY = 'record_origin_resolution' as const;

/** Bloque auditable. Sin nombres de empresa ni dominios. */
export function toCandidateRecordOriginMetadata(
  resolution: CandidateRecordOriginResolution,
): Record<string, unknown> {
  return {
    record_origin: resolution.recordOrigin,
    rejection_reason: resolution.rejectionReason,
    classification_source: resolution.classificationSource,
    is_clean_production: resolution.isCleanProduction,
    decided_by: 'canonical_writer',
    derivation:
      resolution.derivation === null
        ? null
        : {
            matched_rule: resolution.derivation.matchedRule,
            derived_classification_source: resolution.derivation.classificationSource,
            derived_confidence: resolution.derivation.classificationConfidence,
            warnings: [...resolution.derivation.warnings],
          },
  };
}

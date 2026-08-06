/**
 * A1-APOLLO-CANDIDATE-INSERT-FORENSICS-1 — un candidato que no se guarda deja
 * rastro.
 *
 * La corrida `9a9acf99` perdió su ÚNICO candidato con subindustria confirmada y
 * el motivo real (`prospect_candidates_classification_source_check`) no estaba
 * en ningún sitio consultable: `prospect_candidate_audit` sólo tenía filas de
 * los candidatos que SÍ entraron, `warnings` estaba vacío y la metadata del lote
 * decía «candidate_insert» sin nombrar columna ni constraint. Reconstruirlo
 * exigió los logs de Postgres, que caducan en 24 h.
 *
 * Aquí se preserva el diagnóstico del motor —código, mensaje, detalle, pista y
 * constraint— junto a la identidad del candidato perdido. `candidate_id` es
 * nullable en `prospect_candidate_audit`, así que el fallo se audita a nivel de
 * lote sin inventar una fila de candidato que nunca existió.
 */

/** Diagnóstico del motor, tal y como llega en un `PostgrestError`. */
export type DatabaseErrorDiagnostics = {
  code: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
  constraint: string | null;
};

const CONSTRAINT_PATTERN =
  /violates (?:check|unique|foreign key|not-null) constraint "([^"]+)"/i;

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Extrae el diagnóstico sin propagarlo a la UI ni al `reason` del candidato: el
 * mensaje crudo del motor sigue viviendo SÓLO en la auditoría técnica.
 */
export function extractDatabaseErrorDiagnostics(error: unknown): DatabaseErrorDiagnostics {
  if (error === null || typeof error !== 'object') {
    return { code: null, message: null, details: null, hint: null, constraint: null };
  }
  const source = error as Record<string, unknown>;
  const message = readString(source, 'message');
  return {
    code: readString(source, 'code'),
    message,
    details: readString(source, 'details'),
    hint: readString(source, 'hint'),
    constraint: readString(source, 'constraint') ?? CONSTRAINT_PATTERN.exec(message ?? '')?.[1] ?? null,
  };
}

/** `23505` es el código de violación de índice único en Postgres. */
const UNIQUE_VIOLATION = '23505';
/** Códigos que sólo se resuelven con un despliegue: la columna aún no existe. */
const DEPLOYMENT_MISMATCH_CODES = new Set(['42703', 'PGRST204', 'PGRST205']);
/** Fallos transitorios: reintentar el mismo payload puede funcionar. */
const TRANSIENT_CODES = new Set(['40001', '40P01', '53300', '57014', '08006', '08003']);

/**
 * Una duplicidad tardía NO es un fallo técnico.
 *
 * El writer descarta duplicados antes de escribir, pero un índice único puede
 * ganar la carrera. Contarlo como «persistence failure» inflaría el hueco de
 * persistencia y mandaría a investigar una avería que no existe.
 */
export type CandidateInsertFailureKind = 'duplicate' | 'persistence_failure';

export function classifyCandidateInsertFailureKind(
  diagnostics: DatabaseErrorDiagnostics,
): CandidateInsertFailureKind {
  return diagnostics.code === UNIQUE_VIOLATION ? 'duplicate' : 'persistence_failure';
}

/**
 * Si reintentar el MISMO payload puede prosperar.
 *
 * Una constraint violada o un dato inválido no se arreglan reintentando: el
 * payload es el problema. Marcarlos como reintentables invitaría a un bucle.
 */
export function isRetryableInsertFailure(diagnostics: DatabaseErrorDiagnostics): boolean {
  if (diagnostics.code === null) return false;
  return (
    TRANSIENT_CODES.has(diagnostics.code) || DEPLOYMENT_MISMATCH_CODES.has(diagnostics.code)
  );
}

export const CANDIDATE_PERSISTENCE_FAILED_AUDIT_ACTION = 'candidate_persistence_failed' as const;

export type CandidatePersistenceFailureAuditDetails = {
  stage: string;
  error_code: string;
  failure_kind: CandidateInsertFailureKind;
  retryable: boolean;
  company_name: string | null;
  normalized_domain: string | null;
  identity_key: string | null;
  candidate_fingerprint: string;
  database_error_code: string | null;
  database_error_message: string | null;
  database_error_details: string | null;
  database_error_hint: string | null;
  failed_constraint: string | null;
  occurred_at: string;
};

/**
 * Detalle auditable del fallo. Sólo identidad de empresa y diagnóstico del
 * motor: ni claves de API, ni tokens, ni el payload completo del insert.
 */
export function toCandidatePersistenceFailureAuditDetails(input: {
  stage: string;
  errorCode: string;
  diagnostics: DatabaseErrorDiagnostics;
  companyName: string | null;
  normalizedDomain: string | null;
  identityKey: string | null;
  countryCode: string | null;
  occurredAt: string;
}): CandidatePersistenceFailureAuditDetails {
  return {
    stage: input.stage,
    error_code: input.errorCode,
    failure_kind: classifyCandidateInsertFailureKind(input.diagnostics),
    retryable: isRetryableInsertFailure(input.diagnostics),
    company_name: input.companyName,
    normalized_domain: input.normalizedDomain,
    identity_key: input.identityKey,
    // Huella estable e independiente de `identity_key`, que puede ser null.
    // `batch_id` es la columna que ya identifica la corrida en la auditoría.
    candidate_fingerprint: [
      input.companyName ?? '',
      input.normalizedDomain ?? '',
      input.countryCode ?? '',
    ].join('|'),
    database_error_code: input.diagnostics.code,
    database_error_message: input.diagnostics.message,
    database_error_details: input.diagnostics.details,
    database_error_hint: input.diagnostics.hint,
    failed_constraint: input.diagnostics.constraint,
    occurred_at: input.occurredAt,
  };
}

/**
 * idempotency.ts — Claves de operación por ronda, ancladas a la correlación
 * económica que ya existe.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 12.
 *
 * La segunda ronda usa la MISMA correlación económica que la primera
 * (`batch_id`, `reservation_id`, `client_request_id`, `wizard_run_id`,
 * `request_fingerprint`, `idempotency_key`); lo único que se añade por operación
 * es `round_number` y una `operation_key` derivada. Así, reintentar la ejecución
 * completa con el mismo `idempotencyKey`:
 *
 *   - no repite la búsqueda de una ronda ya completada,
 *   - no repite un enrichment,
 *   - no duplica usage logs,
 *   - no duplica candidatos,
 *   - no duplica créditos registrados.
 *
 * Ningún timestamp participa: dos reintentos del mismo run deben producir las
 * mismas claves, y un reloj no garantiza eso.
 *
 * Puro: hashing con `node:crypto`, sin reloj, sin aleatoriedad, sin I/O.
 */

import { createHash } from 'node:crypto';

/** Suficientemente corto para leerse en un log, suficientemente largo para no colisionar. */
const DIGEST_LENGTH = 32;

function digest(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, DIGEST_LENGTH);
}

/**
 * Correlación económica compartida por toda la corrida. Se recibe ya construida
 * (la produce `wizard-run-correlation`): este módulo no la reinventa ni añade un
 * segundo identificador de lote.
 */
export type ApolloTwoRoundRunCorrelation = {
  wizardRunId: string;
  clientRequestId: string;
  batchId: string | null;
  reservationId: string | null;
  requestFingerprint: string;
  idempotencyKey: string;
};

/** Operaciones que una ronda puede emitir. */
export type ApolloTwoRoundOperation = 'organizations_search' | 'organization_enrichment';

export type ApolloTwoRoundOperationKeyInput = {
  correlation: ApolloTwoRoundRunCorrelation;
  roundNumber: number;
  operation: ApolloTwoRoundOperation;
  /**
   * Sujeto concreto de la operación: la huella de la consulta para una búsqueda,
   * el dominio para un enrichment. Distingue dos enrichments de la misma ronda
   * sin depender del orden en que se ejecutaron.
   */
  subject: string;
};

/**
 * Clave lógica de una operación concreta de una ronda concreta de una corrida
 * concreta.
 *
 * Incluye `requestFingerprint`: un reintento que reusa el `idempotencyKey` con
 * parámetros distintos NO es el mismo trabajo, y darle la misma clave lo haría
 * pasar por ya ejecutado.
 */
export function buildApolloTwoRoundOperationKey(
  input: ApolloTwoRoundOperationKeyInput,
): string {
  const subject = input.subject.trim() || 'no_subject';
  return digest([
    'apollo_two_round',
    input.correlation.idempotencyKey,
    input.correlation.requestFingerprint,
    input.operation,
    `round_${input.roundNumber}`,
    subject,
  ]);
}

/** Metadata de correlación que cada operación añade a la de la corrida. */
export type ApolloTwoRoundOperationCorrelation = {
  round_number: number;
  operation_key: string;
};

export function toOperationCorrelationMetadata(
  input: ApolloTwoRoundOperationKeyInput,
): ApolloTwoRoundOperationCorrelation {
  return {
    round_number: input.roundNumber,
    operation_key: buildApolloTwoRoundOperationKey(input),
  };
}

// ─── Contexto de operación (§ 2 del FINAL-FIX) ─────────────────────────────────

/**
 * Identidad completa de UNA operación de la corrida.
 *
 * Antes el orquestador entregaba a sus dependencias sólo la `operationKey`
 * (el digest) y descartaba la ronda y el sujeto que la habían producido. El
 * adaptador, por tanto, no podía escribir `round_number` ni `operation_subject`
 * en la fila económica: cuatro operaciones de la misma corrida quedaban
 * indistinguibles entre sí. Este objeto es lo que ahora viaja completo hasta la
 * petición al proveedor, el usage log, el ledger, el checkpoint y la auditoría de
 * reconciliación.
 *
 * `operationKey` es el NOMBRE de la operación (`organizations_search` /
 * `organization_enrichment`), tal como aterriza en
 * `provider_usage_logs.operation_key`. `operationId` es el digest estable que
 * identifica esta operación concreta para la idempotencia. Los dos nombres son
 * distintos a propósito: confundirlos fue lo que dejó la correlación a medias.
 */
export type ApolloTwoRoundOperationContext = {
  roundNumber: number;
  operationKey: ApolloTwoRoundOperation;
  subject: string;
  operationId: string;
};

export function buildApolloTwoRoundOperationContext(input: {
  correlation: ApolloTwoRoundRunCorrelation;
  roundNumber: number;
  operationKey: ApolloTwoRoundOperation;
  subject: string;
}): ApolloTwoRoundOperationContext {
  const subject = input.subject.trim() || 'no_subject';
  return {
    roundNumber: input.roundNumber,
    operationKey: input.operationKey,
    subject,
    operationId: buildApolloTwoRoundOperationKey({
      correlation: input.correlation,
      roundNumber: input.roundNumber,
      operation: input.operationKey,
      subject,
    }),
  };
}

/**
 * Sujeto sanitizado de un Organization Enrichment.
 *
 * Precedencia: id del proveedor → dominio normalizado → clave estable del
 * candidato. Ningún timestamp participa: dos reintentos de la misma operación
 * deben producir el mismo sujeto, y un reloj no garantiza eso.
 */
export function buildApolloTwoRoundEnrichmentSubject(input: {
  providerOrganizationId?: string | null;
  normalizedDomain?: string | null;
  candidateKey: string;
}): string {
  const providerId = input.providerOrganizationId?.trim();
  if (providerId) return `apollo_org:${providerId}`;
  const domain = input.normalizedDomain?.trim();
  if (domain) return `domain:${domain}`;
  return `candidate:${input.candidateKey}`;
}

/** Proyección snake_case del contexto, para la fila económica y el checkpoint. */
export function toApolloTwoRoundOperationContextMetadata(
  context: ApolloTwoRoundOperationContext,
  providerRequestId: string | null = null,
): {
  round_number: number;
  operation_key: ApolloTwoRoundOperation;
  operation_subject: string;
  operation_id: string;
  provider_request_id: string | null;
} {
  return {
    round_number: context.roundNumber,
    operation_key: context.operationKey,
    operation_subject: context.subject,
    operation_id: context.operationId,
    provider_request_id: providerRequestId,
  };
}

// ─── Ledger de operaciones de la corrida ──────────────────────────────────────

/**
 * Registro de qué operaciones ya se completaron en esta corrida.
 *
 * No es un candado distribuido: es la identidad estable que permite reconocer que
 * una ronda ya se buscó o que un dominio ya se enriqueció, para que un reintento
 * no vuelva a gastar. Una operación INDETERMINADA (un timeout posterior al envío,
 * que Apollo pudo haber cobrado) bloquea igual que una completada: repetirla
 * duplicaría el cargo.
 */
export class ApolloTwoRoundOperationLedger {
  private readonly completed = new Set<string>();
  private readonly indeterminate = new Set<string>();

  markCompleted(operationKey: string): void {
    this.completed.add(operationKey);
    this.indeterminate.delete(operationKey);
  }

  markIndeterminate(operationKey: string): void {
    this.completed.delete(operationKey);
    this.indeterminate.add(operationKey);
  }

  /**
   * Degrada una operación ya marcada como completada a indeterminada.
   *
   * Es el único desenlace honesto cuando la operación se ejecutó pero su
   * resultado NO se pudo persistir: dejarla `completed` haría que un reintento la
   * saltara sin poder recuperar lo que produjo (corrida vacía después de pagar),
   * y borrarla haría que la repitiera (segundo cargo). Indeterminada evita las dos
   * cosas y exige conciliación manual, que es lo que el hecho realmente es.
   */
  downgradeToIndeterminate(operationKey: string): void {
    this.markIndeterminate(operationKey);
  }

  isCompleted(operationKey: string): boolean {
    return this.completed.has(operationKey);
  }

  isIndeterminate(operationKey: string): boolean {
    return this.indeterminate.has(operationKey);
  }

  /** Una operación sólo puede ejecutarse si no se completó ni quedó indeterminada. */
  canExecute(operationKey: string): boolean {
    return !this.completed.has(operationKey) && !this.indeterminate.has(operationKey);
  }

  get completedCount(): number {
    return this.completed.size;
  }

  /** Claves completadas, ordenadas. Se devuelven al caller para un reintento. */
  get completedKeys(): string[] {
    return [...this.completed].sort();
  }

  get indeterminateKeys(): string[] {
    return [...this.indeterminate].sort();
  }

  /** Rehidrata un ledger desde claves ya conocidas (p.ej. de un reintento). */
  static fromCompletedKeys(keys: readonly string[]): ApolloTwoRoundOperationLedger {
    const ledger = new ApolloTwoRoundOperationLedger();
    for (const key of keys) ledger.markCompleted(key);
    return ledger;
  }
}

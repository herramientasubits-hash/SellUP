/**
 * correlated-provider-usage-log.ts — Motor NEUTRAL de escritura de una fila
 * correlacionada en `provider_usage_logs`.
 *
 * AGENT1-LUSHA-PROVIDER-USAGE-OBSERVABILITY-1 § 2.
 *
 * De dónde sale este módulo: el motor que aquí vive es EXACTAMENTE el que
 * `apollo-organizations-usage-logging.ts` ya ejecutaba en Producción desde
 * A1-APOLLO-BUDGET-RECONCILIATION-1. No es un rediseño: se EXTRAE tal cual para
 * que la ruta Lusha no tenga que fabricar un segundo mecanismo con las mismas
 * tres decisiones difíciles ya resueltas aquí —idempotencia por `usage_key`,
 * supervivencia a una migración 100 no aplicada, y un aviso libre de secretos—.
 * El módulo Apollo sigue exportando sus mismos nombres con las mismas firmas y
 * delega en este; ninguna de sus suites cambia de import.
 *
 * Por qué el `billing_state` entra RESUELTO y no se calcula aquí: su precedencia
 * es propia de cada proveedor (Apollo cruza `run_correlation` con su
 * `spend_observability`; Lusha lo deriva de la liquidación de la reserva). Un
 * motor neutral que la adivinara sería un tercer criterio compitiendo con los
 * dos que ya existen.
 *
 * REGLAS DE SEGURIDAD (heredadas, no relajadas):
 * - Nunca imprime claves de API, consultas completas ni resultados de empresa.
 * - `real_cost_usd` se escribe SIEMPRE null: se concilia post-factura.
 * - `usage_key` único es lo que impide el doble conteo económico.
 */

import { isProviderUsageCorrelationColumnsEnabled } from '@/lib/feature-flags.server';
import {
  isMissingProviderUsageCorrelationColumnError,
  RUN_CORRELATION_METADATA_KEY,
  type RunCorrelationMetadata,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';
import type { LogProviderUsageInput } from './types';

// ─── Tipos de transporte ──────────────────────────────────────────────────────

/** Forma del error de DB sobre el que este módulo razona. */
export type ProviderUsageInsertError = { message: string; code?: string };

/**
 * Superficie de inserción mínima. Estrecha a propósito: el cliente admin real la
 * satisface, y una prueba la satisface sin base de datos y sin mock de módulo.
 */
export type ProviderUsageInsertClient = {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: ProviderUsageInsertError | null }>;
  };
};

export type CorrelatedProviderUsageLogResult =
  | { kind: 'logged'; correlationColumnsFallback?: true }
  | { kind: 'already_logged'; correlationColumnsFallback?: true }
  | { kind: 'failed'; error: string }
  | { kind: 'skipped_no_supabase' };

export type CorrelatedProviderUsageLogDeps = {
  /** Cliente de DB inyectado. Sin él, el resultado es `skipped_no_supabase`. */
  client?: ProviderUsageInsertClient | null;
  /** Sumidero inyectable del aviso de fallback. Por defecto `console.warn`. */
  warn?: (signal: string, detail: Record<string, unknown>) => void;
};

/**
 * Señal estable emitida cuando las columnas de correlación no existían.
 *
 * Grep-able a propósito: es la única diferencia observable entre «las columnas
 * están vivas» y «el flag está encendido pero la migración 100 no está aquí».
 */
export const CORRELATION_COLUMNS_FALLBACK_SIGNAL =
  'provider_usage_log.correlation_columns_missing.fallback_to_metadata' as const;

// ─── Constructores de fila ────────────────────────────────────────────────────

/**
 * Proyección de las columnas de correlación de la migración 100.
 *
 * Devuelve `{}` cuando el flag está apagado (el caso por defecto, y el único
 * válido mientras la migración no esté aplicada) o cuando no hay correlación.
 * `batch_id` no se proyecta: ya es una columna propia del insert.
 */
export function buildCorrelationColumnsWithBillingState(
  metadata: unknown,
  resolvedBillingState: string | null,
): Record<string, unknown> {
  if (!isProviderUsageCorrelationColumnsEnabled()) return {};
  if (!metadata || typeof metadata !== 'object') return {};
  const block = (metadata as Record<string, unknown>)[RUN_CORRELATION_METADATA_KEY];
  if (!block || typeof block !== 'object') return {};
  const c = block as Partial<RunCorrelationMetadata>;
  return {
    reservation_id: c.reservation_id ?? null,
    client_request_id: c.client_request_id ?? null,
    wizard_run_id: c.wizard_run_id ?? null,
    request_fingerprint: c.request_fingerprint ?? null,
    idempotency_key: c.idempotency_key ?? null,
    billing_state: resolvedBillingState,
  };
}

export type BuildProviderUsageLogRowOptions = {
  /**
   * `true` ⇒ un `estimated_cost_usd` explícitamente null se escribe como SQL
   * NULL en vez de colapsar a 0. Es el contrato canónico de
   * `buildProviderUsageLogInsertPayload`, y lo que impide reportar un costo
   * DESCONOCIDO como si fuera cero.
   */
  preserveUnknownEstimatedCost?: boolean;
};

/**
 * La fila tal como SIEMPRE se puede insertar — cada columna aquí precede a la
 * migración 100. `metadata` transporta la correlación completa, así que esta
 * fila por sí sola basta para reconciliar la corrida.
 *
 * El estado de cobro resuelto viaja SIEMPRE en el metadata, exista o no la
 * columna: con las columnas de correlación apagadas ésa es la única
 * representación disponible, y dejarla implícita es lo que produjo una fila con
 * el estado en el metadata de gasto y la columna en NULL.
 */
export function buildProviderUsageLogRowWithBillingState(
  input: LogProviderUsageInput,
  resolvedBillingState: string | null,
  options?: BuildProviderUsageLogRowOptions,
): Record<string, unknown> {
  const metadata =
    resolvedBillingState === null
      ? (input.metadata ?? {})
      : { ...(input.metadata ?? {}), provider_usage_billing_state: resolvedBillingState };

  // Contrato canónico de `buildProviderUsageLogInsertPayload` (17B.4X.5):
  // omitido ⇒ 0 (defecto histórico), null explícito ⇒ SQL NULL (costo
  // DESCONOCIDO, nunca 0 fabricado), número ⇒ tal cual (0 es un costo conocido
  // válido). Es opt-in porque la ruta Apollo lleva desde v1.16K-X colapsando
  // null a 0 en ESTA fila, y alinearla sin autorización cambiaría filas suyas.
  const estimatedCostUsd =
    options?.preserveUnknownEstimatedCost === true
      ? (input.estimated_cost_usd === undefined ? 0 : input.estimated_cost_usd)
      : (input.estimated_cost_usd ?? 0);

  return {
    agent_run_id: input.agent_run_id ?? null,
    agent_run_step_id: input.agent_run_step_id ?? null,
    batch_id: input.batch_id ?? null,
    usage_key: input.usage_key ?? null,
    provider_key: input.provider_key,
    operation_key: input.operation_key,
    model: input.model ?? null,
    input_tokens: input.input_tokens ?? 0,
    output_tokens: input.output_tokens ?? 0,
    credits_used: input.credits_used ?? null,
    results_returned: input.results_returned ?? 0,
    estimated_cost_usd: estimatedCostUsd,
    real_cost_usd: null,
    status: input.status ?? 'success',
    error_code: input.error_code ?? null,
    error_message: input.error_message ? input.error_message.slice(0, 500) : null,
    duration_ms: input.duration_ms ?? null,
    triggered_by: input.triggered_by ?? null,
    triggered_by_role_key: null,
    triggered_by_group_id: null,
    metadata,
  };
}

function defaultWarn(signal: string, detail: Record<string, unknown>): void {
  console.warn(signal, detail);
}

// ─── Motor de inserción ───────────────────────────────────────────────────────

/**
 * Inserta UNA fila de `provider_usage_logs`, sobreviviendo a una migración 100
 * no aplicada.
 *
 * Manejo de 23505: un `usage_key` que ya existe es `already_logged`, no un
 * error — es exactamente lo que hace idempotente el registro. `real_cost_usd`
 * nunca se escribe; queda NULL hasta que una factura externa lo concilie.
 *
 * Por qué existe el reintento: con el flag de columnas encendido y la migración
 * sin aplicar, el insert falla por columna desconocida y el log de uso se pierde
 * —justo el registro de gasto que hay que conciliar, después de que los créditos
 * ya se cobraron—. Así que una columna de correlación ausente degrada la fila a
 * su forma siempre-insertable y la escribe. La correlación tampoco se pierde:
 * está en `metadata.run_correlation` en las dos formas.
 *
 * Lo que deliberadamente NO hace:
 *   - reintentar cualquier otro error (permisos, constraints, conexión). Ésos se
 *     devuelven como fallo, en voz alta;
 *   - reintentar más de una vez, ni llamar al proveedor otra vez. El primer
 *     insert nunca creó fila, y la unicidad de `usage_key` atrapa un duplicado
 *     genuino como `already_logged`.
 *
 * NUNCA lanza: un ledger que no se pudo escribir no puede tumbar la operación
 * cuyo gasto ya ocurrió.
 */
export async function insertCorrelatedProviderUsageRow(
  args: {
    baseRow: Record<string, unknown>;
    correlationColumns: Record<string, unknown>;
    providerKey: string;
    operationKey: string;
  },
  deps?: CorrelatedProviderUsageLogDeps,
): Promise<CorrelatedProviderUsageLogResult> {
  try {
    const client = deps?.client ?? null;
    if (!client) return { kind: 'skipped_no_supabase' };

    const { baseRow, correlationColumns } = args;
    const correlationColumnNames = Object.keys(correlationColumns);

    const { error } = await client
      .from('provider_usage_logs')
      .insert({ ...correlationColumns, ...baseRow });

    if (!error) return { kind: 'logged' };
    if (error.code === '23505') return { kind: 'already_logged' };

    const canStripCorrelationColumns =
      correlationColumnNames.length > 0 &&
      isMissingProviderUsageCorrelationColumnError(error);
    if (!canStripCorrelationColumns) return { kind: 'failed', error: error.message };

    // Saneado a propósito: sólo hechos de esquema — ni texto de consulta, ni
    // payload de empresa, ni credenciales, ni cuerpo crudo del error.
    (deps?.warn ?? defaultWarn)(CORRELATION_COLUMNS_FALLBACK_SIGNAL, {
      provider_key: args.providerKey,
      operation_key: args.operationKey,
      error_code: error.code ?? null,
      stripped_columns: correlationColumnNames,
      correlation_preserved_in: `metadata.${RUN_CORRELATION_METADATA_KEY}`,
    });

    const retry = await client.from('provider_usage_logs').insert(baseRow);
    if (!retry.error) return { kind: 'logged', correlationColumnsFallback: true };
    if (retry.error.code === '23505') {
      return { kind: 'already_logged', correlationColumnsFallback: true };
    }
    return { kind: 'failed', error: retry.error.message };
  } catch (err: unknown) {
    return {
      kind: 'failed',
      error: err instanceof Error ? err.message : 'unknown logging error',
    };
  }
}

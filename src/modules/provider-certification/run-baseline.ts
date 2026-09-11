/**
 * run-baseline.ts — la línea base de una CORRIDA, no de una fila.
 *
 * A1-CERTIFICATION-READINESS §§ CUT-E.1, E.2, E.3.
 *
 * ── El defecto de forma que este módulo cierra ───────────────────────────────
 *
 * `usage-log-adapters.ts` proyecta UNA fila de `provider_usage_logs`. Esa firma
 * era la causa común de tres defectos distintos, y no tres despistes:
 *
 *   · la ACEPTACIÓN de Apollo la decide el writer agregando TODAS las consultas
 *     de la corrida, así que ninguna fila por consulta puede llevarla sin
 *     duplicarla (Producción tiene 2 filas de búsqueda por corrida);
 *   · el GASTO de Apollo se reparte entre `organizations_search` y
 *     `organization_enrichment`, así que una fila sola siempre subestima;
 *   · el EMBUDO (páginas, vistas, rechazadas, duplicados) es la suma de las
 *     consultas, no la primera de ellas.
 *
 * La unidad correcta es la corrida. Este módulo la construye.
 *
 * ── 🔴 Lo que este módulo NO hace ───────────────────────────────────────────
 *
 * · No decide la aceptación. La LEE de `replayApolloRunAcceptance` (CUT-D.1),
 *   que a su vez lee el `countsTowardTarget` que el writer ya resolvió. No hay
 *   aritmética de aceptación aquí, y no puede haberla: sería la segunda
 *   autoridad que CUT-7 existe para impedir.
 * · No vuelve a extraer campos de `metadata`: usa los lectores exportados por
 *   `usage-log-adapters.ts`, que siguen siendo la única autoridad de extracción.
 * · No lee ni escribe en base de datos, no llama a ningún proveedor, no reserva
 *   ni consume créditos y no mira el reloj. El llamador trae las filas.
 *
 * Puro.
 */

import type { ApolloUsageOperationKey } from '@/server/agents/prospecting-toolkit/apollo-usage-operation-context';
import {
  replayApolloRunAcceptance,
  type ApolloRunAcceptanceReplay,
  type StoredCandidateRow,
} from '@/server/agents/prospecting-toolkit/apollo-accepted-for-target-replay';
import {
  buildCertificationBaselineRow,
  CERT_SEAM_BATCH_ACCEPTANCE_SHARED_BY_TWO_PROVIDERS,
  type CertificationBaselineRow,
} from './certification-baseline';
import {
  readApolloSearchRowFacts,
  readLushaRowFacts,
  type ProviderUsageLogLike,
} from './usage-log-adapters';

// ─── Qué operaciones cobra cada proveedor ────────────────────────────────────

/**
 * 🔴 CUT-E.3 — las operaciones de descubrimiento que Apollo COBRA.
 *
 * No es una lista nueva: es la enumeración que
 * `ApolloUsageOperationKey` ya declaraba («operaciones Apollo que una ronda
 * puede emitir»). Escribirla otra vez a mano habría sido exactamente el defecto
 * —una segunda lista que se queda atrás— con el que empezamos.
 *
 * El acoplamiento lo sostiene el COMPILADOR en las dos direcciones:
 *   · `satisfies` falla si aquí aparece una operación que la unión no reconoce;
 *   · `APOLLO_CHARGED_OPERATION_COVERAGE_IS_EXHAUSTIVE` falla si la unión gana
 *     una operación que esta lista no cubre — que es el caso peligroso, porque
 *     es el que vuelve a subestimar el coste en silencio.
 */
export const APOLLO_CHARGED_OPERATIONS = [
  'organizations_search',
  'organization_enrichment',
] as const satisfies readonly ApolloUsageOperationKey[];

type UncoveredApolloOperation = Exclude<
  ApolloUsageOperationKey,
  (typeof APOLLO_CHARGED_OPERATIONS)[number]
>;

/** Falla en compilación si `ApolloUsageOperationKey` gana una operación sin cubrir. */
export const APOLLO_CHARGED_OPERATION_COVERAGE_IS_EXHAUSTIVE: [
  UncoveredApolloOperation,
] extends [never]
  ? true
  : never = true;

/**
 * La operación de descubrimiento de empresas de Lusha.
 *
 * 🔴 Se declara aquí, y no se importa de
 * `lusha-provider-usage-observability.ts`, porque ese módulo es del servidor y
 * arrastra dependencias que este fichero no puede tener. La copia no puede
 * derivar en silencio: una guarda estática de la suite compara este literal con
 * el de `LUSHA_COMPANY_DISCOVERY_OPERATION_KEY`.
 */
export const LUSHA_CHARGED_OPERATIONS = ['company_prospecting_v3'] as const;

// ─── Gasto de la corrida ─────────────────────────────────────────────────────

export interface ChargedCreditsSummary {
  /** Total de la corrida. `null` ⇒ alguna fila cobrada no declara su gasto. */
  readonly total: number | null;
  /** Desglose por operación. `null` ⇒ no hubo ni una fila cobrada. */
  readonly byOperation: Readonly<Record<string, number>> | null;
  readonly chargedRows: number;
  readonly rowsWithUnknownCredits: number;
}

/**
 * Suma el gasto de las filas COBRADAS de una corrida.
 *
 * 🔴 Una sola fila cobrada sin `credits_used` deja el TOTAL en `null`, no en «lo
 * que sí se pudo sumar». Un total parcial presentado como total es la forma
 * exacta del defecto que CUT-E.3 cierra: una cifra que parece completa y no lo
 * está. El desglose sí se conserva, para que se vea qué se pudo leer.
 */
export function summarizeChargedCredits(
  rows: readonly ProviderUsageLogLike[],
  chargedOperations: readonly string[],
): ChargedCreditsSummary {
  const charged = rows.filter((r) => chargedOperations.includes(r.operation_key));
  if (charged.length === 0) {
    return { total: null, byOperation: null, chargedRows: 0, rowsWithUnknownCredits: 0 };
  }

  const byOperation: Record<string, number> = {};
  let unknown = 0;
  let sum = 0;
  for (const row of charged) {
    const credits =
      typeof row.credits_used === 'number' && Number.isFinite(row.credits_used)
        ? row.credits_used
        : null;
    if (credits === null) {
      unknown += 1;
      continue;
    }
    sum += credits;
    byOperation[row.operation_key] = (byOperation[row.operation_key] ?? 0) + credits;
  }

  return {
    total: unknown === 0 ? sum : null,
    byOperation,
    chargedRows: charged.length,
    rowsWithUnknownCredits: unknown,
  };
}

// ─── Agregación de hechos ────────────────────────────────────────────────────

/** Suma ignorando ausentes. `null` cuando NINGUNO estaba presente. */
function sumOrNull(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

/** El primer valor presente, o `null`. */
function firstOrNull<T>(values: readonly (T | null)[]): T | null {
  return values.find((v): v is T => v !== null) ?? null;
}

/**
 * La latencia de la CORRIDA.
 *
 * 🔴 `null` en cuanto UNA fila cobrada no la declara, y no «la suma de las que
 * sí». En Producción `organization_enrichment` no registra `duration_ms` en
 * ninguna de sus 82 filas, así que sumar sólo las búsquedas publicaría como
 * latencia de la corrida una cifra que deja fuera la mitad de sus llamadas.
 */
function resolveRunLatency(rows: readonly ProviderUsageLogLike[]): number | null {
  if (rows.length === 0) return null;
  let sum = 0;
  for (const row of rows) {
    if (typeof row.duration_ms !== 'number' || !Number.isFinite(row.duration_ms)) return null;
    sum += row.duration_ms;
  }
  return sum;
}

/** El `created_at` más temprano. Es OBSERVADO: la corrida empezó ahí. */
function earliestCreatedAt(rows: readonly ProviderUsageLogLike[]): string | null {
  const stamps = rows
    .map((r) => r.created_at)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .sort();
  return stamps[0] ?? null;
}

// ─── El contraste del contrato, y su trampa ──────────────────────────────────

export interface BatchAcceptanceContrast {
  readonly count: number | null;
  /** Por qué NO se pudo contrastar. `null` cuando sí se pudo. */
  readonly notComparableReason: string | null;
}

/**
 * ¿Se puede usar la aceptación del LOTE para contrastar la de UN proveedor?
 *
 * 🔴 Sólo cuando el lote tiene un único proveedor. En el waterfall Apollo y
 * Lusha comparten lote por construcción, y
 * `accepted_for_target.accepted_paid_for_target` es la aceptación de PAGO del
 * lote entero. Medido en Producción: el lote `483f3584` publica 5 y sus 5
 * candidatos son de Lusha, con 0 de Apollo. Contrastar la traza de Apollo (0)
 * contra ese 5 declararía rota una correlación intacta.
 *
 * No medir no es discrepar: sin contraste posible se devuelve `null` y se dice
 * por qué.
 */
export function resolveBatchAcceptanceContrast(input: {
  readonly batchAcceptedPaidForTarget: number | null;
  readonly providerKeysInBatch: readonly string[];
}): BatchAcceptanceContrast {
  const distinct = [...new Set(input.providerKeysInBatch)];
  if (distinct.length > 1) {
    return { count: null, notComparableReason: CERT_SEAM_BATCH_ACCEPTANCE_SHARED_BY_TWO_PROVIDERS };
  }
  return { count: input.batchAcceptedPaidForTarget, notComparableReason: null };
}

// ─── Línea base por corrida ──────────────────────────────────────────────────

export interface ProviderRunBaseline {
  readonly row: CertificationBaselineRow;
  readonly credits: ChargedCreditsSummary;
  /** Hechos que la fila no puede llevar y que el lector necesita saber. */
  readonly diagnostics: readonly string[];
}

export interface ApolloRunBaseline extends ProviderRunBaseline {
  readonly replay: ApolloRunAcceptanceReplay;
}

export interface ApolloRunBaselineInput {
  /** TODAS las filas de gasto de Apollo de la corrida, de cualquier operación. */
  readonly usageRows: readonly ProviderUsageLogLike[];
  /** Las filas de `prospect_candidates` de ESTA pierna. El llamador ya filtró. */
  readonly candidateRows: readonly StoredCandidateRow[];
  /** `accepted_for_target.accepted_paid_for_target` del lote. Sólo contrasta. */
  readonly batchAcceptedPaidForTarget: number | null;
  /** `provider_key` distintos con gasto en el MISMO lote. Ver el contraste. */
  readonly providerKeysInBatch: readonly string[];
  readonly dispositions?: Readonly<Record<string, number>> | null;
  readonly providerOrder?: number | null;
  readonly certificationRunId?: string | null;
  readonly finishedAt?: string | null;
}

/**
 * La corrida de Apollo, entera.
 *
 * 🔴 `companies_accepted` sale del replay por CANDIDATO —los veredictos que el
 * writer ya tomó y CUT-D.1 conservó—, nunca de la fila de gasto, que lo publica
 * `null` por contrato. Por eso `companies_accepted_source` vale
 * `per_candidate_writer_trace`: la certificación tiene que poder leer de dónde
 * vino el número sin preguntarle a nadie.
 */
export function buildApolloRunCertificationBaseline(
  input: ApolloRunBaselineInput,
): ApolloRunBaseline {
  const searchRows = input.usageRows.filter((r) => r.operation_key === 'organizations_search');
  const chargedRows = input.usageRows.filter((r) =>
    (APOLLO_CHARGED_OPERATIONS as readonly string[]).includes(r.operation_key),
  );
  const facts = searchRows.map(readApolloSearchRowFacts);
  const credits = summarizeChargedCredits(input.usageRows, APOLLO_CHARGED_OPERATIONS);

  const contrast = resolveBatchAcceptanceContrast({
    batchAcceptedPaidForTarget: input.batchAcceptedPaidForTarget,
    providerKeysInBatch: input.providerKeysInBatch,
  });

  const replay = replayApolloRunAcceptance({
    usageRows: searchRows,
    candidateRows: input.candidateRows,
    contractAcceptedCount: contrast.count,
  });

  const diagnostics: string[] = [];
  if (contrast.notComparableReason !== null) diagnostics.push(contrast.notComparableReason);
  if (replay.correlationBroken) diagnostics.push('apollo_acceptance_correlation_broken');
  if (credits.rowsWithUnknownCredits > 0) diagnostics.push('apollo_charged_row_without_credits');
  if (searchRows.length === 0) diagnostics.push('apollo_run_has_no_search_row');

  const row = buildCertificationBaselineRow({
    provider: 'apollo',
    providerOrder: input.providerOrder ?? null,
    wizardRunId: firstOrNull(input.usageRows.map((r) => r.wizard_run_id)),
    batchId: firstOrNull(input.usageRows.map((r) => r.batch_id)),
    certificationRunId: input.certificationRunId ?? null,
    country: firstOrNull(facts.map((f) => f.country)),
    macroIndustry: firstOrNull(facts.map((f) => f.macroIndustry)),
    requestFingerprint: firstOrNull(facts.map((f) => f.requestFingerprint)),
    pages: sumOrNull(facts.map((f) => f.pages)),
    credits: credits.total,
    creditsByOperation: credits.byOperation,
    latencyMs: resolveRunLatency(chargedRows),
    companiesSeen: sumOrNull(facts.map((f) => f.companiesSeen)),
    companiesAccepted: replay.candidatesAccepted,
    companiesAcceptedSource:
      replay.candidatesAccepted === null ? null : 'per_candidate_writer_trace',
    companiesRejected: sumOrNull(facts.map((f) => f.companiesRejected)),
    employeeCountKnown: null,
    identityResolved: sumOrNull(facts.map((f) => f.identityResolved)),
    dedupeRemoved: sumOrNull(facts.map((f) => f.dedupeRemoved)),
    dispositions: input.dispositions ?? null,
    startedAt: earliestCreatedAt(input.usageRows),
    // 🔴 `finished_at` NO se deriva del último `created_at`: ése es el INICIO de
    // la última operación, no el final de la corrida. Llamarlo final sería
    // mentir sobre un dato que el esquema simplemente no guarda.
    finishedAt: input.finishedAt ?? null,
  });

  return { row, credits, diagnostics, replay };
}

export interface LushaRunBaselineInput {
  readonly usageRows: readonly ProviderUsageLogLike[];
  readonly dispositions?: Readonly<Record<string, number>> | null;
  readonly providerOrder?: number | null;
  readonly certificationRunId?: string | null;
  readonly finishedAt?: string | null;
}

/**
 * La corrida de Lusha, entera.
 *
 * 🔴 `accepted_for_target_total` es un total DE CORRIDA. Con más de una fila
 * publicándolo no se suma —serían copias del mismo hecho— y tampoco se elige
 * una: se declara ausente y se dice por qué. En Producción hay exactamente una
 * fila por corrida (8 de 8), así que esta rama es una defensa, no el caso común.
 */
export function buildLushaRunCertificationBaseline(
  input: LushaRunBaselineInput,
): ProviderRunBaseline {
  const rows = input.usageRows.filter((r) =>
    (LUSHA_CHARGED_OPERATIONS as readonly string[]).includes(r.operation_key),
  );
  const facts = rows.map(readLushaRowFacts);
  const credits = summarizeChargedCredits(input.usageRows, LUSHA_CHARGED_OPERATIONS);

  const diagnostics: string[] = [];
  const publishedAcceptance = facts.filter((f) => f.companiesAccepted !== null);
  let companiesAccepted: number | null = null;
  if (publishedAcceptance.length === 1) {
    companiesAccepted = publishedAcceptance[0].companiesAccepted;
  } else if (publishedAcceptance.length > 1) {
    diagnostics.push('lusha_run_total_published_by_more_than_one_row');
  }
  if (credits.rowsWithUnknownCredits > 0) diagnostics.push('lusha_charged_row_without_credits');
  if (rows.length === 0) diagnostics.push('lusha_run_has_no_discovery_row');

  const row = buildCertificationBaselineRow({
    provider: 'lusha',
    providerOrder: input.providerOrder ?? null,
    wizardRunId: firstOrNull(input.usageRows.map((r) => r.wizard_run_id)),
    batchId: firstOrNull(input.usageRows.map((r) => r.batch_id)),
    certificationRunId: input.certificationRunId ?? null,
    country: firstOrNull(facts.map((f) => f.country)),
    macroIndustry: firstOrNull(facts.map((f) => f.macroIndustry)),
    requestFingerprint: firstOrNull(input.usageRows.map((r) => r.request_fingerprint)),
    pages: sumOrNull(facts.map((f) => f.pages)),
    credits: credits.total,
    creditsByOperation: credits.byOperation,
    latencyMs: resolveRunLatency(rows),
    companiesSeen: sumOrNull(facts.map((f) => f.companiesSeen)),
    companiesAccepted,
    companiesAcceptedSource: companiesAccepted === null ? null : 'provider_run_total',
    companiesRejected: sumOrNull(facts.map((f) => f.companiesRejected)),
    employeeCountKnown: null,
    identityResolved: null,
    dedupeRemoved: sumOrNull(facts.map((f) => f.dedupeRemoved)),
    dispositions: input.dispositions ?? null,
    startedAt: earliestCreatedAt(input.usageRows),
    finishedAt: input.finishedAt ?? null,
  });

  return { row, credits, diagnostics };
}

/**
 * usage-log-adapters.ts — de la fila de gasto que YA existe a la línea base
 * comparable.
 *
 * A1-CERTIFICATION-BASELINE § CUT-C.3 · A1-CERTIFICATION-READINESS §§ CUT-E.1,
 * E.3, E.4.
 *
 * Estos dos adaptadores son la PRUEBA de la auditoría: demuestran, campo por
 * campo, qué parte de la certificación es alcanzable hoy leyendo
 * `provider_usage_logs` —sin migración, sin corrida nueva y sin volver a pagar—
 * y qué parte no lo es.
 *
 * 🔴 Ninguno de los dos INVENTA. Un campo que su proveedor no publica sale
 * `null`, y `buildCertificationBaselineRow` lo nombra con su costura.
 *
 * ── 🔴 CUT-E.4 — las claves son las de PRODUCCIÓN, no las que parecían ───────
 *
 * La cabecera anterior afirmaba que estas formas estaban «verificadas contra
 * Producción». No lo estaban dentro de `lusha_run_observability.run`: el
 * adaptador leía `providerRequestsUsed` / `rawResultsTotal` /
 * `crossBranchDuplicatesRemoved` y la base persiste `provider_requests_used` /
 * `raw_results_total` / `cross_branch_duplicates_removed`. Los valores existían
 * —2 / 50 / 2 en la corrida `294298cd…`— y el adaptador devolvía `null`, así que
 * `pages` y `dedupe_removed` se publicaban como «ausentes» siendo falso.
 *
 * La suite no lo detectó porque su fixture copiaba la MISMA casing equivocada.
 * Por eso CUT-E.4 no arregla sólo la lectura: reescribe el fixture a la forma
 * real y añade una guarda estática sobre el código de este fichero.
 *
 * ── 🔴 CUT-E.1/E.3 — por qué hay overrides de CORRIDA ───────────────────────
 *
 * Una fila NO es una corrida. La aceptación la decide el writer agregando todas
 * las consultas, y el gasto se reparte entre varias operaciones cobradas. Los
 * dos son hechos de la CORRIDA, y por eso entran por `CertificationRunContext`,
 * que ya era el sitio declarado para lo que no vive en la fila. El mapeo de
 * campos sigue estando aquí y en un solo sitio: `run-baseline.ts` no lo repite,
 * lo alimenta.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin base de datos, sin reloj.
 */

import {
  buildCertificationBaselineRow,
  type CertificationAcceptanceSource,
  type CertificationBaselineInput,
  type CertificationBaselineRow,
} from './certification-baseline';

/** La fila de `provider_usage_logs` que hace falta. Estructural a propósito. */
export interface ProviderUsageLogLike {
  readonly provider_key: string;
  readonly operation_key: string;
  readonly credits_used: number | null;
  readonly results_returned: number | null;
  readonly duration_ms: number | null;
  readonly wizard_run_id: string | null;
  readonly request_fingerprint: string | null;
  readonly batch_id: string | null;
  readonly created_at: string | null;
  readonly metadata: Record<string, unknown> | null;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Contexto que NO vive en la fila de gasto y que el llamador debe aportar si lo
 * tiene. Ausente ⇒ el campo sale `null` y se nombra su costura.
 */
export interface CertificationRunContext {
  /** Hoy SIEMPRE `null`: el esquema no tiene dónde guardarlo. */
  readonly certificationRunId?: string | null;
  /** Derivado de ordenar por `created_at` las filas del mismo `wizard_run_id`. */
  readonly providerOrder?: number | null;
  /** Conteo por disposición leído de `prospect_discarded_dispositions`. */
  readonly dispositions?: Readonly<Record<string, number>> | null;
  readonly finishedAt?: string | null;
  // ── Hechos de CORRIDA (CUT-E.1 / E.3) ──────────────────────────────────────
  /**
   * 🔴 CUT-E.1 — las aceptadas de la corrida, ya resueltas por su autoridad.
   *
   * Presente ⇒ MANDA sobre lo que traiga la fila. No es una preferencia
   * estética: para Apollo la fila publica `null` por contrato (la aceptación es
   * de la corrida y la fila es por consulta), así que sin este canal la cifra no
   * puede llegar sin duplicarse entre las filas de búsqueda.
   */
  readonly companiesAccepted?: number | null;
  /** Qué autoridad produjo la cifra de arriba. Ver `CertificationAcceptanceSource`. */
  readonly companiesAcceptedSource?: CertificationAcceptanceSource | null;
  /** 🔴 CUT-E.3 — el gasto de la CORRIDA, sumando todas sus operaciones cobradas. */
  readonly credits?: number | null;
  /** Desglose `operation_key → créditos` del total de arriba. */
  readonly creditsByOperation?: Readonly<Record<string, number>> | null;
}

// ─── Lectores de fila: la ÚNICA autoridad de extracción ──────────────────────

/**
 * Los hechos que UNA fila de `apollo/organizations_search` publica.
 *
 * 🔴 Se exporta porque `run-baseline.ts` tiene que sumarlos entre las filas de
 * la corrida. Que sume lo que este lector devuelve —en vez de volver a hurgar en
 * `metadata`— es lo que impide que aparezca una segunda forma de leer la misma
 * fila.
 */
export interface ApolloSearchRowFacts {
  readonly country: string | null;
  readonly macroIndustry: string | null;
  readonly requestFingerprint: string | null;
  readonly pages: number | null;
  readonly companiesSeen: number | null;
  readonly companiesAccepted: number | null;
  readonly companiesRejected: number | null;
  readonly identityResolved: number | null;
  readonly dedupeRemoved: number | null;
  readonly latencyMs: number | null;
  readonly credits: number | null;
}

export function readApolloSearchRowFacts(log: ProviderUsageLogLike): ApolloSearchRowFacts {
  const meta = obj(log.metadata) ?? {};
  const funnel = obj(meta.apollo_benchmark_funnel) ?? {};
  const pagination = obj(meta.apollo_pagination) ?? {};
  const normalization = obj(pagination.normalization) ?? {};

  return {
    country: str(meta.countryCode) ?? str(meta.country),
    macroIndustry: str(meta.industry),
    requestFingerprint:
      log.request_fingerprint ?? str(pagination.effective_request_fingerprint_sent),
    pages: num(pagination.pages_processed),
    companiesSeen: num(funnel.paid_raw) ?? num(log.results_returned),
    // 🔴 El campo caro. Apollo lo publica `null` POR CONTRATO: la aceptación la
    // decide el writer agregando todas las consultas, y esta fila es UNA
    // consulta. Estampar aquí el total de la corrida duplicaría la cifra entre
    // las 2 filas de búsqueda que Producción tiene por corrida. No se sustituye
    // por `unique` ni por `results_returned` — serían OTRA pregunta con el mismo
    // nombre. La cifra correcta entra por `CertificationRunContext`.
    companiesAccepted: num(funnel.accepted_for_target),
    companiesRejected: num(funnel.precision_rejected),
    identityResolved: num(funnel.unique),
    dedupeRemoved: num(funnel.duplicate) ?? num(normalization.duplicates_removed_count),
    latencyMs: num(log.duration_ms),
    credits: num(log.credits_used),
  };
}

/**
 * Los hechos que UNA fila de `lusha/company_prospecting_v3` publica.
 *
 * 🔴 CUT-E.4 — todas las claves de `run` son snake_case. Así es como la base las
 * guarda; verificado leyendo la fila real de la corrida `294298cd…`.
 */
export interface LushaRowFacts {
  readonly country: string | null;
  readonly macroIndustry: string | null;
  readonly pages: number | null;
  readonly companiesSeen: number | null;
  readonly companiesAccepted: number | null;
  readonly companiesRejected: number | null;
  readonly dedupeRemoved: number | null;
  readonly latencyMs: number | null;
  readonly credits: number | null;
}

export function readLushaRowFacts(log: ProviderUsageLogLike): LushaRowFacts {
  const meta = obj(log.metadata) ?? {};
  const o = obj(meta.lusha_run_observability) ?? {};
  const run = obj(o.run) ?? {};

  const rejected =
    num(o.precision_rejected) !== null ||
    num(o.exact_duplicates) !== null ||
    num(o.target_overflow_discarded) !== null
      ? (num(o.precision_rejected) ?? 0) +
        (num(o.exact_duplicates) ?? 0) +
        (num(o.target_overflow_discarded) ?? 0)
      : null;

  return {
    country: str(o.country_code),
    macroIndustry: str(o.macro_industry_key),
    pages: num(run.provider_requests_used),
    companiesSeen: num(run.raw_results_total) ?? num(log.results_returned),
    // 🔴 Lusha SÍ lo publica. Ésa es exactamente la asimetría con Apollo que la
    // certificación tiene que ver declarada —en `companies_accepted_source`— en
    // vez de descubrirla al comparar.
    companiesAccepted: num(o.accepted_for_target_total),
    companiesRejected: rejected,
    dedupeRemoved: num(run.cross_branch_duplicates_removed),
    latencyMs: num(log.duration_ms),
    credits: num(o.credits_settled) ?? num(log.credits_used),
  };
}

// ─── Resolución de la aceptación y su procedencia ────────────────────────────

/**
 * Combina lo que la fila trae con lo que la corrida ya resolvió, y DECLARA cuál
 * de las dos ganó.
 *
 * 🔴 La procedencia es `null` exactamente cuando la cifra es `null`, nunca en
 * otro caso: un número sin dueño no se puede auditar, y un dueño sin número es
 * una afirmación sobre algo que no se midió.
 */
function resolveAcceptance(
  fromRow: number | null,
  context: CertificationRunContext,
  rowSource: CertificationAcceptanceSource,
): { readonly value: number | null; readonly source: CertificationAcceptanceSource | null } {
  const fromContext = context.companiesAccepted ?? null;
  if (fromContext !== null) {
    return {
      value: fromContext,
      source: context.companiesAcceptedSource ?? 'per_candidate_writer_trace',
    };
  }
  return fromRow === null ? { value: null, source: null } : { value: fromRow, source: rowSource };
}

// ─── Adaptadores por proveedor ───────────────────────────────────────────────

/** Apollo: `provider_key='apollo'`, `operation_key='organizations_search'`. */
export function apolloUsageLogToCertificationBaseline(
  log: ProviderUsageLogLike,
  context: CertificationRunContext = {},
): CertificationBaselineRow {
  const facts = readApolloSearchRowFacts(log);
  const accepted = resolveAcceptance(facts.companiesAccepted, context, 'provider_run_total');

  const input: CertificationBaselineInput = {
    provider: 'apollo',
    providerOrder: context.providerOrder ?? null,
    wizardRunId: log.wizard_run_id,
    batchId: log.batch_id,
    certificationRunId: context.certificationRunId ?? null,
    country: facts.country,
    macroIndustry: facts.macroIndustry,
    requestFingerprint: facts.requestFingerprint,
    pages: facts.pages,
    credits: context.credits ?? facts.credits,
    creditsByOperation: context.creditsByOperation ?? null,
    latencyMs: facts.latencyMs,
    companiesSeen: facts.companiesSeen,
    companiesAccepted: accepted.value,
    companiesAcceptedSource: accepted.source,
    companiesRejected: facts.companiesRejected,
    // El conteo de empleados vive en el candidato escrito, no en la fila de
    // gasto: desde aquí no es observable.
    employeeCountKnown: null,
    identityResolved: facts.identityResolved,
    dedupeRemoved: facts.dedupeRemoved,
    dispositions: context.dispositions ?? null,
    startedAt: log.created_at,
    finishedAt: context.finishedAt ?? null,
  };
  return buildCertificationBaselineRow(input);
}

/** Lusha: `provider_key='lusha'`, `operation_key='company_prospecting_v3'`. */
export function lushaUsageLogToCertificationBaseline(
  log: ProviderUsageLogLike,
  context: CertificationRunContext = {},
): CertificationBaselineRow {
  const facts = readLushaRowFacts(log);
  const accepted = resolveAcceptance(facts.companiesAccepted, context, 'provider_run_total');

  const input: CertificationBaselineInput = {
    provider: 'lusha',
    providerOrder: context.providerOrder ?? null,
    wizardRunId: log.wizard_run_id,
    batchId: log.batch_id,
    certificationRunId: context.certificationRunId ?? null,
    country: facts.country,
    macroIndustry: facts.macroIndustry,
    requestFingerprint: log.request_fingerprint,
    pages: facts.pages,
    credits: context.credits ?? facts.credits,
    creditsByOperation: context.creditsByOperation ?? null,
    latencyMs: facts.latencyMs,
    companiesSeen: facts.companiesSeen,
    companiesAccepted: accepted.value,
    companiesAcceptedSource: accepted.source,
    companiesRejected: facts.companiesRejected,
    employeeCountKnown: null,
    identityResolved: null,
    dedupeRemoved: facts.dedupeRemoved,
    dispositions: context.dispositions ?? null,
    startedAt: log.created_at,
    finishedAt: context.finishedAt ?? null,
  };
  return buildCertificationBaselineRow(input);
}

/**
 * Deriva `provider_order` ordenando por reloj las filas de un mismo
 * `wizard_run_id`. Puro.
 *
 * 🔴 Se expone porque es el ÚNICO camino disponible hoy, no porque sea bueno:
 * dos filas del mismo instante quedan en orden de entrada, y este módulo no
 * puede saber cuál pierna corrió primero. La costura queda nombrada en
 * `CERT_SEAM_PROVIDER_ORDER_DERIVED_FROM_CLOCK`.
 */
export function deriveProviderOrder(
  logs: readonly ProviderUsageLogLike[],
): ReadonlyMap<ProviderUsageLogLike, number> {
  const sorted = [...logs].sort((a, b) => {
    const ta = a.created_at ?? '';
    const tb = b.created_at ?? '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  return new Map(sorted.map((log, index) => [log, index + 1]));
}

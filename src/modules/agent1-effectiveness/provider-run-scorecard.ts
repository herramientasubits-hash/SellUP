// AGENT1-PROVIDER-RUN-SCORECARD-1 — la ficha por CORRIDA y PROVEEDOR.
//
// El read model de efectividad existente es por LOTE. Para comparar a Apollo
// con Lusha hace falta otra unidad: la corrida de un proveedor. No coinciden
// porque:
//
//   · una corrida de Lusha que lo rechaza todo NO crea lote — sólo deja su log
//     de uso (2026-09-24, CO × Consumo Masivo: 4 créditos, 0 aceptadas);
//   · en la cascada, Apollo y la pierna Lusha comparten UN lote, y el log de la
//     pierna se escribe con `batch_id` NULL;
//   · el coste de Apollo vive en el libro de la corrida
//     (`apollo_run_budget.ledger`); `provider_attempts.credits_used` sólo cuenta
//     las páginas de búsqueda.
//
// 🔴 Principios, los mismos que el resto de la medición de Agente 1:
//
//   · la aceptación sale de `accepted_for_target` —del lote, de la traza de la
//     pierna o del log de Lusha—, nunca de `stop_reason` ni de las filas;
//   · lo que no se puede atribuir se DECLARA en `gaps`, nunca se deduce: en un
//     lote de cascada la aceptación de Apollo no se obtiene restando;
//   · un dato de la base que no es una cuenta válida no se convierte en cero.
//
// Puro: sin env, sin I/O, sin reloj, sin proveedor.

export type ScorecardProvider = 'apollo' | 'lusha';

/** `prospect_batches`, reducido a lo que la ficha lee. */
export type ScorecardBatchInput = {
  id: string;
  createdAt: string;
  countryCode: string | null;
  industry: string | null;
  metadata: Record<string, unknown> | null;
};

/** `provider_usage_logs`, reducido a lo que la ficha lee. */
export type ScorecardUsageLogInput = {
  id: string;
  createdAt: string;
  providerKey: string;
  operationKey: string | null;
  batchId: string | null;
  creditsUsed: number | string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Filas persistidas (`prospect_candidates`) o descartadas
 * (`prospect_discarded_dispositions`) de un lote, ya agrupadas por proveedor.
 */
export type ScorecardOutcomeCount = {
  batchId: string;
  sourcePrimary: string | null;
  kind: 'candidate' | 'discard';
  disposition: string | null;
  count: number;
};

/** Precio por crédito aplicado. `source` dice de dónde salió. */
export type ScorecardPrice = {
  providerKey: ScorecardProvider;
  unitCostUsd: number;
  source: string;
};

export type ScorecardGap =
  /** Una operación del libro de Apollo no está liquidada: el coste es parcial. */
  | 'apollo_ledger_unsettled'
  /** El lote de Apollo no tiene libro: no hay coste fiable. */
  | 'apollo_ledger_missing'
  /** El coste de la fuente principal no coincide con la suma de los logs de uso. */
  | 'credits_mismatch_usage_logs'
  /** Apollo no mide cuántas empresas ya conocía el proveedor. */
  | 'provider_seen_not_measured'
  /** Corrida sin lote: sus descartes no quedaron registrados de forma durable. */
  | 'no_batch_dispositions_not_durable'
  /** El lote no publicó `accepted_for_target` (p. ej. `c681bfcd`). */
  | 'accepted_for_target_missing'
  /** Lote de cascada: la aceptación es del lote, no se atribuye por proveedor. */
  | 'shared_batch_acceptance_not_attributable'
  /** La aceptación publicada es una cota inferior, no un conteo. */
  | 'acceptance_lower_bound'
  /** Empresas distintas sin destino registrado. */
  | 'unaccounted_companies'
  /** Más destinos que empresas distintas: algo se contó dos veces. */
  | 'destinations_exceed_unique'
  /** No hay precio para el proveedor: no hay coste en dólares. */
  | 'price_missing';

export type ScorecardAcceptanceSource =
  | 'batch_accepted_for_target'
  | 'waterfall_leg_trace'
  | 'lusha_usage_log';

export type ScorecardCreditsSource =
  | 'apollo_run_budget_ledger'
  | 'lusha_batch_billing'
  | 'lusha_usage_log';

export type ProviderRunScorecardRow = {
  /** `batch:<id>:<proveedor>` o `log:<id>`: estable y único. */
  runKey: string;
  provider: ScorecardProvider;
  role: 'standalone' | 'waterfall_leg';
  batchId: string | null;
  createdAt: string;
  countryCode: string | null;
  /** Industria del lote o, sin lote, la macro que declara el log. */
  industry: string | null;
  credits: number | null;
  creditsSource: ScorecardCreditsSource | null;
  unitCostUsd: number | null;
  priceSource: string | null;
  costUsd: number | null;
  rawResults: number | null;
  uniqueResults: number | null;
  /** Empresas que la memoria del proveedor ya había visto. `null` = no medido. */
  alreadySeenByProvider: number | null;
  persisted: number | null;
  /** `null` cuando no hay registro durable, que no es lo mismo que cero. */
  discarded: number | null;
  discardsByDisposition: Record<string, number>;
  acceptedForTarget: number | null;
  acceptanceSource: ScorecardAcceptanceSource | null;
  /**
   * Empresas distintas menos destinos registrados. Positivo = faltan destinos;
   * negativo = sobran (algo se contó dos veces). `null` = no se puede calcular.
   */
  unaccountedCompanies: number | null;
  costPerAccepted: number | null;
  costPerPersisted: number | null;
  gaps: ScorecardGap[];
};

/** Las operaciones de Lusha que son descubrimiento de empresas (Agente 1). */
const LUSHA_COMPANY_DISCOVERY_OPERATIONS: ReadonlySet<string> = new Set(['company_prospecting_v3']);

// ── Lectura defensiva ────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Una cuenta: número finito y no negativo. Texto numérico de Postgres vale. */
function readCount(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  if (values.some((v) => v === null)) return null;
  return values.reduce<number>((total, v) => total + (v ?? 0), 0);
}

function divideOrNull(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

// ── Piezas por fuente ────────────────────────────────────────────────────────

function primaryProvider(metadata: Record<string, unknown> | null): ScorecardProvider | null {
  const attempts = metadata?.['provider_attempts'];
  if (!Array.isArray(attempts)) return null;
  for (const attempt of attempts) {
    const record = asRecord(attempt);
    if (record?.['role'] !== 'primary') continue;
    const provider = record['provider'];
    if (provider === 'apollo' || provider === 'lusha') return provider;
  }
  return null;
}

function apolloLedgerCredits(metadata: Record<string, unknown>): {
  credits: number | null;
  gaps: ScorecardGap[];
} {
  const ledger = asRecord(asRecord(metadata['apollo_run_budget'])?.['ledger']);
  const entries = ledger?.['entries'];
  if (!Array.isArray(entries)) return { credits: null, gaps: ['apollo_ledger_missing'] };
  let credits = 0;
  let unsettled = false;
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;
    if (record['state'] !== 'settled') {
      unsettled = true;
      continue;
    }
    credits += readCount(record['settledCredits']) ?? 0;
  }
  return { credits, gaps: unsettled ? ['apollo_ledger_unsettled'] : [] };
}

type AcceptanceRead = {
  accepted: number | null;
  gaps: ScorecardGap[];
};

/** La parte de PAGO del bloque `accepted_for_target` de un lote. */
function batchPaidAcceptance(metadata: Record<string, unknown>): AcceptanceRead {
  const block = asRecord(metadata['accepted_for_target']);
  if (!block) return { accepted: null, gaps: ['accepted_for_target_missing'] };
  const accepted = readCount(block['accepted_paid_for_target']);
  if (accepted === null) return { accepted: null, gaps: ['accepted_for_target_missing'] };
  const lowerBound =
    block['accepted_count_kind'] === 'lower_bound' || block['paid_acceptance_measured'] === false;
  return { accepted, gaps: lowerBound ? ['acceptance_lower_bound'] : [] };
}

type LushaRunRead = {
  raw: number | null;
  unique: number | null;
  knownSeed: number;
  alreadySeen: number | null;
  accepted: number | null;
  countryCode: string | null;
  macroKey: string | null;
};

function readLushaObservability(metadata: Record<string, unknown> | null): LushaRunRead {
  const observability = asRecord(metadata?.['lusha_run_observability']);
  const run = asRecord(observability?.['run']);
  const duplicates = asRecord(run?.['duplicate_reason_counts']);
  const yieldRows = asRecord(run?.['provider_seen'])?.['branch_page_novelty_yield'];
  const alreadySeen = Array.isArray(yieldRows)
    ? sumOrNull(yieldRows.map((y) => readCount(asRecord(y)?.['provider_seen_hits'])))
    : null;
  return {
    raw: readCount(run?.['raw_results_total']),
    unique: readCount(run?.['unique_results_total']),
    knownSeed: readCount(duplicates?.['known_domain_seed']) ?? 0,
    alreadySeen,
    accepted: readCount(run?.['accepted_for_target_total']),
    countryCode: readString(observability?.['country_code']),
    macroKey: readString(observability?.['macro_industry_key']),
  };
}

function clientRequestIdOf(log: ScorecardUsageLogInput): string | null {
  return readString(asRecord(log.metadata?.['run_correlation'])?.['client_request_id']);
}

type OutcomeTotals = {
  persisted: number;
  discarded: number;
  byDisposition: Record<string, number>;
};

function outcomeTotals(
  counts: readonly ScorecardOutcomeCount[],
  batchId: string,
  provider: ScorecardProvider,
): OutcomeTotals {
  const totals: OutcomeTotals = { persisted: 0, discarded: 0, byDisposition: {} };
  for (const c of counts) {
    if (c.batchId !== batchId || c.sourcePrimary !== provider) continue;
    const n = readCount(c.count) ?? 0;
    if (c.kind === 'candidate') {
      totals.persisted += n;
    } else {
      totals.discarded += n;
      const key = c.disposition ?? 'unknown';
      totals.byDisposition[key] = (totals.byDisposition[key] ?? 0) + n;
    }
  }
  return totals;
}

function usageCredits(
  logs: readonly ScorecardUsageLogInput[],
  batchId: string,
  provider: ScorecardProvider,
): number | null {
  const own = logs.filter((l) => l.batchId === batchId && l.providerKey === provider);
  if (own.length === 0) return null;
  return sumOrNull(own.map((l) => readCount(l.creditsUsed)));
}

// ── Composición de una fila ──────────────────────────────────────────────────

type RowDraft = Omit<
  ProviderRunScorecardRow,
  'unitCostUsd' | 'priceSource' | 'costUsd' | 'costPerAccepted' | 'costPerPersisted'
>;

function priced(draft: RowDraft, prices: readonly ScorecardPrice[]): ProviderRunScorecardRow {
  const price = prices.find(
    (p) => p.providerKey === draft.provider && readCount(p.unitCostUsd) !== null,
  );
  const gaps = [...draft.gaps];
  if (!price) gaps.push('price_missing');
  const costUsd = price && draft.credits !== null ? draft.credits * price.unitCostUsd : null;
  return {
    ...draft,
    gaps,
    unitCostUsd: price?.unitCostUsd ?? null,
    priceSource: price?.source ?? null,
    costUsd,
    costPerAccepted: divideOrNull(costUsd, draft.acceptedForTarget),
    costPerPersisted: divideOrNull(costUsd, draft.persisted),
  };
}

function unaccounted(
  expectedDestinations: number | null,
  totals: OutcomeTotals,
  gaps: ScorecardGap[],
): number | null {
  if (expectedDestinations === null) return null;
  const difference = expectedDestinations - totals.persisted - totals.discarded;
  if (difference > 0) gaps.push('unaccounted_companies');
  if (difference < 0) gaps.push('destinations_exceed_unique');
  return difference;
}

function apolloRow(
  batch: ScorecardBatchInput,
  metadata: Record<string, unknown>,
  input: ProviderRunScorecardInput,
  legExecuted: boolean,
): RowDraft {
  const { credits, gaps } = apolloLedgerCredits(metadata);
  const logged = usageCredits(input.usageLogs, batch.id, 'apollo');
  if (credits !== null && logged !== null && Math.abs(credits - logged) > 1e-9) {
    gaps.push('credits_mismatch_usage_logs');
  }
  const runMetrics = asRecord(asRecord(metadata['apollo_two_round_discovery'])?.['run_metrics']);
  const unique = readCount(runMetrics?.['total_unique_organizations']);
  const totals = outcomeTotals(input.outcomeCounts, batch.id, 'apollo');

  let accepted: number | null = null;
  let acceptanceSource: ScorecardAcceptanceSource | null = null;
  if (legExecuted) {
    // 🔴 El bloque del lote suma Apollo + pierna Lusha. Restar la pierna sería
    // una segunda aritmética de aceptación, acotada por reglas que no viven aquí.
    gaps.push('shared_batch_acceptance_not_attributable');
  } else {
    const read = batchPaidAcceptance(metadata);
    accepted = read.accepted;
    acceptanceSource = read.accepted === null ? null : 'batch_accepted_for_target';
    gaps.push(...read.gaps);
  }
  gaps.push('provider_seen_not_measured');

  return {
    runKey: `batch:${batch.id}:apollo`,
    provider: 'apollo',
    role: 'standalone',
    batchId: batch.id,
    createdAt: batch.createdAt,
    countryCode: batch.countryCode,
    industry: batch.industry,
    credits,
    creditsSource: credits === null ? null : 'apollo_run_budget_ledger',
    rawResults: readCount(runMetrics?.['total_raw_results']),
    uniqueResults: unique,
    alreadySeenByProvider: null,
    persisted: totals.persisted,
    discarded: totals.discarded,
    discardsByDisposition: totals.byDisposition,
    acceptedForTarget: accepted,
    acceptanceSource,
    unaccountedCompanies: unaccounted(unique, totals, gaps),
    gaps,
  };
}

function lushaStandaloneBatchRow(
  batch: ScorecardBatchInput,
  metadata: Record<string, unknown>,
  input: ProviderRunScorecardInput,
  log: ScorecardUsageLogInput | null,
): RowDraft {
  const gaps: ScorecardGap[] = [];
  const billed = readCount(asRecord(metadata['billing'])?.['credits_charged']);
  const logged = usageCredits(input.usageLogs, batch.id, 'lusha');
  const credits = billed ?? logged;
  if (billed !== null && logged !== null && Math.abs(billed - logged) > 1e-9) {
    gaps.push('credits_mismatch_usage_logs');
  }
  const run = readLushaObservability(log?.metadata ?? null);
  const totals = outcomeTotals(input.outcomeCounts, batch.id, 'lusha');
  const read = batchPaidAcceptance(metadata);
  gaps.push(...read.gaps);
  // La semilla de dominios conocidos se cuenta como duplicado ANTES de las
  // únicas, pero sí recibe disposición: es un destino más.
  const expected = run.unique === null ? null : run.unique + run.knownSeed;

  return {
    runKey: `batch:${batch.id}:lusha`,
    provider: 'lusha',
    role: 'standalone',
    batchId: batch.id,
    createdAt: batch.createdAt,
    countryCode: batch.countryCode,
    industry: batch.industry,
    credits,
    creditsSource:
      billed !== null ? 'lusha_batch_billing' : logged !== null ? 'lusha_usage_log' : null,
    rawResults: run.raw,
    uniqueResults: run.unique,
    alreadySeenByProvider: run.alreadySeen,
    persisted: totals.persisted,
    discarded: totals.discarded,
    discardsByDisposition: totals.byDisposition,
    acceptedForTarget: read.accepted,
    acceptanceSource: read.accepted === null ? null : 'batch_accepted_for_target',
    unaccountedCompanies: unaccounted(expected, totals, gaps),
    gaps,
  };
}

function lushaLogRow(
  log: ScorecardUsageLogInput,
  input: ProviderRunScorecardInput,
  legBatch: ScorecardBatchInput | null,
): RowDraft {
  const gaps: ScorecardGap[] = [];
  const run = readLushaObservability(log.metadata);
  const credits = readCount(log.creditsUsed);

  if (legBatch) {
    const leg = asRecord(asRecord(legBatch.metadata)?.['lusha_waterfall_leg']);
    const accepted = readCount(leg?.['acceptedForTarget']);
    if (accepted === null) gaps.push('accepted_for_target_missing');
    const totals = outcomeTotals(input.outcomeCounts, legBatch.id, 'lusha');
    const expected = run.unique === null ? null : run.unique + run.knownSeed;
    return {
      runKey: `log:${log.id}`,
      provider: 'lusha',
      role: 'waterfall_leg',
      batchId: legBatch.id,
      createdAt: log.createdAt,
      countryCode: legBatch.countryCode,
      industry: legBatch.industry,
      credits,
      creditsSource: credits === null ? null : 'lusha_usage_log',
      rawResults: run.raw,
      uniqueResults: run.unique,
      alreadySeenByProvider: run.alreadySeen,
      persisted: totals.persisted,
      discarded: totals.discarded,
      discardsByDisposition: totals.byDisposition,
      acceptedForTarget: accepted,
      acceptanceSource: accepted === null ? null : 'waterfall_leg_trace',
      unaccountedCompanies: unaccounted(expected, totals, gaps),
      gaps,
    };
  }

  // Corrida standalone que no creó lote: se rechazó todo antes de persistir.
  gaps.push('no_batch_dispositions_not_durable');
  if (run.accepted === null) gaps.push('accepted_for_target_missing');
  return {
    runKey: `log:${log.id}`,
    provider: 'lusha',
    role: 'standalone',
    batchId: null,
    createdAt: log.createdAt,
    countryCode: run.countryCode,
    industry: run.macroKey,
    credits,
    creditsSource: credits === null ? null : 'lusha_usage_log',
    rawResults: run.raw,
    uniqueResults: run.unique,
    alreadySeenByProvider: run.alreadySeen,
    persisted: 0,
    discarded: null,
    discardsByDisposition: {},
    acceptedForTarget: run.accepted,
    acceptanceSource: run.accepted === null ? null : 'lusha_usage_log',
    unaccountedCompanies: null,
    gaps,
  };
}

// ── API pública ──────────────────────────────────────────────────────────────

export type ProviderRunScorecardInput = {
  batches: readonly ScorecardBatchInput[];
  usageLogs: readonly ScorecardUsageLogInput[];
  outcomeCounts: readonly ScorecardOutcomeCount[];
  prices: readonly ScorecardPrice[];
};

/**
 * Una fila por corrida de proveedor. Orden: el de creación.
 *
 * Cada log de Lusha de descubrimiento produce UNA fila y sólo una: si su lote
 * existe, la fila es la del lote; si pertenece a una cascada, es la pierna; si
 * no, es una corrida sin lote.
 */
export function buildProviderRunScorecard(
  input: ProviderRunScorecardInput,
): ProviderRunScorecardRow[] {
  const drafts: RowDraft[] = [];
  const legBatchByClientRequestId = new Map<string, ScorecardBatchInput>();
  for (const batch of input.batches) {
    const leg = asRecord(asRecord(batch.metadata)?.['lusha_waterfall_leg']);
    const clientRequestId = readString(leg?.['clientRequestId']);
    if (leg?.['executed'] === true && clientRequestId) {
      legBatchByClientRequestId.set(clientRequestId, batch);
    }
  }

  const lushaLogs = input.usageLogs.filter(
    (l) =>
      l.providerKey === 'lusha' && LUSHA_COMPANY_DISCOVERY_OPERATIONS.has(l.operationKey ?? ''),
  );
  const consumedLogIds = new Set<string>();

  for (const batch of input.batches) {
    const metadata = asRecord(batch.metadata);
    if (!metadata) continue;
    const provider = primaryProvider(metadata);
    if (provider === 'apollo') {
      const legExecuted = asRecord(metadata['lusha_waterfall_leg'])?.['executed'] === true;
      drafts.push(apolloRow(batch, metadata, input, legExecuted));
    } else if (provider === 'lusha') {
      const log = lushaLogs.find((l) => l.batchId === batch.id) ?? null;
      if (log) consumedLogIds.add(log.id);
      drafts.push(lushaStandaloneBatchRow(batch, metadata, input, log));
    }
  }

  for (const log of lushaLogs) {
    if (consumedLogIds.has(log.id)) continue;
    // Un log CON lote ya se contó con su lote, o su lote cae fuera de la ventana.
    // En ninguno de los dos casos es una corrida sin lote, y no se inventa como tal.
    if (log.batchId !== null) continue;
    const clientRequestId = clientRequestIdOf(log);
    const legBatch = clientRequestId
      ? (legBatchByClientRequestId.get(clientRequestId) ?? null)
      : null;
    drafts.push(lushaLogRow(log, input, legBatch));
  }

  return drafts
    .map((d) => priced(d, input.prices))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type ProviderScorecardTotals = {
  runs: number;
  /** Corridas con al menos un hueco declarado: sus totales son parciales. */
  runsWithGaps: number;
  credits: number;
  costUsd: number | null;
  persisted: number;
  acceptedForTarget: number;
  costPerAccepted: number | null;
};

export type ProviderRunScorecardSummary = {
  byProvider: Record<ScorecardProvider, ProviderScorecardTotals>;
};

/**
 * Totales por proveedor. Suma lo conocido y CUENTA lo que no lo es: una fila con
 * huecos suma lo que tiene y queda reflejada en `runsWithGaps`. Los huecos de
 * «no medido por diseño» (`provider_seen_not_measured`) no cuentan como parciales.
 */
export function summarizeProviderRunScorecard(
  rows: readonly ProviderRunScorecardRow[],
): ProviderRunScorecardSummary {
  const empty = (): ProviderScorecardTotals => ({
    runs: 0,
    runsWithGaps: 0,
    credits: 0,
    costUsd: 0,
    persisted: 0,
    acceptedForTarget: 0,
    costPerAccepted: null,
  });
  const byProvider: Record<ScorecardProvider, ProviderScorecardTotals> = {
    apollo: empty(),
    lusha: empty(),
  };
  for (const row of rows) {
    const totals = byProvider[row.provider];
    totals.runs += 1;
    if (row.gaps.some((g) => g !== 'provider_seen_not_measured')) totals.runsWithGaps += 1;
    totals.credits += row.credits ?? 0;
    totals.costUsd =
      totals.costUsd === null || row.costUsd === null ? null : totals.costUsd + row.costUsd;
    totals.persisted += row.persisted ?? 0;
    totals.acceptedForTarget += row.acceptedForTarget ?? 0;
  }
  for (const totals of Object.values(byProvider)) {
    totals.costPerAccepted = divideOrNull(totals.costUsd, totals.acceptedForTarget);
  }
  return { byProvider };
}

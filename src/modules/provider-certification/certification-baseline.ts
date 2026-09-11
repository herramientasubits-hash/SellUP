/**
 * certification-baseline.ts — la línea base COMPARABLE de una corrida de
 * descubrimiento de empresas, para poder evaluar un proveedor nuevo contra
 * Apollo y Lusha SIN volver a pagarles.
 *
 * A1-CERTIFICATION-BASELINE § CUT-C.3.
 *
 * ── El problema que resuelve ─────────────────────────────────────────────────
 *
 * Los datos de una corrida YA se persisten. Lo que no existe es una forma
 * COMPARABLE de leerlos: Apollo y Lusha publican en
 * `provider_usage_logs.metadata` dos vocabularios distintos para las mismas
 * preguntas —`apollo_benchmark_funnel` / `apollo_pagination` / `apollo_paid_volume`
 * frente a `lusha_run_observability`—, con nombres, anidamiento y unidades
 * propios. Comparar hoy exige un traductor ad-hoc por proveedor, escrito de nuevo
 * cada vez, que es exactamente donde se cuelan las comparaciones falsas.
 *
 * Este módulo es ese traductor, UNO solo, y el contrato que un proveedor NUEVO
 * tendrá que rellenar para entrar en la comparación. Añadir un cuarto proveedor
 * es escribir su adaptador, no volver a correr los tres anteriores.
 *
 * ── 🔴 La regla que gobierna este módulo entero ──────────────────────────────
 *
 * Es la MISMA de `apollo-benchmark-funnel.ts`, y no por copiarla: un campo que la
 * corrida no puede producir con verdad se publica `null` y se NOMBRA en
 * `fields_missing`, junto con la costura exacta que falta. Jamás como 0.
 *
 * Un 0 dice «lo medimos y salió cero». Un null dice «no lo medimos». Colapsar el
 * segundo en el primero es lo que hace que una certificación elija el proveedor
 * equivocado con total confianza.
 *
 * ── 🔴 Lo que este módulo NO hace ────────────────────────────────────────────
 *
 * No escribe. No lee de base de datos. No llama a ningún proveedor. No define
 * tabla ni migración: PROYECTA lo que ya existe. El diseño de la migración
 * mínima —y por qué todavía no se ejecuta— vive en
 * `docs/CERTIFICATION_BASELINE.md`.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

/** Proveedores de descubrimiento de empresas que hoy se pueden certificar. */
export const CERTIFIABLE_PROVIDERS = ['apollo', 'lusha'] as const;
export type CertifiableProvider = (typeof CERTIFIABLE_PROVIDERS)[number];

/**
 * Cómo se obtuvo cada cifra. Vocabulario IDÉNTICO al de
 * `apollo-benchmark-funnel.ts` — dos escalas distintas para la misma idea harían
 * incomparables los propios informes de comparabilidad.
 */
export type CertificationFieldSource = 'observed' | 'derived' | 'missing';

/** Los campos que la certificación necesita de CADA corrida y proveedor. */
export const CERTIFICATION_BASELINE_FIELDS = [
  // ── Identidad de la corrida ──
  'certification_run_id',
  'wizard_run_id',
  'batch_id',
  'provider',
  'provider_order',
  'country',
  'macro_industry',
  'request_fingerprint',
  // ── Economía y esfuerzo ──
  'pages',
  'credits',
  'latency_ms',
  // ── Embudo de empresas ──
  'companies_seen',
  'companies_accepted',
  'companies_rejected',
  // ── Calidad de la empresa ──
  'employee_count_known',
  'identity_resolved',
  'dedupe_removed',
  'dispositions',
  // ── Tiempo ──
  'started_at',
  'finished_at',
] as const;

export type CertificationBaselineField = (typeof CERTIFICATION_BASELINE_FIELDS)[number];

// ─── Costuras que faltan, nombradas ───────────────────────────────────────────

/**
 * 🔴 La costura MÁS cara de todas, y la razón por la que hoy el rendimiento útil
 * de Apollo NO es calculable desde su fila de gasto.
 *
 * `apollo_benchmark_funnel.accepted_for_target` sale `null` en Producción: 16 de
 * 16 filas medidas el 11-09-2026. Su propio bloque ya lo declara con esta misma
 * costura. Lusha SÍ lo publica (`accepted_for_target_total`), así que la
 * comparación de «útiles por crédito» entre los dos proveedores es, hoy,
 * imposible sin inventarse el numerador de uno de los dos.
 */
export const CERT_SEAM_ACCEPTED_NOT_CORRELATED =
  'target_satisfaction_decided_by_candidate_writer_across_all_queries_not_correlated_back_to_search_usage_row' as const;

/**
 * No existe ninguna columna ni clave `certification_run_id` en el esquema
 * (verificado contra Producción: 0 tablas y 0 columnas que la nombren).
 *
 * Una certificación agrupa VARIAS corridas de wizard —una por proveedor, por
 * país y por macro industria— y hoy ese agrupamiento no está escrito en ningún
 * sitio: existe sólo en la cabeza de quien lanzó las corridas.
 */
export const CERT_SEAM_NO_CERTIFICATION_RUN_ID =
  'certification_campaign_grouping_not_persisted_anywhere_in_schema' as const;

/**
 * `provider_order` —qué pierna corrió primero— no se declara. Es DERIVABLE
 * ordenando por `created_at` las filas de uso que comparten `wizard_run_id`,
 * y por eso este módulo lo acepta como `derived`; pero derivarlo de un reloj es
 * frágil: dos filas del mismo milisegundo, o una pierna que se registra tarde,
 * invierten el orden sin que nada lo señale.
 */
export const CERT_SEAM_PROVIDER_ORDER_DERIVED_FROM_CLOCK =
  'provider_order_not_declared_only_derivable_from_created_at_ordering' as const;

/**
 * La latencia no está en todas las operaciones. `duration_ms` se puebla en las
 * búsquedas (93/93 en `apollo/organizations_search`, 8/8 en
 * `lusha/company_prospecting_v3`) pero NO en el enriquecimiento de Apollo
 * (0/82), que es donde vive una parte grande de su coste.
 */
export const CERT_SEAM_LATENCY_ABSENT_FOR_OPERATION =
  'duration_ms_not_recorded_for_this_operation' as const;

/**
 * Una corrida standalone que rechaza TODO no crea lote, y sin lote sus
 * disposiciones no se escriben (`batch_id` es `NOT NULL`). Es el caso que la
 * certificación más necesita ver —página pagada, nada admitido— y es justo el
 * que hoy no deja fila. Ver CUT-C.2 § G.
 */
export const CERT_SEAM_DISPOSITIONS_LOST_WITHOUT_BATCH =
  'dispositions_require_non_null_batch_id_so_an_all_rejected_standalone_run_persists_none' as const;

// ─── Entrada: lo que un adaptador de proveedor tiene que aportar ──────────────

/**
 * 🔴 Éste es el CONTRATO que un proveedor nuevo debe rellenar para entrar en la
 * comparación. No hay ruta alternativa: un campo que no pueda producir viaja
 * `null` y se nombra, no se estima.
 */
export interface CertificationBaselineInput {
  readonly provider: CertifiableProvider | string;
  /** Orden de la pierna dentro de la corrida. `null` ⇒ no se pudo derivar. */
  readonly providerOrder: number | null;
  readonly wizardRunId: string | null;
  readonly batchId: string | null;
  /** Agrupador de la campaña de certificación. Hoy SIEMPRE `null`. */
  readonly certificationRunId: string | null;
  readonly country: string | null;
  readonly macroIndustry: string | null;
  readonly requestFingerprint: string | null;
  readonly pages: number | null;
  readonly credits: number | null;
  readonly latencyMs: number | null;
  /** Filas que el proveedor devolvió y se pagaron, antes de filtros locales. */
  readonly companiesSeen: number | null;
  /** Empresas que REALMENTE satisficieron el objetivo. */
  readonly companiesAccepted: number | null;
  /** Empresas descartadas con motivo. */
  readonly companiesRejected: number | null;
  /** Empresas con conteo de empleados CONOCIDO (0 es conocido; null no). */
  readonly employeeCountKnown: number | null;
  /** Empresas con identidad resuelta (dominio o identificador fiscal). */
  readonly identityResolved: number | null;
  readonly dedupeRemoved: number | null;
  /** Conteo por código de disposición durable. `null` ⇒ no se pudo leer. */
  readonly dispositions: Readonly<Record<string, number>> | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface CertificationBaselineRow {
  readonly values: Readonly<Record<CertificationBaselineField, unknown>>;
  readonly field_sources: Readonly<Record<CertificationBaselineField, CertificationFieldSource>>;
  readonly fields_missing: readonly CertificationBaselineField[];
  readonly missing_correlation_seams: Readonly<Record<string, string>>;
}

/**
 * Proyecta una corrida al vocabulario comparable.
 *
 * `provider_order` es el único campo que se marca `derived` teniendo valor: no
 * se declara en ningún sitio y sale de ordenar por reloj. Los demás son
 * `observed` cuando hay cifra y `missing` cuando no.
 */
export function buildCertificationBaselineRow(
  input: CertificationBaselineInput,
): CertificationBaselineRow {
  const values: Record<CertificationBaselineField, unknown> = {
    certification_run_id: input.certificationRunId,
    wizard_run_id: input.wizardRunId,
    batch_id: input.batchId,
    provider: input.provider,
    provider_order: input.providerOrder,
    country: input.country,
    macro_industry: input.macroIndustry,
    request_fingerprint: input.requestFingerprint,
    pages: input.pages,
    credits: input.credits,
    latency_ms: input.latencyMs,
    companies_seen: input.companiesSeen,
    companies_accepted: input.companiesAccepted,
    companies_rejected: input.companiesRejected,
    employee_count_known: input.employeeCountKnown,
    identity_resolved: input.identityResolved,
    dedupe_removed: input.dedupeRemoved,
    dispositions: input.dispositions,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
  };

  const sources = {} as Record<CertificationBaselineField, CertificationFieldSource>;
  for (const field of CERTIFICATION_BASELINE_FIELDS) {
    sources[field] = values[field] === null ? 'missing' : 'observed';
  }
  // `provider_order` nunca es `observed`: no lo declara nadie.
  if (values.provider_order !== null) sources.provider_order = 'derived';

  const seams: Record<string, string> = {};
  if (values.certification_run_id === null) {
    seams.certification_run_id = CERT_SEAM_NO_CERTIFICATION_RUN_ID;
  }
  if (values.provider_order === null) {
    seams.provider_order = CERT_SEAM_PROVIDER_ORDER_DERIVED_FROM_CLOCK;
  }
  if (values.companies_accepted === null) {
    seams.companies_accepted = CERT_SEAM_ACCEPTED_NOT_CORRELATED;
  }
  if (values.latency_ms === null) {
    seams.latency_ms = CERT_SEAM_LATENCY_ABSENT_FOR_OPERATION;
  }
  if (values.dispositions === null) {
    seams.dispositions = CERT_SEAM_DISPOSITIONS_LOST_WITHOUT_BATCH;
  }

  return {
    values,
    field_sources: sources,
    fields_missing: CERTIFICATION_BASELINE_FIELDS.filter((f) => values[f] === null),
    missing_correlation_seams: seams,
  };
}

// ─── Métricas: sólo cuando sus insumos existen ───────────────────────────────

/** Las métricas que la certificación tiene que poder calcular después. */
export const CERTIFICATION_METRICS = [
  'useful_yield',
  'precision',
  'coverage',
  'overlap',
  'cost_per_useful',
  'pages',
  'latency_ms',
] as const;

export type CertificationMetric = (typeof CERTIFICATION_METRICS)[number];

/**
 * 🔴 `null` significa «no calculable con lo que esta fila trae», y es un
 * resultado legítimo que la certificación DEBE poder leer. Devolver 0 —o peor,
 * omitir la métrica— convertiría una laguna de medición en un veredicto.
 *
 * `overlap` y `coverage` NO se calculan aquí a propósito: son propiedades del
 * CONJUNTO de identidades de dos corridas, no de una fila. Se declaran en el
 * catálogo para que su ausencia sea explícita.
 */
export function computeCertificationMetrics(
  row: CertificationBaselineRow,
): Readonly<Record<CertificationMetric, number | null>> {
  const v = row.values;
  const num = (field: CertificationBaselineField): number | null => {
    const raw = v[field];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  };

  const seen = num('companies_seen');
  const accepted = num('companies_accepted');
  const rejected = num('companies_rejected');
  const credits = num('credits');

  const usefulYield = accepted !== null && seen !== null && seen > 0 ? accepted / seen : null;
  const precision =
    accepted !== null && rejected !== null && accepted + rejected > 0
      ? accepted / (accepted + rejected)
      : null;
  const costPerUseful =
    accepted !== null && credits !== null && accepted > 0 ? credits / accepted : null;

  return {
    useful_yield: usefulYield,
    precision,
    // Propiedades de conjunto: una sola fila no las puede responder.
    coverage: null,
    overlap: null,
    cost_per_useful: costPerUseful,
    pages: num('pages'),
    latency_ms: num('latency_ms'),
  };
}

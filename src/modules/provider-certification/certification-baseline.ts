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

/**
 * 🔴 CUT-E.1 — las autoridades que pueden responder «¿cuántas fueron aceptadas?».
 *
 * Son DOS porque los dos proveedores resuelven la aceptación en sitios
 * distintos, y fusionarlas en una etiqueta única sería esconder justo lo que la
 * certificación necesita ver:
 *
 * · `per_candidate_writer_trace` — la suma de los veredictos POR CANDIDATO que
 *   el writer ya tomó (`countsTowardTarget`), conservados en
 *   `source_trace.acceptedForTarget` desde CUT-D.1. Es el caso de Apollo.
 * · `provider_run_total`         — el total que el propio proveedor publica en
 *   su fila de gasto (`accepted_for_target_total`). Es el caso de Lusha.
 *
 * 🔴 No hay un tercer valor para «lo deduje»: una aceptación que no venga de una
 * de estas dos autoridades no se publica, se declara ausente.
 */
export const CERTIFICATION_ACCEPTANCE_SOURCES = [
  'per_candidate_writer_trace',
  'provider_run_total',
] as const;

export type CertificationAcceptanceSource = (typeof CERTIFICATION_ACCEPTANCE_SOURCES)[number];

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
  /**
   * 🔴 CUT-E.3 — el desglose del gasto POR OPERACIÓN cobrada.
   *
   * Va junto al total y no en su lugar: un total desnudo no se puede auditar, y
   * el defecto que este corte cierra fue precisamente un total que parecía
   * completo mientras sumaba una sola operación de las dos que la corrida paga.
   */
  'credits_by_operation',
  'latency_ms',
  // ── Embudo de empresas ──
  'companies_seen',
  'companies_accepted',
  /**
   * 🔴 CUT-E.1 — DE DÓNDE salió `companies_accepted`.
   *
   * Apollo y Lusha no responden esta pregunta con la misma autoridad, y ésa es
   * una asimetría que la certificación tiene que LEER en la fila en vez de
   * descubrirla comparando. Ver `CertificationAcceptanceSource`.
   */
  'companies_accepted_source',
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
 * 🔴 CUT-E.3 — la costura que hacía a Apollo parecer más barato de lo que es.
 *
 * Una corrida de Apollo paga DOS operaciones —`organizations_search` y
 * `organization_enrichment`— bajo el mismo `wizard_run_id`. Medido en
 * Producción el 11-09-2026: 420 créditos de búsqueda y 82 de enriquecimiento, y
 * en la corrida `294298cd…` fueron 6 y 5. Sumar sólo la búsqueda subestima el
 * coste de Apollo un ~45% y por tanto INVIERTE la comparación de coste por
 * empresa útil contra Lusha, que trae su gasto entero en su única fila.
 *
 * Se nombra cuando el desglose por operación no está disponible: sin él, el
 * total no es auditable y no se puede afirmar que esté completo.
 */
export const CERT_SEAM_CREDITS_NOT_BROKEN_DOWN_BY_OPERATION =
  'credits_total_not_broken_down_by_charged_operation_so_completeness_is_not_auditable' as const;

/**
 * 🔴 CUT-E.1 — el lote NO es el proveedor.
 *
 * `prospect_batches.metadata.accepted_for_target.accepted_paid_for_target` es la
 * aceptación de PAGO del LOTE, y en el waterfall Apollo y Lusha comparten lote.
 * Medido en Producción: el lote `483f3584` publica `accepted_paid_for_target: 5`
 * y sus 5 candidatos son de Lusha, con 0 de Apollo. Usar esa cifra como contraste
 * de Apollo declararía rota una correlación que está intacta.
 *
 * Por eso, con dos proveedores en el mismo lote, el contraste no se hace: se
 * declara no comparable.
 */
export const CERT_SEAM_BATCH_ACCEPTANCE_SHARED_BY_TWO_PROVIDERS =
  'batch_paid_acceptance_is_shared_by_every_provider_leg_so_it_cannot_contrast_one_of_them' as const;

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
  /** Total de créditos de la corrida, sumando TODAS las operaciones cobradas. */
  readonly credits: number | null;
  /** Desglose `operation_key → créditos`. `null` ⇒ el total no es auditable. */
  readonly creditsByOperation: Readonly<Record<string, number>> | null;
  readonly latencyMs: number | null;
  /** Filas que el proveedor devolvió y se pagaron, antes de filtros locales. */
  readonly companiesSeen: number | null;
  /** Empresas que REALMENTE satisficieron el objetivo. */
  readonly companiesAccepted: number | null;
  /**
   * Qué autoridad produjo la cifra de arriba. `null` SÓLO cuando no hay cifra:
   * una aceptación sin procedencia sería un número sin dueño.
   */
  readonly companiesAcceptedSource: CertificationAcceptanceSource | null;
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
    credits_by_operation: input.creditsByOperation,
    latency_ms: input.latencyMs,
    companies_seen: input.companiesSeen,
    companies_accepted: input.companiesAccepted,
    companies_accepted_source: input.companiesAcceptedSource,
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
    // La procedencia falta por la MISMA razón, y nombrarla con otra costura
    // inventaría una segunda causa para un solo hecho.
    seams.companies_accepted_source = CERT_SEAM_ACCEPTED_NOT_CORRELATED;
  }
  if (values.credits_by_operation === null) {
    seams.credits_by_operation = CERT_SEAM_CREDITS_NOT_BROKEN_DOWN_BY_OPERATION;
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

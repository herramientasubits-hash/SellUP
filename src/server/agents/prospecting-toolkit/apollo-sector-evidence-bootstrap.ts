/**
 * apollo-sector-evidence-bootstrap.ts — Adquisición de evidencia clasificatoria
 * cuando la búsqueda no trajo ninguna.
 *
 * AGENT1-APOLLO-SECTOR-EVIDENCE-BOOTSTRAP-1.
 *
 * El bloqueo estructural que cierra (RUN 1 Salud, lote `f4c8a60f`, 2026-08-12):
 *
 *   `mixed_companies/search` devolvió las 20 organizaciones en `accounts[]`, y
 *   ninguna traía `industry`, `keywords`, `descriptions` ni `employee_count`.
 *   La única fuente de esos campos es `organization_enrichment`.
 *       +
 *   `SECTOR_SIGNAL_TERMS` no tiene política para el sector pedido, así que el
 *   veredicto de gasto era `sector_not_mapped` — INCONDICIONAL, sin mirar la
 *   evidencia — y eso es un rechazo terminal ANTES del enrichment.
 *       ⇒
 *   0 enrichments ⇒ la evidencia que hace falta para juzgar el sector no se puede
 *   adquirir NUNCA, y la corrida es incapaz de producir un candidato antes de
 *   empezar. 20 créditos, 0 candidatos.
 *
 * La salida NO es añadir Salud (ni Banca, ni Educación) a mano al catálogo de
 * señales: eso arregla una corrida y deja el bloqueo intacto para las otras 70
 * subindustrias del catálogo activo. La salida es separar dos preguntas que el
 * veredicto único mezclaba:
 *
 *   1. ¿Hay política para juzgar este sector?        → `SECTOR_SIGNAL_TERMS`
 *   2. ¿El proveedor dijo ALGO que juzgar?           → campos del resultado
 *
 * Cuando la respuesta a (2) es «nada», no hay contradicción posible ni
 * confirmación posible: hay AUSENCIA, y adquirir evidencia es exactamente para lo
 * que existe el enrichment. Este módulo autoriza esa adquisición —y sólo esa—
 * bajo condiciones que se comprueban, no se suponen.
 *
 * Lo que este módulo NO hace, en ningún camino:
 *
 *   - no confirma sector ni subindustria;
 *   - no hace elegible a un candidato para el objetivo;
 *   - no promueve reglas `confirm_only` ni toca la precisión;
 *   - no sube ningún cap: cambia QUIÉN compite por los <= 5 enrichments, nunca
 *     CUÁNTOS se pagan;
 *   - no convierte la industria PEDIDA en evidencia de nada. Pedir «Salud» sólo
 *     autoriza a preguntar; jamás responde.
 *
 * Puro: sin I/O, sin env, sin reloj, sin llamadas al proveedor.
 */

// ─── Versión ──────────────────────────────────────────────────────────────────

export const APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_VERSION = 'v1.SEB-1';

// ─── Precondiciones de la CORRIDA ─────────────────────────────────────────────

/**
 * Hechos OBSERVADOS de la corrida que pueden autorizar la adquisición.
 *
 * Todos vienen de la búsqueda que efectivamente se emitió, no de la intención con
 * que se construyó: la corrida `ce957e2f` demuestra que una intención que nombra
 * dos subindustrias puede colapsar en un body que sólo representa a una, y una
 * cobertura declarada sobre la hipótesis habría autorizado gasto sobre una
 * pregunta que el usuario no hizo.
 */
export type ApolloSectorEvidenceBootstrapPreconditions = {
  /**
   * Una búsqueda REAL del proveedor se emitió para esta corrida (ni saltada por
   * flag, ni dry-run, ni bloqueada por el gate de gasto).
   */
  providerSearchExecuted: boolean;
  /**
   * Toda subindustria pedida está representada por al menos un término en la
   * consulta EFECTIVA. `false` ⇒ la pregunta emitida no fue la del usuario.
   */
  queryCoverageComplete: boolean;
  /**
   * `selection_catalog_version == search_term_catalog_version`. Una cobertura
   * perfecta calculada sobre la versión equivocada sigue siendo la pregunta
   * equivocada.
   */
  catalogVersionCoherent: boolean;
  /**
   * Los criterios pedidos se resolvieron contra el catálogo publicado activo.
   * `false` ⇒ los términos no salieron del catálogo que gobierna el gasto.
   */
  catalogTermsResolved: boolean;
};

/** Por qué la corrida NO puede autorizar adquisición. Códigos estáticos. */
export type ApolloSectorEvidenceBootstrapBlockReason =
  /** Nadie evaluó las precondiciones — el estado inicial, y el fail-closed. */
  | 'preconditions_not_evaluated'
  | 'provider_search_not_executed'
  | 'query_coverage_incomplete'
  | 'catalog_version_incoherent'
  | 'catalog_terms_unresolved';

/** Por qué la corrida SÍ puede autorizarla. Un único motivo, deliberadamente. */
export type ApolloSectorEvidenceBootstrapAuthorizationReason =
  'valid_catalog_criteria_with_complete_query_coverage';

export type ApolloSectorEvidenceBootstrapAuthorization =
  | { authorized: true; reason: ApolloSectorEvidenceBootstrapAuthorizationReason }
  | { authorized: false; blockReason: ApolloSectorEvidenceBootstrapBlockReason };

/**
 * Autorización por defecto: NO autorizada.
 *
 * Es el valor que ve todo llamador que no pasa nada, y es lo que garantiza que
 * este hito no cambie ni una decisión de las rutas existentes. Sin precondiciones
 * comprobadas no hay adquisición: fallar cerrado aquí cuesta una corrida vacía;
 * fallar abierto cuesta créditos sobre una pregunta que nadie validó.
 */
export const APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED: ApolloSectorEvidenceBootstrapAuthorization =
  { authorized: false, blockReason: 'preconditions_not_evaluated' };

/**
 * Evalúa las precondiciones de CORRIDA. Todas deben cumplirse.
 *
 * El orden de comprobación va de lo más fundamental a lo más derivado, para que
 * el motivo reportado sea el que de verdad explica el bloqueo: una cobertura
 * incompleta sobre un catálogo incoherente es, primero, un problema de catálogo.
 */
export function evaluateApolloSectorEvidenceBootstrapAuthorization(
  preconditions: ApolloSectorEvidenceBootstrapPreconditions,
): ApolloSectorEvidenceBootstrapAuthorization {
  if (!preconditions.providerSearchExecuted) {
    return { authorized: false, blockReason: 'provider_search_not_executed' };
  }
  if (!preconditions.catalogTermsResolved) {
    return { authorized: false, blockReason: 'catalog_terms_unresolved' };
  }
  if (!preconditions.catalogVersionCoherent) {
    return { authorized: false, blockReason: 'catalog_version_incoherent' };
  }
  if (!preconditions.queryCoverageComplete) {
    return { authorized: false, blockReason: 'query_coverage_incomplete' };
  }
  return {
    authorized: true,
    reason: 'valid_catalog_criteria_with_complete_query_coverage',
  };
}

/**
 * Conjunción de autorizaciones de varias rondas.
 *
 * Una corrida de dos rondas emite dos búsquedas, y la autorización describe a la
 * corrida entera: basta que UNA ronda se haya emitido con la pregunta equivocada
 * para que la corrida no pueda autorizar gasto adicional. Sin rondas, no
 * autorizada.
 */
export function combineApolloSectorEvidenceBootstrapAuthorizations(
  authorizations: readonly ApolloSectorEvidenceBootstrapAuthorization[],
): ApolloSectorEvidenceBootstrapAuthorization {
  if (authorizations.length === 0) return APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED;
  const blocked = authorizations.find((authorization) => !authorization.authorized);
  return blocked ?? { authorized: true, reason: 'valid_catalog_criteria_with_complete_query_coverage' };
}

// ─── Decisión por CANDIDATO ───────────────────────────────────────────────────

/** Por qué un candidato concreto no puede competir por adquirir evidencia. */
export type ApolloSectorEvidenceBootstrapCandidateBlockReason =
  | ApolloSectorEvidenceBootstrapBlockReason
  /**
   * El proveedor SÍ declaró clasificación para este candidato y no hay política
   * para juzgarla. Eso no es ausencia de evidencia: es ausencia de POLÍTICA, y
   * comprar más descripción no crea la política que falta. Sigue siendo
   * `sector_not_mapped`, que es lo que de verdad ocurre.
   */
  | 'provider_classification_present_without_sector_policy';

/** Único motivo por el que un candidato SÍ puede competir por adquirirla. */
export type ApolloSectorEvidenceBootstrapCandidateReason = 'provider_classification_missing';

export type ApolloSectorEvidenceBootstrapCandidateDecision =
  | { bootstrapEligible: true; reason: ApolloSectorEvidenceBootstrapCandidateReason }
  | { bootstrapEligible: false; blockReason: ApolloSectorEvidenceBootstrapCandidateBlockReason };

/**
 * ¿Puede ESTE candidato competir por un enrichment que adquiera su clasificación?
 *
 * Dos condiciones, ambas necesarias:
 *
 *   1. la corrida está autorizada (criterios válidos, cobertura completa,
 *      catálogo coherente, búsqueda real emitida);
 *   2. el proveedor no declaró NINGÚN campo con carga sectorial para él.
 *
 * La segunda es la que mantiene el fail-closed intacto donde importaba: a
 * Citigroup se le rechazaba porque Apollo dice «retail banking», y sigue
 * rechazándose — tiene evidencia, y tener evidencia excluye la adquisición. Lo
 * que cambia es únicamente el caso en que el proveedor no dijo NADA.
 *
 * Los gates de candidato previos (país, dominio, ownership, plataforma externa,
 * cooldown, duplicados) NO se re-evalúan aquí: el gate de elegibilidad los aplica
 * ANTES que el veredicto sectorial y se detiene en el primero que falla, así que
 * un candidato que llega hasta esta pregunta ya los superó todos.
 */
export function decideApolloSectorEvidenceBootstrapForCandidate(input: {
  authorization: ApolloSectorEvidenceBootstrapAuthorization;
  /** Campos con carga sectorial que el proveedor entregó. Vacío ⇒ no dijo nada. */
  providerSectorEvidenceFields: readonly string[];
}): ApolloSectorEvidenceBootstrapCandidateDecision {
  if (!input.authorization.authorized) {
    return { bootstrapEligible: false, blockReason: input.authorization.blockReason };
  }
  if (input.providerSectorEvidenceFields.length > 0) {
    return {
      bootstrapEligible: false,
      blockReason: 'provider_classification_present_without_sector_policy',
    };
  }
  return { bootstrapEligible: true, reason: 'provider_classification_missing' };
}

// ─── Autorización del GATE DE COMPRA ──────────────────────────────────────────

/**
 * AGENT1-APOLLO-BOOTSTRAP-PURCHASE-GATE-THREADING-1.
 *
 * El defecto que este bloque cierra, medido en producción (lote
 * `74a49b01-aa34-4160-a59a-1c84a7f85e13`, 2026-08-12, SHA `6808835f`):
 *
 *   #274 hizo llegar la autorización al gate BARATO —el que decide quién compite—
 *   y NO al gate que guarda la COMPRA, que vive dentro del cascade. La corrida
 *   dejó 20 candidatos `bootstrap_eligible`, seleccionó los 5 mejores… y ejecutó
 *   CERO enrichments: `evaluateApolloEnrichmentEligibility` volvía a juzgar sin
 *   autorización, un sector sin política volvía a `sector_not_mapped`, y el
 *   cascade devolvía `eligibility_blocked`. 20 créditos de búsqueda, 0 de
 *   adquisición, 0 candidatos, y la evidencia que el hito existe para comprar
 *   siguió sin comprarse.
 *
 * La corrección NO es recalcular el bootstrap por segunda vez junto al gasto: dos
 * evaluaciones independientes pueden discrepar, y la que guarda el dinero sería
 * la que decidiera sin contexto. Es ENHEBRAR la misma autorización que ya dejó
 * competir al candidato, y hacerlo con dos límites que un booleano de corrida no
 * tiene:
 *
 *   1. por CANDIDATO — sólo autoriza a quien el gate barato registró como
 *      bootstrap-eligible; nadie más hereda la autorización de la corrida;
 *   2. por SELECCIÓN — la corrida no puede emitir más autorizaciones de compra
 *      que enrichments permite su cap, así que una autorización de corrida jamás
 *      se convierte en permiso para los 20.
 *
 * Puro: sin I/O, sin estado, sin reloj.
 */

/** Por qué un candidato SELECCIONADO no puede llegar a la operación pagada. */
export type ApolloSectorEvidenceBootstrapPurchaseBlockReason =
  /** La corrida entera no autoriza adquisición. Se propaga tal cual. */
  | ApolloSectorEvidenceBootstrapBlockReason
  /**
   * El gate BARATO no registró a este candidato como bootstrap-eligible. Puede
   * ser porque el proveedor sí declaró clasificación, o porque su sector tiene
   * política y no necesita bootstrap alguno. En ambos casos la compra se juzga
   * con el contrato de siempre: cero deriva para las rutas existentes.
   */
  | 'candidate_not_bootstrap_eligible_at_cheap_gate'
  /**
   * La corrida ya emitió tantas autorizaciones de compra como enrichments
   * permite su cap. Es el límite que convierte «esta corrida está autorizada» en
   * «estos <= N candidatos lo están», y el que impide que una autorización de
   * corrida acabe cubriendo a toda la cohorte.
   */
  | 'purchase_authorization_cap_reached';

/** Desenlace de una operación de compra que la autorización SÍ alcanzó a habilitar. */
export type ApolloSectorEvidenceBootstrapPurchaseSkipReason =
  /** No hay pricing activo para `organization_enrichment`. */
  | 'enrichment_pricing_unavailable'
  /** El presupuesto de la corrida ya no admite otra operación pagada. */
  | 'budget_exhausted'
  /** El resultado original del proveedor ya no está disponible para evaluar. */
  | 'candidate_evidence_unavailable'
  /** El candidato no tiene dominio normalizado con el que llamar a Apollo. */
  | 'candidate_domain_missing'
  /** El cascade no devolvió entrada para el único candidato que se le pasó. */
  | 'cascade_returned_no_entry'
  /** El gate de compra del cascade rechazó. El motivo fino viaja aparte. */
  | 'cascade_eligibility_blocked'
  /** El cascade agotó su propio cap antes de llamar. */
  | 'cascade_cap_reached'
  /** El cascade no encontró dominio en el resultado. */
  | 'cascade_missing_domain'
  /** El cascade está deshabilitado. */
  | 'cascade_disabled';

export type ApolloSectorEvidenceBootstrapPurchaseDecision =
  | {
      authorized: true;
      reason: ApolloSectorEvidenceBootstrapCandidateReason;
      /**
       * La autorización que viaja al gate de la operación PAGADA.
       *
       * Es el MISMO valor que autorizó al gate barato, no una reconstrucción: una
       * segunda evaluación podría discrepar de la primera, y la que guarda el
       * dinero sería la que decidiera sin contexto.
       */
      authorization: ApolloSectorEvidenceBootstrapAuthorization;
    }
  | {
      authorized: false;
      blockReason: ApolloSectorEvidenceBootstrapPurchaseBlockReason;
      /** Siempre NO autorizada: fallar cerrado es el default de este módulo. */
      authorization: ApolloSectorEvidenceBootstrapAuthorization;
    };

/**
 * ¿Puede ESTA compra ejecutarse bajo la autorización de bootstrap de la corrida?
 *
 * Comprueba de lo más fundamental a lo más derivado, para que el motivo reportado
 * sea el que de verdad explica el bloqueo.
 *
 * Fail-closed en todos los caminos: lo que no está explícitamente autorizado
 * viaja como `APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED`, que es exactamente
 * el valor con el que se comportaban las rutas anteriores a este hito.
 */
export function resolveApolloSectorEvidenceBootstrapPurchaseAuthorization(input: {
  /** Autorización de la CORRIDA, combinada sobre las búsquedas emitidas. */
  runAuthorization: ApolloSectorEvidenceBootstrapAuthorization;
  /**
   * El motivo que el gate BARATO registró para este candidato, o `null` si nunca
   * lo registró. `null` no se interpreta como «se puede»: es lo que fuerza que la
   * autorización sea de candidato y no de corrida.
   */
  cheapGateBootstrapReason: ApolloSectorEvidenceBootstrapCandidateReason | null;
  /** Autorizaciones de compra que esta corrida ya emitió. */
  authorizedPurchasesSoFar: number;
  /** Cap de enrichments de la corrida. Nunca se emiten más autorizaciones. */
  maxAuthorizedPurchases: number;
}): ApolloSectorEvidenceBootstrapPurchaseDecision {
  const denied = (
    blockReason: ApolloSectorEvidenceBootstrapPurchaseBlockReason,
  ): ApolloSectorEvidenceBootstrapPurchaseDecision => ({
    authorized: false,
    blockReason,
    authorization: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED,
  });

  if (!input.runAuthorization.authorized) return denied(input.runAuthorization.blockReason);
  if (input.cheapGateBootstrapReason === null) {
    return denied('candidate_not_bootstrap_eligible_at_cheap_gate');
  }
  if (input.authorizedPurchasesSoFar >= input.maxAuthorizedPurchases) {
    return denied('purchase_authorization_cap_reached');
  }
  return {
    authorized: true,
    reason: input.cheapGateBootstrapReason,
    authorization: input.runAuthorization,
  };
}

/**
 * La traza durable de una compra de bootstrap: qué se autorizó, si se llegó a
 * intentar, y por qué no si no se llegó.
 *
 * Vive aquí y no en el módulo de auditoría porque es el vocabulario del gate de
 * compra, y porque el runner la produce mientras decide — no después.
 */
export type ApolloSectorEvidenceBootstrapPurchaseTrace = {
  decision: ApolloSectorEvidenceBootstrapPurchaseDecision;
  /** ¿Se llegó a invocar el cascade con este candidato? */
  cascadeInvoked: boolean;
  /** Por qué no se ejecutó la operación pagada. `null` si se ejecutó. */
  skipReason: ApolloSectorEvidenceBootstrapPurchaseSkipReason | null;
  /**
   * Motivo fino del gate de compra del cascade cuando bloqueó. Es el campo que
   * habría respondido la forense de `74a49b01` sin un replay: decía
   * `sector_not_mapped` y nadie podía verlo.
   */
  cascadeIneligibilityReason: string | null;
};

// ─── Transporte de las precondiciones ─────────────────────────────────────────

/**
 * Clave con que las precondiciones viajan en la metadata de la búsqueda.
 *
 * Existe porque quien las OBSERVA (el provider, que construyó el request
 * efectivo) y quien las NECESITA (el runner de dos rondas, que evalúa candidatos)
 * están separados por el contrato de `WebSearchOutput`. Se transportan como
 * hechos de la búsqueda emitida, no se vuelven a derivar: derivarlas otra vez
 * abriría la puerta a que la autorización describiera una consulta distinta de la
 * que se pagó.
 */
export const APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_PRECONDITIONS_KEY =
  'apollo_sector_evidence_bootstrap_preconditions' as const;

export function toApolloSectorEvidenceBootstrapPreconditionsMetadata(
  preconditions: ApolloSectorEvidenceBootstrapPreconditions,
): Record<string, unknown> {
  return {
    provider_search_executed: preconditions.providerSearchExecuted,
    query_coverage_complete: preconditions.queryCoverageComplete,
    catalog_version_coherent: preconditions.catalogVersionCoherent,
    catalog_terms_resolved: preconditions.catalogTermsResolved,
  };
}

/**
 * Lee las precondiciones de la metadata de una búsqueda.
 *
 * Estricto a propósito: cada campo tiene que ser un booleano de verdad. Una
 * metadata antigua, truncada o de otro proveedor devuelve `null`, y `null` no
 * autoriza nada. Un `undefined` interpretado como `true` sería gasto autorizado
 * por una ausencia.
 */
export function readApolloSectorEvidenceBootstrapPreconditionsFromMetadata(
  metadata: unknown,
): ApolloSectorEvidenceBootstrapPreconditions | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const block = (metadata as Record<string, unknown>)[
    APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_PRECONDITIONS_KEY
  ];
  if (typeof block !== 'object' || block === null) return null;

  const record = block as Record<string, unknown>;
  const readBoolean = (key: string): boolean | null =>
    typeof record[key] === 'boolean' ? (record[key] as boolean) : null;

  const providerSearchExecuted = readBoolean('provider_search_executed');
  const queryCoverageComplete = readBoolean('query_coverage_complete');
  const catalogVersionCoherent = readBoolean('catalog_version_coherent');
  const catalogTermsResolved = readBoolean('catalog_terms_resolved');

  if (
    providerSearchExecuted === null ||
    queryCoverageComplete === null ||
    catalogVersionCoherent === null ||
    catalogTermsResolved === null
  ) {
    return null;
  }

  return {
    providerSearchExecuted,
    queryCoverageComplete,
    catalogVersionCoherent,
    catalogTermsResolved,
  };
}

// ─── Observabilidad ───────────────────────────────────────────────────────────

/**
 * Metadata de la autorización. Sólo códigos estáticos y booleanos: sin secretos,
 * sin PII, sin nombres de empresa.
 */
export function toApolloSectorEvidenceBootstrapAuthorizationMetadata(
  authorization: ApolloSectorEvidenceBootstrapAuthorization,
  preconditions?: ApolloSectorEvidenceBootstrapPreconditions | null,
): Record<string, unknown> {
  return {
    bootstrap_version: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_VERSION,
    bootstrap_authorized: authorization.authorized,
    bootstrap_authorization_reason: authorization.authorized ? authorization.reason : null,
    bootstrap_block_reason: authorization.authorized ? null : authorization.blockReason,
    bootstrap_preconditions: preconditions
      ? {
          provider_search_executed: preconditions.providerSearchExecuted,
          query_coverage_complete: preconditions.queryCoverageComplete,
          catalog_version_coherent: preconditions.catalogVersionCoherent,
          catalog_terms_resolved: preconditions.catalogTermsResolved,
        }
      : null,
  };
}

import type { GenerateAIBatchInput } from '@/modules/prospect-batches/actions';
import type { WizardApolloSkipReason } from './wizard-apollo-availability';
import type { NoNewCandidatesBreakdown } from './wizard-no-new-candidates-copy';
import type { WizardPersistenceOutcome } from './wizard-result-copy';
import type {
  ProviderResolutionReason,
  WizardDiscoveryProvider,
} from './wizard-run-provider-selection';
import type { DiscoveryTaxonomyCapability } from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';

// ── Run-level provider outcome (A1-APOLLO-QA-CONTROL-SURFACE-1 § 10) ──────────

/**
 * Lo que el SERVIDOR decidió sobre el proveedor de esta corrida.
 *
 * Viaja de vuelta al cliente para que la UI pueda nombrar el proveedor real en
 * vez de su propia selección. Sólo códigos estáticos y nombres de proveedor: sin
 * nombres de variables de entorno, sin sus valores, sin roles.
 */
export type WizardRunProviderOutcome = {
  /** Lo que se pidió, si se pidió algo válido. */
  requested: WizardDiscoveryProvider | null;
  /** El que el servidor resolvió. La única fuente para el indicador de la UI. */
  resolved: WizardDiscoveryProvider;
  reason: ProviderResolutionReason;
  /** True cuando la corrida se apartó del predeterminado global. */
  isRunLevelOverride: boolean;
};

// ── Error codes ───────────────────────────────────────────────────────────────

export type WizardExecutionErrorCode =
  | 'UNAUTHENTICATED'
  | 'INACTIVE_USER'
  | 'INVALID_REQUEST'
  | 'CATALOG_VERSION_NOT_FOUND'
  | 'CATALOG_VERSION_NOT_PUBLISHED'
  | 'CATALOG_VERSION_CHANGED'
  | 'INDUSTRY_NOT_FOUND'
  | 'INDUSTRY_VERSION_MISMATCH'
  | 'SUBINDUSTRY_NOT_FOUND'
  | 'SUBINDUSTRY_INDUSTRY_MISMATCH'
  | 'SUBINDUSTRY_COUNTRY_MISMATCH'
  | 'TOO_MANY_SUBINDUSTRIES'
  | 'INVALID_CRITERIA';

/**
 * A1-APOLLO-PERSISTENCE-READINESS-4-FIX § 3 — catálogo ÚNICO de códigos con los
 * que una corrida puede terminar en fallo.
 *
 * Antes vivía como una unión escrita a mano dentro del tipo del resultado, así
 * que era invisible para cualquier consumidor: el mapa de copy de la UI mantenía
 * su propia lista y la prueba de cobertura mantenía una TERCERA, hardcodeada.
 * Con tres listas independientes, añadir un código en el servidor no rompía
 * nada — y eso es exactamente cómo `PERSISTENCE_NOT_READY` llegó a Producción
 * mostrando el mensaje genérico de fallback.
 *
 * Es una tupla `as const` a propósito: da el tipo (unión derivada, no duplicada)
 * y a la vez es enumerable, de modo que el mapa de la UI puede exigirse
 * exhaustivo en tiempo de compilación y la prueba puede recorrerla en vez de
 * copiarla.
 */
export const WIZARD_EXECUTION_FAILURE_CODES = [
  'EXECUTION_DISABLED',
  'UNAUTHENTICATED',
  'INACTIVE_USER',
  'INVALID_REQUEST',
  'CATALOG_CHANGED',
  'IDEMPOTENCY_CONFLICT',
  'PROVIDER_UNAVAILABLE',
  'GENERATION_FAILED',
  // Pilot budget guardrail codes (16AB.43.17)
  'PILOT_PAUSED',
  'NOT_IN_PILOT',
  'BUDGET_PERIOD_NOT_CONFIGURED',
  'BUDGET_PERIOD_CLOSED',
  'EXECUTION_CREDIT_LIMIT_EXCEEDED',
  'BUDGET_EXCEEDED',
  'CONCURRENT_EXECUTION_ACTIVE',
  'BUDGET_RESERVATION_FAILED',
  /**
   * A1-APOLLO-PERSISTENCE-READINESS-4 § 6 — el esquema no puede guardar
   * candidatos. Se decide ANTES de reservar presupuesto y ANTES de llamar al
   * proveedor: cero reserva, cero llamadas, cero créditos.
   */
  'PERSISTENCE_NOT_READY',
] as const;

export type WizardExecutionFailureCode = (typeof WIZARD_EXECUTION_FAILURE_CODES)[number];

export class WizardExecutionError extends Error {
  constructor(
    public readonly code: WizardExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WizardExecutionError';
  }
}

// ── Request contract (client → server boundary) ───────────────────────────────
// Fields the browser may safely send.
// Absent: userId, targetCount, requestedCount, employeeThreshold, industry/country names.
// Server derives all labels and controls from the authenticated session and catalog.

export type WizardExecutionRequest = {
  countryCode: string;
  industryId: string;
  subindustryIds: string[];
  additionalCriteriaRaw: string | null;
  catalogVersion: string;
  clientRequestId: string;
};

// ── Resolved catalog entities ─────────────────────────────────────────────────

export type ResolvedCountry = {
  code: string;
  name: string;
};

export type ResolvedIndustry = {
  id: string;
  slug: string;
  name: string;
};

export type ResolvedSubindustry = {
  id: string;
  slug: string;
  name: string;
  applicableCountries: string[] | null;
};

export type ResolvedCatalog = {
  version: string;
};

export type SystemControls = {
  targetCount: number;
  minimumEmployees: number;
  employeeThresholdMode: 'hard_filter';
};

// ── Resolved execution (server internal) ─────────────────────────────────────
// All labels and IDs are canonical — resolved server-side from the catalog.
// userId is always obtained from the active session, never from the client payload.

export type ResolvedWizardExecution = {
  userId: string;
  clientRequestId: string;
  mode: 'exploratory';
  country: ResolvedCountry;
  catalog: ResolvedCatalog;
  industry: ResolvedIndustry;
  subindustries: ResolvedSubindustry[];
  additionalCriteria: string | null;
  systemControls: SystemControls;
};

// ── Wizard context preserved beyond GenerateAIBatchInput ─────────────────────
// GenerateAIBatchInput has no fields for subindustries, additional criteria,
// or catalog metadata. These are preserved here for traceability and future use.

/**
 * MACRO-INDUSTRY-CATALOG-DISCOVERY-1 § 8 — bajo qué taxonomía se creó la
 * solicitud, declarado y persistido.
 *
 * Extiende la capacidad resuelta con la identidad de la macro industria pedida.
 * `macroIndustryKey` es `null` en toda corrida legacy y también cuando la
 * industria publicada no corresponde a ninguna de las 12 —ese `null` es un dato,
 * no un error: dice que el catálogo publicado y el módulo de código no
 * coincidían en el momento de la corrida—.
 */
export type WizardTaxonomyContext = DiscoveryTaxonomyCapability & {
  macroIndustryKey: string | null;
  macroIndustryDisplayName: string;
};

export type WizardContext = {
  catalogVersion: string;
  industryId: string;
  subindustries: ResolvedSubindustry[];
  additionalCriteria: string | null;
  clientRequestId: string;
  taxonomy: WizardTaxonomyContext;
  employeeSizeCriteria: {
    minEmployeeCountExclusive: number;
    enforcement: 'hard_filter';
    scope: 'local_legal_entity';
  };
};

// ── Adapter output ────────────────────────────────────────────────────────────
// Wraps GenerateAIBatchInput with preserved wizard context.
// generationInput is ready to be passed to generateAIProspectBatch.
// wizardContext carries fields with no counterpart in the current pipeline.

export type WizardGenerationCommand = {
  generationInput: GenerateAIBatchInput;
  wizardContext: WizardContext;
};

// ── Action result (server action return type) ─────────────────────────────────

/**
 * Estados con los que una ejecución del wizard puede terminar bien.
 *
 * A1-APOLLO-PERSISTENCE-READINESS-4 § 7 — exportado y reutilizado a propósito:
 * antes esta unión estaba escrita a mano en tres archivos (la acción, el estado
 * de la UI y el panel), y añadir un estado en uno solo compilaba igual dejando a
 * los otros dos sin él.
 */
export type WizardExecutionStatus =
  | 'created'
  | 'already_started'
  | 'no_new_candidates'
  | 'success_partial'
  | 'success_target_reached'
  | 'completed_with_errors';

export type WizardExecutionActionResult =
  | {
      ok: true;
      /**
       * A1-APOLLO-PERSISTENCE-READINESS-4 § 7 — `completed_with_errors` es el
       * estado de una corrida que SÍ encontró empresas elegibles y no pudo
       * guardar ninguna. No es `no_new_candidates`: la búsqueda ya se ejecutó y
       * pudo cobrarse, así que anunciarla como un vacío normal invita al usuario
       * a repetirla y pagarla otra vez.
       *
       * Es un miembro de esta unión de TypeScript, no un enum nuevo de base de
       * datos: el lote usa `failed`, que ya existe en el CHECK de
       * `prospect_batches.status`.
       */
      status: WizardExecutionStatus;
      batchId: string;
      batchStatus: string;
      candidateCount?: number;
      redirectPath: string;
      /** Present when budget reconciliation failed after a successful generation. */
      reconciliationWarning?: 'BUDGET_RECONCILIATION_FAILED';
      /**
       * A1-APOLLO-BUDGET-RECONCILIATION-1: outcome of the spend reconciliation.
       *
       * `pending_reconciliation` means recorded spend exceeded the reservation —
       * the exact 4-against-3 case of the QA batch — and needs administrative
       * review. `billing_unknown` means part of the spend is indeterminate.
       * Never turns a successful generation into a failure: the candidates were
       * produced and the credits were really spent either way.
       */
      reconciliationState?: 'confirmed' | 'pending_reconciliation' | 'billing_unknown';
      /** Structured anomaly codes raised during reconciliation, if any. */
      budgetAnomalies?: readonly string[];
      /** True when novelty pre-check confirms no new candidates would survive the writer filter. */
      noveltyExhausted?: boolean;
      /** The configured target count of persistible candidates. */
      targetPersistibleCandidates?: number;
      /** True when candidatesCreated >= targetPersistibleCandidates. */
      targetReached?: boolean;
      /**
       * A1-APOLLO-QA-CONTROL-SURFACE-1 § 10 — proveedor REAL de esta corrida.
       *
       * Presente en cuanto la selección por corrida se resolvió. La UI debe
       * pintar esto y no su propia selección: si el usuario pidió Apollo y el
       * servidor resolvió Tavily, aquí llega Tavily.
       */
      runProvider?: WizardRunProviderOutcome;
      /**
       * § 11 — cifras reales de la modalidad de dos rondas, cuando corrió.
       *
       * Cada campo admite `null` = «no se sabe», distinto de `0`. Ausente cuando
       * la modalidad no corrió.
       */
      twoRoundOutcome?: {
        roundsExecuted: number | null;
        eligibleCompaniesFound: number | null;
      };
      /**
       * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 § 8 — distribución REAL de descartes.
       *
       * Sólo se envía cuando la corrida terminó sin empresas nuevas: es lo que
       * permite decirle al usuario la causa que ocurrió en vez de una disyunción
       * genérica entre las dos posibles.
       */
      noNewCandidatesBreakdown?: NoNewCandidatesBreakdown;
      /**
       * A1-APOLLO-PERSISTENCE-READINESS-4 § 7/§ 8 — cifras REALES de la
       * persistencia.
       *
       * Se envía siempre que el pipeline las produjo, no sólo cuando fallan: es
       * lo que permite a la UI resolver la causa de mayor prioridad —fallo de
       * almacenamiento por encima de historial y calidad— sin adivinarla desde
       * un conteo de candidatos.
       */
      persistenceOutcome?: WizardPersistenceOutcome;
    }
  | {
      ok: false;
      /**
       * Derivado de `WIZARD_EXECUTION_FAILURE_CODES` — no se vuelve a escribir la
       * unión aquí. Añadir un código allí lo hace obligatorio en el mapa de copy
       * de la UI en tiempo de compilación (§ 3).
       */
      code: WizardExecutionFailureCode;
      message: string;
      retryable: boolean;
      /**
       * A1-APOLLO-WIZARD-1 — resultado estructurado de proveedor omitido / no
       * disponible. Presente sólo con code='PROVIDER_UNAVAILABLE'.
       *
       * No lleva lote, candidatos ni coste a propósito: un proveedor omitido no
       * produjo nada y no gastó nada, y la UI no debe poder confundirlo con una
       * ejecución que sí corrió y volvió vacía.
       */
      providerSkipped?: {
        provider: 'apollo_organizations';
        skipReason: WizardApolloSkipReason;
      };
      /**
       * A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX § 10 — detalle explicativo del
       * bloqueo de presupuesto.
       *
       * La AUTORIDAD sigue siendo la reserva atómica: es la RPC la que decide, y
       * este campo no puede desbloquear nada. Existe porque un
       * `EXECUTION_CREDIT_LIMIT_EXCEEDED` con la modalidad de dos rondas activa
       * significa algo concreto —el techo de 12 créditos del peor caso de esa
       * modalidad no cabía— y sin decirlo el operador no puede distinguirlo del
       * guardrail legacy, que describe una corrida de otra forma.
       *
       * Código estático. Nunca lleva valores de entorno ni cifras de otro usuario.
       */
      blockDetail?: string;
      /**
       * A1-APOLLO-QA-CONTROL-SURFACE-1 § 10 — proveedor resuelto, también en el
       * fallo.
       *
       * Presente sólo cuando la selección llegó a resolverse (un fallo de flag,
       * sesión, schema o catálogo ocurre antes y no tiene proveedor que reportar).
       * Existe porque un rechazo tiene que poder decir con qué proveedor se
       * rechazó: sin esto, un admin que pidió Apollo y recibió un error no puede
       * distinguir «Apollo falló» de «nunca se intentó Apollo».
       */
      runProvider?: WizardRunProviderOutcome;
      /**
       * § 6 — motivo estructurado de un `PERSISTENCE_NOT_READY`.
       *
       * `errorCode` es el código propio del repo, nunca el de Postgres/PostgREST.
       * `reason` distingue «la columna no está» de «no se pudo comprobar», que es
       * lo que decide si hay que aplicar una migración o mirar la conexión.
       */
      persistenceNotReady?: {
        errorCode: string;
        reason: 'identity_key_missing' | 'probe_failed';
        stage: 'schema_preflight';
      };
    };

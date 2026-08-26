import type { AcceptedForTargetSummary } from '@/modules/prospect-batches/accepted-for-target';
// A1-APOLLO-PERSISTENCE-READINESS-4 § 7 — la unión de estados de ejecución se
// importa de la acción en vez de reescribirse aquí: dos copias a mano fue cómo
// `completed_with_errors` habría podido existir en el servidor y no en la UI.
import type {
  WizardExecutionStatus,
  WizardFreeContribution,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';

// ── Search mode contracts ─────────────────────────────────────────────────────

export type ProspectSearchMode = 'exploratory' | 'competitors' | 'suppliers';

export type ProspectSearchModeAvailability = 'enabled' | 'coming_soon' | 'disabled';

export type ProspectSearchModeDefinition = {
  mode: ProspectSearchMode;
  label: string;
  description: string;
  availability: ProspectSearchModeAvailability;
};

// ── Step contracts ────────────────────────────────────────────────────────────

export type ProspectWizardStep =
  | 'welcome'
  | 'search_type'
  | 'country'
  | 'industry'
  | 'subindustries'
  | 'additional_criteria'
  | 'requested_count'
  | 'summary'
  | 'validating'
  | 'validated'
  | 'submitting'
  | 'success'
  | 'blocked'
  | 'error';

export type EditableWizardStep =
  | 'search_type'
  | 'country'
  | 'industry'
  | 'subindustries'
  | 'additional_criteria'
  | 'requested_count';

// ── Feedback contracts ────────────────────────────────────────────────────────

export type WizardWarningCode =
  | 'SUBINDUSTRIES_REMOVED_AFTER_COUNTRY_CHANGE'
  | 'MODE_COMING_SOON'
  | 'CRITERIA_DIFFICULT_TO_VERIFY'
  | 'CRITERIA_OUTSIDE_CATALOG';

export type WizardBlockingIssueCode =
  | 'COUNTRY_REQUIRED'
  | 'INDUSTRY_REQUIRED'
  | 'TOO_MANY_SUBINDUSTRIES'
  | 'CRITERIA_TOO_LONG'
  | 'REQUESTED_COUNT_OUT_OF_RANGE'
  | 'UNSAFE_CRITERIA'
  | 'DISCRIMINATORY_CRITERIA'
  | 'PROMPT_INJECTION'
  | 'OUT_OF_SCOPE'
  | 'SERVER_VALIDATION_FAILED';

export type WizardWarning = {
  code: WizardWarningCode;
  step: ProspectWizardStep;
  message: string;
};

export type WizardBlockingIssue = {
  code: WizardBlockingIssueCode;
  step: ProspectWizardStep;
  message: string;
  recoverable: boolean;
};

// ── Guard contract (prepared for 16AB.35.3) ───────────────────────────────────

export type CriteriaGuardResult = {
  status: 'allowed' | 'warning' | 'blocked';
  normalizedValue: string | null;
  warnings: WizardWarning[];
  blockingIssues: WizardBlockingIssue[];
};

// ── State contract ────────────────────────────────────────────────────────────

export type ProspectWizardState = {
  currentStep: ProspectWizardStep;

  searchMode: ProspectSearchMode | null;
  countryCode: string | null;
  industryId: string | null;
  subindustryIds: string[];
  additionalCriteriaRaw: string | null;
  requestedCount: number | null;
  catalogVersion: string;

  validationStatus: 'idle' | 'validating' | 'valid' | 'invalid';

  warnings: WizardWarning[];
  blockingIssues: WizardBlockingIssue[];

  lastEditedStep: ProspectWizardStep | null;
  restartConfirmationRequired: boolean;

  executionError: { code: string; message: string; retryable: boolean } | null;
  executionBatchId: string | null;
  executionRedirectPath: string | null;
  executionStatus: WizardExecutionStatus | null;
  /** True when novelty pre-check confirms the universe of domains for these criteria is exhausted. */
  executionNoveltyExhausted?: boolean;
  /**
   * AGENT1-LOCAL-CUT8 § 3 — FILAS DURABLES que la ejecución dejó en el lote.
   *
   * 🔴 Es el universo durable, no el objetivo y no lo aceptado. Antes de este
   * corte el panel de éxito recibía como `candidateCount` el objetivo
   * `executionTargetPersistibleCandidates`, así que una corrida que pidió 10 y
   * guardó 4 anunciaba «Se generaron 10 candidatos». Este campo existe para que
   * ese número sea el que la base tiene.
   *
   * `undefined` cuando el servidor no lo envió (p. ej. `already_started`, que no
   * ejecutó nada): entonces el copy no afirma ninguna cifra.
   */
  executionCandidateCount?: number;
  /**
   * AGENT1-LOCAL-CUT8 §§ 1, 4 — el resumen CANÓNICO de aceptación hacia el
   * objetivo, tal como lo resolvió `resolveAcceptedForTarget` en el servidor.
   *
   * 🔴 Es la ÚNICA autoridad de objetivo del estado del mago. Los campos
   * `executionTargetReached` y `executionTargetPersistibleCandidates` que vivían
   * aquí se han retirado a propósito: eran un segundo veredicto y un segundo
   * objetivo que nadie despachaba —el `dispatch` nunca los enviaba— y que la UI
   * ya usaba mal. `requestedTarget` y `targetReached` se leen de aquí.
   *
   * `null` = esta ejecución no declaró aceptación. Ciclo de vida de UNA
   * ejecución: se borra al empezar el intento siguiente y al reiniciar el mago,
   * por la misma razón que `executionFreeContribution` (§ L).
   */
  executionAcceptedForTarget: AcceptedForTargetSummary | null;
  /**
   * AGENT1-LOCAL-CUT6B-PARTIAL-UI-PROPAGATION §§ 3, 5 — empresas que la capa
   * GRATUITA dejó guardadas en la ejecución que acaba de FALLAR.
   *
   * `null` = esta ejecución no dejó nada durable, que es el caso de todo fallo
   * anterior a la capa gratuita. NO es lo mismo que `executionBatchId`: ése
   * describe un lote de una corrida que terminó BIEN, y confundirlos dejaría al
   * paso de éxito leyendo el lote de un fallo.
   *
   * 🔴 Su ciclo de vida es el de UNA ejecución: se guarda al fallar, y se borra
   * al empezar el intento siguiente, al terminar con éxito y al reiniciar el
   * mago. Sin ese borrado, un fallo posterior SIN aporte enseñaría las empresas
   * de una corrida anterior — una mentira peor que el silencio que CUT-6B cierra.
   */
  executionFreeContribution: WizardFreeContribution | null;
};

// ── Action contracts ──────────────────────────────────────────────────────────

export type ProspectWizardAction =
  | { type: 'START' }
  | { type: 'SELECT_SEARCH_MODE'; mode: ProspectSearchMode }
  | { type: 'SELECT_COUNTRY'; countryCode: string }
  | { type: 'SELECT_INDUSTRY'; industryId: string }
  /**
   * AGENT1-MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § A — cada cambio de la
   * multiselección se COMPROMETE en el estado, sin avanzar de paso.
   *
   * Antes la selección vivía en un `useState` local del paso, y el árbol del paso
   * activo se desmonta cada vez que el hilo de mensajes vuelve a "escribir". Un
   * desmontaje entre el primer clic y «Continuar» reiniciaba ese borrador desde
   * `state.subindustryIds` y descartaba en silencio lo ya elegido: nadie lo
   * advertía, y el lote se creaba con menos subindustrias de las pedidas.
   */
  | { type: 'SET_SUBINDUSTRY_SELECTION'; subindustryIds: string[] }
  | { type: 'SET_SUBINDUSTRIES'; subindustryIds: string[] }
  | { type: 'SKIP_SUBINDUSTRIES' }
  | { type: 'SET_ADDITIONAL_CRITERIA'; value: string | null }
  | { type: 'SKIP_ADDITIONAL_CRITERIA' }
  | { type: 'SET_REQUESTED_COUNT'; value: number }
  | { type: 'GO_BACK' }
  | { type: 'EDIT_STEP'; step: EditableWizardStep }
  | { type: 'REQUEST_RESTART' }
  | { type: 'CANCEL_RESTART' }
  | { type: 'CONFIRM_RESTART' }
  | { type: 'BEGIN_VALIDATION' }
  | { type: 'VALIDATION_SUCCEEDED' }
  | {
      type: 'VALIDATION_FAILED';
      warnings: WizardWarning[];
      blockingIssues: WizardBlockingIssue[];
    }
  | { type: 'CLEAR_FEEDBACK' }
  | { type: 'RECONCILE_COUNTRY_SUBINDUSTRIES'; compatibleSubindustryIds: string[] }
  | { type: 'APPLY_CRITERIA_GUARD_RESULT'; rawValue: string; result: CriteriaGuardResult }
  | { type: 'BEGIN_EXECUTION' }
  // AGENT1-LOCAL-CUT8 § 3 — el éxito transporta lo que el SERVIDOR derivó: las
  // filas durables y el resumen canónico de aceptación. Ni el objetivo suelto ni
  // un `targetReached` propio: los dos viven dentro de `acceptedForTarget`, que
  // es la autoridad, y duplicarlos aquí permitiría despachar un veredicto que no
  // concuerde con sus propias cifras.
  | { type: 'EXECUTION_SUCCEEDED'; batchId: string; redirectPath: string; status: WizardExecutionStatus; noveltyExhausted?: boolean; candidateCount?: number; acceptedForTarget: AcceptedForTargetSummary | null }
  /**
   * AGENT1-LOCAL-CUT6B-PARTIAL-UI-PROPAGATION § 3 — `freeContribution` viaja en la
   * acción, no se vuelve a leer del resultado desde el reducer.
   *
   * Opcional porque la mayoría de los fallos ocurren antes de la capa gratuita y
   * no tienen nada que declarar. Ausente ⇒ el reducer guarda `null`, y la UI se
   * comporta EXACTAMENTE como antes de este corte.
   */
  | {
      type: 'EXECUTION_FAILED';
      errorCode: string;
      message: string;
      retryable: boolean;
      freeContribution?: WizardFreeContribution;
    };

// ── Derived message contract ──────────────────────────────────────────────────

export type DerivedWizardMessageRole = 'assistant' | 'user' | 'system';

export type DerivedWizardMessageType =
  | 'text'
  | 'choice'
  | 'selection_summary'
  | 'warning'
  | 'error'
  | 'confirmation';

export type DerivedWizardMessage = {
  id: string;
  role: DerivedWizardMessageRole;
  messageType: DerivedWizardMessageType;
  content: string;
  step: ProspectWizardStep;
};

export type WizardMessageContext = {
  countries: Array<{ code: string; name: string }>;
  industries: Array<{ id: string; name: string }>;
  subindustries: Array<{ id: string; name: string }>;
};

// ── Selector output contracts ─────────────────────────────────────────────────

export type WizardProgress = {
  currentStepIndex: number;
  totalSteps: number;
  percentage: number;
};

export type WizardFormPayload = {
  countryCode: string;
  industryId: string;
  subindustryIds: string[];
  additionalCriteriaRaw: string | null;
  requestedCount: number;
  catalogVersion: string;
};

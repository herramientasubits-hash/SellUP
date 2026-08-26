import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { isSubindustrySelectionEnabled } from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
import { SEARCH_MODE_DEFINITIONS, VALID_COUNTRY_CODES } from './wizard-config';
import { getPreviousWizardStep } from './wizard-selectors';
import type {
  ProspectWizardState,
  ProspectWizardAction,
  ProspectWizardStep,
  WizardWarning,
  WizardBlockingIssue,
} from './wizard-types';

// ── Initial state factory ─────────────────────────────────────────────────────

export type InitialStateParams = {
  catalogVersion: string;
  defaultRequestedCount: number;
};

export function createInitialProspectWizardState(
  params: InitialStateParams,
): ProspectWizardState {
  return {
    currentStep: 'welcome',
    searchMode: null,
    countryCode: null,
    industryId: null,
    subindustryIds: [],
    additionalCriteriaRaw: null,
    requestedCount: params.defaultRequestedCount,
    catalogVersion: params.catalogVersion,
    validationStatus: 'idle',
    warnings: [],
    blockingIssues: [],
    lastEditedStep: null,
    restartConfirmationRequired: false,
    executionError: null,
    executionBatchId: null,
    executionRedirectPath: null,
    executionStatus: null,
    // CUT-6B § 5 — el estado inicial no tiene aporte que declarar. `CONFIRM_RESTART`
    // vuelve por aquí, así que reiniciar el mago lo borra sin una rama propia.
    executionFreeContribution: null,
    // CUT-8 § L — mismo razonamiento para la aceptación: el mago reiniciado no
    // arrastra el veredicto de objetivo de la corrida anterior.
    executionAcceptedForTarget: null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function withoutWarningCode(
  warnings: WizardWarning[],
  code: WizardWarning['code'],
): WizardWarning[] {
  return warnings.filter((w) => w.code !== code);
}

function withoutBlockingCode(
  issues: WizardBlockingIssue[],
  code: WizardBlockingIssue['code'],
): WizardBlockingIssue[] {
  return issues.filter((i) => i.code !== code);
}

function withoutBlockingForStep(
  issues: WizardBlockingIssue[],
  step: ProspectWizardStep,
): WizardBlockingIssue[] {
  return issues.filter((i) => i.step !== step);
}

function withoutWarningsForStep(
  warnings: WizardWarning[],
  step: ProspectWizardStep,
): WizardWarning[] {
  return warnings.filter((w) => w.step !== step);
}

/**
 * MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § A.2 — política ÚNICA y explícita de
 * normalización de la multiselección.
 *
 * Reglas, en este orden:
 *   1. se conserva el ORDEN de selección del usuario;
 *   2. un id repetido se colapsa en su PRIMERA aparición (nunca la última: la
 *      segunda pulsación sobre la misma subindustria no reordena la lista);
 *   3. no se recorta por tope aquí — el tope es fail-closed en el reductor.
 *
 * `[...new Set(ids)]` ya cumple 1 y 2; existe como función nombrada para que las
 * dos ramas que la usan no puedan divergir y para que la política sea testeable
 * por sí sola.
 */
function normalizeSubindustrySelection(subindustryIds: readonly string[]): string[] {
  return [...new Set(subindustryIds)];
}

// ── Reducer ───────────────────────────────────────────────────────────────────

export function prospectWizardReducer(
  state: ProspectWizardState,
  action: ProspectWizardAction,
): ProspectWizardState {
  switch (action.type) {
    // ── START ──────────────────────────────────────────────────────────────
    case 'START': {
      if (state.currentStep !== 'welcome') return state;
      return { ...state, currentStep: 'search_type' };
    }

    // ── SELECT_SEARCH_MODE ──────────────────────────────────────────────────
    case 'SELECT_SEARCH_MODE': {
      if (state.currentStep !== 'search_type') return state;
      const modeDef = SEARCH_MODE_DEFINITIONS.find((d) => d.mode === action.mode);
      if (!modeDef) return state;

      if (modeDef.availability !== 'enabled') {
        const warning: WizardWarning = {
          code: 'MODE_COMING_SOON',
          step: 'search_type',
          message: `El modo "${modeDef.label}" estará disponible próximamente.`,
        };
        return {
          ...state,
          searchMode: action.mode,
          warnings: [
            ...withoutWarningCode(state.warnings, 'MODE_COMING_SOON'),
            warning,
          ],
        };
      }

      return {
        ...state,
        searchMode: action.mode,
        currentStep: 'country',
        warnings: withoutWarningCode(state.warnings, 'MODE_COMING_SOON'),
      };
    }

    // ── SELECT_COUNTRY ──────────────────────────────────────────────────────
    case 'SELECT_COUNTRY': {
      if (state.currentStep !== 'country') return state;

      if (!VALID_COUNTRY_CODES.has(action.countryCode)) {
        const issue: WizardBlockingIssue = {
          code: 'COUNTRY_REQUIRED',
          step: 'country',
          message: 'El código de país no es válido.',
          recoverable: true,
        };
        return {
          ...state,
          blockingIssues: [
            ...withoutBlockingCode(state.blockingIssues, 'COUNTRY_REQUIRED'),
            issue,
          ],
        };
      }

      return {
        ...state,
        countryCode: action.countryCode,
        currentStep: 'industry',
        blockingIssues: withoutBlockingCode(state.blockingIssues, 'COUNTRY_REQUIRED'),
        lastEditedStep: state.lastEditedStep,
      };
    }

    // ── RECONCILE_COUNTRY_SUBINDUSTRIES ─────────────────────────────────────
    case 'RECONCILE_COUNTRY_SUBINDUSTRIES': {
      const compatible = new Set(action.compatibleSubindustryIds);
      const kept = state.subindustryIds.filter((id) => compatible.has(id));
      const removed = state.subindustryIds.length - kept.length;

      if (removed === 0) {
        return { ...state, subindustryIds: kept };
      }

      const warning: WizardWarning = {
        code: 'SUBINDUSTRIES_REMOVED_AFTER_COUNTRY_CHANGE',
        step: 'subindustries',
        message: `Se eliminaron ${removed} subindustria${removed > 1 ? 's' : ''} que no están disponibles para el nuevo país.`,
      };

      return {
        ...state,
        subindustryIds: kept,
        warnings: [
          ...withoutWarningCode(state.warnings, 'SUBINDUSTRIES_REMOVED_AFTER_COUNTRY_CHANGE'),
          warning,
        ],
      };
    }

    // ── SELECT_INDUSTRY ─────────────────────────────────────────────────────
    case 'SELECT_INDUSTRY': {
      if (state.currentStep !== 'industry') return state;

      return {
        ...state,
        industryId: action.industryId,
        // § 7 — la selección de subindustria se limpia SIEMPRE al elegir
        // industria, en las dos taxonomías. Bajo el catálogo macro, además,
        // el paso siguiente ya no existe.
        subindustryIds: [],
        currentStep: isSubindustrySelectionEnabled(state.catalogVersion)
          ? 'subindustries'
          : 'additional_criteria',
        warnings: withoutWarningCode(
          state.warnings,
          'SUBINDUSTRIES_REMOVED_AFTER_COUNTRY_CHANGE',
        ),
        blockingIssues: withoutBlockingCode(state.blockingIssues, 'INDUSTRY_REQUIRED'),
      };
    }

    // ── SET_SUBINDUSTRY_SELECTION ───────────────────────────────────────────
    // MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § A.2 — commit sin avanzar.
    //
    // El paso ya no guarda un borrador propio: cada clic del multiselector
    // aterriza aquí. Así la selección sobrevive a cualquier remontaje del árbol
    // del paso activo (el hilo de mensajes lo desmonta mientras "escribe") y la
    // pantalla de confirmación siempre lee lo mismo que viajará en la solicitud.
    case 'SET_SUBINDUSTRY_SELECTION': {
      if (state.currentStep !== 'subindustries') return state;

      const normalized = normalizeSubindustrySelection(action.subindustryIds);
      const max = EXPLORATORY_SEARCH_LIMITS.subindustries.max;

      // Fail-closed: por encima del tope NO se trunca en silencio. Truncar
      // elegiría por el usuario cuáles descartar, que es exactamente la clase de
      // pérdida invisible que este hito cierra.
      if (normalized.length > max) {
        const issue: WizardBlockingIssue = {
          code: 'TOO_MANY_SUBINDUSTRIES',
          step: 'subindustries',
          message: `Puedes seleccionar hasta ${max} subindustrias.`,
          recoverable: true,
        };
        return {
          ...state,
          blockingIssues: [
            ...withoutBlockingCode(state.blockingIssues, 'TOO_MANY_SUBINDUSTRIES'),
            issue,
          ],
        };
      }

      return {
        ...state,
        subindustryIds: normalized,
        blockingIssues: withoutBlockingCode(state.blockingIssues, 'TOO_MANY_SUBINDUSTRIES'),
      };
    }

    // ── SET_SUBINDUSTRIES ───────────────────────────────────────────────────
    case 'SET_SUBINDUSTRIES': {
      if (state.currentStep !== 'subindustries') return state;

      // Normalize: deduplicate preserving the first occurrence (§ A.3 caso E).
      const deduped = normalizeSubindustrySelection(action.subindustryIds);
      const max = EXPLORATORY_SEARCH_LIMITS.subindustries.max;

      if (deduped.length > max) {
        const issue: WizardBlockingIssue = {
          code: 'TOO_MANY_SUBINDUSTRIES',
          step: 'subindustries',
          message: `Puedes seleccionar hasta ${max} subindustrias.`,
          recoverable: true,
        };
        return {
          ...state,
          blockingIssues: [
            ...withoutBlockingCode(state.blockingIssues, 'TOO_MANY_SUBINDUSTRIES'),
            issue,
          ],
        };
      }

      return {
        ...state,
        subindustryIds: deduped,
        currentStep: 'additional_criteria',
        blockingIssues: withoutBlockingCode(state.blockingIssues, 'TOO_MANY_SUBINDUSTRIES'),
      };
    }

    // ── SKIP_SUBINDUSTRIES ──────────────────────────────────────────────────
    case 'SKIP_SUBINDUSTRIES': {
      if (state.currentStep !== 'subindustries') return state;

      return {
        ...state,
        subindustryIds: [],
        currentStep: 'additional_criteria',
        blockingIssues: withoutBlockingCode(state.blockingIssues, 'TOO_MANY_SUBINDUSTRIES'),
      };
    }

    // ── SET_ADDITIONAL_CRITERIA ─────────────────────────────────────────────
    case 'SET_ADDITIONAL_CRITERIA': {
      if (state.currentStep !== 'additional_criteria') return state;

      const value = action.value;
      const maxChars = EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars;

      if (value !== null && value.length > maxChars) {
        const issue: WizardBlockingIssue = {
          code: 'CRITERIA_TOO_LONG',
          step: 'additional_criteria',
          message: `El criterio específico puede tener máximo ${maxChars} caracteres.`,
          recoverable: true,
        };
        return {
          ...state,
          blockingIssues: [
            ...withoutBlockingCode(state.blockingIssues, 'CRITERIA_TOO_LONG'),
            issue,
          ],
        };
      }

      return {
        ...state,
        additionalCriteriaRaw: value,
        currentStep: 'requested_count',
        blockingIssues: withoutBlockingForStep(
          state.blockingIssues,
          'additional_criteria',
        ),
        warnings: withoutWarningsForStep(state.warnings, 'additional_criteria'),
      };
    }

    // ── SKIP_ADDITIONAL_CRITERIA ────────────────────────────────────────────
    case 'SKIP_ADDITIONAL_CRITERIA': {
      if (state.currentStep !== 'additional_criteria') return state;

      return {
        ...state,
        additionalCriteriaRaw: null,
        currentStep: 'summary',
        blockingIssues: withoutBlockingForStep(
          state.blockingIssues,
          'additional_criteria',
        ),
        warnings: withoutWarningsForStep(state.warnings, 'additional_criteria'),
      };
    }

    // ── APPLY_CRITERIA_GUARD_RESULT ─────────────────────────────────────────
    case 'APPLY_CRITERIA_GUARD_RESULT': {
      if (state.currentStep !== 'additional_criteria') return state;

      const { result } = action;

      if (result.status === 'blocked') {
        return {
          ...state,
          additionalCriteriaRaw: null,
          blockingIssues: [
            ...withoutBlockingForStep(state.blockingIssues, 'additional_criteria'),
            ...result.blockingIssues,
          ],
          warnings: [
            ...withoutWarningsForStep(state.warnings, 'additional_criteria'),
            ...result.warnings,
          ],
        };
      }

      // allowed or warning — advance directly to summary
      return {
        ...state,
        additionalCriteriaRaw: result.normalizedValue,
        currentStep: 'summary',
        blockingIssues: [
          ...withoutBlockingForStep(state.blockingIssues, 'additional_criteria'),
          ...result.blockingIssues,
        ],
        warnings: [
          ...withoutWarningsForStep(state.warnings, 'additional_criteria'),
          ...result.warnings,
        ],
      };
    }

    // ── SET_REQUESTED_COUNT ─────────────────────────────────────────────────
    case 'SET_REQUESTED_COUNT': {
      if (state.currentStep !== 'requested_count') return state;

      const { min, max } = EXPLORATORY_SEARCH_LIMITS.requestedCount;

      if (action.value < min || action.value > max) {
        const issue: WizardBlockingIssue = {
          code: 'REQUESTED_COUNT_OUT_OF_RANGE',
          step: 'requested_count',
          message: `La cantidad debe estar entre ${min} y ${max}.`,
          recoverable: true,
        };
        return {
          ...state,
          blockingIssues: [
            ...withoutBlockingCode(state.blockingIssues, 'REQUESTED_COUNT_OUT_OF_RANGE'),
            issue,
          ],
        };
      }

      return {
        ...state,
        requestedCount: action.value,
        currentStep: 'summary',
        blockingIssues: withoutBlockingCode(
          state.blockingIssues,
          'REQUESTED_COUNT_OUT_OF_RANGE',
        ),
      };
    }

    // ── GO_BACK ─────────────────────────────────────────────────────────────
    case 'GO_BACK': {
      // MACRO-INDUSTRY-CATALOG-DISCOVERY-1 § 7 — sin paso de subindustria, volver
      // atrás desde el criterio adicional lleva a la industria. Dejar el mapa
      // estático llevaría a un paso que no se renderiza: un hueco visual, que es
      // exactamente lo que el § 7 prohíbe.
      const prev = getPreviousWizardStep(state.currentStep, state.catalogVersion);
      if (!prev) return state;

      return {
        ...state,
        currentStep: prev,
      };
    }

    // ── EDIT_STEP ───────────────────────────────────────────────────────────
    case 'EDIT_STEP': {
      // § 7 — un paso que no existe en esta taxonomía tampoco se puede editar.
      // El botón no se renderiza; esto cierra la vía por acción directa.
      if (action.step === 'subindustries' && !isSubindustrySelectionEnabled(state.catalogVersion)) {
        return state;
      }
      return {
        ...state,
        currentStep: action.step,
        lastEditedStep: action.step,
      };
    }

    // ── REQUEST_RESTART ─────────────────────────────────────────────────────
    case 'REQUEST_RESTART': {
      return { ...state, restartConfirmationRequired: true };
    }

    // ── CANCEL_RESTART ──────────────────────────────────────────────────────
    case 'CANCEL_RESTART': {
      return { ...state, restartConfirmationRequired: false };
    }

    // ── CONFIRM_RESTART ─────────────────────────────────────────────────────
    case 'CONFIRM_RESTART': {
      return createInitialProspectWizardState({
        catalogVersion: state.catalogVersion,
        defaultRequestedCount: EXPLORATORY_SEARCH_LIMITS.requestedCount.default,
      });
    }

    // ── BEGIN_VALIDATION ────────────────────────────────────────────────────
    case 'BEGIN_VALIDATION': {
      if (state.currentStep !== 'summary' && state.currentStep !== 'blocked') return state;

      return {
        ...state,
        currentStep: 'validating',
        validationStatus: 'validating',
      };
    }

    // ── VALIDATION_SUCCEEDED ────────────────────────────────────────────────
    case 'VALIDATION_SUCCEEDED': {
      if (state.currentStep !== 'validating') return state;

      return {
        ...state,
        currentStep: 'validated',
        validationStatus: 'valid',
        blockingIssues: [],
      };
    }

    // ── VALIDATION_FAILED ───────────────────────────────────────────────────
    case 'VALIDATION_FAILED': {
      if (state.currentStep !== 'validating') return state;

      const hasBlocking = action.blockingIssues.length > 0;
      return {
        ...state,
        currentStep: hasBlocking ? 'blocked' : 'summary',
        validationStatus: 'invalid',
        warnings: [...state.warnings, ...action.warnings],
        blockingIssues: [...state.blockingIssues, ...action.blockingIssues],
      };
    }

    // ── CLEAR_FEEDBACK ──────────────────────────────────────────────────────
    case 'CLEAR_FEEDBACK': {
      return {
        ...state,
        warnings: [],
        blockingIssues: [],
        validationStatus: 'idle',
      };
    }

    // ── BEGIN_EXECUTION ─────────────────────────────────────────────────────
    case 'BEGIN_EXECUTION': {
      if (state.currentStep !== 'validated') return state;
      return {
        ...state,
        currentStep: 'submitting',
        executionError: null,
        // 🔴 CUT-6B § 5 — un intento NUEVO empieza sin el aporte del anterior. Sin
        // esto, un segundo fallo que no dejó nada durable seguiría enseñando las
        // empresas de la corrida previa, y el mago afirmaría sobre ESTA ejecución
        // un hecho que pertenece a otra.
        executionFreeContribution: null,
        // 🔴 CUT-8 § L — y tampoco la ACEPTACIÓN del intento anterior. Sin este
        // borrado, una segunda corrida que no llegara a declarar aceptación
        // seguiría enseñando el «objetivo alcanzado» de la primera: el mago
        // afirmaría sobre ESTA ejecución un hecho de otra. Es la misma regla que
        // CUT-6B fijó para el aporte gratuito, aplicada al veredicto.
        executionAcceptedForTarget: null,
        executionCandidateCount: undefined,
      };
    }

    // ── EXECUTION_SUCCEEDED ─────────────────────────────────────────────────
    case 'EXECUTION_SUCCEEDED': {
      if (state.currentStep !== 'submitting') return state;
      return {
        ...state,
        currentStep: 'success',
        executionBatchId: action.batchId,
        executionRedirectPath: action.redirectPath,
        executionStatus: action.status,
        executionNoveltyExhausted: action.noveltyExhausted ?? false,
        // 🔴 CUT-8 § 3 — las FILAS durables que el servidor declaró, no el
        // objetivo. Se guarda `action.candidateCount` tal cual, sin `?? 0`: un
        // cero afirmaría que no se guardó nada, y «el servidor no lo envió» es
        // una corrida distinta de «el servidor envió cero».
        executionCandidateCount: action.candidateCount,
        // El resumen canónico de aceptación, entero. De él salen el objetivo
        // pedido y el veredicto; el estado no guarda copias sueltas de ninguno.
        executionAcceptedForTarget: action.acceptedForTarget,
        executionError: null,
        // CUT-6B § 5 — el éxito ya reporta el TOTAL combinado (CUT-6 § 14) en su
        // propio conteo. Conservar además el aporte parcial dejaría dos cifras
        // describiendo la misma corrida.
        executionFreeContribution: null,
      };
    }

    // ── EXECUTION_FAILED ────────────────────────────────────────────────────
    case 'EXECUTION_FAILED': {
      if (state.currentStep !== 'submitting') return state;
      return {
        ...state,
        currentStep: 'validated',
        executionError: {
          code: action.errorCode,
          message: action.message,
          retryable: action.retryable,
        },
        // 🔴 CUT-6B §§ 3, 4 — el fallo SIGUE siendo un fallo: `executionError` se
        // escribe igual que antes y el paso vuelve a `validated`, así que el
        // reintento es el de siempre. Lo único que se añade es dejar de tirar el
        // hecho durable que el servidor ya declaró.
        //
        // `?? null` y no `action.freeContribution` a secas: un fallo sin aporte
        // tiene que BORRAR el del intento anterior, no dejarlo pasar.
        executionFreeContribution: action.freeContribution ?? null,
      };
    }

    default: {
      const _: never = action;
      void _;
      return state;
    }
  }
}

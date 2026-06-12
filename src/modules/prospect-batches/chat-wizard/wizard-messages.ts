import { SEARCH_MODE_DEFINITIONS } from './wizard-config';
import type {
  ProspectWizardState,
  ProspectWizardStep,
  DerivedWizardMessage,
  WizardMessageContext,
} from './wizard-types';

// ── Step order for "has this step been reached?" checks ──────────────────────

const ORDERED_STEPS: ProspectWizardStep[] = [
  'welcome',
  'search_type',
  'country',
  'industry',
  'subindustries',
  'additional_criteria',
  'requested_count',
  'summary',
  'validating',
  'validated',
  'blocked',
  'error',
];

function stepIndex(step: ProspectWizardStep): number {
  const idx = ORDERED_STEPS.indexOf(step);
  return idx === -1 ? 0 : idx;
}

function hasReached(current: ProspectWizardStep, target: ProspectWizardStep): boolean {
  return stepIndex(current) >= stepIndex(target);
}

// ── Lookup helpers (pure, no side effects) ───────────────────────────────────

function findCountryName(
  code: string | null,
  countries: WizardMessageContext['countries'],
): string | null {
  if (!code) return null;
  return countries.find((c) => c.code === code)?.name ?? null;
}

function findIndustryName(
  id: string | null,
  industries: WizardMessageContext['industries'],
): string | null {
  if (!id) return null;
  return industries.find((i) => i.id === id)?.name ?? null;
}

function findSubindustryNames(
  ids: string[],
  subindustries: WizardMessageContext['subindustries'],
): string[] {
  return ids.map((id) => subindustries.find((s) => s.id === id)?.name ?? id);
}

// ── Message builder ───────────────────────────────────────────────────────────

export function deriveWizardMessages(
  state: ProspectWizardState,
  context: WizardMessageContext,
): DerivedWizardMessage[] {
  const messages: DerivedWizardMessage[] = [];

  // ── Welcome ──────────────────────────────────────────────────────────────
  if (hasReached(state.currentStep, 'search_type')) {
    messages.push({
      id: 'assistant-welcome-greeting',
      role: 'assistant',
      messageType: 'text',
      content: 'Hola, te ayudaré a encontrar los prospectos que necesitas.',
      step: 'welcome',
    });

    messages.push({
      id: 'assistant-welcome-intro',
      role: 'assistant',
      messageType: 'text',
      content: 'Primero, selecciona el tipo de búsqueda que quieres realizar.',
      step: 'welcome',
    });
  }

  // ── Search type ──────────────────────────────────────────────────────────
  if (hasReached(state.currentStep, 'search_type')) {
    messages.push({
      id: 'assistant-search-type-question',
      role: 'assistant',
      messageType: 'choice',
      content: '¿Qué tipo de prospectos quieres encontrar?',
      step: 'search_type',
    });

    if (state.searchMode) {
      const modeDef = SEARCH_MODE_DEFINITIONS.find((d) => d.mode === state.searchMode);
      messages.push({
        id: 'user-search-type-answer',
        role: 'user',
        messageType: 'selection_summary',
        content: modeDef?.label ?? state.searchMode,
        step: 'search_type',
      });

      const isComingSoon = modeDef?.availability !== 'enabled';
      if (isComingSoon) {
        messages.push({
          id: 'assistant-mode-coming-soon',
          role: 'assistant',
          messageType: 'text',
          content: `El modo "${modeDef?.label ?? state.searchMode}" estará disponible próximamente. Por ahora puedes usar "Empresas por criterios".`,
          step: 'search_type',
        });
      }
    }
  }

  // ── Country ──────────────────────────────────────────────────────────────
  if (hasReached(state.currentStep, 'country') && state.searchMode === 'exploratory') {
    messages.push({
      id: 'assistant-country-question',
      role: 'assistant',
      messageType: 'choice',
      content: '¿En qué país quieres buscar?',
      step: 'country',
    });

    if (state.countryCode) {
      const countryName =
        findCountryName(state.countryCode, context.countries) ?? state.countryCode;
      messages.push({
        id: 'user-country-answer',
        role: 'user',
        messageType: 'selection_summary',
        content: countryName,
        step: 'country',
      });
    }
  }

  // ── Industry ─────────────────────────────────────────────────────────────
  if (hasReached(state.currentStep, 'industry') && state.countryCode) {
    messages.push({
      id: 'assistant-industry-question',
      role: 'assistant',
      messageType: 'choice',
      content: '¿En qué industria?',
      step: 'industry',
    });

    if (state.industryId) {
      const industryName =
        findIndustryName(state.industryId, context.industries) ?? state.industryId;
      messages.push({
        id: 'user-industry-answer',
        role: 'user',
        messageType: 'selection_summary',
        content: industryName,
        step: 'industry',
      });
    }
  }

  // ── Subindustries ─────────────────────────────────────────────────────────
  if (hasReached(state.currentStep, 'subindustries') && state.industryId) {
    messages.push({
      id: 'assistant-subindustries-question',
      role: 'assistant',
      messageType: 'choice',
      content:
        '¿Quieres enfocar la búsqueda en subindustrias específicas? Puedes seleccionar hasta 5 o continuar sin filtrar.',
      step: 'subindustries',
    });

    if (hasReached(state.currentStep, 'additional_criteria')) {
      if (state.subindustryIds.length > 0) {
        const names = findSubindustryNames(state.subindustryIds, context.subindustries);
        messages.push({
          id: 'user-subindustries-answer',
          role: 'user',
          messageType: 'selection_summary',
          content: names.join(', '),
          step: 'subindustries',
        });
      } else {
        messages.push({
          id: 'user-subindustries-skipped',
          role: 'user',
          messageType: 'text',
          content: 'Sin filtro de subindustria.',
          step: 'subindustries',
        });
      }
    }

    // Warning: subindustries removed after country change
    const removedWarning = state.warnings.find(
      (w) => w.code === 'SUBINDUSTRIES_REMOVED_AFTER_COUNTRY_CHANGE',
    );
    if (removedWarning) {
      messages.push({
        id: 'warning-subindustries-removed',
        role: 'system',
        messageType: 'warning',
        content: removedWarning.message,
        step: 'subindustries',
      });
    }
  }

  // ── Additional criteria ───────────────────────────────────────────────────
  if (hasReached(state.currentStep, 'additional_criteria') && state.industryId) {
    messages.push({
      id: 'assistant-criteria-question',
      role: 'assistant',
      messageType: 'choice',
      content:
        '¿Tienes algún criterio específico adicional? Por ejemplo: empresa con operación regional, equipos distribuidos. Es opcional.',
      step: 'additional_criteria',
    });

    if (hasReached(state.currentStep, 'requested_count')) {
      if (state.additionalCriteriaRaw) {
        messages.push({
          id: 'user-criteria-answer',
          role: 'user',
          messageType: 'text',
          content: state.additionalCriteriaRaw,
          step: 'additional_criteria',
        });
      } else {
        messages.push({
          id: 'user-criteria-skipped',
          role: 'user',
          messageType: 'text',
          content: 'Sin criterio específico adicional.',
          step: 'additional_criteria',
        });
      }
    }

    // Blocking issues for additional_criteria
    for (const issue of state.blockingIssues.filter(
      (i) => i.step === 'additional_criteria',
    )) {
      messages.push({
        id: `error-criteria-${issue.code.toLowerCase()}`,
        role: 'system',
        messageType: 'error',
        content: issue.message,
        step: 'additional_criteria',
      });
    }

    // Warnings for additional_criteria
    for (const warning of state.warnings.filter(
      (w) => w.step === 'additional_criteria',
    )) {
      messages.push({
        id: `warning-criteria-${warning.code.toLowerCase()}`,
        role: 'system',
        messageType: 'warning',
        content: warning.message,
        step: 'additional_criteria',
      });
    }
  }

  // ── Requested count ───────────────────────────────────────────────────────
  if (hasReached(state.currentStep, 'requested_count') && state.industryId) {
    messages.push({
      id: 'assistant-count-question',
      role: 'assistant',
      messageType: 'choice',
      content: '¿Cuántos prospectos quieres generar?',
      step: 'requested_count',
    });

    if (state.requestedCount !== null && hasReached(state.currentStep, 'summary')) {
      messages.push({
        id: 'user-count-answer',
        role: 'user',
        messageType: 'selection_summary',
        content: String(state.requestedCount),
        step: 'requested_count',
      });
    }

    // Blocking issues for requested_count
    for (const issue of state.blockingIssues.filter(
      (i) => i.step === 'requested_count',
    )) {
      messages.push({
        id: `error-count-${issue.code.toLowerCase()}`,
        role: 'system',
        messageType: 'error',
        content: issue.message,
        step: 'requested_count',
      });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  if (hasReached(state.currentStep, 'summary') && state.requestedCount !== null) {
    messages.push({
      id: 'assistant-summary',
      role: 'assistant',
      messageType: 'text',
      content: 'Esto es lo que entendí de tu búsqueda:',
      step: 'summary',
    });
  }

  // ── Non-step-specific warnings ────────────────────────────────────────────
  for (const warning of state.warnings.filter(
    (w) =>
      w.step !== 'subindustries' &&
      w.step !== 'additional_criteria' &&
      w.code !== 'SUBINDUSTRIES_REMOVED_AFTER_COUNTRY_CHANGE',
  )) {
    messages.push({
      id: `warning-general-${warning.code.toLowerCase()}`,
      role: 'system',
      messageType: 'warning',
      content: warning.message,
      step: warning.step,
    });
  }

  // ── Validation success ────────────────────────────────────────────────────
  if (state.currentStep === 'validated') {
    messages.push({
      id: 'assistant-validated',
      role: 'assistant',
      messageType: 'confirmation',
      content:
        'La búsqueda fue validada correctamente. Puedes proceder a generar los prospectos.',
      step: 'validated',
    });
  }

  // ── Blocked ───────────────────────────────────────────────────────────────
  if (state.currentStep === 'blocked') {
    for (const issue of state.blockingIssues.filter(
      (i) => i.step === 'summary' || i.step === 'blocked',
    )) {
      messages.push({
        id: `error-blocked-${issue.code.toLowerCase()}`,
        role: 'system',
        messageType: 'error',
        content: issue.message,
        step: 'blocked',
      });
    }

    messages.push({
      id: 'assistant-blocked',
      role: 'assistant',
      messageType: 'error',
      content:
        'La búsqueda no puede procesarse por el momento. Revisa los errores y corrige los campos indicados.',
      step: 'blocked',
    });
  }

  return messages;
}

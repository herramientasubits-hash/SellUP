// ── Composer mode type ────────────────────────────────────────────────────────
// Defined here (no React imports) so tests can import without a bundler.

export type WizardComposerMode =
  | 'locked_selection'
  | 'text_input'
  | 'validating'
  | 'validated'
  | 'blocked';

// ── Composer mode mapping ─────────────────────────────────────────────────────

export function getComposerMode(step: string): WizardComposerMode {
  switch (step) {
    case 'additional_criteria':
      return 'text_input';
    case 'validating':
      return 'validating';
    case 'validated':
      return 'validated';
    case 'blocked':
    case 'error':
      return 'blocked';
    default:
      return 'locked_selection';
  }
}

// ── Composer placeholder mapping ──────────────────────────────────────────────

export function getComposerPlaceholder(step: string): string {
  switch (step) {
    case 'search_type':
      return 'Selecciona un tipo de búsqueda para continuar';
    case 'country':
      return 'Selecciona un país para continuar';
    case 'industry':
      return 'Selecciona una industria para continuar';
    case 'subindustries':
      return 'Selecciona subindustrias o continúa sin filtrar';
    case 'additional_criteria':
      return 'Escribe una característica adicional…';
    case 'summary':
      return 'Revisa la configuración y selecciona una acción';
    case 'validating':
      return 'Validando la configuración…';
    case 'validated':
      return 'La configuración ya fue validada';
    case 'blocked':
    case 'error':
      return 'Corrige el problema indicado para continuar';
    default:
      return '';
  }
}
